/**
 * Latest-audit-run extractor.
 *
 * Pulls the most recent completed PE audit run for a deal and lifts out the
 * structured pieces analyzers care about (planset vision, photo assignments).
 *
 * Cross-ref re-uses the audit's vision work so we don't pay for redundant
 * Sonnet calls. The audit's `classifyDocument` already extracts equipment
 * lists and issue strings from the planset; cross-ref pattern-matches those.
 */

import { prisma } from "@/lib/db";
import type { AuditRunSummary, PlansetVisionResult } from "@/lib/pe-crossref/types";

interface AuditItemFromJson {
  item?: { id?: string; label?: string; isPhoto?: boolean };
  status?: string;
  foundFile?: { id?: string; name?: string } | null;
  visionResult?: {
    issues?: string[];
    equipmentVisible?: string[];
  } | null;
}

interface AuditCategoryFromJson {
  items?: AuditItemFromJson[];
}

export async function fetchLatestAuditRun(dealId: string): Promise<AuditRunSummary | null> {
  const run = await prisma.peAuditRun.findFirst({
    where: { dealId, status: "completed" },
    orderBy: { startedAt: "desc" },
    select: { id: true, results: true },
  });
  if (!run || !Array.isArray(run.results)) return null;

  const photoAssignments = new Map<string, { photoFileId: string; checklistLabel: string }>();
  let plansetVisionResult: PlansetVisionResult | null = null;

  for (const cat of run.results as unknown as AuditCategoryFromJson[]) {
    for (const ri of cat.items ?? []) {
      const item = ri.item;
      if (!item?.id) continue;

      // Planset → extract vision result (issues + equipmentVisible)
      if (item.id === "m1.design.planset" && ri.foundFile && ri.visionResult) {
        plansetVisionResult = {
          plansetFileId: ri.foundFile.id ?? "",
          plansetFileName: ri.foundFile.name ?? "",
          issues: ri.visionResult.issues ?? [],
          equipmentVisible: ri.visionResult.equipmentVisible ?? [],
        };
      }

      // Photo items → assignment map (used by PhotoCritiqueAnalyzer later)
      if (item.isPhoto && ri.status === "found" && ri.foundFile?.id) {
        photoAssignments.set(item.id, {
          photoFileId: ri.foundFile.id,
          checklistLabel: item.label ?? item.id,
        });
      }
    }
  }

  return {
    runId: run.id,
    photoAssignments,
    plansetVisionResult,
  };
}
