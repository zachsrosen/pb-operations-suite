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
 *   - document.present=true  + no action items at all      → UPLOADED
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
  PE_API_DOC_MAP,
  PE_ACTION_DOC_MAP,
  type PeProjectListItem,
  type PeProjectDetail,
} from "@/lib/pe-api";
import { buildPeDealMap, matchProjectToDeal } from "@/lib/pe-scraper-sync";
import type { ParsedProject } from "@/lib/pe-scraper-sync";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PeApiSyncResult {
  runId: string;
  projectsFetched: number;
  projectsMatched: number;
  docsUpserted: number;
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
 * Derive PeDocStatus from API document info + action items.
 *
 * Logic:
 *   - Not present (present=false)                   → NOT_UPLOADED
 *   - Present + has active action item              → ACTION_REQUIRED
 *   - Present + has review pass (no active actions)  → APPROVED
 *   - Present + no action items at all               → UPLOADED
 *
 * Note: The API `version` field never exceeds 1 across the entire dataset,
 * so it cannot distinguish APPROVED from UNDER_REVIEW. We rely on review
 * pass action items ("No issues found") as the only API-based proof of
 * approval. Docs that are present but have no action items at all get
 * UPLOADED — the portal scrape or email sync can later upgrade to
 * APPROVED or UNDER_REVIEW with real status data.
 */
function deriveDocStatus(
  present: boolean,
  hasActiveActionItem: boolean,
  hasReviewPass: boolean,
): PeDocStatus {
  if (!present) return PeDocStatus.NOT_UPLOADED;
  if (hasActiveActionItem) return PeDocStatus.ACTION_REQUIRED;
  if (hasReviewPass) return PeDocStatus.APPROVED;
  return PeDocStatus.UPLOADED;
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

  // Create run record
  const run = await prisma.peApiSyncRun.create({
    data: { status: "running" },
  });

  const result: PeApiSyncResult = {
    runId: run.id,
    projectsFetched: 0,
    projectsMatched: 0,
    docsUpserted: 0,
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
      const idsNeedingDetail = projects
        .filter((p) => {
          // Check if any document in this project is present
          for (const docKey of Object.keys(PE_API_DOC_MAP)) {
            const docInfo = p.documents[docKey];
            if (docInfo?.present) return true;
          }
          return false;
        })
        .map((p) => p.id);

      console.warn(
        `[pe-api-sync] Fetching details for ${idsNeedingDetail.length}/${projects.length} ` +
          `projects with present docs (concurrency=${concurrency})...`,
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
    // The API sync must NOT overwrite these because the portal/email have
    // real doc statuses while the API can only infer from action items.
    const protectedRows = new Set<string>();
    {
      const nonApiRows = await prisma.peDocumentReview.findMany({
        where: { reviewedBy: { not: "pe-api-sync" } },
        select: { dealId: true, docName: true },
      });
      for (const row of nonApiRows) {
        protectedRows.add(`${row.dealId}::${row.docName}`);
      }
      console.warn(
        `[pe-api-sync] ${protectedRows.size} doc rows protected (portal/email/manual)`,
      );
    }

    interface DocUpsertOp {
      dealId: string;
      docName: string;
      status: PeDocStatus;
      notes: string;
    }

    const docOps: DocUpsertOp[] = [];
    let skippedProtected = 0;

    for (const project of projects) {
      const parsed = apiProjectToParsed(project);
      const dealId = matchProjectToDeal(parsed, dealMap);

      if (!dealId) {
        result.unmatchedProjects.push(
          `${project.projectId} (${project.customer.firstName} ${project.customer.lastName})`,
        );
        continue;
      }

      result.projectsMatched++;

      const detail = detailMap.get(project.id);

      // Iterate over the 15 canonical documents
      for (const [docKey, canonicalName] of Object.entries(PE_API_DOC_MAP)) {
        const docInfo = project.documents[docKey];
        if (!docInfo) continue;

        // Skip docs that have been written by a higher-authority source
        if (protectedRows.has(`${dealId}::${canonicalName}`)) {
          skippedProtected++;
          continue;
        }

        // Check action item status for this doc
        const hasActiveAction = hasActiveActionForDoc(canonicalName, detail);
        const hasPass = hasReviewPassForDoc(canonicalName, detail);

        const status = deriveDocStatus(
          docInfo.present,
          hasActiveAction,
          hasPass,
        );

        const noteParts: string[] = [
          `Synced from PE API (${project.projectId})`,
          `v${docInfo.version}`,
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

    for (let i = 0; i < docOps.length; i += BATCH_SIZE) {
      const batch = docOps.slice(i, i + BATCH_SIZE);
      const settled = await Promise.allSettled(
        batch.map((op) =>
          prisma.peDocumentReview.upsert({
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
              notes: op.notes,
              reviewedBy: "pe-api-sync",
              reviewedAt: now,
            },
          }),
        ),
      );

      for (let j = 0; j < settled.length; j++) {
        if (settled[j].status === "fulfilled") {
          result.docsUpserted++;
        } else {
          const err = (settled[j] as PromiseRejectedResult).reason;
          const op = batch[j];
          result.errors.push(
            `Doc upsert failed: ${op.docName} for deal ${op.dealId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
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

    console.warn(
      `[pe-api-sync] Sync complete: ${result.projectsFetched} projects, ` +
        `${result.projectsMatched} matched, ${result.docsUpserted} docs, ` +
        `${result.actionItemsUpserted} action items, ${result.errors.length} errors ` +
        `(${result.durationMs}ms)`,
    );

    return result;
  } catch (error) {
    result.durationMs = Date.now() - startTime;
    const msg = error instanceof Error ? error.message : String(error);
    result.errors.push(`Fatal sync error: ${msg}`);

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
