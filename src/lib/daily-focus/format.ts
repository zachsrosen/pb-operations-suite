// src/lib/daily-focus/format.ts
import {
  getPermitStatusDisplayName,
  getICStatusDisplayName,
  getPTOStatusDisplayName,
} from "@/lib/pi-statuses";
import { getStageMaps, PIPELINE_IDS } from "@/lib/deals-pipeline";
import { PIPELINE_SUFFIXES } from "./config";

// ── Deal name trimming ─────────────────────────────────────────────────

const PREFIX_PATTERNS = ["D&R", "SVC", "RESI"];

/**
 * Strip the address segment from a deal name.
 * Standard deals keep first 2 pipe-segments: "PROJ-9502 | McCammon, ROY"
 * Prefixed deals (D&R, SVC) keep first 3: "D&R | PROJ-5736 | Goltz, James"
 */
export function trimDealName(dealname: string): string {
  const segments = dealname.split(" | ");
  if (segments.length <= 2) return dealname;

  const hasPipelinePrefix = PREFIX_PATTERNS.some(
    (p) => segments[0].trim().toUpperCase() === p
  );
  const keepCount = hasPipelinePrefix ? 3 : 2;
  return segments.slice(0, keepCount).join(" | ");
}

// ── Status display names ───────────────────────────────────────────────

const LAYOUT_STATUS_DISPLAY: Record<string, string> = {
  Ready: "Review In Progress",
  "Revision Returned From Design": "DA Revision Ready To Send",
};

const DESIGN_STATUS_DISPLAY: Record<string, string> = {
  "Initial Review": "Initial Design Review",
  "Ready for Review": "Final Review/Stamping",
  "DA Approved": "Final Design Review",
  "Revision Final Review": "Revision Final Review/Stamping",
  "Revision Needed - Rejected": "Revision Needed - As-Built",
  "In Revision": "Revision In Progress",
};

/**
 * Get display-friendly status name for any status property.
 * Reuses pi-statuses.ts functions for permit/IC/PTO.
 * Adds layout_status and design_status maps for design emails.
 */
export function getStatusDisplayName(
  rawStatus: string,
  statusProperty: string
): string {
  switch (statusProperty) {
    case "permitting_status":
      return getPermitStatusDisplayName(rawStatus);
    case "interconnection_status":
      return getICStatusDisplayName(rawStatus);
    case "pto_status":
      return getPTOStatusDisplayName(rawStatus);
    case "layout_status":
      return LAYOUT_STATUS_DISPLAY[rawStatus] ?? rawStatus;
    case "design_status":
      return DESIGN_STATUS_DISPLAY[rawStatus] ?? rawStatus;
    default:
      return rawStatus;
  }
}

// ── Stage resolution ───────────────────────────────────────────────────

/**
 * Build a flat stageId → display label map from getStageMaps().
 * Appends pipeline suffix: " (D&R)", " (Service)", " (Roofing)".
 * Project pipeline has no suffix.
 */
export async function buildStageDisplayMap(): Promise<Record<string, string>> {
  const stageMaps = await getStageMaps();
  const flat: Record<string, string> = {};

  for (const [pipelineKey, stages] of Object.entries(stageMaps)) {
    const pipelineId = PIPELINE_IDS[pipelineKey];
    const suffix = pipelineId ? (PIPELINE_SUFFIXES[pipelineId] ?? "") : "";

    for (const [stageId, stageName] of Object.entries(stages)) {
      flat[stageId] = stageName + suffix;
    }
  }

  return flat;
}

// ── Deal URL (re-export for convenience) ───────────────────────────────

export { getHubSpotDealUrl } from "@/lib/external-links";

// ── Sort ───────────────────────────────────────────────────────────────

const PROJ_RE = /PROJ-(\d+)/;

/**
 * Sort deals: PROJ-numbered deals first by number ascending,
 * then non-PROJ deals alphabetically.
 */
export function sortDealRows<T extends { dealname: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const aMatch = PROJ_RE.exec(a.dealname);
    const bMatch = PROJ_RE.exec(b.dealname);

    if (aMatch && bMatch) {
      return Number(aMatch[1]) - Number(bMatch[1]);
    }
    if (aMatch && !bMatch) return -1;
    if (!aMatch && bMatch) return 1;
    return a.dealname.localeCompare(b.dealname);
  });
}
