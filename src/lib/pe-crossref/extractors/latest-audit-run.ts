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
import type { AuditRunSummary, NameplateData, PlansetVisionResult } from "@/lib/pe-crossref/types";

// PE photo categories that capture nameplate / equipment label shots.
// The audit's vision pass extracts equipmentVisible[] for these — that's
// where the installed Tesla Powerwall part number surfaces.
const NAMEPLATE_PHOTO_IDS = new Set([
  "m1.photos.10_storage_nameplate", // Storage nameplate + labels
  "m1.photos.3_module_nameplate",   // Module nameplate
  "m1.photos.7_inverter",           // Inverter model
]);

// Tesla Powerwall 3 part-number pattern. We extract the FULL variant
// (e.g. "1707000-21-Y", "1707000-11-M") so HardwareAnalyzer can compare
// against PowerHub.
const TESLA_PW_RE = /\b(1707000-\d{2}-[A-Z])\b/i;

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

export interface LatestAuditRunResult {
  audit: AuditRunSummary;
  /** Nameplate part numbers + serials parsed from photo equipmentVisible.
   *  Keyed by photoFileId. Surfaced to context.nameplateExtractions. */
  nameplateExtractions: Map<string, NameplateData>;
}

export async function fetchLatestAuditRun(dealId: string): Promise<LatestAuditRunResult | null> {
  const run = await prisma.peAuditRun.findFirst({
    where: { dealId, status: "completed" },
    orderBy: { startedAt: "desc" },
    select: { id: true, results: true },
  });
  if (!run || !Array.isArray(run.results)) return null;

  const photoAssignments = new Map<string, { photoFileId: string; checklistLabel: string }>();
  const nameplateExtractions = new Map<string, NameplateData>();
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

      // Photo items
      if (item.isPhoto && ri.status === "found" && ri.foundFile?.id) {
        photoAssignments.set(item.id, {
          photoFileId: ri.foundFile.id,
          checklistLabel: item.label ?? item.id,
        });

        // Nameplate categories → pull Tesla part-number out of equipmentVisible
        if (NAMEPLATE_PHOTO_IDS.has(item.id) && ri.visionResult) {
          const equipmentVisible = ri.visionResult.equipmentVisible ?? [];
          const issues = ri.visionResult.issues ?? [];
          const combined = [...equipmentVisible, ...issues];

          let detectedModel: string | null = null;
          for (const s of combined) {
            const m = s.match(TESLA_PW_RE);
            if (m) {
              detectedModel = m[1].toUpperCase();
              break;
            }
          }

          // Best-effort serial extraction from notes ("SN: TG1234..." or "Serial: ...")
          const SERIAL_RE = /(?:SN|S\/N|Serial[^A-Za-z0-9]*)\s*[:#]?\s*([A-Z0-9-]{8,})/i;
          let detectedSerial: string | null = null;
          for (const s of combined) {
            const m = s.match(SERIAL_RE);
            if (m) {
              detectedSerial = m[1];
              break;
            }
          }

          nameplateExtractions.set(ri.foundFile.id, {
            photoFileId: ri.foundFile.id,
            detectedModel,
            detectedSerial,
            notes: combined.find((s) => /LEADER|obscured|placeholder|FLAGGED/i.test(s)) ?? "",
          });
        }
      }
    }
  }

  return {
    audit: {
      runId: run.id,
      photoAssignments,
      plansetVisionResult,
    },
    nameplateExtractions,
  };
}
