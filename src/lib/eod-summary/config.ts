// src/lib/eod-summary/config.ts
//
// EOD summary configuration. Reuses lead rosters and pipeline constants
// from daily-focus but defines its own broader query approach (no status
// filter) and milestone definitions using raw HubSpot enum values.

import {
  PI_LEADS,
  DESIGN_LEADS,
  EXCLUDED_STAGES,
  INCLUDED_PIPELINES,
  PIPELINE_SUFFIXES,
  MANAGER_EMAIL,
  type PILead,
  type DesignLead,
} from "@/lib/daily-focus/config";

export {
  PI_LEADS,
  DESIGN_LEADS,
  EXCLUDED_STAGES,
  INCLUDED_PIPELINES,
  PIPELINE_SUFFIXES,
  MANAGER_EMAIL,
  type PILead,
  type DesignLead,
};

// ── Broad query properties ───────────────────────────────────────────
// Used by both morning snapshot and evening refresh. Returns ALL status
// fields so the diff can detect changes across any department.

export const SNAPSHOT_PROPERTIES = [
  "hs_object_id",
  "dealname",
  "dealstage",
  "pipeline",
  "pb_location",
  "design_status",
  "layout_status",
  "permitting_status",
  "interconnection_status",
  "pto_status",
];

// ── Status properties we monitor for changes ─────────────────────────

export const MONITORED_STATUS_FIELDS = [
  "designStatus",
  "layoutStatus",
  "permittingStatus",
  "interconnectionStatus",
  "ptoStatus",
  "dealStage",
] as const;

// Map from snapshot field name → HubSpot property name
export const FIELD_TO_HS_PROPERTY: Record<string, string> = {
  designStatus: "design_status",
  layoutStatus: "layout_status",
  permittingStatus: "permitting_status",
  interconnectionStatus: "interconnection_status",
  ptoStatus: "pto_status",
  dealStage: "dealstage",
};

// Map from HubSpot property → department label for email grouping
export const PROPERTY_TO_DEPARTMENT: Record<string, string> = {
  design_status: "Design",
  layout_status: "Design",
  permitting_status: "Permitting",
  interconnection_status: "Interconnection",
  pto_status: "PTO",
};

// Map from status property → the HubSpot role property that owns it.
// Used to resolve which lead a status change should be grouped under.
export const STATUS_TO_ROLE_PROPERTY: Record<string, string> = {
  design_status: "design",
  layout_status: "design",
  permitting_status: "permit_tech",
  interconnection_status: "interconnections_tech",
  pto_status: "interconnections_tech",
};

// ── Milestone definitions ────────────────────────────────────────────
// Raw HubSpot enum values. Display labels come from deals-types.ts
// STATUS_DISPLAY_LABELS at render time.

export interface MilestoneDef {
  statusProperty: string;       // HubSpot property name
  rawValue: string;             // exact HubSpot enum string
  displayLabel: string;         // human-readable for email
  department: string;           // grouping label
}

export const MILESTONES: MilestoneDef[] = [
  { statusProperty: "design_status", rawValue: "Complete", displayLabel: "Design Complete", department: "Design" },
  { statusProperty: "layout_status", rawValue: "Sent to Customer", displayLabel: "Sent For Approval", department: "Design" },
  { statusProperty: "permitting_status", rawValue: "Submitted to AHJ", displayLabel: "Submitted to AHJ", department: "Permitting" },
  { statusProperty: "permitting_status", rawValue: "Complete", displayLabel: "Permit Issued", department: "Permitting" },
  { statusProperty: "interconnection_status", rawValue: "Application Approved", displayLabel: "IC Approved", department: "Interconnection" },
  { statusProperty: "interconnection_status", rawValue: "Submitted To Utility", displayLabel: "Submitted to Utility", department: "Interconnection" },
  { statusProperty: "pto_status", rawValue: "PTO", displayLabel: "PTO Granted", department: "PTO" },
  { statusProperty: "pto_status", rawValue: "Inspection Submitted to Utility", displayLabel: "PTO Submitted to Utility", department: "PTO" },
];

// Quick lookup: property → Set of raw milestone values
export const MILESTONE_VALUES: Map<string, Set<string>> = new Map();
for (const m of MILESTONES) {
  if (!MILESTONE_VALUES.has(m.statusProperty)) {
    MILESTONE_VALUES.set(m.statusProperty, new Set());
  }
  MILESTONE_VALUES.get(m.statusProperty)!.add(m.rawValue);
}
