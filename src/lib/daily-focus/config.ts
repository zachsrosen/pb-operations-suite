// src/lib/daily-focus/config.ts

// ── Types ──────────────────────────────────────────────────────────────

export type PIRole = "permit_tech" | "interconnections_tech";

export interface PILead {
  name: string;
  firstName: string;
  email: string;
  hubspotOwnerId: string;
  roles: PIRole[];
}

export interface DesignLead {
  name: string;
  firstName: string;
  email: string;
  hubspotOwnerId: string;
}

/**
 * Data-driven query definition. Each entry produces one HubSpot search.
 * The orchestrator iterates these per lead, skipping entries whose
 * roleProperty doesn't match the lead's roles (PI only).
 */
export interface QueryDef {
  /** Section key — used as stable identifier in rollup columns and HTML anchors */
  key: string;
  /** Section display label shown in the email */
  label: string;
  /** "ready" items appear first, "resubmit" items appear second within a section */
  subsections: "split" | "flat";
  /** HubSpot property to filter on */
  statusProperty: string;
  /** HubSpot property that identifies the assigned lead */
  roleProperty: string;
  /** Statuses for the "Ready to Submit" subsection */
  readyStatuses: string[];
  /** Statuses for the "Resubmissions Needed" subsection (empty = flat section) */
  resubmitStatuses?: string[];
  /** Section header color tokens */
  headerColor: { bg: string; border: string; text: string };
  /** When true, skip the owner filter — query ALL deals with matching statuses.
   *  Used for properties with no per-lead assignment (e.g., PE M1/M2 for Layla). */
  skipOwnerFilter?: boolean;
  /** Only show this section for specific lead owner IDs. Empty = show for all. */
  onlyForOwnerIds?: string[];
}

export interface SectionColorTokens {
  bg: string;
  border: string;
  text: string;
}

// ── Excluded Stages (terminal — skip from all queries) ─────────────────

export const EXCLUDED_STAGES = [
  "68229433",   // Cancelled (Project)
  "52474745",   // Cancelled (D&R)
  "56217769",   // Cancelled (Service)
  "20440343",   // Project Complete
  "68245827",   // Complete (D&R)
  "76979603",   // Completed (Service)
  "20440344",   // On Hold (Project)
  "72700977",   // On-hold (D&R)
  "1299090217", // New (Service) — no P&I/design work yet
];

// ── Included Pipelines ─────────────────────────────────────────────────

export const INCLUDED_PIPELINES = [
  "6900017",    // Project
  "21997330",   // D&R
  "23928924",   // Service
  "765928545",  // Roofing
];

/** Pipeline ID → suffix appended to stage name in emails */
export const PIPELINE_SUFFIXES: Record<string, string> = {
  "6900017": "",
  "21997330": " (D&R)",
  "23928924": " (Service)",
  "765928545": " (Roofing)",
};

// ── Manager ────────────────────────────────────────────────────────────

export const MANAGER_EMAIL = "zach@photonbrothers.com";

// ── P&I Lead Roster ────────────────────────────────────────────────────

export const PI_LEADS: PILead[] = [
  {
    name: "Peter Zaun",
    firstName: "Peter",
    email: "peter.zaun@photonbrothers.com",
    hubspotOwnerId: "78035785",
    roles: ["permit_tech", "interconnections_tech"],
  },
  {
    name: "Kristofer Stuhff",
    firstName: "Kristofer",
    email: "kristofer.stuhff@photonbrothers.com",
    hubspotOwnerId: "82539445",
    roles: ["permit_tech"],
  },
  {
    name: "Katlyyn Arnoldi",
    firstName: "Kat",
    email: "kat@photonbrothers.com",
    hubspotOwnerId: "212300376",
    roles: ["permit_tech", "interconnections_tech"],
  },
  {
    name: "Layla Counts",
    firstName: "Layla",
    email: "layla@photonbrothers.com",
    hubspotOwnerId: "216565308",
    roles: ["permit_tech", "interconnections_tech"],
  },
  {
    name: "Alexis Severson",
    firstName: "Alexis",
    email: "alexis@photonbrothers.com",
    hubspotOwnerId: "212300959",
    roles: ["permit_tech", "interconnections_tech"],
  },
  {
    name: "Kaitlyn Martinez",
    firstName: "Kaitlyn",
    email: "kaitlyn@photonbrothers.com",
    hubspotOwnerId: "212298628",
    roles: ["permit_tech", "interconnections_tech"],
  },
];

// ── Design Lead Roster ─────────────────────────────────────────────────

export const DESIGN_LEADS: DesignLead[] = [
  {
    name: "Jacob Campbell",
    firstName: "Jacob",
    email: "jacob.campbell@photonbrothers.com",
    hubspotOwnerId: "85273950",
  },
  {
    name: "Zach Rosen",
    firstName: "Zach",
    email: "zach@photonbrothers.com",
    hubspotOwnerId: "2068088473",
  },
];

// ── P&I Query Definitions ──────────────────────────────────────────────
//
// Each definition drives one section in the P&I email.
// `roleProperty` determines which leads see this section.
// `readyStatuses` and `resubmitStatuses` become separate subsections.
//
// Adding a new status bucket = add one entry here. Nothing else changes.

export const PI_QUERY_DEFS: QueryDef[] = [
  {
    key: "permits",
    label: "Permits",
    subsections: "split",
    statusProperty: "permitting_status",
    roleProperty: "permit_tech",
    readyStatuses: [
      "Ready For Permitting",
      "Customer Signature Acquired",
      "Pending SolarApp",
      "Awaiting Utility Approval",
    ],
    resubmitStatuses: [
      "Returned from Design",
      "As-Built Ready To Resubmit",
    ],
    headerColor: { bg: "#eff6ff", border: "#2563eb", text: "#2563eb" },
  },
  {
    key: "interconnection",
    label: "Interconnection",
    subsections: "split",
    statusProperty: "interconnection_status",
    roleProperty: "interconnections_tech",
    readyStatuses: [
      "Ready for Interconnection",
      "Signature Acquired By Customer",
    ],
    resubmitStatuses: [
      "Revision Returned From Design",
    ],
    headerColor: { bg: "#f0fdf4", border: "#16a34a", text: "#16a34a" },
  },
  {
    key: "pto",
    label: "PTO",
    subsections: "split",
    statusProperty: "pto_status",
    roleProperty: "interconnections_tech",
    readyStatuses: [
      "Inspection Passed - Ready for Utility",
      "Xcel Photos Ready to Submit",
    ],
    resubmitStatuses: [
      "Inspection Rejected By Utility",
      "Ops Related PTO Rejection",
      "XCEL Photos Rejected",
      "Xcel Photos Ready to Resubmit",
    ],
    headerColor: { bg: "#fefce8", border: "#ca8a04", text: "#ca8a04" },
  },
  {
    key: "pe-m1",
    label: "P.E. M1",
    subsections: "split",
    statusProperty: "pe_m1_status",
    roleProperty: "interconnections_tech", // used for role-gating only
    readyStatuses: [
      "Ready to Submit",
    ],
    resubmitStatuses: [
      "Rejected",
      "Ready to Resubmit",
    ],
    headerColor: { bg: "#faf5ff", border: "#7c3aed", text: "#7c3aed" },
    skipOwnerFilter: true,
    onlyForOwnerIds: ["216565308"], // Layla only
  },
  {
    key: "pe-m2",
    label: "P.E. M2",
    subsections: "split",
    statusProperty: "pe_m2_status",
    roleProperty: "interconnections_tech",
    readyStatuses: [
      "Ready to Submit",
    ],
    resubmitStatuses: [
      "Rejected",
      "Ready to Resubmit",
    ],
    headerColor: { bg: "#faf5ff", border: "#7c3aed", text: "#7c3aed" },
    skipOwnerFilter: true,
    onlyForOwnerIds: ["216565308"], // Layla only
  },
];

// ── Design Query Definitions ───────────────────────────────────────────

export const DESIGN_QUERY_DEFS: QueryDef[] = [
  {
    key: "da-ready",
    label: "DA Ready to Send",
    subsections: "flat",
    statusProperty: "layout_status",
    roleProperty: "design",
    readyStatuses: [
      "Draft Created",
      "Ready",                        // raw HS value → display "Review In Progress"
      "Revision Returned From Design", // → display "DA Revision Ready To Send"
    ],
    headerColor: { bg: "#eff6ff", border: "#1d4ed8", text: "#1d4ed8" },
  },
  {
    key: "design-review",
    label: "Design Ready to Review",
    subsections: "flat",
    statusProperty: "design_status",
    roleProperty: "design",
    readyStatuses: [
      "Initial Review",
      "Ready for Review",
      "DA Approved",
      "Revision Initial Review",
      "Revision Final Review",
    ],
    headerColor: { bg: "#f0fdf4", border: "#15803d", text: "#15803d" },
  },
  {
    key: "revisions-needed",
    label: "Revisions Needed",
    subsections: "flat",
    statusProperty: "design_status",
    roleProperty: "design",
    readyStatuses: [
      "Revision Needed - DA Rejected",
      "Revision Needed - Rejected by AHJ",
      "Revision Needed - Rejected by Utility",
      "Revision Needed - Rejected",
    ],
    headerColor: { bg: "#fef2f2", border: "#b91c1c", text: "#b91c1c" },
  },
  {
    key: "revisions-in-progress",
    label: "Revisions In Progress",
    subsections: "flat",
    statusProperty: "design_status",
    roleProperty: "design",
    readyStatuses: [
      "DA Revision In Progress",
      "Permit Revision In Progress",
      "Utility Revision In Progress",
      "As-Built Revision In Progress",
      "In Revision",
      "Revision In Engineering",
    ],
    headerColor: { bg: "#fffbeb", border: "#b45309", text: "#b45309" },
  },
];
