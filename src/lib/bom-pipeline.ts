/**
 * BOM Pipeline Orchestrator
 *
 * Runs the full Design-Complete → Draft Sales Order pipeline:
 *   1. Fetch deal properties + primary contact from HubSpot
 *   2. List PDFs in the deal's design documents Drive folder
 *   3. Download + extract BOM from newest stamped planset
 *   4. Save BOM snapshot (with post-processing)
 *   5. Resolve Zoho customer by HubSpot contact ID
 *   6. Create draft Sales Order in Zoho Inventory
 *   7. Log result + notify ops
 *
 * Called by the webhook endpoint after dedupe. Each step is sequential;
 * failure at any step updates the BomPipelineRun record and sends a
 * notification, then stops.
 */

import { prisma, logActivity } from "@/lib/db";
import { getServiceAccountToken } from "@/lib/google-auth";
import { extractBomFromPdf } from "@/lib/bom-extract";
import { saveBomSnapshot, type BomData } from "@/lib/bom-snapshot";
import { createSalesOrder } from "@/lib/bom-so-create";
import { fetchPrimaryContactId } from "@/lib/hubspot";
import {
  ensureCustomerCacheLoaded,
  findByHubSpotContactId,
} from "@/lib/zoho-customer-cache";
import { sendPipelineNotification } from "@/lib/email";
import { PIPELINE_ACTOR } from "@/lib/actor-context";
import type { BomPipelineStep } from "@/generated/prisma/enums";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PipelineResult {
  status: "succeeded" | "failed" | "partial";
  dealId: string;
  dealName?: string;
  snapshotId?: string;
  snapshotVersion?: number;
  zohoSoId?: string;
  zohoSoNumber?: string;
  unmatchedCount?: number;
  failedStep?: BomPipelineStep;
  errorMessage?: string;
  durationMs: number;
}

interface DrivePdfFile {
  id: string;
  name: string;
  modifiedTime: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract a Google Drive folder ID from a URL or bare ID. */
function extractFolderId(input: string): string | null {
  // Full URL: https://drive.google.com/drive/folders/FOLDER_ID?...
  const urlMatch = input.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];

  // Bare alphanumeric ID (no slashes)
  if (/^[a-zA-Z0-9_-]{10,}$/.test(input.trim())) return input.trim();

  return null;
}

/** Fetch HubSpot deal properties needed by the pipeline. */
async function fetchDealProperties(dealId: string): Promise<{
  dealName: string;
  designFolderUrl: string | null;
}> {
  const accessToken = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!accessToken) throw new Error("HUBSPOT_ACCESS_TOKEN not configured");

  const properties = ["dealname", "design_documents", "design_document_folder_id", "all_document_parent_folder_id"];
  const url = `https://api.hubapi.com/crm/v3/objects/deals/${encodeURIComponent(dealId)}?properties=${properties.join(",")}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HubSpot API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json() as {
    properties: Record<string, string | null>;
  };

  const p = data.properties;
  const dealName = p.dealname || `Deal ${dealId}`;
  const designFolderUrl =
    String(p.design_documents || p.design_document_folder_id || p.all_document_parent_folder_id || "").trim() || null;

  return { dealName, designFolderUrl };
}

/** Get a Drive-scoped token, preferring domain-wide delegation (impersonation). */
async function getDriveToken(): Promise<string> {
  const impersonateEmail = process.env.GOOGLE_ADMIN_EMAIL ?? process.env.GMAIL_SENDER_EMAIL;
  if (impersonateEmail) {
    try {
      return await getServiceAccountToken(
        ["https://www.googleapis.com/auth/drive.readonly"],
        impersonateEmail,
      );
    } catch {
      // DWD not configured — fall through to plain SA
    }
  }
  return getServiceAccountToken(["https://www.googleapis.com/auth/drive.readonly"]);
}

/** List PDF files in a Google Drive folder, sorted by modifiedTime descending. */
async function listDrivePdfs(folderId: string): Promise<DrivePdfFile[]> {
  const token = await getDriveToken();

  const query = `'${folderId}' in parents and mimeType='application/pdf' and trashed=false`;
  const fields = "files(id,name,modifiedTime)";
  const orderBy = "modifiedTime desc";
  const url =
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}` +
    `&fields=${encodeURIComponent(fields)}` +
    `&orderBy=${encodeURIComponent(orderBy)}` +
    `&pageSize=50` +
    `&supportsAllDrives=true&includeItemsFromAllDrives=true`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Drive API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json() as { files?: DrivePdfFile[] };
  return data.files ?? [];
}

/** Pick the best planset PDF from a list — prefer "stamped" or "planset" in name. */
function pickBestPlanset(files: DrivePdfFile[]): DrivePdfFile | null {
  if (files.length === 0) return null;

  // Prefer files with "stamped" in the name (case-insensitive)
  const stamped = files.filter((f) => /stamped/i.test(f.name));
  if (stamped.length > 0) return stamped[0]; // already sorted by modifiedTime desc

  // Fallback to files with "planset" or "plan set" in the name
  const planset = files.filter((f) => /plan\s*set/i.test(f.name));
  if (planset.length > 0) return planset[0];

  // Last resort: newest PDF
  return files[0];
}

/** Download a PDF from Google Drive as a Buffer. */
async function downloadDrivePdf(fileId: string): Promise<{ buffer: Buffer; filename: string }> {
  const token = await getDriveToken();

  // Get file metadata for the filename
  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=name&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
  );
  const meta = metaRes.ok ? (await metaRes.json() as { name?: string }) : {};
  const filename = meta.name ?? `planset-${fileId}.pdf`;

  // Download content
  const dlUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
  const dlRes = await fetch(dlUrl, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!dlRes.ok) {
    const body = await dlRes.text().catch(() => "");
    throw new Error(`Drive download ${dlRes.status}: ${body.slice(0, 200)}`);
  }

  const arrayBuffer = await dlRes.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), filename };
}

// ---------------------------------------------------------------------------
// Update helpers
// ---------------------------------------------------------------------------

async function updateRun(
  runId: string,
  data: Record<string, unknown>,
): Promise<void> {
  if (!prisma) return;
  try {
    await prisma.bomPipelineRun.update({ where: { id: runId }, data });
  } catch (e) {
    console.error("[bom-pipeline] Failed to update run record:", e);
  }
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

/**
 * Run the full Design-Complete BOM pipeline.
 *
 * @param runId - The BomPipelineRun record ID (already inserted by the webhook handler).
 * @param dealId - HubSpot deal ID (string, from the webhook event objectId).
 */
export async function runDesignCompletePipeline(
  runId: string,
  dealId: string,
): Promise<PipelineResult> {
  const startedAt = Date.now();
  let currentStep: BomPipelineStep = "FETCH_DEAL";
  let dealName = `Deal ${dealId}`;

  const fail = async (step: BomPipelineStep, error: string): Promise<PipelineResult> => {
    const durationMs = Date.now() - startedAt;
    console.error(`[bom-pipeline] Step ${step} failed for deal ${dealId}: ${error}`);

    await updateRun(runId, {
      status: "FAILED",
      dealName,
      failedStep: step,
      errorMessage: error.slice(0, 2000),
      durationMs,
    });

    await logActivity({
      type: "BOM_PIPELINE_FAILED",
      description: `BOM pipeline failed at ${step} for deal ${dealId}`,
      userEmail: PIPELINE_ACTOR.email,
      userName: PIPELINE_ACTOR.name,
      entityType: "bom",
      entityId: dealId,
      entityName: "pipeline",
      metadata: { event: "bom_pipeline_failed", dealId, dealName, step, error: error.slice(0, 500) },
      requestPath: PIPELINE_ACTOR.requestPath,
      requestMethod: PIPELINE_ACTOR.requestMethod,
      durationMs,
    });

    // Send failure notification (best-effort)
    try {
      await sendPipelineNotification({
        dealId,
        dealName,
        status: "failed",
        failedStep: step,
        errorMessage: error.slice(0, 500),
        durationMs,
      });
    } catch (notifyErr) {
      console.error("[bom-pipeline] Failed to send failure notification:", notifyErr);
    }

    return { status: "failed", dealId, dealName, failedStep: step, errorMessage: error, durationMs };
  };

  try {
    // ── Step 1: Fetch deal properties + primary contact ──
    currentStep = "FETCH_DEAL";

    const [dealProps, primaryContactId] = await Promise.all([
      fetchDealProperties(dealId),
      fetchPrimaryContactId(dealId),
    ]);

    dealName = dealProps.dealName;
    await updateRun(runId, { dealName });

    if (!dealProps.designFolderUrl) {
      return fail("FETCH_DEAL", "Deal has no design_documents folder URL");
    }

    const folderId = extractFolderId(dealProps.designFolderUrl);
    if (!folderId) {
      return fail("FETCH_DEAL", `Cannot extract folder ID from: ${dealProps.designFolderUrl}`);
    }

    // ── Step 2: List PDFs in Drive folder ──
    currentStep = "LIST_PDFS";

    const pdfFiles = await listDrivePdfs(folderId);
    if (pdfFiles.length === 0) {
      return fail("LIST_PDFS", `No PDF files found in Drive folder ${folderId}`);
    }

    const selectedFile = pickBestPlanset(pdfFiles);
    if (!selectedFile) {
      return fail("LIST_PDFS", "Could not select a planset PDF");
    }

    await updateRun(runId, { selectedPlanset: selectedFile.name });
    console.log(`[bom-pipeline] Selected planset: ${selectedFile.name} (${selectedFile.id})`);

    // ── Step 3: Download + Extract BOM ──
    currentStep = "EXTRACT_BOM";

    const { buffer: pdfBuffer, filename } = await downloadDrivePdf(selectedFile.id);
    const extractResult = await extractBomFromPdf(pdfBuffer, filename, PIPELINE_ACTOR);

    if (!extractResult.bom) {
      return fail("EXTRACT_BOM", "BOM extraction returned no data");
    }

    // ── Step 4: Save BOM snapshot ──
    currentStep = "SAVE_SNAPSHOT";

    const snapshotResult = await saveBomSnapshot({
      dealId,
      dealName,
      bomData: extractResult.bom as unknown as BomData,
      sourceFile: filename,
      actor: PIPELINE_ACTOR,
    });

    await updateRun(runId, {
      snapshotId: snapshotResult.id,
      snapshotVersion: snapshotResult.version,
    });

    console.log(`[bom-pipeline] Saved snapshot v${snapshotResult.version} (${snapshotResult.id})`);

    // ── Step 5: Resolve Zoho customer ──
    currentStep = "RESOLVE_CUSTOMER";

    let customerId: string | null = null;

    // Try HubSpot contact ID → Zoho customer mapping first
    if (primaryContactId) {
      await ensureCustomerCacheLoaded();
      const match = findByHubSpotContactId(primaryContactId);
      if (match) {
        customerId = match.contact_id;
        console.log(`[bom-pipeline] Auto-matched Zoho customer: ${match.contact_name} (${customerId})`);
      }
    }

    if (!customerId) {
      return fail(
        "RESOLVE_CUSTOMER",
        primaryContactId
          ? `No Zoho customer found for HubSpot contact ID ${primaryContactId}`
          : "No primary contact associated with deal",
      );
    }

    await updateRun(runId, { zohoCustomerId: customerId });

    // ── Step 6: Create draft Sales Order ──
    currentStep = "CREATE_SO";

    const soResult = await createSalesOrder({
      dealId,
      version: snapshotResult.version,
      customerId,
      actor: PIPELINE_ACTOR,
    });

    await updateRun(runId, {
      zohoSoId: soResult.salesorder_id,
      zohoSoNumber: soResult.salesorder_number,
      unmatchedCount: soResult.unmatchedCount,
    });

    // Determine final status
    const isPartial = soResult.unmatchedCount > 0;
    const finalStatus = soResult.alreadyExisted
      ? "succeeded"
      : isPartial
        ? "partial"
        : "succeeded";

    // ── Step 7: Log + Notify ──
    currentStep = "NOTIFY";
    const durationMs = Date.now() - startedAt;

    await updateRun(runId, { status: finalStatus === "partial" ? "PARTIAL" : "SUCCEEDED", durationMs });

    await logActivity({
      type: "BOM_PIPELINE_COMPLETED",
      description: `BOM pipeline ${finalStatus} for deal ${dealId} — SO ${soResult.salesorder_number ?? soResult.salesorder_id}`,
      userEmail: PIPELINE_ACTOR.email,
      userName: PIPELINE_ACTOR.name,
      entityType: "bom",
      entityId: dealId,
      entityName: "pipeline",
      metadata: {
        event: "bom_pipeline_completed",
        dealId,
        dealName,
        status: finalStatus,
        snapshotVersion: snapshotResult.version,
        salesorderId: soResult.salesorder_id,
        salesorderNumber: soResult.salesorder_number,
        unmatchedCount: soResult.unmatchedCount,
        alreadyExisted: soResult.alreadyExisted,
      },
      requestPath: PIPELINE_ACTOR.requestPath,
      requestMethod: PIPELINE_ACTOR.requestMethod,
      durationMs,
    });

    // Send success/partial notification
    try {
      await sendPipelineNotification({
        dealId,
        dealName,
        status: finalStatus,
        soNumber: soResult.salesorder_number ?? soResult.salesorder_id,
        unmatchedCount: soResult.unmatchedCount,
        durationMs,
      });
    } catch (notifyErr) {
      console.error("[bom-pipeline] Failed to send success notification:", notifyErr);
    }

    return {
      status: finalStatus,
      dealId,
      dealName,
      snapshotId: snapshotResult.id,
      snapshotVersion: snapshotResult.version,
      zohoSoId: soResult.salesorder_id,
      zohoSoNumber: soResult.salesorder_number ?? undefined,
      unmatchedCount: soResult.unmatchedCount,
      durationMs,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(currentStep, message);
  }
}
