import type { GroupKey, Team } from "./types";

/**
 * Extra "Inspection" queue section: deals whose team status marks the work
 * done (`statusValue` — a TERMINAL status the main queue query excludes) but
 * the follow-on team hasn't started (`nextStatusProperty` has no value at
 * all). Permit-only today: permit issued, waiting on/through inspection, no
 * pto_status yet — the population inspection_passed approval signals flag.
 */
export interface InspectionSectionConfig {
  /** HubSpot VALUE (not label) of the team's work-complete status. */
  statusValue: string;
  /** Next team's status property — ANY value there means that team owns the deal. */
  nextStatusProperty: string;
}

export interface TeamConfig {
  key: Team;
  label: string;
  accent: "blue" | "green" | "yellow";
  statusProperty: string;
  roleProperty: string;
  /** Explicit lead-name deal property (IC and PTO share the IC lead). */
  leadNameProperty: string;
  leadLabel: string;
  terminalStatuses: readonly string[];
  groups: Partial<Record<GroupKey, readonly string[]>>;
  /** Absent for teams without an inspection section (ic, pto). */
  inspection?: InspectionSectionConfig;
  inboxTeam: "permit" | "ic";
  folderProperty: string;
  folderLabel: string;
  domainPanel: "ahj" | "utility";  // also selects the portal-link source
}

export const TEAM_CONFIGS: Record<Team, TeamConfig> = {
  permit: {
    key: "permit", label: "Permit", accent: "blue",
    statusProperty: "permitting_status", roleProperty: "permit_tech",
    leadNameProperty: "permit_lead_name", leadLabel: "Permit Lead",
    terminalStatuses: ["Complete", "Not Needed"], // "Complete" is labelled "Permit Issued"
    groups: {
      ready: ["Ready For Permitting", "Customer Signature Acquired", "Pending SolarApp", "Submit SolarApp to AHJ"],
      rejections: ["Non-Design Related Rejection"],
      resubmit: ["Returned from Design", "As-Built Ready To Resubmit"],
      waiting: ["Submitted to AHJ", "Resubmitted to AHJ", "Awaiting Utility Approval"],
      // other (catch-all): design-owned Rejected / In Design For Revision /
      // As-Built Revision Needed / In Progress, As-Built Revision Resubmitted,
      // Waiting On Information, Permit Issued Pending Payment, Submitted To Customer
    },
    // Inspection section: permit issued ("Complete", labelled "Permit
    // Issued") with NO pto_status at all — any pto_status means the PTO team
    // already owns the deal (Zach 2026-07-20). Mirrors the approval-scan
    // inspection candidate filter so inspection_passed signals land on rows.
    inspection: { statusValue: "Complete", nextStatusProperty: "pto_status" },
    inboxTeam: "permit",
    folderProperty: "permit_documents", folderLabel: "Permit Folder",
    domainPanel: "ahj",
  },
  ic: {
    key: "ic", label: "Interconnection", accent: "green",
    statusProperty: "interconnection_status", roleProperty: "interconnections_tech",
    leadNameProperty: "interconnection_lead_name", leadLabel: "IC Lead",
    terminalStatuses: [
      "Application Approved", "Application Approved - Pending Signatures",
      "Conditional Application Approval", "Conditional Application Approval - Pending Signatures",
      "Not Needed",
    ],
    groups: {
      ready: ["Ready for Interconnection", "Signature Acquired By Customer"],
      rejections: ["Rejected (New)", "Non-Design Related Rejection"], // "Rejected (New)" is labelled "Rejected"
      resubmit: ["Revision Returned From Design", "As-Built Ready to Resubmit", "Waiting On Information"],
      waiting: ["Submitted To Utility", "Resubmitted To Utility", "As-Built Resubmitted"],
      // other: design-owned Rejected ("Rejected - Revisions Needed") / In Design For
      // Revisions, Transformer Upgrade, Waiting on New Construction, Waiting on
      // Utility Bill, Supplemental Review, RBC On Hold, In Review, Submitted To
      // Customer, Ready To Submit - Pending Design, Xcel Site Plan & SLD Needed,
      // Pending Rebate Approval, Waiting on Participate Energy
    },
    inboxTeam: "ic",
    folderProperty: "interconnection_documents", folderLabel: "Interconnection Folder",
    domainPanel: "utility",
  },
  pto: {
    key: "pto", label: "PTO", accent: "yellow",
    statusProperty: "pto_status", roleProperty: "interconnections_tech",
    leadNameProperty: "interconnection_lead_name", leadLabel: "IC Lead",
    terminalStatuses: ["PTO", "Not Needed"], // "PTO" is labelled "PTO Granted"
    groups: {
      ready: ["Inspection Passed - Ready for Utility", "Xcel Photos Ready to Submit"],
      rejections: ["Inspection Rejected By Utility", "Ops Related PTO Rejection", "XCEL Photos Rejected"],
      resubmit: ["Ready to Resubmit", "Xcel Photos Ready to Resubmit"],
      waiting: ["Inspection Submitted to Utility", "Resubmitted to Utility", "Xcel Photos Submitted", "Xcel Photos Resubmitted"],
      // other BY DECISION (Zach 2026-07-17): Xcel Photos Approved, Conditional PTO -
      // Pending Transformer Upgrade; plus PTO Waiting on Interconnection Approval,
      // Pending Truck Roll, Waiting on New Construction, Waiting On Information
    },
    inboxTeam: "ic",
    folderProperty: "pto___closeout_documents", folderLabel: "PTO Folder",
    domainPanel: "utility",
  },
};

export function groupForStatus(config: TeamConfig, status: string): GroupKey {
  for (const [group, statuses] of Object.entries(config.groups)) {
    if (statuses?.includes(status)) return group as GroupKey;
  }
  return "other";
}

/**
 * Group assignment for a fetched queue deal from its raw HubSpot properties.
 * Inspection rows: team status equals the section's complete value AND the
 * next team's status property is blank (HubSpot reads property-missing as
 * null or empty string, both falsy here). Everything else falls through to
 * the status→group map — teams without an inspection section are unchanged.
 */
export function groupForQueueDeal(
  config: TeamConfig,
  props: Record<string, string | null>,
): GroupKey {
  const status = props[config.statusProperty] ?? "";
  if (
    config.inspection &&
    status === config.inspection.statusValue &&
    !props[config.inspection.nextStatusProperty]
  ) {
    return "inspection";
  }
  return groupForStatus(config, status);
}
