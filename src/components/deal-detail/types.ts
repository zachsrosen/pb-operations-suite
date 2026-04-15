/**
 * Shared types for the deal detail page.
 *
 * SerializedDeal is the client-safe DTO — all Dates become ISO strings,
 * all Decimals become numbers, all Json is pre-parsed.
 * The client NEVER imports Prisma types directly.
 */

/** Department leads parsed from the Json column */
export interface DepartmentLeads {
  design?: string | null;
  permit_tech?: string | null;
  interconnections_tech?: string | null;
  rtb_lead?: string | null;
}

/**
 * Client-safe deal record. Built by serializeDeal() in the server component.
 *
 * Convention:
 *   DateTime? → string | null (ISO 8601)
 *   Decimal?  → number | null
 *   Json      → pre-parsed typed object
 *   String/Int/Boolean → as-is
 */
export interface SerializedDeal {
  // Identity
  id: string;
  hubspotDealId: string;
  dealName: string;
  pipeline: string;
  stage: string;
  stageId: string;
  amount: number | null;

  // Location
  pbLocation: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  ahj: string | null;
  utility: string | null;

  // Team
  hubspotOwnerId: string | null;
  dealOwnerName: string | null;
  projectManager: string | null;
  operationsManager: string | null;
  siteSurveyor: string | null;
  departmentLeads: DepartmentLeads;

  // Contact (association-derived)
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  companyName: string | null;
  hubspotContactId: string | null;
  hubspotCompanyId: string | null;

  // External links
  hubspotUrl: string | null;
  driveUrl: string | null;
  designDocumentsUrl: string | null;
  designFolderUrl: string | null;
  allDocumentFolderUrl: string | null;
  openSolarUrl: string | null;
  openSolarId: string | null;
  zuperUid: string | null;

  // Sync
  lastSyncedAt: string | null;

  // All remaining fields accessed dynamically by the section registry
  [key: string]: unknown;
}

/** A single field rendered in a CollapsibleSection grid */
export interface FieldDef {
  label: string;
  value: string | number | boolean | null;
  format?: "date" | "money" | "decimal" | "days" | "boolean" | "status";
}

/** Section registry entry — maps pipeline to UI sections */
export interface SectionConfig {
  key: string;
  title: string;
  defaultOpen: boolean;
  pipelines: string[] | "all";
  fields: (deal: SerializedDeal) => FieldDef[];
}

/** A stage in the milestone timeline */
export interface TimelineStage {
  key: string;
  label: string;
  completedDate: string | null;
  isCurrent: boolean;
}

/** Zuper job info resolved from ZuperJobCache */
export interface ZuperJobInfo {
  jobUid: string;
  jobTitle: string;
  jobCategory: string;
  jobStatus: string;
  jobPriority: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  completedDate: string | null;
  assignedUsers: { user_uid: string; user_name?: string }[];
}

/** A single field change from DealSyncLog */
export interface ChangeLogEntry {
  id: string;
  syncType: string;
  source: string;
  status: string;
  changesDetected: Record<string, [unknown, unknown]> | null;
  createdAt: string;
}

/** Minimal related deal for the sidebar */
export interface RelatedDeal {
  id: string;
  hubspotDealId: string;
  dealName: string;
  pipeline: string;
  stage: string;
  amount: number | null;
}

// ---------------------------------------------------------------------------
// Activity Timeline
// ---------------------------------------------------------------------------

export type TimelineEventType =
  | "note"
  | "sync"
  | "zuper"
  | "zuper_status"
  | "zuper_note"
  | "bom"
  | "schedule"
  | "photo"
  | "email"
  | "call"
  | "meeting"
  | "hubspot_note"
  | "task"
  | "service_task";

/** A file attached to a Zuper note or service task. */
export interface TimelineAttachment {
  fileName: string;
  url: string;
  isImage: boolean;
}

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  timestamp: string; // ISO 8601
  title: string;
  detail: string | null;
  author: string | null;
  metadata: Record<string, unknown> | null;
}

export interface TimelinePage {
  events: TimelineEvent[];
  nextCursor: { ts: string; id: string } | null;
}

export interface DealNoteData {
  id: string;
  dealId: string;
  content: string;
  authorEmail: string;
  authorName: string;
  hubspotSyncStatus: string | null;
  zuperSyncStatus: string | null;
  createdAt: string;
}

export interface Engagement {
  id: string;
  type: "email" | "call" | "note" | "meeting" | "task";
  timestamp: string;
  subject: string | null;
  body: string | null;
  from: string | null;
  to: string[] | null;
  duration: number | null;
  disposition: string | null;
  attendees: string[] | null;
  createdBy: string | null;
}
