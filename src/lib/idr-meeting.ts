/**
 * IDR Meeting Hub — Business Logic
 *
 * Session creation, deal snapshot mapping, HubSpot sync (property updates + timeline notes),
 * and archive search.
 */

import { prisma } from "@/lib/db";
import { hubspotClient, searchWithRetry, resolveHubSpotOwnerContact } from "@/lib/hubspot";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import {
  AssociationSpecAssociationCategoryEnum,
} from "@hubspot/api-client/lib/codegen/crm/objects/notes/models/AssociationSpec";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IDR_ALLOWED_ROLES = [
  "ADMIN", "OWNER", "PROJECT_MANAGER", "TECH_OPS",
  "OPERATIONS_MANAGER", "OPERATIONS",
] as const;

const PROJECT_PIPELINE_ID = process.env.HUBSPOT_PIPELINE_PROJECT || "6900017";

/** Properties fetched for each deal during session creation / snapshot refresh. */
export const SNAPSHOT_PROPERTIES = [
  "dealname", "pb_location", "project_type", "address_line_1", "city", "state",
  "amount",
  "calculated_system_size__kwdc_", "site_survey_status", "site_survey_date",
  "design_status", "design_draft_completion_date", "is_site_survey_completed_",
  "all_document_parent_folder_id", "site_survey_documents", "design_documents",
  "module_brand", "module_model", "module_count",
  "inverter_brand", "inverter_model", "inverter_qty",
  "battery_brand", "battery_model", "battery_count",
  "ahj", "utility_company",
  "hubspot_owner_id", "site_surveyor", "design", "operations_manager", "project_manager",
  "disco__reco", "interior_access", "notes_for_install",
  "link_to_opensolar", "os_project_link",
];

// ---------------------------------------------------------------------------
// Role check
// ---------------------------------------------------------------------------

export function isIdrAllowedRole(role: string): boolean {
  return (IDR_ALLOWED_ROLES as readonly string[]).includes(role);
}

// ---------------------------------------------------------------------------
// Snapshot helpers
// ---------------------------------------------------------------------------

/** Build an equipment one-liner from deal properties. */
function buildEquipmentSummary(p: Record<string, string | null>): string {
  const parts: string[] = [];
  const moduleBrand = p.module_brand ?? "";
  const moduleModel = p.module_model ?? "";
  const moduleCount = p.module_count ?? "";
  if (moduleBrand || moduleModel) {
    parts.push(`${moduleBrand} ${moduleModel} x${moduleCount}`.trim());
  }
  const invBrand = p.inverter_brand ?? "";
  const invModel = p.inverter_model ?? "";
  const invQty = p.inverter_qty ?? "1";
  if (invBrand || invModel) {
    parts.push(`${invBrand} ${invModel} x${invQty}`.trim());
  }
  const batBrand = p.battery_brand ?? "";
  const batModel = p.battery_model ?? "";
  const batCount = p.battery_count ?? "";
  if (batBrand || batModel) {
    parts.push(`${batBrand} ${batModel} x${batCount}`.trim());
  }
  return parts.join(" | ") || "No equipment listed";
}

export type SnapshotFields = {
  dealName: string;
  region: string;
  address: string | null;
  projectType: string | null;
  equipmentSummary: string;
  systemSizeKw: number | null;
  dealAmount: number | null;
  dealOwner: string | null;
  siteSurveyor: string | null;
  projectManager: string | null;
  operationsManager: string | null;
  surveyStatus: string | null;
  surveyDate: string | null;
  designStatus: string | null;
  plansetDate: string | null;
  driveFolderUrl: string | null;
  surveyFolderUrl: string | null;
  designFolderUrl: string | null;
  ahj: string | null;
  utilityCompany: string | null;
  openSolarUrl: string | null;
  surveyCompleted: boolean;
};

/** Map raw HubSpot deal properties to the IdrMeetingItem snapshot fields. */
export function snapshotDealProperties(
  p: Record<string, string | null>,
  ownerMap?: Map<string, string>,
): SnapshotFields {
  const addr = [p.address_line_1, p.city, p.state].filter(Boolean).join(", ") || null;
  const sizeRaw = parseFloat(p.calculated_system_size__kwdc_ ?? "");
  const amountRaw = parseFloat(p.amount ?? "");
  const surveyCompleted =
    p.is_site_survey_completed_ === "true" ||
    p.is_site_survey_completed_ === "Yes";

  const resolveName = (id: string | null | undefined): string | null => {
    if (!id) return null;
    return ownerMap?.get(id) ?? id;
  };

  return {
    dealName: p.dealname ?? "Unknown",
    region: p.pb_location ?? "Unknown",
    address: addr,
    projectType: p.project_type ?? null,
    equipmentSummary: buildEquipmentSummary(p),
    systemSizeKw: isNaN(sizeRaw) ? null : sizeRaw,
    dealAmount: isNaN(amountRaw) ? null : amountRaw,
    dealOwner: resolveName(p.hubspot_owner_id),
    siteSurveyor: resolveName(p.site_surveyor),
    projectManager: resolveName(p.project_manager),
    operationsManager: resolveName(p.operations_manager),
    surveyStatus: p.site_survey_status ?? null,
    surveyDate: p.site_survey_date ?? null,
    designStatus: p.design_status ?? null,
    plansetDate: p.design_draft_completion_date ?? null,
    driveFolderUrl: p.all_document_parent_folder_id ?? null,
    surveyFolderUrl: p.site_survey_documents ?? null,
    designFolderUrl: p.design_documents ?? null,
    ahj: p.ahj ?? null,
    utilityCompany: p.utility_company ?? null,
    openSolarUrl: p.link_to_opensolar ?? p.os_project_link ?? null,
    surveyCompleted,
  };
}

/** Build an owner ID→name map for a batch of deals. */
export async function buildOwnerMap(
  deals: Array<{ properties: Record<string, string | null> }>,
): Promise<Map<string, string>> {
  const ownerIds = new Set<string>();
  for (const deal of deals) {
    for (const key of ["hubspot_owner_id", "site_surveyor", "project_manager", "operations_manager"]) {
      const val = deal.properties[key];
      if (val) ownerIds.add(val);
    }
  }

  const map = new Map<string, string>();
  const resolvePromises = [...ownerIds].map(async (id) => {
    const contact = await resolveHubSpotOwnerContact(id);
    if (contact) map.set(id, contact.name);
  });
  await Promise.allSettled(resolvePromises);
  return map;
}

// ---------------------------------------------------------------------------
// Readiness badge
// ---------------------------------------------------------------------------

export type ReadinessBadge = "green" | "yellow" | "orange" | "red";

export function computeReadinessBadge(
  surveyCompleted: boolean,
  plansetDate: string | null,
): ReadinessBadge {
  const hasPlanset = !!plansetDate;
  if (surveyCompleted && hasPlanset) return "green";
  if (surveyCompleted && !hasPlanset) return "yellow";
  if (!surveyCompleted && hasPlanset) return "orange";
  return "red";
}

// ---------------------------------------------------------------------------
// HubSpot note builder
// ---------------------------------------------------------------------------

interface NoteFields {
  difficulty: number | null;
  installerCount: number | null;
  installerDays: number | null;
  electricianCount: number | null;
  electricianDays: number | null;
  discoReco: boolean | null;
  interiorAccess: boolean | null;
  customerNotes: string | null;
  operationsNotes: string | null;
  designNotes: string | null;
  conclusion: string | null;
  salesChangeRequested?: boolean | null;
  salesChangeNotes?: string | null;
  needsSurveyInfo?: boolean | null;
  opsChangeNotes?: string | null;
  needsResurvey?: boolean | null;
}

/** Build the formatted note body for the HubSpot timeline. */
export function buildHubSpotNoteBody(fields: NoteFields, dateStr: string): string {
  // Format date as M/D/YYYY — parse as local date to avoid UTC timezone shift
  // Accepts "YYYY-MM-DD" or full ISO strings
  const isoDateMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  let formatted: string;
  if (isoDateMatch) {
    const [, year, month, day] = isoDateMatch;
    formatted = `${parseInt(month, 10)}/${parseInt(day, 10)}/${year}`;
  } else {
    const d = new Date(dateStr);
    formatted = isNaN(d.getTime())
      ? dateStr
      : `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  }

  // HubSpot hs_note_body is rendered as HTML — use <br> for line breaks
  const lines: string[] = [`<strong>IDR Meeting -- ${formatted}</strong>`];

  if (fields.customerNotes) lines.push(`<strong>Customer Notes:</strong> ${esc(fields.customerNotes)}`);
  if (fields.operationsNotes) lines.push(`<strong>Operation Notes:</strong> ${esc(fields.operationsNotes)}`);
  if (fields.difficulty != null) lines.push(`<strong>Difficulty:</strong> ${fields.difficulty}/5`);
  if (fields.installerCount != null || fields.installerDays != null) {
    lines.push(`<strong>Roofers:</strong> ${fields.installerCount ?? "?"} count / ${fields.installerDays ?? "?"} day${(fields.installerDays ?? 0) !== 1 ? "s" : ""}`);
  }
  if (fields.electricianCount != null || fields.electricianDays != null) {
    lines.push(`<strong>Electricians:</strong> ${fields.electricianCount ?? "?"} count / ${fields.electricianDays ?? "?"} day${(fields.electricianDays ?? 0) !== 1 ? "s" : ""}`);
  }
  if (fields.discoReco != null) lines.push(`<strong>Disco/Reco:</strong> ${fields.discoReco ? "Yes" : "No"}`);
  if (fields.interiorAccess != null) lines.push(`<strong>Interior Access:</strong> ${fields.interiorAccess ? "Yes" : "No"}`);
  if (fields.salesChangeRequested) lines.push(`<strong>Sales Change Requested:</strong> Yes`);
  if (fields.salesChangeNotes) lines.push(`<strong>Sales Communication Reason:</strong> ${esc(fields.salesChangeNotes)}`);
  if (fields.needsSurveyInfo) lines.push(`<strong>Needs Survey Info:</strong> Yes`);
  if (fields.opsChangeNotes) lines.push(`<strong>Ops Communication Reason:</strong> ${esc(fields.opsChangeNotes)}`);
  if (fields.needsResurvey) lines.push(`<strong>Needs Resurvey:</strong> Yes`);
  if (fields.designNotes) lines.push(`<strong>Design Notes:</strong> ${esc(fields.designNotes)}`);
  if (fields.conclusion) lines.push(`<strong>Conclusion:</strong> ${esc(fields.conclusion)}`);

  return lines.join("<br>");
}

/** Escape HTML special characters in user-provided text */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// HubSpot property updates
// ---------------------------------------------------------------------------

interface PropertyFields {
  difficulty: number | null;
  installerCount: number | null;
  installerDays: number | null;
  electricianCount: number | null;
  electricianDays: number | null;
  discoReco: boolean | null;
  interiorAccess: boolean | null;
  operationsNotes: string | null;
  needsSurveyInfo: boolean | null;
  needsResurvey: boolean | null;
  salesChangeRequested: boolean | null;
  salesChangeNotes: string | null;
  opsChangeNotes: string | null;
}

/** Map item fields to HubSpot deal property key-value pairs. Only includes non-null fields. */
export function buildHubSpotPropertyUpdates(
  fields: PropertyFields,
): Record<string, string> {
  const updates: Record<string, string> = {};
  if (fields.difficulty != null) updates.install_difficulty = String(fields.difficulty);
  if (fields.installerCount != null) updates.expected_installer_cont = String(fields.installerCount);
  if (fields.installerDays != null) updates.days_for_installers = String(fields.installerDays);
  if (fields.electricianCount != null) updates.expected_electrician_count = String(fields.electricianCount);
  if (fields.electricianDays != null) updates.days_for_electricians = String(fields.electricianDays);
  if (fields.discoReco != null) updates.disco__reco = fields.discoReco ? "true" : "false";
  if (fields.interiorAccess != null) updates.interior_access = fields.interiorAccess ? "true" : "false";
  if (fields.operationsNotes != null) updates.notes_for_install = fields.operationsNotes;

  // DA status flags — priority: resurvey > survey info > sales change
  if (fields.needsResurvey) {
    updates.layout_status = "Pending Resurvey";
  } else if (fields.needsSurveyInfo) {
    updates.layout_status = "Pending Ops Changes";
  } else if (fields.salesChangeRequested) {
    updates.layout_status = "Pending Sales Changes";
  }

  // Communication reason notes
  if (fields.salesChangeNotes) updates.sales_communication_reason = fields.salesChangeNotes;
  if (fields.opsChangeNotes) updates.ops_communication_reason = fields.opsChangeNotes;

  return updates;
}

// ---------------------------------------------------------------------------
// Session creation — query HubSpot + build items
// ---------------------------------------------------------------------------

// Terminal deal stages — deals in these stages should never appear in the IDR queue
const TERMINAL_DEAL_STAGES = [
  "68229433",  // Cancelled
  "20440343",  // Project Complete
  "20440344",  // On Hold
];

/** Query HubSpot for all active Project pipeline deals in Initial Review. */
export async function fetchInitialReviewDeals(): Promise<
  Array<{ dealId: string; properties: Record<string, string | null> }>
> {
  const filters: Record<string, unknown>[] = [
    { propertyName: "pipeline", operator: FilterOperatorEnum.Eq, value: PROJECT_PIPELINE_ID },
    { propertyName: "design_status", operator: FilterOperatorEnum.Eq, value: "Initial Review" },
    { propertyName: "dealstage", operator: FilterOperatorEnum.NotIn, values: TERMINAL_DEAL_STAGES },
  ];
  const response = await searchWithRetry({
    filterGroups: [{ filters }] as unknown as { filters: { propertyName: string; operator: typeof FilterOperatorEnum.Eq; value: string }[] }[],
    properties: SNAPSHOT_PROPERTIES,
    limit: 200,
  });

  return (response?.results ?? []).map((deal) => ({
    dealId: deal.id,
    properties: deal.properties as Record<string, string | null>,
  }));
}

/** Check which dealIds appeared in the session immediately before `sessionDate`. */
export async function getReturningDealIds(sessionDate: Date): Promise<Set<string>> {
  const priorSession = await prisma.idrMeetingSession.findFirst({
    where: { date: { lt: sessionDate } },
    orderBy: { date: "desc" },
    select: { id: true },
  });
  if (!priorSession) return new Set();

  const items = await prisma.idrMeetingItem.findMany({
    where: { sessionId: priorSession.id },
    select: { dealId: true },
  });
  return new Set(items.map((i) => i.dealId));
}

// ---------------------------------------------------------------------------
// HubSpot sync — push properties + create timeline note
// ---------------------------------------------------------------------------

/** Push property updates to a HubSpot deal. */
export async function pushDealProperties(
  dealId: string,
  properties: Record<string, string>,
): Promise<void> {
  await hubspotClient.crm.deals.basicApi.update(dealId, { properties });
}

/**
 * HubSpot owner IDs to @mention on IDR meeting notes.
 * Comma-separated list of HubSpot owner IDs.
 * Set IDR_MEETING_MENTION_OWNER_IDS in .env.
 */
const IDR_MENTION_OWNER_IDS = (process.env.IDR_MEETING_MENTION_OWNER_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** Create a note engagement on a HubSpot deal timeline. */
export async function createDealTimelineNote(
  dealId: string,
  noteBody: string,
): Promise<void> {
  const properties: Record<string, string> = {
    hs_note_body: noteBody,
    hs_timestamp: new Date().toISOString(),
  };

  // @mention configured owners so they get notified
  if (IDR_MENTION_OWNER_IDS.length > 0) {
    properties.hs_at_mentioned_owner_ids = IDR_MENTION_OWNER_IDS.join(";");
  }

  await hubspotClient.crm.objects.notes.basicApi.create({
    properties,
    associations: [
      {
        to: { id: dealId },
        types: [
          {
            associationCategory: AssociationSpecAssociationCategoryEnum.HubspotDefined,
            associationTypeId: 214, // note-to-deal
          },
        ],
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Archive search
// ---------------------------------------------------------------------------

/** Search meeting items by text across note fields. */
export async function searchMeetingItems(params: {
  query: string;
  dateFrom?: string;
  dateTo?: string;
  skip?: number;
  limit?: number;
}) {
  const { query, dateFrom, dateTo, skip = 0, limit = 50 } = params;

  const textFilter = {
    OR: [
      { dealName: { contains: query, mode: "insensitive" as const } },
      { region: { contains: query, mode: "insensitive" as const } },
      { customerNotes: { contains: query, mode: "insensitive" as const } },
      { operationsNotes: { contains: query, mode: "insensitive" as const } },
      { designNotes: { contains: query, mode: "insensitive" as const } },
      { conclusion: { contains: query, mode: "insensitive" as const } },
      { escalationReason: { contains: query, mode: "insensitive" as const } },
    ],
  };

  const dateFilter = (dateFrom || dateTo)
    ? {
        session: {
          date: {
            ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
            ...(dateTo ? { lte: new Date(dateTo) } : {}),
          },
        },
      }
    : {};

  const [items, total] = await Promise.all([
    prisma.idrMeetingItem.findMany({
      where: { ...textFilter, ...dateFilter },
      include: { session: { select: { date: true, status: true } } },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.idrMeetingItem.count({ where: { ...textFilter, ...dateFilter } }),
  ]);

  return {
    items,
    total,
    hasMore: skip + items.length < total,
  };
}
