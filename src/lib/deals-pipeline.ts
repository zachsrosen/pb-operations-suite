/**
 * Shared constants for HubSpot deals pipelines.
 * Used by /api/deals and /api/deals/stream to avoid duplication.
 */

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
  // D&R specific
  "detach_status",
  "reset_status",
];
