/**
 * PE API Sync
 *
 * Replaces the HTML scraper sync with direct PE Raceway API calls.
 * Syncs document statuses into PeDocumentReview and action items
 * into PeActionItem, with run tracking via PeApiSyncRun.
 *
 * Flow:
 *   1. List all PE projects via API (cursor-paginated)
 *   2. Build HubSpot deal map (reuses existing buildPeDealMap)
 *   3. Derive document statuses from project.documents + actionItems
 *   4. Upsert into PeDocumentReview (same table as scraper)
 *   5. Fetch detail for projects with potential action items
 *   6. Upsert action items into PeActionItem
 *   7. Track run in PeApiSyncRun
 *
 * Status derivation (API → PeDocStatus):
 *   - document.present=true  + has active action item      → ACTION_REQUIRED
 *   - document.present=true  + has review pass, no action  → APPROVED
 *   - document.present=true  + no action items at all      → UNDER_REVIEW ("In Review")
 *   - document.present=false                               → NOT_UPLOADED
 *
 * Source priority: portal scrape > email sync > API sync.
 * The API sync never overwrites rows written by higher-authority sources.
 */

import { prisma } from "@/lib/db";
import { PeDocStatus } from "@/generated/prisma/enums";
import {
  listAllProjects,
  getProjectDetails,
  projectNeedsActionItemDetail,
  quotaBlockActive,
  isDailyQuotaError,
  parseQuotaResetAt,
  PE_API_DOC_MAP,
  PE_ACTION_DOC_MAP,
  type PeProjectListItem,
  type PeProjectDetail,
} from "@/lib/pe-api";
import { PE_CONDITIONAL_DOC_NAMES } from "@/lib/pe-analytics";

/** SystemConfig key holding the ISO timestamp until which PE is daily-quota blocked. */
const QUOTA_BLOCK_KEY = "pe_api_quota_blocked_until";
import { buildPeDealMap, matchProjectToDeal } from "@/lib/pe-scraper-sync";
import { syncPeDocStatusesToHubSpot } from "@/lib/pe-hubspot-sync";
import { detectAndConsumeResubmissions } from "@/lib/pe-uploader-overrides";
import { notifyOverrideResubmissions } from "@/lib/pe-doc-notify";
import { hubspotClient } from "@/lib/hubspot";

/**
 * Stamp pe_portal_url + pe_project_id on matched deals that don't have them
 * yet. Only fills BLANK fields — never overwrites an existing value — so
 * email-verified links and any manual corrections are preserved even if the
 * name matcher would resolve a project to a different deal. Best-effort.
 */
async function stampPortalLinks(
  linkOps: { dealId: string; portalUrl: string; projectId: string }[],
): Promise<number> {
  const byDeal = new Map<string, { portalUrl: string; projectId: string }>();
  for (const op of linkOps) if (!byDeal.has(op.dealId)) byDeal.set(op.dealId, { portalUrl: op.portalUrl, projectId: op.projectId });
  const dealIds = [...byDeal.keys()];
  if (dealIds.length === 0) return 0;

  const current = new Map<string, { url?: string; pid?: string }>();
  for (let i = 0; i < dealIds.length; i += 100) {
    const res = (await hubspotClient.apiRequest({
      method: "POST",
      path: "/crm/v3/objects/deals/batch/read",
      body: { inputs: dealIds.slice(i, i + 100).map((id) => ({ id })), properties: ["pe_portal_url", "pe_project_id"] },
    })) as unknown as { json(): Promise<{ results?: { id: string; properties?: Record<string, string> }[] }> };
    for (const d of (await res.json()).results ?? []) current.set(d.id, { url: d.properties?.pe_portal_url, pid: d.properties?.pe_project_id });
  }

  const inputs: { id: string; properties: Record<string, string> }[] = [];
  for (const [dealId, want] of byDeal) {
    const cur = current.get(dealId) ?? {};
    const props: Record<string, string> = {};
    if (!cur.url) props.pe_portal_url = want.portalUrl;
    if (!cur.pid) props.pe_project_id = want.projectId;
    if (Object.keys(props).length) inputs.push({ id: dealId, properties: props });
  }
  for (let i = 0; i < inputs.length; i += 100) {
    await hubspotClient.apiRequest({ method: "POST", path: "/crm/v3/objects/deals/batch/update", body: { inputs: inputs.slice(i, i + 100) } });
  }
  return inputs.length;
}
import type { ParsedProject } from "@/lib/pe-scraper-sync";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PeApiSyncResult {
  runId: string;
  projectsFetched: number;
  projectsMatched: number;
  docsUpserted: number;
  versionsUpserted: number;
  actionItemsUpserted: number;
  errors: string[];
  unmatchedProjects: string[];
  durationMs: number;
  incremental: boolean;
  since?: string;
}

// ---------------------------------------------------------------------------
// Error code + page number extraction from action item notes
// ---------------------------------------------------------------------------

/**
 * Extract structured data from PE action item notes.
 *
 * Notes format examples:
 *   "[H106] Page 1 — Design plan does not match the installation order"
 *   "[H045] Module layout does not match site photos"
 *   "Page 3 — Missing equipment specifications"
 *   "Needs resubmission"
 */
export function parseActionItemNotes(notes: string): {
  errorCode: string | null;
  pageNumber: number | null;
  cleanNotes: string;
} {
  let errorCode: string | null = null;
  let pageNumber: number | null = null;
  let remaining = notes;

  // Extract error code: [H106], [H045], etc.
  const codeMatch = remaining.match(/^\[([A-Z]\d{2,4})\]\s*/);
  if (codeMatch) {
    errorCode = codeMatch[1];
    remaining = remaining.slice(codeMatch[0].length);
  }

  // Extract page number: "Page 1 —", "Page 3 -", "Page 12 —"
  const pageMatch = remaining.match(/^Page\s+(\d+)\s*[—\-–]\s*/i);
  if (pageMatch) {
    pageNumber = parseInt(pageMatch[1], 10);
    remaining = remaining.slice(pageMatch[0].length);
  }

  return {
    errorCode,
    pageNumber,
    cleanNotes: remaining.trim() || notes,
  };
}

// ---------------------------------------------------------------------------
// Review pass detection — distinguish "no issues" from real action items
// ---------------------------------------------------------------------------

/**
 * PE action items are historical activity log entries that never disappear.
 * They include both review PASSES ("No issues found") and real FAILURES
 * (error codes, specific issues). This function detects pass entries so
 * they don't permanently mark a doc as ACTION_REQUIRED.
 *
 * Conservative approach: only classify as a pass if the notes match the
 * known PE pass format EXACTLY — "{DocName}:\n\n  No issues found.\n\n0
 * issues found." or just "No issues found." If the note contains ANY
 * other substantive content, error codes, or page references, we treat
 * it as a real action item (safe default).
 */
export function isReviewPass(notes: string | null | undefined): boolean {
  if (!notes) return false;

  // Normalize: collapse whitespace, trim
  const normalized = notes.replace(/\s+/g, " ").trim().toLowerCase();

  // Exact match: "no issues found." (simple pass)
  if (normalized === "no issues found." || normalized === "no issues found") {
    return true;
  }

  // Structured pass format: "{DocName}: No issues found. 0 issues found."
  // e.g. "Conditional Progress Lien Waiver:\n\n  No issues found.\n\n0 issues found."
  // After normalization: "conditional progress lien waiver: no issues found. 0 issues found."
  if (/^[a-z][a-z\s()—\-\/]+:\s*no issues found\.?\s*0 issues found\.?$/.test(normalized)) {
    return true;
  }

  // Safety: anything else — even if it contains "no issues found" — is NOT
  // treated as a pass. This avoids false negatives where a reviewer writes
  // something like "No issues found on X but Y needs fixing."
  return false;
}

// ---------------------------------------------------------------------------
// Document status derivation
// ---------------------------------------------------------------------------

/**
 * Map the API's native document `status` field (added by Raceway 2026-06-12)
 * to our PeDocStatus enum. Returns null when the API status is absent or
 * unrecognized — callers fall back to action-item inference.
 *
 * Mapping verified empirically against 2,100 scrape-written rows (2026-06-12):
 *   APPROVED         → APPROVED        (98% concordant; discords = scrape lag)
 *   RESPONSE_NEEDED  → ACTION_REQUIRED (100% concordant)
 *   PENDING_REVIEW   → UNDER_REVIEW
 *   PENDING_APPROVAL → UNDER_REVIEW
 *   null             → NOT_UPLOADED when present=false, else null (infer)
 */
export function mapApiDocStatus(
  status: string | null | undefined,
  present: boolean,
): PeDocStatus | null {
  if (!present) return PeDocStatus.NOT_UPLOADED;
  switch (status) {
    case "APPROVED":
      return PeDocStatus.APPROVED;
    case "RESPONSE_NEEDED":
      return PeDocStatus.ACTION_REQUIRED;
    case "PENDING_REVIEW":
    case "PENDING_APPROVAL":
      return PeDocStatus.UNDER_REVIEW;
    default:
      return null; // missing/unknown — fall back to inference
  }
}

/**
 * Derive PeDocStatus from API document info + action items.
 *
 * FALLBACK ONLY — used when the document has no native `status` field
 * (pre-2026-06-12 API behavior, or a null status on an uploaded doc).
 *
 * Logic:
 *   - Not present (present=false)                   → NOT_UPLOADED
 *   - Present + has active action item              → ACTION_REQUIRED
 *   - Present + has review pass (no active actions)  → APPROVED
 *   - Present + no action items at all               → UNDER_REVIEW ("In Review")
 */
function deriveDocStatus(
  present: boolean,
  hasActiveActionItem: boolean,
  hasReviewPass: boolean,
): PeDocStatus {
  if (!present) return PeDocStatus.NOT_UPLOADED;
  if (hasActiveActionItem) return PeDocStatus.ACTION_REQUIRED;
  if (hasReviewPass) return PeDocStatus.APPROVED;
  return PeDocStatus.UNDER_REVIEW;
}

// ---------------------------------------------------------------------------
// API project → deal matching adapter
// ---------------------------------------------------------------------------

/**
 * Adapt a PE API project to the ParsedProject shape used by matchProjectToDeal.
 * This lets us reuse the existing 4-strategy matching logic.
 */
function apiProjectToParsed(project: PeProjectListItem): ParsedProject {
  return {
    customerName: `${project.customer.firstName} ${project.customer.lastName}`.trim(),
    projNumber: project.projectId, // e.g. "CO2602-KRAF2"
    stage: project.project.currentMilestone,
    m1Status: null,
    m2Status: null,
    epcCost: null,
    documents: [], // not needed for matching
    street: project.project.street, // for address matching
    zip: project.project.zipCode != null ? String(project.project.zipCode) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Core sync
// ---------------------------------------------------------------------------

/**
 * Run a PE API sync: fetch projects (incrementally if possible), derive
 * document statuses, fetch action items, and upsert into the database.
 *
 * Incremental sync: uses the `since` API parameter to only fetch projects
 * modified since the last successful sync. Falls back to a full sync if
 * no prior successful run exists.
 *
 * Time budget: detail fetches stop 30s before the deadline (default 280s)
 * to leave room for DB upserts. Partial results are still saved.
 *
 * @param options.skipActionItems - Skip fetching project details (faster, doc-only sync)
 * @param options.concurrency - Max parallel detail fetches (default 10)
 * @param options.fullSync - Force a full sync ignoring last run timestamp
 * @param options.timeBudgetMs - Total time budget in ms (default 280_000, ~4m40s)
 */
export async function syncFromPeApi(options?: {
  skipActionItems?: boolean;
  concurrency?: number;
  fullSync?: boolean;
  timeBudgetMs?: number;
}): Promise<PeApiSyncResult> {
  const startTime = Date.now();
  const {
    skipActionItems = false,
    concurrency = 10,
    fullSync = false,
    timeBudgetMs = 280_000,
  } = options ?? {};
  const deadlineMs = startTime + timeBudgetMs;

  // Circuit breaker: if a prior run recorded a daily-quota block that hasn't
  // reset yet, skip entirely. Hammering an exhausted quota only logs more
  // failures (and, before the retry fix, burned even more calls).
  const blockRow = await prisma.systemConfig.findUnique({ where: { key: QUOTA_BLOCK_KEY } });
  if (quotaBlockActive(blockRow?.value, startTime)) {
    console.warn(`[pe-api-sync] Skipped — PE daily quota blocked until ${blockRow?.value}`);
    const skipped = await prisma.peApiSyncRun.create({
      data: {
        status: "skipped",
        completedAt: new Date(),
        errors: [`Skipped: PE daily quota blocked until ${blockRow?.value}`],
      },
    });
    return {
      runId: skipped.id,
      projectsFetched: 0,
      projectsMatched: 0,
      docsUpserted: 0,
      versionsUpserted: 0,
      actionItemsUpserted: 0,
      errors: [],
      unmatchedProjects: [],
      durationMs: Date.now() - startTime,
      incremental: false,
    };
  }

  // Create run record
  const run = await prisma.peApiSyncRun.create({
    data: { status: "running" },
  });

  const result: PeApiSyncResult = {
    runId: run.id,
    projectsFetched: 0,
    projectsMatched: 0,
    docsUpserted: 0,
    versionsUpserted: 0,
    actionItemsUpserted: 0,
    errors: [],
    unmatchedProjects: [],
    durationMs: 0,
    incremental: false,
    since: undefined,
  };

  try {
    // -----------------------------------------------------------------------
    // Step 1: Fetch projects from PE API (incremental if possible)
    // -----------------------------------------------------------------------
    let sinceDate: string | undefined;
    if (!fullSync) {
      const lastRun = await prisma.peApiSyncRun.findFirst({
        where: { status: { in: ["completed", "completed_with_errors"] } },
        orderBy: { startedAt: "desc" },
        select: { startedAt: true },
      });
      if (lastRun?.startedAt) {
        // Back up 1 hour from last run start to catch any in-flight updates
        const since = new Date(lastRun.startedAt.getTime() - 60 * 60 * 1000);
        sinceDate = since.toISOString();
      }
    }

    result.incremental = !!sinceDate;
    result.since = sinceDate;

    console.warn(
      sinceDate
        ? `[pe-api-sync] Incremental sync since ${sinceDate}`
        : "[pe-api-sync] Full sync (no prior run or fullSync=true)",
    );
    const projects = await listAllProjects(sinceDate ? { since: sinceDate } : undefined);
    result.projectsFetched = projects.length;
    console.warn(`[pe-api-sync] Fetched ${projects.length} projects`);

    // -----------------------------------------------------------------------
    // Step 2: Build HubSpot deal map for matching
    // -----------------------------------------------------------------------
    console.warn("[pe-api-sync] Building HubSpot deal map...");
    const dealMap = await buildPeDealMap();
    console.warn(`[pe-api-sync] Deal map has ${dealMap.size} entries`);

    // -----------------------------------------------------------------------
    // Step 3: Fetch project details (for action items + review passes)
    //
    // Optimization: only fetch details for projects that have at least one
    // document marked present — no point checking action items for projects
    // where every doc is absent.
    // -----------------------------------------------------------------------

    let detailMap = new Map<string, PeProjectDetail>();

    if (!skipActionItems) {
      // Only fetch DETAIL for projects with a RESPONSE_NEEDED doc. The DETAIL
      // endpoint's sole addition over the (cheap, already-fetched) LIST is
      // `actionItems` — reviewer notes that only exist for RESPONSE_NEEDED docs.
      // Doc status + version history come from the LIST for every project, so
      // narrowing here cuts ~391 per-project calls/run down to the handful with
      // an open rejection — the fix for blowing the PE daily quota.
      const idsNeedingDetail = projects
        .filter((p) => projectNeedsActionItemDetail(p))
        .map((p) => p.id);

      console.warn(
        `[pe-api-sync] Fetching details for ${idsNeedingDetail.length}/${projects.length} ` +
          `projects with a RESPONSE_NEEDED doc (concurrency=${concurrency})...`,
      );
      detailMap = await getProjectDetails(idsNeedingDetail, concurrency, deadlineMs);
      console.warn(`[pe-api-sync] Fetched details for ${detailMap.size} projects`);
    }

    // -----------------------------------------------------------------------
    // Step 4: Upsert document statuses into PeDocumentReview
    // -----------------------------------------------------------------------
    console.warn("[pe-api-sync] Upserting document statuses...");

    // Build a set of "protected" doc review keys — rows written by
    // higher-authority sources (portal scrape, email sync, manual review).
    // Historically the API could only infer statuses from action items, so
    // it never overwrote these. Since 2026-06-12 the API carries native
    // statuses; set PE_API_STATUS_AUTHORITY=true to let the API overwrite
    // scrape-written rows (full cutover from the HTML scrape).
    const apiAuthority = process.env.PE_API_STATUS_AUTHORITY === "true";
    const protectedRows = new Set<string>();
    const existingRowMap = new Map<
      string,
      { status: string; notes: string | null; reviewedBy: string | null }
    >();
    {
      const existingRows = await prisma.peDocumentReview.findMany({
        select: { dealId: true, docName: true, status: true, notes: true, reviewedBy: true },
      });
      for (const row of existingRows) {
        const key = `${row.dealId}::${row.docName}`;
        existingRowMap.set(key, { status: row.status, notes: row.notes, reviewedBy: row.reviewedBy });
        if (!apiAuthority && row.reviewedBy !== "pe-api-sync") {
          protectedRows.add(key);
        }
      }
      console.warn(
        `[pe-api-sync] ${protectedRows.size} doc rows protected (portal/email/manual)` +
          (apiAuthority ? " — API authority mode, nothing protected" : ""),
      );
    }

    interface DocUpsertOp {
      dealId: string;
      docName: string;
      status: PeDocStatus;
      notes: string;
    }

    interface VersionUpsertOp {
      peProjectId: string;
      peInternalId: string;
      dealId: string | null;
      docName: string;
      version: number;
      uploadedAt: Date;
      uploadedBy: string | null;
      fileName: string | null;
      source: string | null;
    }

    const docOps: DocUpsertOp[] = [];
    const versionOps: VersionUpsertOp[] = [];
    const linkOps: { dealId: string; portalUrl: string; projectId: string }[] = [];
    let skippedProtected = 0;

    for (const project of projects) {
      const parsed = apiProjectToParsed(project);
      const dealId = matchProjectToDeal(parsed, dealMap);

      if (!dealId) {
        result.unmatchedProjects.push(
          `${project.projectId} (${project.customer.firstName} ${project.customer.lastName})`,
        );
      } else {
        result.projectsMatched++;
        // Record the canonical portal link so we can stamp pe_portal_url +
        // pe_project_id on the deal (built from the project's own id).
        linkOps.push({
          dealId,
          portalUrl: `https://raceway.participate.energy/projects/${project.id}`,
          projectId: project.projectId,
        });
      }

      const detail = detailMap.get(project.id);

      // Iterate over the 15 canonical documents. The API only returns a doc
      // when it's been uploaded — an absent key means NOT_UPLOADED. We must
      // still write that row so missing-doc tracking (the analytics
      // "Missing Docs" stat + owed-doc lists) keeps working; the retired
      // scraper used to provide these rows.
      for (const [docKey, canonicalName] of Object.entries(PE_API_DOC_MAP)) {
        const docInfo = project.documents[docKey];

        // Collect version history when present — PeDocVersion is keyed by PE
        // project ID, and dealId backfills once matched.
        if (docInfo) {
          for (const v of docInfo.versions ?? []) {
            const uploadedAt = new Date(v.uploadedAt);
            if (isNaN(uploadedAt.getTime())) continue;
            versionOps.push({
              peProjectId: project.projectId,
              peInternalId: project.id,
              dealId: dealId ?? null,
              docName: canonicalName,
              version: v.version,
              uploadedAt,
              uploadedBy: v.uploadedBy ?? null,
              fileName: v.fileName ?? null,
              source: v.source ?? null,
            });
          }
        }

        if (!dealId) continue;

        // Skip docs that have been written by a higher-authority source
        if (protectedRows.has(`${dealId}::${canonicalName}`)) {
          skippedProtected++;
          continue;
        }

        let status: PeDocStatus;
        if (!docInfo) {
          // Absent from the API response. Conditional docs (e.g. Bill of
          // Materials) are only owed when PE includes the slot, so when PE omits
          // them we record NOT_REQUIRED (counts complete, never missing) rather
          // than NOT_UPLOADED — which would read as missing on every project PE
          // isn't requesting it for. Always-required docs stay NOT_UPLOADED.
          status = PE_CONDITIONAL_DOC_NAMES.has(canonicalName)
            ? PeDocStatus.NOT_REQUIRED
            : PeDocStatus.NOT_UPLOADED;
        } else {
          // Prefer the API's native status (added 2026-06-12); fall back to
          // action-item inference when it's absent.
          status = mapApiDocStatus(docInfo.status, docInfo.present) ?? deriveDocStatus(
            docInfo.present,
            hasActiveActionForDoc(canonicalName, detail),
            hasReviewPassForDoc(canonicalName, detail),
          );
        }

        const noteParts: string[] = [
          `Synced from PE API (${project.projectId})`,
          docInfo ? `v${docInfo.version}` : "not uploaded",
          `milestone: ${project.project.currentMilestone}`,
        ];

        docOps.push({
          dealId,
          docName: canonicalName,
          status,
          notes: noteParts.join(" | "),
        });
      }
    }

    console.warn(
      `[pe-api-sync] ${docOps.length} doc upserts queued, ${skippedProtected} skipped (protected by portal/email)`,
    );

    // Execute doc upserts in batches of 50
    const BATCH_SIZE = 50;
    const now = new Date();
    const statusChanges: {
      dealId: string;
      docName: string;
      oldStatus: string;
      newStatus: string;
      oldNotes: string | null;
      newNotes: string | null;
    }[] = [];

    for (let i = 0; i < docOps.length; i += BATCH_SIZE) {
      const batch = docOps.slice(i, i + BATCH_SIZE);
      const settled = await Promise.allSettled(
        batch.map((op) => {
          // Preserve scrape/email-written notes — they carry "Submitted:" /
          // "Responded:" stamps that analytics parses. API notes are
          // mechanical and only written on rows the API itself created.
          const existing = existingRowMap.get(`${op.dealId}::${op.docName}`);
          const preserveNotes = !!existing && existing.reviewedBy !== "pe-api-sync";
          return prisma.peDocumentReview.upsert({
            where: {
              dealId_docName: { dealId: op.dealId, docName: op.docName },
            },
            create: {
              dealId: op.dealId,
              docName: op.docName,
              status: op.status,
              notes: op.notes,
              reviewedBy: "pe-api-sync",
              reviewedAt: now,
            },
            update: {
              status: op.status,
              ...(preserveNotes ? {} : { notes: op.notes }),
              reviewedBy: "pe-api-sync",
              reviewedAt: now,
            },
          });
        }),
      );

      for (let j = 0; j < settled.length; j++) {
        if (settled[j].status === "fulfilled") {
          result.docsUpserted++;
          const op = batch[j];
          const prev = existingRowMap.get(`${op.dealId}::${op.docName}`);
          if (prev && prev.status !== op.status) {
            statusChanges.push({
              dealId: op.dealId,
              docName: op.docName,
              oldStatus: prev.status,
              newStatus: op.status,
              oldNotes: prev.notes,
              newNotes: op.notes,
            });
          }
        } else {
          const err = (settled[j] as PromiseRejectedResult).reason;
          const op = batch[j];
          result.errors.push(
            `Doc upsert failed: ${op.docName} for deal ${op.dealId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    // Persist status transitions to the change log (best-effort) — analytics
    // builds doc-level submission/rejection events from these rows.
    if (statusChanges.length > 0) {
      try {
        await prisma.peDocChangeLog.createMany({
          data: statusChanges.map((c) => ({ ...c, syncedBy: "pe-api-sync" })),
        });
        console.warn(`[pe-api-sync] Logged ${statusChanges.length} status changes`);
      } catch (err) {
        console.warn(
          `[pe-api-sync] Failed to persist change log (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // -----------------------------------------------------------------------
    // Step 4b: Upsert document version history into PeDocVersion
    // -----------------------------------------------------------------------
    if (versionOps.length > 0) {
      console.warn(`[pe-api-sync] Upserting ${versionOps.length} doc versions...`);
      for (let i = 0; i < versionOps.length; i += BATCH_SIZE) {
        const batch = versionOps.slice(i, i + BATCH_SIZE);
        const settled = await Promise.allSettled(
          batch.map((op) =>
            prisma.peDocVersion.upsert({
              where: {
                peProjectId_docName_version: {
                  peProjectId: op.peProjectId,
                  docName: op.docName,
                  version: op.version,
                },
              },
              create: op,
              update: {
                // dealId can backfill once matching improves; attribution
                // fields re-sync in case PE backfills them server-side.
                dealId: op.dealId,
                uploadedBy: op.uploadedBy,
                fileName: op.fileName,
                source: op.source,
                uploadedAt: op.uploadedAt,
              },
            }),
          ),
        );
        for (let j = 0; j < settled.length; j++) {
          if (settled[j].status === "fulfilled") {
            result.versionsUpserted++;
          } else {
            const err = (settled[j] as PromiseRejectedResult).reason;
            const op = batch[j];
            result.errors.push(
              `Version upsert failed: ${op.docName} v${op.version} (${op.peProjectId}): ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // Step 4b: Push doc statuses to HubSpot deal properties (best-effort)
    //
    // This was previously the retired scraper's job. The API sync now owns the
    // DB→HubSpot mirror so the per-doc HubSpot status properties stay current.
    // Set PE_HUBSPOT_DOC_SYNC_ENABLED=false to disable.
    // -----------------------------------------------------------------------
    if (process.env.PE_HUBSPOT_DOC_SYNC_ENABLED !== "false") {
      const pushDealIds = [...new Set(docOps.map((op) => op.dealId))];
      if (pushDealIds.length > 0) {
        try {
          await syncPeDocStatusesToHubSpot(pushDealIds);
          console.warn(`[pe-api-sync] Pushed doc statuses to HubSpot for ${pushDealIds.length} deals`);
        } catch (err) {
          result.errors.push(
            `HubSpot doc-status push failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    // -----------------------------------------------------------------------
    // Step 4c: Stamp pe_portal_url + pe_project_id on newly-matched deals
    // (fills blanks only — keeps the link fields current automatically).
    // Set PE_LINK_STAMP_ENABLED=false to disable.
    // -----------------------------------------------------------------------
    if (process.env.PE_LINK_STAMP_ENABLED !== "false" && linkOps.length > 0) {
      try {
        const stamped = await stampPortalLinks(linkOps);
        if (stamped > 0) console.warn(`[pe-api-sync] Stamped portal links on ${stamped} deals`);
      } catch (err) {
        result.errors.push(
          `Portal-link stamp failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // -----------------------------------------------------------------------
    // Step 5: Upsert action items into PeActionItem
    // -----------------------------------------------------------------------
    if (!skipActionItems && detailMap.size > 0) {
      console.warn("[pe-api-sync] Upserting action items...");

      interface ActionItemOp {
        peProjectId: string;
        dealId: string | null;
        peInternalId: string;
        actionItemId: string;
        docType: string;
        docLabel: string;
        errorCode: string | null;
        pageNumber: number | null;
        reviewer: string;
        notes: string | null;
        actionDate: Date;
      }

      const actionOps: ActionItemOp[] = [];

      for (const [, detail] of detailMap) {
        const parsed = apiProjectToParsed(detail);
        const dealId = matchProjectToDeal(parsed, dealMap);

        for (const item of detail.actionItems ?? []) {
          // Parse error code and page number from notes
          const { errorCode, pageNumber } = item.notes
            ? parseActionItemNotes(item.notes)
            : { errorCode: null, pageNumber: null };

          // Map document.id to canonical name
          const canonicalDocName = item.document?.id
            ? PE_ACTION_DOC_MAP[item.document.id] ?? item.document.label ?? item.document.id
            : "Unknown Document";

          actionOps.push({
            peProjectId: detail.projectId,
            dealId: dealId ?? null,
            peInternalId: detail.id,
            actionItemId: item.id,
            docType: item.document?.id ?? "unknown",
            docLabel: canonicalDocName,
            errorCode,
            pageNumber,
            reviewer: item.activityBy,
            notes: item.notes || null,
            actionDate: new Date(item.date),
          });
        }
      }

      // Batch upsert action items
      for (let i = 0; i < actionOps.length; i += BATCH_SIZE) {
        const batch = actionOps.slice(i, i + BATCH_SIZE);
        const settled = await Promise.allSettled(
          batch.map((op) =>
            prisma.peActionItem.upsert({
              where: { actionItemId: op.actionItemId },
              create: {
                peProjectId: op.peProjectId,
                dealId: op.dealId,
                peInternalId: op.peInternalId,
                actionItemId: op.actionItemId,
                docType: op.docType,
                docLabel: op.docLabel,
                errorCode: op.errorCode,
                pageNumber: op.pageNumber,
                reviewer: op.reviewer,
                notes: op.notes,
                actionDate: op.actionDate,
              },
              update: {
                dealId: op.dealId, // re-link if deal match improved
                docLabel: op.docLabel,
                errorCode: op.errorCode,
                pageNumber: op.pageNumber,
                reviewer: op.reviewer,
                notes: op.notes,
              },
            }),
          ),
        );

        for (let j = 0; j < settled.length; j++) {
          if (settled[j].status === "fulfilled") {
            result.actionItemsUpserted++;
          } else {
            const err = (settled[j] as PromiseRejectedResult).reason;
            const op = batch[j];
            result.errors.push(
              `Action item upsert failed: ${op.actionItemId} (${op.peProjectId}): ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }

      // Mark review passes as resolved so the UI can filter them out.
      // PE API action items are immutable activity entries — review passes
      // ("No issues found") never disappear, so we set resolvedAt to flag
      // them as non-actionable.
      const passIds = actionOps
        .filter((op) => isReviewPass(op.notes))
        .map((op) => op.actionItemId);
      if (passIds.length > 0) {
        try {
          const { count: resolvedCount } = await prisma.peActionItem.updateMany({
            where: {
              actionItemId: { in: passIds },
              resolvedAt: null,
            },
            data: { resolvedAt: new Date() },
          });
          if (resolvedCount > 0) {
            console.warn(`[pe-api-sync] Marked ${resolvedCount} review passes as resolved`);
          }
        } catch (err) {
          result.errors.push(
            `Failed to mark review passes: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // Auto-resolve action items whose document is now APPROVED.
      // When PE approves a doc after the installer fixes issues, the prior
      // action items become historical — they no longer need attention.
      const approvedDocs = docOps.filter((op) => op.status === PeDocStatus.APPROVED);
      if (approvedDocs.length > 0) {
        try {
          // Build map: dealId → set of approved doc names
          const approvedByDeal = new Map<string, Set<string>>();
          for (const op of approvedDocs) {
            const set = approvedByDeal.get(op.dealId) ?? new Set();
            set.add(op.docName);
            approvedByDeal.set(op.dealId, set);
          }

          // Resolve open action items for approved docs
          let totalAutoResolved = 0;
          for (const [dealId, docNames] of approvedByDeal) {
            const { count } = await prisma.peActionItem.updateMany({
              where: {
                dealId,
                docLabel: { in: [...docNames] },
                resolvedAt: null,
              },
              data: { resolvedAt: new Date() },
            });
            totalAutoResolved += count;
          }

          if (totalAutoResolved > 0) {
            console.warn(
              `[pe-api-sync] Auto-resolved ${totalAutoResolved} action items for approved docs`,
            );
          }
        } catch (err) {
          result.errors.push(
            `Failed to auto-resolve approved doc items: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    // -----------------------------------------------------------------------
    // Step 6: Finalize run record
    // -----------------------------------------------------------------------
    result.durationMs = Date.now() - startTime;

    await prisma.peApiSyncRun.update({
      where: { id: run.id },
      data: {
        completedAt: new Date(),
        projectsFetched: result.projectsFetched,
        docsUpserted: result.docsUpserted,
        actionItems: result.actionItemsUpserted,
        errors: result.errors.slice(0, 50), // cap stored errors
        status: result.errors.length > 0 ? "completed_with_errors" : "completed",
      },
    });

    // A successful run means quota is available again — clear any stale block.
    if (blockRow) {
      await prisma.systemConfig
        .deleteMany({ where: { key: QUOTA_BLOCK_KEY } })
        .catch(() => {});
    }

    console.warn(
      `[pe-api-sync] Sync complete: ${result.projectsFetched} projects, ` +
        `${result.projectsMatched} matched, ${result.docsUpserted} docs, ` +
        `${result.versionsUpserted} versions, ` +
        `${result.actionItemsUpserted} action items, ${result.errors.length} errors ` +
        `(${result.durationMs}ms)`,
    );

    // Alert if any admin-overridden doc was resubmitted (new version) so the
    // pinned credit can be re-checked. Best-effort — never fail the sync.
    try {
      const resubmitted = await detectAndConsumeResubmissions();
      if (resubmitted.length > 0) {
        console.warn(`[pe-api-sync] ${resubmitted.length} overridden doc(s) resubmitted — notifying`);
        await notifyOverrideResubmissions(resubmitted);
      }
    } catch (e) {
      console.error("[pe-api-sync] override resubmission check failed:", e);
    }

    return result;
  } catch (error) {
    result.durationMs = Date.now() - startTime;
    const msg = error instanceof Error ? error.message : String(error);
    result.errors.push(`Fatal sync error: ${msg}`);

    // If we hit the PE daily-quota cap, record a block so subsequent scheduled
    // runs skip until it resets instead of repeatedly failing on the cap.
    if (isDailyQuotaError(msg)) {
      const resetsAt = parseQuotaResetAt(msg);
      if (resetsAt) {
        await prisma.systemConfig
          .upsert({
            where: { key: QUOTA_BLOCK_KEY },
            create: { key: QUOTA_BLOCK_KEY, value: resetsAt },
            update: { value: resetsAt },
          })
          .catch(() => {});
        console.warn(`[pe-api-sync] PE daily quota hit — blocking syncs until ${resetsAt}`);
      }
    }

    await prisma.peApiSyncRun.update({
      where: { id: run.id },
      data: {
        completedAt: new Date(),
        projectsFetched: result.projectsFetched,
        docsUpserted: result.docsUpserted,
        actionItems: result.actionItemsUpserted,
        errors: [...result.errors.slice(0, 50)],
        status: "failed",
      },
    });

    console.error("[pe-api-sync] Sync failed:", msg);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if a document (by canonical name) has an active action item
 * for a given project.
 *
 * PE API action items are immutable activity log entries — they include
 * both review passes ("No issues found") and real failures. We filter
 * out passes so a doc isn't permanently marked ACTION_REQUIRED after
 * being reviewed and cleared.
 */
function hasActiveActionForDoc(
  canonicalDocName: string,
  detail?: PeProjectDetail,
): boolean {
  if (!detail) return false;

  // Check each action item on this project
  for (const item of detail.actionItems ?? []) {
    if (!item.document?.id) continue;

    // Map the action item's document.id to canonical name
    const actionCanonical =
      PE_ACTION_DOC_MAP[item.document.id] ?? item.document.label;

    if (actionCanonical === canonicalDocName) {
      // Skip review passes — "No issues found. 0 issues found." etc.
      if (isReviewPass(item.notes)) continue;
      return true;
    }
  }

  return false;
}

/**
 * Check if a document (by canonical name) has at least one review pass
 * action item ("No issues found") — this is our only API-based proof
 * that a doc was reviewed and approved.
 */
function hasReviewPassForDoc(
  canonicalDocName: string,
  detail?: PeProjectDetail,
): boolean {
  if (!detail) return false;

  for (const item of detail.actionItems ?? []) {
    if (!item.document?.id) continue;

    const actionCanonical =
      PE_ACTION_DOC_MAP[item.document.id] ?? item.document.label;

    if (actionCanonical === canonicalDocName && isReviewPass(item.notes)) {
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Convenience: fetch latest sync run
// ---------------------------------------------------------------------------

export async function getLatestSyncRun() {
  return prisma.peApiSyncRun.findFirst({
    orderBy: { startedAt: "desc" },
  });
}

/**
 * The last run that actually pulled data from PE — `completed` or
 * `completed_with_errors`. Excludes `running` / `skipped` (throttled or
 * quota-blocked) / `failed` runs, so "Synced X ago" reflects a real successful
 * pull, not a no-op run that still wrote a row.
 */
export async function getLastSuccessfulSyncRun() {
  return prisma.peApiSyncRun.findFirst({
    where: { status: { in: ["completed", "completed_with_errors"] } },
    orderBy: { startedAt: "desc" },
  });
}

/**
 * Get action items for a specific deal, ordered by date descending.
 */
export async function getActionItemsForDeal(dealId: string) {
  return prisma.peActionItem.findMany({
    where: { dealId },
    orderBy: { actionDate: "desc" },
  });
}

/**
 * Get all open action items (no resolvedAt) grouped by deal.
 */
export async function getOpenActionItems() {
  return prisma.peActionItem.findMany({
    where: { resolvedAt: null },
    orderBy: { actionDate: "desc" },
  });
}

/**
 * Get action item summary counts by error code.
 */
export async function getActionItemErrorSummary() {
  const items = await prisma.peActionItem.groupBy({
    by: ["errorCode"],
    where: { resolvedAt: null },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
  });

  return items.map((row) => ({
    errorCode: row.errorCode ?? "No Code",
    count: row._count.id,
  }));
}
