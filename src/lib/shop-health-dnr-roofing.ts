/**
 * D&R + Roofing shop-health computation.
 *
 * Pure functions over the deals + goals passed in by the orchestrator.
 * No DB or HubSpot API calls.
 *
 * Stage bucketing is by HubSpot stage ID, not label —
 * transformDealToProject only resolves Project pipeline labels,
 * so non-project deals have stageName = raw stageId.
 * Stage IDs are globally unique in HubSpot.
 */

// ── D&R buckets ────────────────────────────────────────────────────────────

export type DnrBucket =
  | "preDetach"
  | "detachInProgress"
  | "roofingPhase"
  | "resetBlocked"
  | "resetPhase"
  | "closeout"
  | "terminal"
  | "unknown";

const DNR_STAGE_BUCKETS: Record<string, DnrBucket> = {
  "52474739": "preDetach",         // Kickoff
  "52474740": "preDetach",         // Site Survey
  "52474741": "preDetach",         // Design
  "52474742": "preDetach",         // Permit
  "78437201": "preDetach",         // Ready for Detach
  "52474743": "detachInProgress",  // Detach
  "78453339": "roofingPhase",      // Detach Complete - Roofing In Progress
  "78412639": "resetBlocked",      // Reset Blocked - Waiting on Payment
  "78412640": "resetPhase",        // Ready for Reset
  "52474744": "resetPhase",        // Reset
  "55098156": "closeout",          // Inspection
  "52498440": "closeout",          // Closeout
  "68245827": "terminal",          // Complete
  "52474745": "terminal",          // Cancelled
  "72700977": "terminal",          // On-hold
};

export function bucketDnrStages(stageId: string): DnrBucket {
  return DNR_STAGE_BUCKETS[stageId] ?? "unknown";
}

// ── Roofing buckets ────────────────────────────────────────────────────────

export type RoofingBucket =
  | "preProduction"
  | "inProduction"
  | "postProduction"
  | "terminal"
  | "unknown";

const ROOFING_STAGE_BUCKETS: Record<string, RoofingBucket> = {
  "1117662745": "preProduction",   // On Hold
  "1117662746": "preProduction",   // Color Selection
  "1215078279": "preProduction",   // Material & Labor Order
  "1117662747": "preProduction",   // Confirm Dates
  "1215078280": "preProduction",   // Staged
  "1215078281": "inProduction",    // Production
  "1215078282": "postProduction",  // Post Production
  "1215078283": "postProduction",  // Invoice/Collections
  "1215078284": "postProduction",  // Job Close Out Paperwork
  "1215078285": "terminal",        // Job Completed
};

export function bucketRoofingStages(stageId: string): RoofingBucket {
  return ROOFING_STAGE_BUCKETS[stageId] ?? "unknown";
}

// ── computeDnrRoofingHealth ────────────────────────────────────────────────

import type { Project } from "@/lib/hubspot";
import type { DnrRoofingSection, DrilldownDeal } from "@/lib/shop-health-types";

const STUCK_DAYS_THRESHOLD = 14;

export interface DnrRoofingDrilldownBundle {
  dnrActive: DrilldownDeal[];
  dnrCompleted: DrilldownDeal[];
  dnrPreDetach: DrilldownDeal[];
  dnrDetachInProgress: DrilldownDeal[];
  dnrRoofingPhase: DrilldownDeal[];
  dnrResetBlocked: DrilldownDeal[];
  dnrResetPhase: DrilldownDeal[];
  dnrCloseout: DrilldownDeal[];
  dnrStuck: DrilldownDeal[];
  roofingActive: DrilldownDeal[];
  roofingCompleted: DrilldownDeal[];
  roofingPreProduction: DrilldownDeal[];
  roofingInProduction: DrilldownDeal[];
  roofingPostProduction: DrilldownDeal[];
  roofingStuck: DrilldownDeal[];
}

function toDealDrilldown(d: Project): DrilldownDeal {
  return {
    id: String(d.id),
    name: d.name,
    projectNumber: d.projectNumber,
    amount: d.amount,
    stage: d.stage,
    pm: "",
    date: null,
  };
}

export function computeDnrRoofingHealth(
  dnrDeals: Project[],
  roofingDeals: Project[],
  weekStart: Date
): { section: DnrRoofingSection; drilldown: DnrRoofingDrilldownBundle } {
  const weekStartMs = weekStart.getTime();

  // ── D&R ──
  const dnrByBucket = {
    preDetach: [] as Project[],
    detachInProgress: [] as Project[],
    roofingPhase: [] as Project[],
    resetBlocked: [] as Project[],
    resetPhase: [] as Project[],
    closeout: [] as Project[],
  };
  const dnrCompleted: Project[] = [];
  const dnrStuck: Project[] = [];
  let unknownDnrStageCount = 0;

  for (const d of dnrDeals) {
    const bucket = bucketDnrStages(d.stageId);
    if (bucket === "terminal") {
      // Track completed-this-week (Complete only, not Cancelled or On-hold)
      if (d.stageId === "68245827") {
        const closeMs = d.closeDate ? new Date(d.closeDate).getTime() : 0;
        if (closeMs >= weekStartMs) dnrCompleted.push(d);
      }
      continue;
    }
    if (bucket === "unknown") {
      unknownDnrStageCount++;
      console.warn(`[shop-health] Unknown D&R stage ID: ${d.stageId} (deal ${d.id})`);
      continue;
    }
    dnrByBucket[bucket].push(d);
    if ((d.daysSinceStageMovement ?? 0) > STUCK_DAYS_THRESHOLD) {
      dnrStuck.push(d);
    }
  }

  const dnrActive =
    dnrByBucket.preDetach.length +
    dnrByBucket.detachInProgress.length +
    dnrByBucket.roofingPhase.length +
    dnrByBucket.resetBlocked.length +
    dnrByBucket.resetPhase.length +
    dnrByBucket.closeout.length;
  const dnrActiveDeals = [
    ...dnrByBucket.preDetach,
    ...dnrByBucket.detachInProgress,
    ...dnrByBucket.roofingPhase,
    ...dnrByBucket.resetBlocked,
    ...dnrByBucket.resetPhase,
    ...dnrByBucket.closeout,
  ];

  // ── Roofing ──
  const roofingByBucket = {
    preProduction: [] as Project[],
    inProduction: [] as Project[],
    postProduction: [] as Project[],
  };
  const roofingCompleted: Project[] = [];
  const roofingStuck: Project[] = [];
  let unknownRoofingStageCount = 0;

  for (const r of roofingDeals) {
    const bucket = bucketRoofingStages(r.stageId);
    if (bucket === "terminal") {
      const closeMs = r.closeDate ? new Date(r.closeDate).getTime() : 0;
      if (closeMs >= weekStartMs) roofingCompleted.push(r);
      continue;
    }
    if (bucket === "unknown") {
      unknownRoofingStageCount++;
      console.warn(`[shop-health] Unknown Roofing stage ID: ${r.stageId} (deal ${r.id})`);
      continue;
    }
    roofingByBucket[bucket].push(r);
    if ((r.daysSinceStageMovement ?? 0) > STUCK_DAYS_THRESHOLD) {
      roofingStuck.push(r);
    }
  }

  const roofingActive =
    roofingByBucket.preProduction.length +
    roofingByBucket.inProduction.length +
    roofingByBucket.postProduction.length;
  const roofingActiveDeals = [
    ...roofingByBucket.preProduction,
    ...roofingByBucket.inProduction,
    ...roofingByBucket.postProduction,
  ];

  const section: DnrRoofingSection = {
    dnrActive,
    dnrCompletedThisWeek: dnrCompleted.length,
    roofingActive,
    roofingCompletedThisWeek: roofingCompleted.length,
    dnrPreDetach: dnrByBucket.preDetach.length,
    dnrDetachInProgress: dnrByBucket.detachInProgress.length,
    dnrRoofingPhase: dnrByBucket.roofingPhase.length,
    dnrResetBlocked: dnrByBucket.resetBlocked.length,
    dnrResetPhase: dnrByBucket.resetPhase.length,
    dnrCloseout: dnrByBucket.closeout.length,
    roofPreProduction: roofingByBucket.preProduction.length,
    roofInProduction: roofingByBucket.inProduction.length,
    roofPostProduction: roofingByBucket.postProduction.length,
    stuckDnrJobs: dnrStuck.length,
    stuckRoofingJobs: roofingStuck.length,
    unknownDnrStageCount,
    unknownRoofingStageCount,
  };

  const drilldown: DnrRoofingDrilldownBundle = {
    dnrActive: dnrActiveDeals.map(toDealDrilldown),
    dnrCompleted: dnrCompleted.map(toDealDrilldown),
    dnrPreDetach: dnrByBucket.preDetach.map(toDealDrilldown),
    dnrDetachInProgress: dnrByBucket.detachInProgress.map(toDealDrilldown),
    dnrRoofingPhase: dnrByBucket.roofingPhase.map(toDealDrilldown),
    dnrResetBlocked: dnrByBucket.resetBlocked.map(toDealDrilldown),
    dnrResetPhase: dnrByBucket.resetPhase.map(toDealDrilldown),
    dnrCloseout: dnrByBucket.closeout.map(toDealDrilldown),
    dnrStuck: dnrStuck.map(toDealDrilldown),
    roofingActive: roofingActiveDeals.map(toDealDrilldown),
    roofingCompleted: roofingCompleted.map(toDealDrilldown),
    roofingPreProduction: roofingByBucket.preProduction.map(toDealDrilldown),
    roofingInProduction: roofingByBucket.inProduction.map(toDealDrilldown),
    roofingPostProduction: roofingByBucket.postProduction.map(toDealDrilldown),
    roofingStuck: roofingStuck.map(toDealDrilldown),
  };

  return { section, drilldown };
}
