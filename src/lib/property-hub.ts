/**
 * Property Hub — data orchestration for the full-page property view.
 *
 * Single entry point: `getPropertyHub(propertyId, tab, options)`.
 * Each tab fetches only the data it needs — no mega-query.
 */

import { prisma } from "@/lib/db";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import { getObjectEngagements } from "@/lib/hubspot-engagements";
import { withRetry } from "@/lib/hubspot-custom-objects";
import { getStageMaps } from "@/lib/deals-pipeline";
import { Client } from "@hubspot/api-client";
import type { Engagement } from "@/components/deal-detail/types";
import type { PropertyDetail } from "@/lib/property-detail";
import {
  computeEquipmentSummary,
  createEmptySummary,
} from "@/lib/property-detail";

const hubspotClient = new Client({
  accessToken: process.env.HUBSPOT_ACCESS_TOKEN,
  numberOfApiCallRetries: 2,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HubTab =
  | "activity"
  | "deals"
  | "tickets"
  | "jobs"
  | "schedule"
  | "equipment";

export interface HubOptions {
  offset?: number;
  limit?: number;
}

// --- Activity tab ---

export interface ActivityTabData {
  engagements: Engagement[];
  total: number;
  hasMore: boolean;
}

// --- Deals tab ---

export interface HubDeal {
  id: string;
  name: string;
  stage: string;
  stageName: string;
  pipeline: string;
  pipelineName: string;
  amount: number | null;
  closeDate: string | null;
  owner: string | null;
}

export interface DealsTabData {
  deals: HubDeal[];
  total: number;
}

// --- Tickets tab ---

export interface HubTicket {
  id: string;
  subject: string;
  status: string;
  statusName: string;
  priority: string | null;
  createDate: string | null;
  lastModified: string | null;
  owner: string | null;
}

export interface TicketsTabData {
  tickets: HubTicket[];
  total: number;
}

// --- Jobs tab ---

export interface HubJob {
  jobUid: string;
  title: string;
  category: string;
  status: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  completedDate: string | null;
  crew: { uid: string; name: string }[];
  dealId: string | null;
  dealName: string | null;
  projectUid: string | null;
}

export interface JobsTabData {
  jobs: HubJob[];
  total: number;
  /** Deal IDs that have no ZuperJobCache row */
  uncachedDealIds: string[];
}

// --- Schedule tab ---

export interface HubSlot {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  userName: string;
  location: string;
  projectName: string;
  dealId: string;
  source: string;
  zuperJobUid: string | null;
}

export interface ScheduleTabData {
  slots: HubSlot[];
  total: number;
}

// --- Equipment tab ---

export interface BomSnapshotSummary {
  id: string;
  dealId: string;
  dealName: string;
  version: number;
  createdAt: string;
  savedBy: string;
  sourceFile: string | null;
  itemCount: number;
}

export interface EquipmentTabData {
  snapshots: BomSnapshotSummary[];
  equipmentSummary: PropertyDetail["equipmentSummary"];
}

// --- Counts (for drawer badges) ---

export interface HubCounts {
  deals: number;
  tickets: number;
  jobs: number;
  schedule: number;
}

// --- Union response ---

export type HubResponse =
  | { tab: "activity"; data: ActivityTabData }
  | { tab: "deals"; data: DealsTabData }
  | { tab: "tickets"; data: TicketsTabData }
  | { tab: "jobs"; data: JobsTabData }
  | { tab: "schedule"; data: ScheduleTabData }
  | { tab: "equipment"; data: EquipmentTabData };

// ---------------------------------------------------------------------------
// Pipeline / stage name caches (lightweight, long TTL)
// ---------------------------------------------------------------------------

const PIPELINE_NAMES: Record<string, string> = {
  default: "Sales",
  "6900017": "Project",
  "21997330": "D&R",
  "23928924": "Service",
  "765928545": "Roofing",
};

// ---------------------------------------------------------------------------
// Shared DB fetch: property + links
// ---------------------------------------------------------------------------

async function loadPropertyWithLinks(propertyId: string) {
  // Accept either hubspotObjectId (numeric string) or Prisma cuid
  const isHubSpotId = /^\d+$/.test(propertyId);
  return prisma.hubSpotPropertyCache.findUnique({
    where: isHubSpotId ? { hubspotObjectId: propertyId } : { id: propertyId },
    include: {
      dealLinks: { select: { dealId: true }, orderBy: { associatedAt: "desc" } },
      ticketLinks: { select: { ticketId: true }, orderBy: { associatedAt: "desc" } },
      contactLinks: { select: { contactId: true }, orderBy: { associatedAt: "desc" } },
    },
  });
}

// ---------------------------------------------------------------------------
// Tab: Activity
// ---------------------------------------------------------------------------

async function fetchActivity(
  propertyId: string,
  options: HubOptions,
): Promise<ActivityTabData> {
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 25;

  const cached = await appCache.getOrFetch<Engagement[]>(
    CACHE_KEYS.PROPERTY_HUB_ACTIVITY(propertyId),
    async () => {
      const property = await loadPropertyWithLinks(propertyId);
      if (!property) return [];

      // Cap fan-out: 10 most recent deals + 5 most recent tickets
      const dealIds = property.dealLinks.slice(0, 10).map((l) => l.dealId);
      const ticketIds = property.ticketLinks.slice(0, 5).map((l) => l.ticketId);
      const contactIds = Array.from(
        new Set(property.contactLinks.map((l) => l.contactId)),
      );

      const fetches: Promise<Engagement[]>[] = [
        ...dealIds.map((id) =>
          getObjectEngagements(id, "deals", { expandContacts: true }),
        ),
        ...ticketIds.map((id) =>
          getObjectEngagements(id, "tickets", { expandContacts: true }),
        ),
        // Direct contact engagements — don't re-expand
        ...contactIds.map((id) =>
          getObjectEngagements(id, "contacts", { expandContacts: false }),
        ),
      ];

      const results = await Promise.all(fetches);
      const all = results.flat();

      // Deduplicate by engagement ID
      const seen = new Set<string>();
      const deduped: Engagement[] = [];
      for (const eng of all) {
        if (seen.has(eng.id)) continue;
        seen.add(eng.id);
        deduped.push(eng);
      }

      return deduped.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
    },
  );

  const all = cached.data ?? [];
  const page = all.slice(offset, offset + limit);

  return {
    engagements: page,
    total: all.length,
    hasMore: offset + limit < all.length,
  };
}

// ---------------------------------------------------------------------------
// Tab: Deals
// ---------------------------------------------------------------------------

async function fetchDeals(propertyId: string): Promise<DealsTabData> {
  const property = await loadPropertyWithLinks(propertyId);
  if (!property) return { deals: [], total: 0 };

  const dealIds = property.dealLinks.map((l) => l.dealId);
  if (dealIds.length === 0) return { deals: [], total: 0 };

  // Batch-read from HubSpot + resolve stage names in parallel
  try {
    const [response, stageMaps] = await Promise.all([
      withRetry(() =>
        hubspotClient.crm.deals.batchApi.read({
          inputs: dealIds.map((id) => ({ id })),
          properties: [
            "dealname",
            "dealstage",
            "pipeline",
            "amount",
            "closedate",
            "hubspot_owner_id",
          ],
          propertiesWithHistory: [],
        }),
      ),
      getStageMaps(),
    ]);

    // Build a flat stageId→name lookup from all pipelines
    const flatStageMap: Record<string, string> = {};
    for (const pipelineStages of Object.values(stageMaps)) {
      for (const [stageId, stageName] of Object.entries(pipelineStages)) {
        flatStageMap[stageId] = stageName;
      }
    }

    const deals: HubDeal[] = response.results.map((r) => {
      const props = r.properties as Record<string, string>;
      const stageId = props.dealstage || "";
      return {
        id: r.id,
        name: props.dealname || `Deal ${r.id}`,
        stage: stageId,
        stageName: flatStageMap[stageId] || stageId,
        pipeline: props.pipeline || "",
        pipelineName: PIPELINE_NAMES[props.pipeline] || props.pipeline || "",
        amount: props.amount ? Number(props.amount) : null,
        closeDate: props.closedate || null,
        owner: props.hubspot_owner_id || null,
      };
    });

    // Sort by close date desc
    deals.sort((a, b) => {
      if (!a.closeDate && !b.closeDate) return 0;
      if (!a.closeDate) return 1;
      if (!b.closeDate) return -1;
      return new Date(b.closeDate).getTime() - new Date(a.closeDate).getTime();
    });

    return { deals, total: deals.length };
  } catch (err) {
    console.error("[PropertyHub] deals batch-read failed:", err);
    return { deals: [], total: dealIds.length };
  }
}

// ---------------------------------------------------------------------------
// Tab: Tickets
// ---------------------------------------------------------------------------

async function fetchTickets(propertyId: string): Promise<TicketsTabData> {
  const property = await loadPropertyWithLinks(propertyId);
  if (!property) return { tickets: [], total: 0 };

  const ticketIds = property.ticketLinks.map((l) => l.ticketId);
  if (ticketIds.length === 0) return { tickets: [], total: 0 };

  try {
    const response = await withRetry(() =>
      hubspotClient.crm.tickets.batchApi.read({
        inputs: ticketIds.map((id) => ({ id })),
        properties: [
          "subject",
          "hs_pipeline_stage",
          "hs_ticket_priority",
          "createdate",
          "hs_lastmodifieddate",
          "hubspot_owner_id",
        ],
        propertiesWithHistory: [],
      }),
    );

    const tickets: HubTicket[] = response.results.map((r) => {
      const props = r.properties as Record<string, string>;
      return {
        id: r.id,
        subject: props.subject || `Ticket ${r.id}`,
        status: props.hs_pipeline_stage || "",
        statusName: props.hs_pipeline_stage || "",
        priority: props.hs_ticket_priority || null,
        createDate: props.createdate || null,
        lastModified: props.hs_lastmodifieddate || null,
        owner: props.hubspot_owner_id || null,
      };
    });

    // Sort: newest first
    tickets.sort((a, b) => {
      if (!a.createDate && !b.createDate) return 0;
      if (!a.createDate) return 1;
      if (!b.createDate) return -1;
      return (
        new Date(b.createDate).getTime() - new Date(a.createDate).getTime()
      );
    });

    return { tickets, total: tickets.length };
  } catch (err) {
    console.error("[PropertyHub] tickets batch-read failed:", err);
    return { tickets: [], total: ticketIds.length };
  }
}

// ---------------------------------------------------------------------------
// Tab: Jobs
// ---------------------------------------------------------------------------

async function fetchJobs(propertyId: string): Promise<JobsTabData> {
  const property = await loadPropertyWithLinks(propertyId);
  if (!property) return { jobs: [], total: 0, uncachedDealIds: [] };

  const dealIds = property.dealLinks.map((l) => l.dealId);
  if (dealIds.length === 0) return { jobs: [], total: 0, uncachedDealIds: [] };

  const cachedJobs = await prisma.zuperJobCache.findMany({
    where: { hubspotDealId: { in: dealIds } },
    orderBy: { scheduledStart: "desc" },
  });

  const jobDealIds = new Set(
    cachedJobs.map((j) => j.hubspotDealId).filter(Boolean),
  );
  const uncachedDealIds = dealIds.filter((id) => !jobDealIds.has(id));

  const jobs: HubJob[] = cachedJobs.map((j) => {
    let crew: { uid: string; name: string }[] = [];
    if (j.assignedUsers && Array.isArray(j.assignedUsers)) {
      crew = (j.assignedUsers as { user_uid: string; user_name: string }[]).map(
        (u) => ({ uid: u.user_uid, name: u.user_name }),
      );
    }

    // Extract project UID from raw Zuper response if available
    let projectUid: string | null = null;
    if (j.rawData && typeof j.rawData === "object") {
      const raw = j.rawData as Record<string, unknown>;
      const project = raw.project as { project_uid?: string } | undefined;
      projectUid = project?.project_uid ?? null;
    }

    return {
      jobUid: j.jobUid,
      title: j.jobTitle,
      category: j.jobCategory,
      status: j.jobStatus,
      scheduledStart: j.scheduledStart?.toISOString() ?? null,
      scheduledEnd: j.scheduledEnd?.toISOString() ?? null,
      completedDate: j.completedDate?.toISOString() ?? null,
      crew,
      dealId: j.hubspotDealId,
      dealName: j.projectName,
      projectUid,
    };
  });

  return { jobs, total: jobs.length, uncachedDealIds };
}

// ---------------------------------------------------------------------------
// Tab: Schedule
// ---------------------------------------------------------------------------

async function fetchSchedule(propertyId: string): Promise<ScheduleTabData> {
  const property = await loadPropertyWithLinks(propertyId);
  if (!property) return { slots: [], total: 0 };

  const dealIds = property.dealLinks.map((l) => l.dealId);
  if (dealIds.length === 0) return { slots: [], total: 0 };

  const bookedSlots = await prisma.bookedSlot.findMany({
    where: { projectId: { in: dealIds } },
    orderBy: { date: "desc" },
  });

  const slots: HubSlot[] = bookedSlots.map((s) => ({
    id: s.id,
    date: s.date,
    startTime: s.startTime,
    endTime: s.endTime,
    userName: s.userName,
    location: s.location,
    projectName: s.projectName,
    dealId: s.projectId,
    source: s.source,
    zuperJobUid: s.zuperJobUid,
  }));

  return { slots, total: slots.length };
}

// ---------------------------------------------------------------------------
// Tab: Equipment
// ---------------------------------------------------------------------------

async function fetchEquipment(propertyId: string): Promise<EquipmentTabData> {
  const property = await loadPropertyWithLinks(propertyId);
  if (!property)
    return { snapshots: [], equipmentSummary: createEmptySummary() };

  const dealIds = property.dealLinks.map((l) => l.dealId);

  // BOM snapshots — all versions for all deals
  const snapshots = dealIds.length
    ? await prisma.projectBomSnapshot.findMany({
        where: { dealId: { in: dealIds } },
        orderBy: [{ dealId: "asc" }, { version: "desc" }],
        select: {
          id: true,
          dealId: true,
          dealName: true,
          version: true,
          createdAt: true,
          savedBy: true,
          sourceFile: true,
          bomData: true,
        },
      })
    : [];

  const summaries: BomSnapshotSummary[] = snapshots.map((s) => {
    let itemCount = 0;
    if (s.bomData && typeof s.bomData === "object") {
      const data = s.bomData as { items?: unknown[] };
      itemCount = data.items?.length ?? 0;
    }
    return {
      id: s.id,
      dealId: s.dealId,
      dealName: s.dealName,
      version: s.version,
      createdAt: s.createdAt.toISOString(),
      savedBy: s.savedBy,
      sourceFile: s.sourceFile,
      itemCount,
    };
  });

  // Equipment summary from live line items
  let equipmentSummary: PropertyDetail["equipmentSummary"];
  try {
    equipmentSummary = await computeEquipmentSummary(dealIds);
  } catch {
    equipmentSummary = createEmptySummary();
  }

  return { snapshots: summaries, equipmentSummary };
}

// ---------------------------------------------------------------------------
// Counts (for drawer badges)
// ---------------------------------------------------------------------------

export async function getPropertyHubCounts(
  propertyId: string,
): Promise<HubCounts> {
  const property = await loadPropertyWithLinks(propertyId);
  if (!property) return { deals: 0, tickets: 0, jobs: 0, schedule: 0 };

  const dealIds = property.dealLinks.map((l) => l.dealId);
  const ticketCount = property.ticketLinks.length;

  const [jobCount, slotCount] = await Promise.all([
    dealIds.length
      ? prisma.zuperJobCache.count({
          where: { hubspotDealId: { in: dealIds } },
        })
      : 0,
    dealIds.length
      ? prisma.bookedSlot.count({
          where: { projectId: { in: dealIds } },
        })
      : 0,
  ]);

  return {
    deals: property.dealLinks.length,
    tickets: ticketCount,
    jobs: jobCount,
    schedule: slotCount,
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function getPropertyHub(
  propertyId: string,
  tab: HubTab,
  options: HubOptions = {},
): Promise<HubResponse> {
  switch (tab) {
    case "activity":
      return { tab, data: await fetchActivity(propertyId, options) };
    case "deals":
      return { tab, data: await fetchDeals(propertyId) };
    case "tickets":
      return { tab, data: await fetchTickets(propertyId) };
    case "jobs":
      return { tab, data: await fetchJobs(propertyId) };
    case "schedule":
      return { tab, data: await fetchSchedule(propertyId) };
    case "equipment":
      return { tab, data: await fetchEquipment(propertyId) };
    default: {
      const _exhaustive: never = tab;
      throw new Error(`Unknown tab: ${_exhaustive}`);
    }
  }
}
