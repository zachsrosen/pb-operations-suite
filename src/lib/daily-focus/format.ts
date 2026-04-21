// src/lib/daily-focus/format.ts
import { getStageMaps, PIPELINE_IDS } from "@/lib/deals-pipeline";
import { PIPELINE_SUFFIXES } from "./config";
export { getStatusDisplayName } from "@/lib/hubspot-status-display";

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

// Status display names moved to @/lib/hubspot-status-display and re-exported above.

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
