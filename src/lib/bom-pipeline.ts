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
  findByEmail,
  findByPhone,
  searchCustomersByName,
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

/** Fetch a HubSpot contact's details for fallback customer matching. */
async function fetchContactDetails(contactId: string): Promise<{
  fullName: string | null;
  lastName: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
} | null> {
  const accessToken = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!accessToken) return null;

  try {
    const res = await fetch(
      `https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(contactId)}?properties=firstname,lastname,company,email,phone,mobilephone`,
      {
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        cache: "no-store",
      }
    );
    if (!res.ok) return null;
    const data = await res.json() as { properties: Record<string, string | null> };
    const { firstname, lastname, company, email, phone, mobilephone } = data.properties;

    return {
      fullName: [lastname, firstname].filter(Boolean).map(s => s!.trim()).join(", ") || null,
      lastName: lastname?.trim() || null,
      company: company?.trim() || null,
      email: email?.trim().toLowerCase() || null,
      phone: phone?.trim() || mobilephone?.trim() || null,
    };
  } catch {
    return null;
  }
}

/** Fetch HubSpot deal properties needed by the pipeline. */
async function fetchDealProperties(dealId: string): Promise<{
  dealName: string;
  designFolderUrl: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
}> {
  const accessToken = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!accessToken) throw new Error("HUBSPOT_ACCESS_TOKEN not configured");

  const properties = [
    "dealname",
    "design_documents", "design_document_folder_id", "all_document_parent_folder_id",
    "address_line_1", "city", "state", "postal_code",
  ];
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

  return {
    dealName,
    designFolderUrl,
    address: p.address_line_1?.trim() || null,
    city: p.city?.trim() || null,
    state: p.state?.trim() || null,
  };
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
  let capturedDesignFolderUrl: string | undefined;
  let capturedPlansetName: string | undefined;

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
        designFolderUrl: capturedDesignFolderUrl,
        plansetFileName: capturedPlansetName,
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

    capturedDesignFolderUrl = dealProps.designFolderUrl ?? undefined;

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

    capturedPlansetName = selectedFile.name;
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
    let customerMatchMethod: string = "none";
    const searchAttempts: string[] = [];

    await ensureCustomerCacheLoaded();

    // --- Strategy 1: HubSpot contact ID → Zoho customer mapping ---
    if (primaryContactId) {
      const match = findByHubSpotContactId(primaryContactId);
      if (match) {
        customerId = match.contact_id;
        customerMatchMethod = "hubspot_contact_id";
        console.log(`[bom-pipeline] Auto-matched Zoho customer via HubSpot ID: ${match.contact_name} (${customerId})`);
      } else {
        searchAttempts.push(`HubSpot ID ${primaryContactId} → no match`);
      }
    }

    // Helper: try a name search and auto-select if exactly 1 match or exact-name match
    const tryNameSearch = (query: string, fullName: string | null, label: string): boolean => {
      if (customerId || query.length < 2) return false;
      const matches = searchCustomersByName(query);
      console.log(`[bom-pipeline] ${label} search "${query}" → ${matches.length} match(es)`);

      if (matches.length === 1) {
        customerId = matches[0].contact_id;
        customerMatchMethod = `${label}_single`;
        console.log(`[bom-pipeline] Auto-matched via ${label} (single): ${matches[0].contact_name} (${customerId})`);
        return true;
      }
      if (matches.length > 1 && fullName) {
        const exact = matches.find((c) => c.contact_name.toLowerCase() === fullName.toLowerCase());
        if (exact) {
          customerId = exact.contact_id;
          customerMatchMethod = `${label}_exact`;
          console.log(`[bom-pipeline] Auto-matched via ${label} (exact): ${exact.contact_name} (${customerId})`);
          return true;
        }
      }
      searchAttempts.push(`${label} "${query}" → ${matches.length} match(es), no unique`);
      return false;
    };

    // --- Strategy 2: Deal name (after pipe) → Zoho name search ---
    // Deal names: "PROJ-XXXX | LastName, FirstName | Address" or "PROJ-XXXX | CompanyName"
    if (!customerId && dealName) {
      // Extract customer portion: second segment between pipes
      const segments = dealName.split("|").map((s) => s.trim());
      const afterPipe = segments.length >= 2 ? segments[1] : null;
      if (afterPipe) {
        // 2a: Try full customer portion (e.g. "Morton, Yu")
        tryNameSearch(afterPipe, afterPipe, "deal_name_full");

        // 2b: Try without comma (e.g. "Morton Yu" — Zoho may store as "Yu Morton")
        if (!customerId && afterPipe.includes(",")) {
          const noComma = afterPipe.replace(/,/g, "").trim();
          tryNameSearch(noComma, afterPipe, "deal_name_nocomma");
        }

        // 2c: Try just last name (first word before comma/space)
        if (!customerId) {
          const lastName = afterPipe.split(/[,\s]+/)[0];
          if (lastName && lastName !== afterPipe) {
            tryNameSearch(lastName, afterPipe, "deal_name_lastname");
          }
        }
      }
    }

    // --- Strategy 3: HubSpot contact email/phone/name → Zoho lookup ---
    if (!customerId && primaryContactId) {
      const contactInfo = await fetchContactDetails(primaryContactId);
      if (contactInfo) {
        // 3a: Email match (very reliable — unique identifier)
        if (!customerId && contactInfo.email) {
          const emailMatch = findByEmail(contactInfo.email);
          if (emailMatch) {
            customerId = emailMatch.contact_id;
            customerMatchMethod = "email";
            console.log(`[bom-pipeline] Auto-matched via email ${contactInfo.email}: ${emailMatch.contact_name} (${customerId})`);
          } else {
            searchAttempts.push(`email "${contactInfo.email}" → no match`);
          }
        }

        // 3b: Phone match (reliable — normalize digits)
        if (!customerId && contactInfo.phone) {
          const phoneMatch = findByPhone(contactInfo.phone);
          if (phoneMatch) {
            customerId = phoneMatch.contact_id;
            customerMatchMethod = "phone";
            console.log(`[bom-pipeline] Auto-matched via phone ${contactInfo.phone}: ${phoneMatch.contact_name} (${customerId})`);
          } else {
            searchAttempts.push(`phone "${contactInfo.phone}" → no match`);
          }
        }

        // 3c: Last name → name search
        if (!customerId && contactInfo.lastName) {
          tryNameSearch(contactInfo.lastName, contactInfo.fullName, "contact_lastname");
        }
        // 3d: Full name → name search
        if (!customerId && contactInfo.fullName) {
          tryNameSearch(contactInfo.fullName, contactInfo.fullName, "contact_fullname");
        }
        // 3e: Company name → name search
        if (!customerId && contactInfo.company) {
          tryNameSearch(contactInfo.company, contactInfo.company, "contact_company");
        }
      }
    }

    // --- Strategy 4: Deal address → Zoho name search (address-based) ---
    // Some Zoho customers are named by address or include address in name
    if (!customerId && dealProps.address) {
      // Try last name from deal + address city combo for disambiguation
      const afterPipe = dealName.includes("|") ? dealName.split("|")[1]?.trim() : null;
      const lastName = afterPipe?.split(/[,\s]+/)[0];
      if (lastName && lastName.length >= 2) {
        // Already tried in strategy 2 — skip if same query
        // But try with just the bare last name (no comma/first name)
        const matches = searchCustomersByName(lastName);
        if (matches.length > 1 && dealProps.address) {
          // Multiple matches for last name — try to disambiguate by address in customer name
          const addressWord = dealProps.address.split(/\s+/)[0]; // First word of address (e.g. "1234")
          if (addressWord && addressWord.length >= 3) {
            const addressMatch = matches.find((c) =>
              c.contact_name.toLowerCase().includes(addressWord.toLowerCase())
            );
            if (addressMatch) {
              customerId = addressMatch.contact_id;
              customerMatchMethod = "address_disambiguate";
              console.log(`[bom-pipeline] Auto-matched via address disambiguation: ${addressMatch.contact_name} (${customerId})`);
            } else {
              searchAttempts.push(`address disambiguate "${lastName}" + "${addressWord}" → no match among ${matches.length}`);
            }
          }
        }
      }
    }

    // --- Graceful degradation: skip SO creation instead of failing ---
    if (!customerId) {
      console.warn(`[bom-pipeline] Could not resolve Zoho customer. Attempts: ${searchAttempts.join("; ")}`);

      const durationMs = Date.now() - startedAt;
      await updateRun(runId, {
        status: "PARTIAL",
        failedStep: "RESOLVE_CUSTOMER",
        errorMessage: `Customer not found — BOM saved, SO skipped. Attempts: ${searchAttempts.join("; ")}`,
        durationMs,
        metadata: { customerMatchMethod: "none", searchAttempts },
      });

      await logActivity({
        type: "BOM_PIPELINE_COMPLETED",
        description: `BOM pipeline partial for deal ${dealId} — customer not found, SO skipped`,
        userEmail: PIPELINE_ACTOR.email,
        userName: PIPELINE_ACTOR.name,
        entityType: "bom",
        entityId: dealId,
        entityName: "pipeline",
        metadata: {
          event: "bom_pipeline_partial",
          dealId,
          dealName,
          status: "partial",
          snapshotVersion: snapshotResult.version,
          searchAttempts,
        },
        requestPath: PIPELINE_ACTOR.requestPath,
        requestMethod: PIPELINE_ACTOR.requestMethod,
        durationMs,
      });

      // Notify ops — they need to manually create the SO
      try {
        await sendPipelineNotification({
          dealId,
          dealName,
          status: "partial",
          failedStep: "RESOLVE_CUSTOMER",
          errorMessage: `BOM extracted & saved (v${snapshotResult.version}), but Zoho customer could not be auto-matched. Manual SO creation needed. Searched: ${searchAttempts.join("; ")}`,
          designFolderUrl: dealProps.designFolderUrl ?? undefined,
          plansetFileName: selectedFile.name,
          durationMs,
        });
      } catch (notifyErr) {
        console.error("[bom-pipeline] Failed to send partial notification:", notifyErr);
      }

      return {
        status: "partial" as const,
        dealId,
        dealName,
        snapshotId: snapshotResult.id,
        snapshotVersion: snapshotResult.version,
        durationMs,
        errorMessage: `Customer not found — BOM saved, SO skipped`,
      };
    }

    await updateRun(runId, {
      zohoCustomerId: customerId,
      metadata: { customerMatchMethod, searchAttempts },
    });

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
        soId: soResult.salesorder_id,
        unmatchedCount: soResult.unmatchedCount,
        unmatchedItems: soResult.unmatchedItems,
        customerMatchMethod: customerMatchMethod !== "none" ? customerMatchMethod : undefined,
        designFolderUrl: dealProps.designFolderUrl ?? undefined,
        plansetFileName: selectedFile.name,
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
