// ---------------------------------------------------------------------------
// Canonical enrichment types — shared across all service API routes
// ---------------------------------------------------------------------------

export interface ServiceEnrichment {
  serviceType: string | null;
  lastContactDate: string | null;
  lastContactSource: "contact" | "deal" | "ticket" | null;
  lineItems: ServiceLineItem[] | null;
  zuperJobs: ServiceZuperJob[] | null;
}

export interface ServiceLineItem {
  name: string;
  quantity: number;
  category: string | null;
  unitPrice: number | null;
}

export interface ServiceZuperJob {
  jobUid: string;
  title: string;
  category: string;
  status: string;
  assignedUsers: string[];
  scheduledDate: string | null;
  completedDate: string | null;
  zuperUrl: string;
}

export type ReasonCategory =
  | "no_contact"
  | "warranty_expiring"
  | "stuck_in_stage"
  | "high_value"
  | "stage_urgency";

export const ALL_REASON_CATEGORIES: ReasonCategory[] = [
  "no_contact",
  "warranty_expiring",
  "stuck_in_stage",
  "high_value",
  "stage_urgency",
];

export interface EnrichmentInput {
  itemId: string;
  itemType: "deal" | "ticket";
  contactIds: string[];
  /** Raw service_type from HubSpot (already fetched by the calling route) */
  serviceType?: string | null;
  /** For tickets: the ticket-level notes_last_contacted as fallback */
  ticketLastContacted?: string | null;
  /** For deals: the deal-level notes_last_contacted as fallback */
  dealLastContacted?: string | null;
}

export interface EnrichmentOptions {
  includeLineItems?: boolean;
  includeZuperJobs?: boolean;
}
