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
