/**
 * Shared constants for HubSpot deals pipelines.
 * Used by /api/deals and /api/deals/stream to avoid duplication.
 *
 * Stage maps are fetched dynamically from HubSpot on first use and cached
 * for 10 minutes. The static STAGE_MAPS below serve as fallbacks if the
 * API call fails.
 */
import { hubspotClient } from "@/lib/hubspot";

/** Pipeline IDs — loaded from env with hardcoded fallbacks */
export const PIPELINE_IDS: Record<string, string> = {
  sales: process.env.HUBSPOT_PIPELINE_SALES || "default",
  project: process.env.HUBSPOT_PIPELINE_PROJECT || "6900017",
  dnr: process.env.HUBSPOT_PIPELINE_DNR || "21997330",
  service: process.env.HUBSPOT_PIPELINE_SERVICE || "23928924",
  roofing: process.env.HUBSPOT_PIPELINE_ROOFING || "765928545",
};

/** Stage ID → stage name mapping for each pipeline */
export const STAGE_MAPS: Record<string, Record<string, string>> = {
  sales: {
    qualifiedtobuy: "Qualified to buy",
    decisionmakerboughtin: "Proposal Submitted",
    "1241097777": "Proposal Accepted",
    contractsent: "Finalizing Deal",
    "70699053": "Sales Follow Up",
    "70695977": "Nurture",
    closedwon: "Closed won",
    closedlost: "Closed lost",
  },
  dnr: {
    "52474739": "Kickoff",
    "52474740": "Site Survey",
    "52474741": "Design",
    "52474742": "Permit",
    "78437201": "Ready for Detach",
    "52474743": "Detach",
    "78453339": "Detach Complete - Roofing In Progress",
    "78412639": "Reset Blocked - Waiting on Payment",
    "78412640": "Ready for Reset",
    "52474744": "Reset",
    "55098156": "Inspection",
    "52498440": "Closeout",
    "68245827": "Complete",
    "72700977": "On-hold",
    "52474745": "Cancelled",
  },
  service: {
    "1058744644": "Project Preparation",
    "1058924076": "Site Visit Scheduling",
    "171758480": "Work In Progress",
    "1058924077": "Inspection",
    "1058924078": "Invoicing",
    "76979603": "Completed",
    "56217769": "Cancelled",
  },
  roofing: {
    "1117662745": "On Hold",
    "1117662746": "Color Selection",
    "1215078279": "Material & Labor Order",
    "1117662747": "Confirm Dates",
    "1215078280": "Staged",
    "1215078281": "Production",
    "1215078282": "Post Production",
    "1215078283": "Invoice/Collections",
    "1215078284": "Job Close Out Paperwork",
    "1215078285": "Job Completed",
  },
};

/** Active (non-completed, non-cancelled) stages per pipeline */
export const ACTIVE_STAGES: Record<string, string[]> = {
  sales: [
    "Qualified to buy",
    "Proposal Submitted",
    "Proposal Accepted",
    "Finalizing Deal",
    "Sales Follow Up",
    "Nurture",
  ],
  dnr: [
    "Kickoff",
    "Site Survey",
    "Design",
    "Permit",
    "Ready for Detach",
    "Detach",
    "Detach Complete - Roofing In Progress",
    "Reset Blocked - Waiting on Payment",
    "Ready for Reset",
    "Reset",
    "Inspection",
    "Closeout",
  ],
  service: [
    "Project Preparation",
    "Site Visit Scheduling",
    "Work In Progress",
    "Inspection",
    "Invoicing",
  ],
  roofing: [
    "On Hold",
    "Color Selection",
    "Material & Labor Order",
    "Confirm Dates",
    "Staged",
    "Production",
    "Post Production",
    "Invoice/Collections",
    "Job Close Out Paperwork",
  ],
};

// ---------------------------------------------------------------------------
// Dynamic stage resolution — fetches from HubSpot API, caches 10 min
// ---------------------------------------------------------------------------

const STAGE_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
let _dynamicStageMaps: Record<string, Record<string, string>> | null = null;
let _dynamicActiveStages: Record<string, string[]> | null = null;
let _dynamicStageOrder: Record<string, string[]> | null = null;
let _stageCacheTime = 0;
let _stageInflight: Promise<void> | null = null;

// Known terminal stages (not considered "active") — case-insensitive match
const TERMINAL_KEYWORDS = ["completed", "complete", "cancelled", "closed won", "closed lost", "job completed"];

async function _fetchPipelineStages(): Promise<void> {
  try {
    const pipelines = await hubspotClient.crm.pipelines.pipelinesApi.getAll("deals");
    const stageMaps: Record<string, Record<string, string>> = {};
    const activeStages: Record<string, string[]> = {};

    // Build reverse lookup: pipelineId → pipelineKey
    const idToKey: Record<string, string> = {};
    for (const [key, id] of Object.entries(PIPELINE_IDS)) {
      idToKey[id] = key;
    }

    const stageOrder: Record<string, string[]> = {};

    for (const pipeline of pipelines.results || []) {
      const key = idToKey[pipeline.id];
      if (!key) continue; // pipeline we don't track

      // Sort stages by displayOrder to match pipeline flow
      const sortedStages = [...(pipeline.stages || [])].sort(
        (a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)
      );

      const stageMap: Record<string, string> = {};
      const active: string[] = [];
      const ordered: string[] = [];

      for (const stage of sortedStages) {
        stageMap[stage.id] = stage.label;
        ordered.push(stage.label);
        const isTerminal = TERMINAL_KEYWORDS.some(kw =>
          stage.label.toLowerCase().includes(kw)
        );
        if (!isTerminal) {
          active.push(stage.label);
        }
      }

      stageMaps[key] = stageMap;
      activeStages[key] = active;
      stageOrder[key] = ordered;
    }

    _dynamicStageMaps = stageMaps;
    _dynamicActiveStages = activeStages;
    _dynamicStageOrder = stageOrder;
    _stageCacheTime = Date.now();
  } catch (err) {
    console.warn("[DealsPipeline] Failed to fetch pipeline stages from HubSpot, using static fallback:", err);
    // Leave cache as-is (null on first fail = use static maps)
  }
}

/**
 * Get the stage ID → name map for a pipeline.
 * Fetches from HubSpot API on first call and caches for 10 minutes.
 * Falls back to static STAGE_MAPS if API fails.
 */
export async function getStageMaps(): Promise<Record<string, Record<string, string>>> {
  if (_dynamicStageMaps && Date.now() - _stageCacheTime < STAGE_CACHE_TTL) {
    return _dynamicStageMaps;
  }

  // Coalesce concurrent calls
  if (!_stageInflight) {
    _stageInflight = _fetchPipelineStages().finally(() => { _stageInflight = null; });
  }
  await _stageInflight;

  return _dynamicStageMaps || STAGE_MAPS;
}

/**
 * Get active (non-terminal) stage names for a pipeline.
 */
export async function getActiveStages(): Promise<Record<string, string[]>> {
  if (_dynamicActiveStages && Date.now() - _stageCacheTime < STAGE_CACHE_TTL) {
    return _dynamicActiveStages;
  }

  if (!_stageInflight) {
    _stageInflight = _fetchPipelineStages().finally(() => { _stageInflight = null; });
  }
  await _stageInflight;

  return _dynamicActiveStages || ACTIVE_STAGES;
}

/**
 * Get pipeline-ordered stage names (all stages, including terminal).
 * Order matches HubSpot's displayOrder for each pipeline.
 */
export async function getStageOrder(): Promise<Record<string, string[]>> {
  if (_dynamicStageOrder && Date.now() - _stageCacheTime < STAGE_CACHE_TTL) {
    return _dynamicStageOrder;
  }

  if (!_stageInflight) {
    _stageInflight = _fetchPipelineStages().finally(() => { _stageInflight = null; });
  }
  await _stageInflight;

  // Fallback: derive from static STAGE_MAPS (values in insertion order)
  if (!_dynamicStageOrder) {
    const fallback: Record<string, string[]> = {};
    for (const [key, map] of Object.entries(STAGE_MAPS)) {
      fallback[key] = Object.values(map);
    }
    return fallback;
  }

  return _dynamicStageOrder;
}

/** HubSpot deal properties fetched by the deals API endpoints */
export const DEAL_PROPERTIES = [
  "hs_object_id",
  "dealname",
  "amount",
  "dealstage",
  "pipeline",
  "closedate",
  "createdate",
  "hs_lastmodifieddate",
  "pb_location",
  "address_line_1",
  "city",
  "state",
  "postal_code",
  "project_type",
  "hubspot_owner_id",
  "deal_currency_code",
  "service_type",
  // D&R specific
  "detach_status",
  "reset_status",
];
