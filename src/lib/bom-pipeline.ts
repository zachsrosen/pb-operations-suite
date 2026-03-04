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
 * Retry strategy (two layers):
 *   Layer 1 — Built-in step retry: each step wrapped in withRetry() that
 *     retries once after a delay for known transient errors (API 500/502/503,
 *     rate limits, network timeouts).
 *   Layer 2 — Claude escalation: if auto-retry is exhausted and
 *     PIPELINE_AI_ESCALATION_ENABLED is set, calls Claude Sonnet to analyze
 *     the error and decide whether a fresh pipeline run is warranted.
 *
 * Feature flags:
 *   PIPELINE_AUTO_RETRY_ENABLED  — enable Layer 1 (default: true)
 *   PIPELINE_AI_ESCALATION_ENABLED — enable Layer 2 (default: false)
 */

import { prisma, logActivity } from "@/lib/db";
import { getServiceAccountToken } from "@/lib/google-auth";
import {
  type DrivePdfFile,
  getDriveToken,
  listDrivePdfs,
  pickBestPlanset,
  downloadDrivePdf,
  extractFolderId,
  NON_PLANSET_PATTERNS,
} from "@/lib/drive-plansets";

// Re-export for existing consumers (tests, etc.)
export { type DrivePdfFile, getDriveToken, listDrivePdfs, pickBestPlanset, downloadDrivePdf, extractFolderId, NON_PLANSET_PATTERNS };
import { extractBomFromPdf } from "@/lib/bom-extract";
import { saveBomSnapshot, type BomData } from "@/lib/bom-snapshot";
import { createSalesOrder } from "@/lib/bom-so-create";
import { fetchPrimaryContactId } from "@/lib/hubspot";
import { resolveCustomer } from "@/lib/bom-customer-resolve";
import { sendPipelineNotification } from "@/lib/email";
import { PIPELINE_ACTOR } from "@/lib/actor-context";
import { getAnthropicClient, CLAUDE_MODELS } from "@/lib/anthropic";
import { acquirePipelineLock, DuplicateRunError } from "@/lib/bom-pipeline-lock";
import type { BomPipelineStep, BomPipelineTrigger } from "@/generated/prisma/enums";
import { renderToBuffer } from "@react-pdf/renderer";
import { BomPdfDocument } from "@/components/BomPdfDocument";
import React from "react";

// ---------------------------------------------------------------------------
// Retry Configuration
// ---------------------------------------------------------------------------

const AUTO_RETRY_ENABLED =
  (process.env.PIPELINE_AUTO_RETRY_ENABLED ?? "true").toLowerCase() !== "false";

const AI_ESCALATION_ENABLED =
  process.env.PIPELINE_AI_ESCALATION_ENABLED === "true";

/** Per-step retry policy. Steps not listed here are not retried. */
interface StepRetryPolicy {
  maxAttempts: number;   // total attempts (1 = no retry, 2 = one retry)
  baseDelayMs: number;   // delay before retry
  jitterMs: number;      // random jitter added to delay (0–jitterMs)
  retryableStatuses: number[];
  retryablePatterns: RegExp[];
}

const DEFAULT_RETRYABLE_STATUSES = [500, 502, 503, 429, 529];
const DEFAULT_RETRYABLE_PATTERNS = [
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /fetch failed/i,
  /network/i,
  /socket hang up/i,
  /rate.?limit/i,
  /overloaded/i,
  /too many requests/i,
  /internal server error/i,
  /service unavailable/i,
  /bad gateway/i,
];

const STEP_RETRY_POLICIES: Partial<Record<BomPipelineStep, StepRetryPolicy>> = {
  FETCH_DEAL: {
    maxAttempts: 2,
    baseDelayMs: 3_000,
    jitterMs: 1_000,
    retryableStatuses: DEFAULT_RETRYABLE_STATUSES,
    retryablePatterns: DEFAULT_RETRYABLE_PATTERNS,
  },
  LIST_PDFS: {
    maxAttempts: 2,
    baseDelayMs: 3_000,
    jitterMs: 1_000,
    retryableStatuses: DEFAULT_RETRYABLE_STATUSES,
    retryablePatterns: DEFAULT_RETRYABLE_PATTERNS,
  },
  EXTRACT_BOM: {
    maxAttempts: 2,
    baseDelayMs: 5_000,
    jitterMs: 2_000,
    retryableStatuses: DEFAULT_RETRYABLE_STATUSES,
    retryablePatterns: [
      ...DEFAULT_RETRYABLE_PATTERNS,
      /api_error/i,
    ],
  },
  SAVE_SNAPSHOT: {
    maxAttempts: 2,
    baseDelayMs: 2_000,
    jitterMs: 500,
    retryableStatuses: DEFAULT_RETRYABLE_STATUSES,
    retryablePatterns: [
      /ECONNRESET/i,
      /connection.*closed/i,
      /Can't reach database/i,
      /connection.*timed out/i,
    ],
  },
  RESOLVE_CUSTOMER: {
    maxAttempts: 2,
    baseDelayMs: 2_000,
    jitterMs: 500,
    retryableStatuses: DEFAULT_RETRYABLE_STATUSES,
    retryablePatterns: DEFAULT_RETRYABLE_PATTERNS,
  },
  CREATE_SO: {
    maxAttempts: 2,
    baseDelayMs: 3_000,
    jitterMs: 1_000,
    retryableStatuses: DEFAULT_RETRYABLE_STATUSES,
    retryablePatterns: DEFAULT_RETRYABLE_PATTERNS,
  },
};

// ---------------------------------------------------------------------------
// Retry Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getBomSnapshotUrl(dealId: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "https://www.pbtechops.com").replace(/\/$/, "");
  return `${base}/dashboards/bom?deal=${encodeURIComponent(dealId)}&load=latest`;
}

/** Check if an error matches the retryable patterns for a given step. */
export function isRetryableError(
  err: unknown,
  policy: StepRetryPolicy,
): boolean {
  const message = err instanceof Error ? err.message : String(err);

  // Check HTTP status codes embedded in error messages (e.g., "HubSpot API 502: ...")
  for (const status of policy.retryableStatuses) {
    if (message.includes(String(status))) return true;
  }

  // Check regex patterns
  for (const pattern of policy.retryablePatterns) {
    if (pattern.test(message)) return true;
  }

  return false;
}

/**
 * Execute a step function with optional retry.
 *
 * Returns { result, attempt, retried, retryReason? } so callers can log
 * observability fields.
 */
/** Mutable retry observation updated by withRetry — even on failure */
export interface RetryObservation {
  attempt: number;
  retried: boolean;
  retryReason?: string;
}

export async function withRetry<T>(
  stepName: BomPipelineStep,
  fn: () => Promise<T>,
  obs?: RetryObservation,
): Promise<{ result: T; attempt: number; retried: boolean; retryReason?: string }> {
  const policy = AUTO_RETRY_ENABLED ? STEP_RETRY_POLICIES[stepName] : undefined;

  const setObs = (a: number, r: boolean, reason?: string) => {
    if (obs) { obs.attempt = a; obs.retried = r; obs.retryReason = reason; }
  };

  try {
    const result = await fn();
    setObs(1, false);
    return { result, attempt: 1, retried: false };
  } catch (firstErr) {
    // No retry policy or not retryable — update obs and rethrow
    if (!policy || policy.maxAttempts < 2 || !isRetryableError(firstErr, policy)) {
      setObs(1, false);
      throw firstErr;
    }

    const retryReason = firstErr instanceof Error ? firstErr.message : String(firstErr);
    const delay = policy.baseDelayMs + Math.floor(Math.random() * policy.jitterMs);
    console.warn(
      `[bom-pipeline] ${stepName} failed (attempt 1/${policy.maxAttempts}), retrying in ${delay}ms: ${retryReason.slice(0, 200)}`,
    );

    await sleep(delay);

    try {
      // Second attempt
      const result = await fn();
      console.log(`[bom-pipeline] ${stepName} succeeded on retry (attempt 2/${policy.maxAttempts})`);
      setObs(2, true, retryReason.slice(0, 500));
      return { result, attempt: 2, retried: true, retryReason: retryReason.slice(0, 500) };
    } catch (secondErr) {
      // Both attempts failed — update obs with retry context before rethrowing
      setObs(2, true, retryReason.slice(0, 500));
      throw secondErr;
    }
  }
}

// ---------------------------------------------------------------------------
// Claude Escalation (Layer 2)
// ---------------------------------------------------------------------------

/** 30-minute cooldown — prevent escalation loops. */
const ESCALATION_COOLDOWN_MS = 30 * 60 * 1000;

/** Max time to wait for Claude's analysis response. */
const ESCALATION_TIMEOUT_MS = 15_000;

export interface EscalationResult {
  shouldRetry: boolean;
  reasoning: string;
}

/**
 * Ask Claude Sonnet to analyze a pipeline failure and decide whether to retry.
 *
 * Returns null if escalation is disabled, on cooldown, or if the API call fails.
 * Safe fallback: never retries on error.
 */
export async function escalateToClaudeAnalysis(params: {
  dealId: string;
  dealName: string;
  failedStep: BomPipelineStep;
  errorMessage: string;
  runId: string;
  attempt: number;
}): Promise<EscalationResult | null> {
  if (!AI_ESCALATION_ENABLED) return null;

  // Cooldown check — prevent retry loops
  if (prisma) {
    try {
      const recentRetry = await prisma.bomPipelineRun.findFirst({
        where: {
          dealId: params.dealId,
          createdAt: { gte: new Date(Date.now() - ESCALATION_COOLDOWN_MS) },
          metadata: { path: ["claudeEscalation", "shouldRetry"], equals: true },
        },
        select: { id: true },
      });
      if (recentRetry) {
        console.log(`[bom-pipeline] Skipping escalation — cooldown active (recent retry: ${recentRetry.id})`);
        return null;
      }
    } catch (e) {
      console.warn("[bom-pipeline] Cooldown check failed, proceeding with escalation:", e);
    }
  }

  try {
    const client = getAnthropicClient();

    const systemPrompt = `You are an operations reliability analyst for a solar company's BOM (Bill of Materials) pipeline.

Your job: analyze pipeline failures and decide if an automatic retry is warranted.

Context:
- All pipeline steps are idempotent — safe to re-run from scratch
- Cost of retry is low (~$0.10 for BOM extraction)
- Cost of NOT retrying is high (human must investigate and manually trigger)
- Err on the side of retrying — false retry is cheap

Known transient errors (SHOULD retry):
- Anthropic API: 500, 502, 503, 529, "overloaded", "internal server error", rate limits
- Google Drive: 500, 503, rate limits, "fetch failed"
- Zoho API: 500, 503, rate limits
- Network: ECONNRESET, ETIMEDOUT, "socket hang up", DNS failures
- Database: connection timeouts, "Can't reach database"

Known permanent errors (should NOT retry):
- Missing data: "no design_documents folder", "no PDF files", "no BOM data"
- Auth failures: 401, 403, "unauthorized", "forbidden"
- Validation errors: schema mismatches, constraint violations
- Business logic: "customer not found" (this is handled as PARTIAL, not FAILED)

Respond with ONLY valid JSON: {"shouldRetry": true/false, "reasoning": "brief explanation"}`;

    const userMessage = `Pipeline failure analysis:
- Deal: ${params.dealName} (${params.dealId})
- Failed Step: ${params.failedStep}
- Attempt: ${params.attempt} (after ${params.attempt - 1} auto-retry)
- Error: ${params.errorMessage.slice(0, 1000)}

Should this pipeline be automatically retried?`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ESCALATION_TIMEOUT_MS);

    let response;
    try {
      response = await client.messages.create(
        {
          model: CLAUDE_MODELS.haiku, // fast + cheap for classification
          max_tokens: 200,
          system: systemPrompt,
          messages: [{ role: "user", content: userMessage }],
        },
        { signal: controller.signal },
      );
    } finally {
      clearTimeout(timeout);
    }

    // Parse response with strict validation
    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => ("text" in block ? block.text : ""))
      .join("");

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[bom-pipeline] Escalation response not JSON:", text.slice(0, 300));
      return null; // Safe fallback: don't retry
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate schema
    if (typeof parsed.shouldRetry !== "boolean" || typeof parsed.reasoning !== "string") {
      console.error("[bom-pipeline] Escalation response invalid schema:", parsed);
      return null; // Safe fallback: don't retry
    }

    return {
      shouldRetry: parsed.shouldRetry,
      reasoning: String(parsed.reasoning).slice(0, 500),
    };
  } catch (err) {
    // Any failure in escalation → safe fallback (don't retry)
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[bom-pipeline] Escalation failed (safe fallback: no retry): ${msg}`);
    return null;
  }
}

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

// DrivePdfFile type is now in drive-plansets.ts

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fetch a HubSpot contact's details for fallback customer matching.
 *  Returns null for expected "not found" (404) or missing config.
 *  Throws on transient errors (5xx, rate limits) so withRetry can handle them. */
export async function fetchContactDetails(contactId: string): Promise<{
  fullName: string | null;
  lastName: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
} | null> {
  const accessToken = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!accessToken) return null;

  const res = await fetch(
    `https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(contactId)}?properties=firstname,lastname,company,email,phone,mobilephone`,
    {
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      cache: "no-store",
    }
  );

  // 404 / 400 = contact doesn't exist — not retryable, return null
  if (res.status === 404 || res.status === 400) return null;

  // 5xx / 429 = transient — let it throw so withRetry can handle
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HubSpot contact API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json() as { properties: Record<string, string | null> };
  const { firstname, lastname, company, email, phone, mobilephone } = data.properties;

  return {
    fullName: [lastname, firstname].filter(Boolean).map(s => s!.trim()).join(", ") || null,
    lastName: lastname?.trim() || null,
    company: company?.trim() || null,
    email: email?.trim().toLowerCase() || null,
    phone: phone?.trim() || mobilephone?.trim() || null,
  };
}

/** Fetch HubSpot deal properties needed by the pipeline. */
async function fetchDealProperties(dealId: string): Promise<{
  dealName: string;
  designFolderUrl: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pbLocation: string | null;
}> {
  const accessToken = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!accessToken) throw new Error("HUBSPOT_ACCESS_TOKEN not configured");

  const properties = [
    "dealname",
    "design_documents", "design_document_folder_id", "all_document_parent_folder_id",
    "address_line_1", "city", "state", "postal_code",
    "pb_location",
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
    pbLocation: p.pb_location?.trim() || null,
  };
}

// Drive helpers (getDriveToken, listDrivePdfs, pickBestPlanset, downloadDrivePdf,
// NON_PLANSET_PATTERNS) are now in drive-plansets.ts — imported and re-exported above.

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
  trigger?: BomPipelineTrigger,
): Promise<PipelineResult> {
  const startedAt = Date.now();
  let currentStep: BomPipelineStep = "FETCH_DEAL";
  let dealName = `Deal ${dealId}`;
  let capturedDesignFolderUrl: string | undefined;
  let capturedPlansetName: string | undefined;
  let capturedPbLocation: string | undefined;
  let bomPdfBuffer: Buffer | undefined;

  /** Track per-step retry info for observability. */
  // Shared retry observation — withRetry updates this even on failure
  const retryObs: RetryObservation = { attempt: 1, retried: false };

  const fail = async (step: BomPipelineStep, error: string): Promise<PipelineResult> => {
    const durationMs = Date.now() - startedAt;
    console.error(`[bom-pipeline] Step ${step} failed for deal ${dealId} (attempt ${retryObs.attempt}, retried=${retryObs.retried}): ${error}`);

    // ── Layer 2: Claude escalation ──
    let escalation: EscalationResult | null = null;
    let escalationTriggeredRunId: string | undefined;

    escalation = await escalateToClaudeAnalysis({
      dealId,
      dealName,
      failedStep: step,
      errorMessage: error.slice(0, 1000),
      runId,
      attempt: retryObs.attempt,
    });

    if (escalation?.shouldRetry) {
      console.log(`[bom-pipeline] Claude escalation: retry recommended — "${escalation.reasoning}"`);

      // IMPORTANT: Mark current run as FAILED before acquiring a new lock,
      // otherwise acquirePipelineLock will see this run as still RUNNING
      // and throw DuplicateRunError.
      const escalationMetadata: Record<string, unknown> = {
        attempt: retryObs.attempt,
        retried: retryObs.retried,
        ...(retryObs.retryReason ? { retryReason: retryObs.retryReason } : {}),
        claudeEscalation: {
          shouldRetry: escalation.shouldRetry,
          reasoning: escalation.reasoning,
        },
      };
      await updateRun(runId, {
        status: "FAILED",
        dealName,
        failedStep: step,
        errorMessage: error.slice(0, 2000),
        durationMs,
        metadata: escalationMetadata,
      });

      // Try to start a fresh pipeline run
      try {
        const newRunId = await acquirePipelineLock(dealId, "MANUAL");
        escalationTriggeredRunId = newRunId;

        // Fire-and-forget the retry (runs after this function returns)
        // Import waitUntil lazily to avoid circular dependency issues in tests
        try {
          const { waitUntil } = await import("@vercel/functions");
          waitUntil(
            runDesignCompletePipeline(newRunId, dealId, trigger).catch((retryErr) => {
              console.error(`[bom-pipeline] Escalation-triggered retry failed for deal ${dealId}:`, retryErr);
            }),
          );
        } catch {
          // waitUntil not available (e.g., local dev) — run inline
          runDesignCompletePipeline(newRunId, dealId, trigger).catch((retryErr) => {
            console.error(`[bom-pipeline] Escalation-triggered retry failed for deal ${dealId}:`, retryErr);
          });
        }

        // Update the run metadata with the triggered run ID
        await updateRun(runId, {
          metadata: { ...escalationMetadata, claudeEscalation: { ...escalationMetadata.claudeEscalation as Record<string, unknown>, triggeredRunId: newRunId } },
        });

        await logActivity({
          type: "BOM_PIPELINE_STARTED",
          description: `BOM pipeline auto-retried via AI escalation for deal ${dealId}`,
          userEmail: PIPELINE_ACTOR.email,
          userName: PIPELINE_ACTOR.name,
          entityType: "bom",
          entityId: dealId,
          entityName: "pipeline",
          metadata: {
            event: "bom_pipeline_ai_escalation_retry",
            dealId,
            dealName,
            originalRunId: runId,
            newRunId,
            reasoning: escalation.reasoning,
          },
          requestPath: PIPELINE_ACTOR.requestPath,
          requestMethod: PIPELINE_ACTOR.requestMethod,
        });
      } catch (lockErr) {
        if (lockErr instanceof DuplicateRunError) {
          console.warn("[bom-pipeline] Escalation retry skipped — pipeline already running");
        } else {
          console.error("[bom-pipeline] Escalation retry lock failed:", lockErr);
        }
        // Proceed with normal failure flow
      }
    } else {
      // No escalation retry — mark run as FAILED normally
      if (escalation) {
        console.log(`[bom-pipeline] Claude escalation: no retry — "${escalation.reasoning}"`);
      }

      const metadata: Record<string, unknown> = {
        attempt: retryObs.attempt,
        retried: retryObs.retried,
        ...(retryObs.retryReason ? { retryReason: retryObs.retryReason } : {}),
        ...(escalation ? {
          claudeEscalation: {
            shouldRetry: escalation.shouldRetry,
            reasoning: escalation.reasoning,
          },
        } : {}),
      };

      await updateRun(runId, {
        status: "FAILED",
        dealName,
        failedStep: step,
        errorMessage: error.slice(0, 2000),
        durationMs,
        metadata,
      });
    }

    await logActivity({
      type: "BOM_PIPELINE_FAILED",
      description: `BOM pipeline failed at ${step} for deal ${dealId}`,
      userEmail: PIPELINE_ACTOR.email,
      userName: PIPELINE_ACTOR.name,
      entityType: "bom",
      entityId: dealId,
      entityName: "pipeline",
      metadata: {
        event: "bom_pipeline_failed",
        dealId,
        dealName,
        step,
        error: error.slice(0, 500),
        attempt: retryObs.attempt,
        retried: retryObs.retried,
        escalated: !!escalation,
        escalationDecision: escalation?.shouldRetry ?? null,
      },
      requestPath: PIPELINE_ACTOR.requestPath,
      requestMethod: PIPELINE_ACTOR.requestMethod,
      durationMs,
    });

    // Send failure notification (best-effort)
    try {
      const safeName = (dealName || "BOM").replace(/[^a-z0-9_-]/gi, "_");
      await sendPipelineNotification({
        dealId,
        dealName,
        status: "failed",
        failedStep: step,
        errorMessage: error.slice(0, 500),
        designFolderUrl: capturedDesignFolderUrl,
        plansetFileName: capturedPlansetName,
        pbLocation: capturedPbLocation,
        snapshotUrl: getBomSnapshotUrl(dealId),
        durationMs,
        trigger,
        attempt: retryObs.attempt,
        retried: retryObs.retried,
        retryReason: retryObs.retryReason,
        ...(escalation ? { claudeAnalysis: escalation } : {}),
        ...(escalationTriggeredRunId ? { escalationTriggeredRunId } : {}),
        ...(bomPdfBuffer ? { pdfAttachment: { filename: `BOM-${safeName}.pdf`, content: bomPdfBuffer } } : {}),
      });
    } catch (notifyErr) {
      console.error("[bom-pipeline] Failed to send failure notification:", notifyErr);
    }

    return { status: "failed", dealId, dealName, failedStep: step, errorMessage: error, durationMs };
  };

  try {
    // ── Step 1: Fetch deal properties + primary contact ──
    currentStep = "FETCH_DEAL";

    const { result: [dealProps, primaryContactId] } =
      await withRetry("FETCH_DEAL", () =>
        Promise.all([fetchDealProperties(dealId), fetchPrimaryContactId(dealId)]),
        retryObs,
      );

    dealName = dealProps.dealName;
    await updateRun(runId, { dealName });

    capturedDesignFolderUrl = dealProps.designFolderUrl ?? undefined;
    capturedPbLocation = dealProps.pbLocation ?? undefined;

    if (!dealProps.designFolderUrl) {
      return fail("FETCH_DEAL", "Deal has no design_documents folder URL");
    }

    const folderId = extractFolderId(dealProps.designFolderUrl);
    if (!folderId) {
      return fail("FETCH_DEAL", `Cannot extract folder ID from: ${dealProps.designFolderUrl}`);
    }

    // ── Step 2: List PDFs in Drive folder ──
    currentStep = "LIST_PDFS";

    const { result: pdfFiles } =
      await withRetry("LIST_PDFS", () => listDrivePdfs(folderId), retryObs);

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

    const { result: { buffer: pdfBuffer, filename } } =
      await withRetry("EXTRACT_BOM", () => downloadDrivePdf(selectedFile.id), retryObs);

    // Fetch team feedback (best-effort) to enrich extraction prompt
    let feedbackContext: string | undefined;
    try {
      if (prisma) {
        const fbEntries = await prisma.bomToolFeedback.findMany({
          orderBy: { createdAt: "desc" },
          take: 10,
        });
        if (fbEntries.length > 0) {
          feedbackContext = fbEntries.map(e => {
            const note = e.notes.replace(/\n/g, " ").slice(0, 200);
            return `- "${note}"`;
          }).join("\n");
        }
      }
    } catch {
      // Best-effort — don't block extraction
    }

    const { result: extractResult } =
      await withRetry("EXTRACT_BOM", () => extractBomFromPdf(pdfBuffer, filename, PIPELINE_ACTOR, undefined, feedbackContext), retryObs);

    if (!extractResult.bom) {
      return fail("EXTRACT_BOM", "BOM extraction returned no data");
    }

    // Guard: extraction succeeded but found zero items (likely wrong document)
    const bomItems = (extractResult.bom as { items?: unknown[] }).items ?? [];
    if (bomItems.length === 0) {
      const warnings = (extractResult.bom as { validation?: { warnings?: string[] } }).validation?.warnings ?? [];
      const warningHint = warnings.length > 0 ? ` Warnings: ${warnings.join("; ")}` : "";
      return fail(
        "EXTRACT_BOM",
        `BOM extraction returned 0 items from "${filename}" — likely not a planset.${warningHint}`,
      );
    }

    // ── Step 4: Save BOM snapshot ──
    currentStep = "SAVE_SNAPSHOT";

    const { result: snapshotResult } =
      await withRetry("SAVE_SNAPSHOT", () =>
        saveBomSnapshot({
          dealId,
          dealName,
          bomData: extractResult.bom as unknown as BomData,
          sourceFile: filename,
          actor: PIPELINE_ACTOR,
        }),
        retryObs,
      );

    await updateRun(runId, {
      snapshotId: snapshotResult.id,
      snapshotVersion: snapshotResult.version,
    });

    console.log(`[bom-pipeline] Saved snapshot v${snapshotResult.version} (${snapshotResult.id})`);

    // ── Generate BOM PDF for email attachment (best-effort, non-blocking) ──
    try {
      const generatedAt = new Date().toLocaleDateString("en-US", {
        year: "numeric", month: "short", day: "numeric",
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pdfElement = React.createElement(BomPdfDocument, {
        bom: extractResult.bom as Parameters<typeof BomPdfDocument>[0]["bom"],
        dealName,
        version: snapshotResult.version,
        generatedBy: "BOM Pipeline",
        generatedAt,
      }) as React.ReactElement<any>;

      const rawBuffer = await renderToBuffer(pdfElement);
      bomPdfBuffer = Buffer.from(rawBuffer);
      console.log(`[bom-pipeline] Generated BOM PDF (${bomPdfBuffer.length} bytes)`);
    } catch (pdfErr) {
      console.warn("[bom-pipeline] BOM PDF generation failed (non-fatal):", pdfErr);
      // Continue pipeline — PDF is optional
    }

    // ── Step 5: Resolve Zoho customer ──
    currentStep = "RESOLVE_CUSTOMER";

    const { result: customerResult } = await withRetry(
      "RESOLVE_CUSTOMER",
      () => resolveCustomer({
        dealName,
        primaryContactId,
        dealAddress: dealProps.address,
      }),
      retryObs,
    );

    const { customerId, customerName: _customerName, matchMethod: customerMatchMethod, searchAttempts } = customerResult;

    if (customerId) {
      console.log(`[bom-pipeline] Resolved Zoho customer via ${customerMatchMethod}: ${_customerName} (${customerId})`);
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
        const safeName = (dealName || "BOM").replace(/[^a-z0-9_-]/gi, "_");
        const pdfFilename = `BOM-${safeName}-v${snapshotResult.version}.pdf`;
        await sendPipelineNotification({
          dealId,
          dealName,
          status: "partial",
          failedStep: "RESOLVE_CUSTOMER",
          errorMessage: `BOM extracted & saved (v${snapshotResult.version}), but Zoho customer could not be auto-matched. Manual SO creation needed. Searched: ${searchAttempts.join("; ")}`,
          designFolderUrl: dealProps.designFolderUrl ?? undefined,
          plansetFileName: selectedFile.name,
          pbLocation: dealProps.pbLocation ?? undefined,
          snapshotUrl: getBomSnapshotUrl(dealId),
          durationMs,
          trigger,
          ...(bomPdfBuffer ? { pdfAttachment: { filename: pdfFilename, content: bomPdfBuffer } } : {}),
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

    const { result: soResult } =
      await withRetry("CREATE_SO", () =>
        createSalesOrder({
          dealId,
          version: snapshotResult.version,
          customerId: customerId!,
          actor: PIPELINE_ACTOR,
        }),
        retryObs,
      );

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
      const safeName = (dealName || "BOM").replace(/[^a-z0-9_-]/gi, "_");
      const pdfFilename = `BOM-${safeName}-v${snapshotResult.version}.pdf`;
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
        pbLocation: dealProps.pbLocation ?? undefined,
        snapshotUrl: getBomSnapshotUrl(dealId),
        durationMs,
        trigger,
        ...(bomPdfBuffer ? { pdfAttachment: { filename: pdfFilename, content: bomPdfBuffer } } : {}),
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
