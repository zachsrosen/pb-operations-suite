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
 *   - document.present=true  + has active action item  → ACTION_REQUIRED
 *   - document.present=true  + version > 0, no action  → APPROVED
 *   - document.present=true  + version = 0             → UPLOADED
 *   - document.present=false                            → NOT_UPLOADED
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
// Document status derivation
// ---------------------------------------------------------------------------

/**
 * Derive PeDocStatus from API document info + action items.
 *
 * Logic:
 *   - Not present (present=false)        → NOT_UPLOADED
 *   - Present + has active action item    → ACTION_REQUIRED
 *   - Present + version > 0, no action   → APPROVED
 *   - Present + version = 0              → UPLOADED (just submitted, not yet reviewed)
 */
function deriveDocStatus(
  present: boolean,
  version: number,
  hasActiveActionItem: boolean,
): PeDocStatus {
  if (!present) return PeDocStatus.NOT_UPLOADED;
  if (hasActiveActionItem) return PeDocStatus.ACTION_REQUIRED;
  if (version > 0) return PeDocStatus.APPROVED;
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
 * Run a full PE API sync: fetch all projects, derive document statuses,
 * fetch action items, and upsert everything into the database.
 *
 * @param options.skipActionItems - Skip fetching project details for action items (faster, doc-only sync)
 * @param options.concurrency - Max parallel detail fetches (default 5)
 */
export async function syncFromPeApi(options?: {
  skipActionItems?: boolean;
  concurrency?: number;
}): Promise<PeApiSyncResult> {
  const startTime = Date.now();
  const { skipActionItems = false, concurrency = 5 } = options ?? {};

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
  };

  try {
    // -----------------------------------------------------------------------
    // Step 1: Fetch all projects from PE API
    // -----------------------------------------------------------------------
    console.warn("[pe-api-sync] Fetching all PE projects...");
    const projects = await listAllProjects();
    result.projectsFetched = projects.length;
    console.warn(`[pe-api-sync] Fetched ${projects.length} projects`);

    // -----------------------------------------------------------------------
    // Step 2: Build HubSpot deal map for matching
    // -----------------------------------------------------------------------
    console.warn("[pe-api-sync] Building HubSpot deal map...");
    const dealMap = await buildPeDealMap();
    console.warn(`[pe-api-sync] Deal map has ${dealMap.size} entries`);

    // -----------------------------------------------------------------------
    // Step 3: Match projects → deals & derive document statuses
    // -----------------------------------------------------------------------

    // Build set of doc keys that have active action items (populated in step 4)
    // Key format: "${peInternalId}:${docKey}" e.g. "abc-123:designPlan"
    const activeActionDocs = new Set<string>();

    // If we're fetching action items, do it now so we can use the data
    // when deriving document statuses
    let detailMap = new Map<string, PeProjectDetail>();

    if (!skipActionItems) {
      console.warn("[pe-api-sync] Fetching project details for action items...");
      const allIds = projects.map((p) => p.id);
      detailMap = await getProjectDetails(allIds, concurrency);
      console.warn(`[pe-api-sync] Fetched details for ${detailMap.size} projects`);

      // Build active action item doc set
      for (const [, detail] of detailMap) {
        for (const item of detail.actionItems ?? []) {
          if (item.document?.id) {
            activeActionDocs.add(`${detail.id}:${item.document.id}`);
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // Step 4: Upsert document statuses into PeDocumentReview
    // -----------------------------------------------------------------------
    console.warn("[pe-api-sync] Upserting document statuses...");

    interface DocUpsertOp {
      dealId: string;
      docName: string;
      status: PeDocStatus;
      notes: string;
    }

    const docOps: DocUpsertOp[] = [];

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

      // Iterate over the 15 canonical documents
      for (const [docKey, canonicalName] of Object.entries(PE_API_DOC_MAP)) {
        const docInfo = project.documents[docKey];
        if (!docInfo) continue;

        // Check if this doc has an active action item
        // Action items reference doc IDs in snake_case (e.g. "design_plan")
        // We need to check all possible action doc IDs that map to this canonical name
        const hasActiveAction = hasActiveActionForDoc(
          project.id,
          canonicalName,
          activeActionDocs,
          detailMap.get(project.id),
        );

        const status = deriveDocStatus(docInfo.present, docInfo.version, hasActiveAction);

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
 */
function hasActiveActionForDoc(
  peInternalId: string,
  canonicalDocName: string,
  activeActionDocs: Set<string>,
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
