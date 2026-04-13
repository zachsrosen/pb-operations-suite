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
