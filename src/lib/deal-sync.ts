/**
 * Deal Sync Engine — orchestrates HubSpot → Deal table synchronization.
 *
 * Exports:
 * - resolvePipeline()       — map HubSpot pipeline ID → DealPipeline enum
 * - resolveStage()          — look up stage name from DealPipelineConfig
 * - diffDealProperties()    — change detection for two deal snapshots
 * - syncPipelineConfigs()   — refresh stage maps from HubSpot
 * - batchSyncPipeline()     — full or incremental sync for a pipeline
 * - syncSingleDeal()        — webhook/manual single-deal sync
 *
 * See spec: docs/superpowers/specs/2026-04-10-deal-mirror-design.md
 */

import { prisma } from "@/lib/db";
import { mapHubSpotToDeal, DEAL_SYNC_PROPERTIES } from "@/lib/deal-property-map";
import { hubspotClient, searchWithRetry } from "@/lib/hubspot";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import type { DealPipeline, DealSyncSource, DealSyncType } from "@/generated/prisma/enums";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** HubSpot pipeline ID → DealPipeline enum */
const PIPELINE_ID_MAP: Record<string, DealPipeline> = {
  "6900017": "PROJECT",
  "21997330": "DNR",
  "23928924": "SERVICE",
  "765928545": "ROOFING",
};

/** Reverse: DealPipeline enum → HubSpot pipeline ID (for search filters) */
const PIPELINE_ENUM_TO_ID: Record<DealPipeline, string> = {
  SALES: "default",
  PROJECT: "6900017",
  DNR: "21997330",
  SERVICE: "23928924",
  ROOFING: "765928545",
};

const BATCH_READ_SIZE = 100;
const BATCH_READ_CONCURRENCY = 3;
const MAX_PAGINATION_PAGES = 100;
const SALES_FILTER_GROUP_SIZE = 5; // HubSpot limit: 5 filterGroups per search
const WATERMARK_OVERLAP_MS = 2 * 60 * 1000; // 2 minutes

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getAccessToken(): string {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) throw new Error("HUBSPOT_ACCESS_TOKEN is not set");
  return token;
}

/** Safe JSON comparison — handles Dates, nulls, and objects */
function valueToComparable(val: unknown): string {
  if (val instanceof Date) return val.toISOString();
  if (val === null || val === undefined) return "null";
  return JSON.stringify(val);
}

// ---------------------------------------------------------------------------
// Public: resolvePipeline
// ---------------------------------------------------------------------------

/**
 * Maps a HubSpot pipeline ID to the DealPipeline enum.
 * Returns "SALES" for "default", empty, null, or unknown IDs.
 */
export function resolvePipeline(pipelineId: string | null | undefined): DealPipeline {
  if (!pipelineId || pipelineId === "default") return "SALES";
  return PIPELINE_ID_MAP[pipelineId] ?? "SALES";
}

// ---------------------------------------------------------------------------
// Public: resolveStage
// ---------------------------------------------------------------------------

/** In-memory cache for pipeline stage maps (populated from DB on first call) */
let stageConfigCache: Map<DealPipeline, Map<string, string>> | null = null;
let stageConfigCacheAt = 0;
const STAGE_CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5 min

// Owner map cache with TTL
let ownerMapCache: { map: Record<string, string>; fetchedAt: number } | null = null;
const OWNER_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Circuit breaker: skip owner fetch for 20 min after 403
let ownerCircuitBreakerUntil = 0;
const OWNER_CIRCUIT_BREAKER_MS = 20 * 60 * 1000;

/**
 * Look up human-readable stage name from the DealPipelineConfig table.
 * Falls back to the raw stageId if no config is found.
 */
export async function resolveStage(
  stageId: string,
  pipeline: DealPipeline
): Promise<string> {
  // Refresh cache if stale or missing
  const now = Date.now();
  if (!stageConfigCache || now - stageConfigCacheAt > STAGE_CONFIG_CACHE_TTL) {
    stageConfigCache = new Map();
    try {
      if (!prisma) throw new Error("DB unavailable");
      const configs = await prisma.dealPipelineConfig.findMany();
      for (const cfg of configs) {
        const stages = cfg.stages as Array<{ id: string; name: string }>;
        const map = new Map<string, string>();
        for (const s of stages) {
          map.set(s.id, s.name);
        }
        stageConfigCache.set(cfg.pipeline, map);
      }
      stageConfigCacheAt = now;
    } catch {
      // DB unavailable — return raw stageId
      return stageId;
    }
  }

  const stageMap = stageConfigCache.get(pipeline);
  return stageMap?.get(stageId) ?? stageId;
}

/**
 * Invalidate the stage config cache so the next resolveStage call re-reads from DB.
 * Called after syncPipelineConfigs().
 */
export function invalidateStageCache(): void {
  stageConfigCache = null;
  stageConfigCacheAt = 0;
}

// ---------------------------------------------------------------------------
// Public: diffDealProperties
// ---------------------------------------------------------------------------

/**
 * Compares two property objects and returns a diff.
 * Only keys present in `incoming` are compared.
 *
 * Returns: `{ fieldName: [oldValue, newValue] }` for changed fields.
 */
export function diffDealProperties(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>
): Record<string, [unknown, unknown]> {
  const diff: Record<string, [unknown, unknown]> = {};

  for (const key of Object.keys(incoming)) {
    const oldVal = existing[key];
    const newVal = incoming[key];

    const oldStr = valueToComparable(oldVal);
    const newStr = valueToComparable(newVal);

    if (oldStr !== newStr) {
      diff[key] = [oldVal, newVal];
    }
  }

  return diff;
}

// ---------------------------------------------------------------------------
// Public: syncPipelineConfigs
// ---------------------------------------------------------------------------

interface HubSpotPipelineStage {
  id: string;
  label: string;
  displayOrder: number;
  archived: boolean;
}

interface HubSpotPipeline {
  id: string;
  label: string;
  stages: HubSpotPipelineStage[];
}

/**
 * Fetches all deal pipelines from HubSpot and upserts into DealPipelineConfig.
 * Returns the number of pipeline configs upserted.
 */
export async function syncPipelineConfigs(): Promise<number> {
  const accessToken = getAccessToken();

  const response = await fetchWithRetry("https://api.hubapi.com/crm/v3/pipelines/deals", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch pipelines: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as { results: HubSpotPipeline[] };

  if (!prisma) throw new Error("Database unavailable");

  let upserted = 0;

  for (const pipeline of data.results) {
    const pipelineEnum = resolvePipeline(pipeline.id);
    const stages = pipeline.stages.map((s) => ({
      id: s.id,
      name: s.label,
      displayOrder: s.displayOrder,
      isActive: !s.archived,
    }));

    await prisma.dealPipelineConfig.upsert({
      where: { pipeline: pipelineEnum },
      create: {
        pipeline: pipelineEnum,
        hubspotPipelineId: pipeline.id,
        stages,
        lastSyncedAt: new Date(),
      },
      update: {
        hubspotPipelineId: pipeline.id,
        stages,
        lastSyncedAt: new Date(),
      },
    });
    upserted++;
  }

  // Invalidate in-memory cache so resolveStage picks up new data
  invalidateStageCache();

  console.log(`[DealSync] Synced ${upserted} pipeline configs`);
  return upserted;
}

// ---------------------------------------------------------------------------
// Public: BatchSyncResult
// ---------------------------------------------------------------------------

export interface BatchSyncResult {
  pipeline: DealPipeline;
  totalFetched: number;
  upserted: number;
  skipped: number;
  deleted: number;
  errors: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Retry helper
// ---------------------------------------------------------------------------

/**
 * Wraps fetch with exponential backoff retry on 429 rate limit responses.
 */
async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 3): Promise<Response> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(url, options);
    if (res.status === 429 && attempt < maxRetries - 1) {
      const delay = Math.pow(2, attempt) * 1100 + Math.random() * 400;
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    return res;
  }
  throw new Error(`Fetch failed after ${maxRetries} retries`);
}

// ---------------------------------------------------------------------------
// Owner resolution
// ---------------------------------------------------------------------------

/** Fetch all HubSpot owners and return an ID → name map (cached with TTL + 403 circuit breaker) */
export async function fetchOwnerMap(): Promise<Record<string, string>> {
  const now = Date.now();

  // Return cached map if within TTL
  if (ownerMapCache && now - ownerMapCache.fetchedAt < OWNER_CACHE_TTL_MS) {
    return ownerMapCache.map;
  }

  // Circuit breaker: skip fetch for 20 min after a 403
  if (now < ownerCircuitBreakerUntil) {
    console.warn("[DealSync] Owner fetch skipped — circuit breaker active until", new Date(ownerCircuitBreakerUntil).toISOString());
    return ownerMapCache?.map ?? {};
  }

  const map: Record<string, string> = {};

  try {
    const result = await hubspotClient.crm.owners.ownersApi.getPage(
      undefined,
      undefined,
      500,
      false
    );

    for (const owner of result.results ?? []) {
      const name = [owner.firstName, owner.lastName].filter(Boolean).join(" ").trim();
      if (!name) continue;

      // Map by all known ID forms
      if (owner.id) map[String(owner.id)] = name;
      if (owner.userId != null) map[String(owner.userId)] = name;
    }

    // Update cache on success
    ownerMapCache = { map, fetchedAt: now };
  } catch (err: unknown) {
    // Activate circuit breaker on 403
    const statusCode =
      err instanceof Error && "code" in err ? (err as { code?: number }).code :
      err instanceof Error && "status" in err ? (err as { status?: number }).status :
      undefined;
    if (statusCode === 403) {
      ownerCircuitBreakerUntil = now + OWNER_CIRCUIT_BREAKER_MS;
      console.warn("[DealSync] Owner fetch 403 — circuit breaker activated for 20 minutes");
    } else {
      console.warn("[DealSync] Failed to fetch owners, owner names will be empty:", err);
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// Association hydration (batch)
// ---------------------------------------------------------------------------

interface AssociationResult {
  from: { id: string };
  to: Array<{
    toObjectId: number;
    associationTypes: Array<{ label: string | null; typeId: number }>;
  }>;
}

/**
 * Batch-read associations from deals to contacts or companies.
 * Uses POST /crm/v4/associations/deals/{toObjectType}/batch/read
 * Returns: Map<dealId, objectId[]>
 */
async function batchReadAssociations(
  dealIds: string[],
  toObjectType: "contacts" | "companies"
): Promise<Map<string, string[]>> {
  const accessToken = getAccessToken();
  const result = new Map<string, string[]>();

  // Process in batches of 100
  for (let i = 0; i < dealIds.length; i += BATCH_READ_SIZE) {
    const batch = dealIds.slice(i, i + BATCH_READ_SIZE);

    try {
      const response = await fetch(
        `https://api.hubapi.com/crm/v4/associations/deals/${toObjectType}/batch/read`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            inputs: batch.map((id) => ({ id })),
          }),
        }
      );

      if (!response.ok) {
        console.warn(
          `[DealSync] Association batch read (${toObjectType}) failed: ${response.status}`
        );
        continue;
      }

      const data = (await response.json()) as { results: AssociationResult[] };

      for (const assoc of data.results ?? []) {
        const dealId = assoc.from.id;
        const objectIds = assoc.to.map((t) => String(t.toObjectId));
        result.set(dealId, objectIds);
      }
    } catch (err) {
      console.warn(`[DealSync] Association batch read (${toObjectType}) error:`, err);
    }

    if (i + BATCH_READ_SIZE < dealIds.length) await sleep(100);
  }

  return result;
}

/**
 * Batch-read contact/company properties and return lookup maps.
 */
async function batchReadContactProperties(
  contactIds: string[]
): Promise<Map<string, { name: string; email: string; phone: string }>> {
  const map = new Map<string, { name: string; email: string; phone: string }>();
  if (contactIds.length === 0) return map;

  const uniqueIds = [...new Set(contactIds)];

  for (let i = 0; i < uniqueIds.length; i += BATCH_READ_SIZE) {
    const batch = uniqueIds.slice(i, i + BATCH_READ_SIZE);

    try {
      const result = await hubspotClient.crm.contacts.batchApi.read({
        inputs: batch.map((id) => ({ id })),
        properties: ["firstname", "lastname", "email", "phone"],
        propertiesWithHistory: [],
      });

      for (const contact of result.results ?? []) {
        const props = contact.properties as Record<string, string | null>;
        const name = [props.firstname, props.lastname].filter(Boolean).join(" ").trim();
        map.set(contact.id, {
          name: name || "",
          email: props.email ?? "",
          phone: props.phone ?? "",
        });
      }
    } catch (err) {
      console.warn("[DealSync] Contact batch read error:", err);
    }

    if (i + BATCH_READ_SIZE < uniqueIds.length) await sleep(100);
  }

  return map;
}

async function batchReadCompanyProperties(
  companyIds: string[]
): Promise<Map<string, { name: string }>> {
  const map = new Map<string, { name: string }>();
  if (companyIds.length === 0) return map;

  const uniqueIds = [...new Set(companyIds)];

  for (let i = 0; i < uniqueIds.length; i += BATCH_READ_SIZE) {
    const batch = uniqueIds.slice(i, i + BATCH_READ_SIZE);

    try {
      const result = await hubspotClient.crm.companies.batchApi.read({
        inputs: batch.map((id) => ({ id })),
        properties: ["name"],
        propertiesWithHistory: [],
      });

      for (const company of result.results ?? []) {
        const props = company.properties as Record<string, string | null>;
        map.set(company.id, { name: props.name ?? "" });
      }
    } catch (err) {
      console.warn("[DealSync] Company batch read error:", err);
    }

    if (i + BATCH_READ_SIZE < uniqueIds.length) await sleep(100);
  }

  return map;
}

// ---------------------------------------------------------------------------
// Watermark management
// ---------------------------------------------------------------------------

function watermarkKey(pipeline: DealPipeline): string {
  return `deal-sync:watermark:${pipeline}`;
}

async function getWatermark(pipeline: DealPipeline): Promise<Date | null> {
  if (!prisma) return null;
  try {
    const config = await prisma.systemConfig.findUnique({
      where: { key: watermarkKey(pipeline) },
    });
    return config ? new Date(config.value) : null;
  } catch {
    return null;
  }
}

async function setWatermark(pipeline: DealPipeline, timestamp: Date): Promise<void> {
  if (!prisma) return;
  const key = watermarkKey(pipeline);
  await prisma.systemConfig.upsert({
    where: { key },
    create: { key, value: timestamp.toISOString() },
    update: { value: timestamp.toISOString() },
  });
}

// ---------------------------------------------------------------------------
// Phase 1: ID collection
// ---------------------------------------------------------------------------

/**
 * Collect all deal IDs for a pipeline via HubSpot search API.
 * For SALES pipeline, uses stage-by-stage filterGroups since HubSpot
 * rejects `pipeline=default` as a filter.
 *
 * When `since` is provided (incremental sync), adds a hs_lastmodifieddate filter.
 */
async function collectDealIds(
  pipeline: DealPipeline,
  since?: Date
): Promise<string[]> {
  const allIds: string[] = [];
  const hubspotPipelineId = PIPELINE_ENUM_TO_ID[pipeline];

  if (pipeline === "SALES") {
    // Sales pipeline: query by stage IDs from config
    const stageIds = await getSalesStageIds();
    if (stageIds.length === 0) {
      console.warn("[DealSync] No stage IDs for SALES pipeline — skipping");
      return [];
    }

    for (let batchStart = 0; batchStart < stageIds.length; batchStart += SALES_FILTER_GROUP_SIZE) {
      const batch = stageIds.slice(batchStart, batchStart + SALES_FILTER_GROUP_SIZE);
      if (batchStart > 0) await sleep(150);

      let after: string | undefined;
      let pages = 0;

      do {
        if (pages >= MAX_PAGINATION_PAGES) break;

        const filterGroups = batch.map((stageId) => {
          const filters: Array<{
            propertyName: string;
            operator: typeof FilterOperatorEnum.Eq | typeof FilterOperatorEnum.Gte;
            value: string;
          }> = [
            {
              propertyName: "dealstage",
              operator: FilterOperatorEnum.Eq,
              value: stageId,
            },
          ];
          if (since) {
            filters.push({
              propertyName: "hs_lastmodifieddate",
              operator: FilterOperatorEnum.Gte,
              value: since.getTime().toString(),
            });
          }
          return { filters };
        });

        const searchRequest: {
          filterGroups: typeof filterGroups;
          properties: string[];
          limit: number;
          after?: string;
        } = {
          filterGroups,
          properties: ["hs_object_id"],
          limit: 100,
        };
        if (after) searchRequest.after = after;

        const response = await searchWithRetry(searchRequest);
        const ids = response.results.map((d) => d.id);
        allIds.push(...ids);
        after = response.paging?.next?.after;
        pages++;
        if (after) await sleep(120);
      } while (after);
    }
  } else {
    // Non-sales pipelines: filter by pipeline ID
    let after: string | undefined;
    let pages = 0;

    do {
      if (pages >= MAX_PAGINATION_PAGES) break;

      const filters: Array<{
        propertyName: string;
        operator: typeof FilterOperatorEnum.Eq | typeof FilterOperatorEnum.Gte;
        value: string;
      }> = [
        {
          propertyName: "pipeline",
          operator: FilterOperatorEnum.Eq,
          value: hubspotPipelineId,
        },
      ];

      if (since) {
        filters.push({
          propertyName: "hs_lastmodifieddate",
          operator: FilterOperatorEnum.Gte,
          value: since.getTime().toString(),
        });
      }

      const searchRequest: {
        filterGroups: { filters: typeof filters }[];
        properties: string[];
        limit: number;
        after?: string;
      } = {
        filterGroups: [{ filters }],
        properties: ["hs_object_id"],
        limit: 100,
      };
      if (after) searchRequest.after = after;

      const response = await searchWithRetry(searchRequest);
      const ids = response.results.map((d) => d.id);
      allIds.push(...ids);
      after = response.paging?.next?.after;
      pages++;
      if (after) await sleep(120);
    } while (after);
  }

  // Deduplicate (sales pipeline stage batches may overlap with incremental)
  return [...new Set(allIds)];
}

/**
 * Get stage IDs for the SALES pipeline from DealPipelineConfig.
 */
async function getSalesStageIds(): Promise<string[]> {
  if (!prisma) return [];

  try {
    const config = await prisma.dealPipelineConfig.findUnique({
      where: { pipeline: "SALES" },
    });
    if (!config) return [];

    const stages = config.stages as Array<{ id: string; isActive?: boolean }>;
    return stages.map((s) => s.id);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Phase 2: Batch-read full properties
// ---------------------------------------------------------------------------

/**
 * Batch-read full deal properties for a list of deal IDs.
 * Returns raw HubSpot properties keyed by deal ID.
 */
async function batchReadDealProperties(
  dealIds: string[]
): Promise<Map<string, Record<string, string | null>>> {
  const result = new Map<string, Record<string, string | null>>();

  const batches: string[][] = [];
  for (let i = 0; i < dealIds.length; i += BATCH_READ_SIZE) {
    batches.push(dealIds.slice(i, i + BATCH_READ_SIZE));
  }

  let batchFailures = 0;

  for (let i = 0; i < batches.length; i += BATCH_READ_CONCURRENCY) {
    const group = batches.slice(i, i + BATCH_READ_CONCURRENCY);
    const results = await Promise.allSettled(
      group.map((batch) =>
        hubspotClient.crm.deals.batchApi.read({
          inputs: batch.map((id) => ({ id })),
          properties: DEAL_SYNC_PROPERTIES,
          propertiesWithHistory: [],
        })
      )
    );

    for (const res of results) {
      if (res.status === "fulfilled") {
        for (const deal of res.value.results) {
          result.set(deal.id, deal.properties as Record<string, string | null>);
        }
      } else {
        batchFailures++;
        console.error(
          "[DealSync] Batch read failed:",
          res.reason?.message || res.reason
        );
      }
    }

    if (i + BATCH_READ_CONCURRENCY < batches.length) await sleep(100);
  }

  if (batchFailures > 0) {
    console.warn(
      `[DealSync] Phase 2 completed with ${batchFailures} failed batch(es)`
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public: batchSyncPipeline
// ---------------------------------------------------------------------------

export interface BatchSyncOptions {
  /** When true, performs incremental sync from watermark. Default: false (full sync). */
  incremental?: boolean;
}

/**
 * Main batch sync function for a single pipeline.
 *
 * Two-phase fetch:
 *   Phase 1: Search for deal IDs (minimal props)
 *   Phase 2: Batch-read full properties (100/batch, 3 concurrent)
 *
 * Then: resolve associations, owners, diff, upsert.
 */
export async function batchSyncPipeline(
  pipeline: DealPipeline,
  options?: BatchSyncOptions
): Promise<BatchSyncResult> {
  const startTime = Date.now();
  const isIncremental = options?.incremental ?? false;
  const syncType: DealSyncType = isIncremental ? "BATCH_INCREMENTAL" : "BATCH_FULL";

  const result: BatchSyncResult = {
    pipeline,
    totalFetched: 0,
    upserted: 0,
    skipped: 0,
    deleted: 0,
    errors: 0,
    durationMs: 0,
  };

  if (!prisma) {
    throw new Error("Database unavailable");
  }

  try {
    // Determine watermark for incremental sync
    let since: Date | undefined;
    if (isIncremental) {
      const watermark = await getWatermark(pipeline);
      if (watermark) {
        since = new Date(watermark.getTime() - WATERMARK_OVERLAP_MS);
      }
      // If no watermark exists, fall through to full sync behavior (no `since` filter)
    }

    // Phase 1: Collect deal IDs
    console.log(
      `[DealSync] Phase 1: collecting IDs for ${pipeline}${since ? ` (since ${since.toISOString()})` : " (full)"}`
    );
    const dealIds = await collectDealIds(pipeline, since);
    result.totalFetched = dealIds.length;

    if (dealIds.length === 0) {
      console.log(`[DealSync] No deals found for ${pipeline}`);
      result.durationMs = Date.now() - startTime;
      return result;
    }

    console.log(`[DealSync] Phase 1 complete: ${dealIds.length} IDs for ${pipeline}`);

    // Phase 2: Batch-read full properties
    console.log(`[DealSync] Phase 2: batch-reading full properties`);
    const dealPropertiesMap = await batchReadDealProperties(dealIds);
    console.log(
      `[DealSync] Phase 2 complete: ${dealPropertiesMap.size} deals with full properties`
    );

    // Resolve owners (cached for this sync run)
    const ownerMap = await fetchOwnerMap();

    // Resolve associations
    console.log(`[DealSync] Resolving associations`);
    const [contactAssocMap, companyAssocMap] = await Promise.all([
      batchReadAssociations(dealIds, "contacts"),
      batchReadAssociations(dealIds, "companies"),
    ]);

    // Batch-read contact and company properties
    const allContactIds = [...new Set([...contactAssocMap.values()].flat())];
    const allCompanyIds = [...new Set([...companyAssocMap.values()].flat())];

    const [contactPropsMap, companyPropsMap] = await Promise.all([
      batchReadContactProperties(allContactIds),
      batchReadCompanyProperties(allCompanyIds),
    ]);

    // Track max observed hubspotUpdatedAt for watermark
    let maxUpdatedAt: Date | null = null;

    // Process each deal
    console.log(`[DealSync] Upserting ${dealPropertiesMap.size} deals`);
    for (const [hsId, properties] of dealPropertiesMap) {
      const dealStart = Date.now();

      try {
        // Map properties
        const mapped = mapHubSpotToDeal(properties);

        // Resolve pipeline and stage
        const dealPipeline = resolvePipeline(properties.pipeline);
        const stageName = await resolveStage(
          properties.dealstage ?? "",
          dealPipeline
        );

        // Resolve owner name
        const ownerId = properties.hubspot_owner_id;
        const ownerName = ownerId ? ownerMap[ownerId] ?? null : null;

        // Resolve primary contact
        const contactIds = contactAssocMap.get(hsId);
        const primaryContactId = contactIds?.[0] ?? null;
        const contactProps = primaryContactId
          ? contactPropsMap.get(primaryContactId)
          : null;

        // Resolve company
        const companyIds = companyAssocMap.get(hsId);
        const primaryCompanyId = companyIds?.[0] ?? null;
        const companyProps = primaryCompanyId
          ? companyPropsMap.get(primaryCompanyId)
          : null;

        // Build upsert data as a loosely-typed record so we can set
        // computed fields (dealName fallback, etc.) without TS narrowing issues.
        const upsertData: Record<string, unknown> = {
          ...mapped,
          hubspotDealId: hsId,
          pipeline: dealPipeline,
          stage: stageName,
          stageId: properties.dealstage ?? "",
          dealOwnerName: ownerName,
          // Resolve manager/surveyor owner IDs to names
          projectManager: mapped.projectManager && ownerMap[String(mapped.projectManager)]
            ? ownerMap[String(mapped.projectManager)]
            : (mapped.projectManager as string | null),
          operationsManager: mapped.operationsManager && ownerMap[String(mapped.operationsManager)]
            ? ownerMap[String(mapped.operationsManager)]
            : (mapped.operationsManager as string | null),
          siteSurveyor: mapped.siteSurveyor && ownerMap[String(mapped.siteSurveyor)]
            ? ownerMap[String(mapped.siteSurveyor)]
            : (mapped.siteSurveyor as string | null),
          hubspotContactId: primaryContactId,
          customerName: contactProps?.name ?? null,
          customerEmail: contactProps?.email ?? null,
          customerPhone: contactProps?.phone ?? null,
          hubspotCompanyId: primaryCompanyId,
          companyName: companyProps?.name ?? null,
          syncSource: "BATCH" as DealSyncSource,
          lastSyncedAt: new Date(),
          rawProperties: properties,
        };

        // Check for existing deal and diff
        const existing = await prisma.deal.findUnique({
          where: { hubspotDealId: hsId },
        });

        if (existing) {
          // Build a comparable snapshot from existing record
          const existingSnapshot: Record<string, unknown> = {};
          const incomingSnapshot: Record<string, unknown> = {};

          for (const key of Object.keys(upsertData)) {
            if (
              key === "lastSyncedAt" ||
              key === "syncSource" ||
              key === "rawProperties"
            )
              continue;
            existingSnapshot[key] = (existing as Record<string, unknown>)[key];
            incomingSnapshot[key] = upsertData[key];
          }

          const diff = diffDealProperties(existingSnapshot, incomingSnapshot);

          if (Object.keys(diff).length === 0) {
            // No changes — update lastSyncedAt only
            await prisma.deal.update({
              where: { hubspotDealId: hsId },
              data: { lastSyncedAt: new Date() },
            });
            result.skipped++;

            // Log skip
            await prisma.dealSyncLog.create({
              data: {
                dealId: existing.id,
                hubspotDealId: hsId,
                syncType,
                source: `batch:${pipeline}`,
                status: "SKIPPED",
                durationMs: Date.now() - dealStart,
              },
            });
          } else {
            // Changes detected — upsert
            await prisma.deal.update({
              where: { hubspotDealId: hsId },
              data: upsertData as Parameters<typeof prisma.deal.update>[0]["data"],
            });
            result.upserted++;

            // Log changes
            await prisma.dealSyncLog.create({
              data: {
                dealId: existing.id,
                hubspotDealId: hsId,
                syncType,
                source: `batch:${pipeline}`,
                status: "SUCCESS",
                changesDetected: JSON.parse(JSON.stringify(diff)),
                durationMs: Date.now() - dealStart,
              },
            });
          }
        } else {
          // New deal — create
          // Ensure required dealName has a fallback
          if (!upsertData.dealName) {
            upsertData.dealName = `Deal ${hsId}`;
          }

          const created = await prisma.deal.create({
            data: upsertData as Parameters<typeof prisma.deal.create>[0]["data"],
          });
          result.upserted++;

          await prisma.dealSyncLog.create({
            data: {
              dealId: created.id,
              hubspotDealId: hsId,
              syncType,
              source: `batch:${pipeline}`,
              status: "SUCCESS",
              durationMs: Date.now() - dealStart,
            },
          });
        }

        // Track max watermark
        const updatedAt = mapped.hubspotUpdatedAt as Date | null;
        if (updatedAt && (!maxUpdatedAt || updatedAt > maxUpdatedAt)) {
          maxUpdatedAt = updatedAt;
        }
      } catch (err) {
        result.errors++;
        console.error(`[DealSync] Error processing deal ${hsId}:`, err);

        try {
          await prisma.dealSyncLog.create({
            data: {
              hubspotDealId: hsId,
              syncType,
              source: `batch:${pipeline}`,
              status: "FAILED",
              errorMessage:
                err instanceof Error ? err.message : String(err),
              durationMs: Date.now() - dealStart,
            },
          });
        } catch {
          // Swallow log write failure
        }
      }
    }

    // Deletion detection (full sync only)
    if (!isIncremental) {
      try {
        const fetchedIds = new Set(dealPropertiesMap.keys());
        const dbDeals = await prisma.deal.findMany({
          where: { pipeline, stage: { not: "DELETED" } },
          select: { id: true, hubspotDealId: true },
        });

        for (const dbDeal of dbDeals) {
          if (!fetchedIds.has(dbDeal.hubspotDealId)) {
            await prisma.deal.update({
              where: { id: dbDeal.id },
              data: { stage: "DELETED", lastSyncedAt: new Date() },
            });
            result.deleted++;

            await prisma.dealSyncLog.create({
              data: {
                dealId: dbDeal.id,
                hubspotDealId: dbDeal.hubspotDealId,
                syncType,
                source: `batch:${pipeline}`,
                status: "SUCCESS",
                changesDetected: { stage: ["(previous)", "DELETED"] } as Record<string, string[]>,
                durationMs: 0,
              },
            });
          }
        }
      } catch (err) {
        console.error(`[DealSync] Deletion detection error for ${pipeline}:`, err);
      }
    }

    // Update watermark
    if (maxUpdatedAt) {
      await setWatermark(pipeline, maxUpdatedAt);
    }
  } catch (err) {
    console.error(`[DealSync] Fatal error syncing ${pipeline}:`, err);
    throw err;
  }

  result.durationMs = Date.now() - startTime;
  console.log(
    `[DealSync] ${pipeline} sync complete: ${result.upserted} upserted, ` +
      `${result.skipped} skipped, ${result.deleted} deleted, ` +
      `${result.errors} errors in ${result.durationMs}ms`
  );

  return result;
}

// ---------------------------------------------------------------------------
// Public: syncSingleDeal
// ---------------------------------------------------------------------------

/**
 * Sync a single deal from HubSpot to the Deal table.
 * Used for webhook triggers and manual refresh.
 */
export async function syncSingleDeal(
  hubspotDealId: string,
  source: DealSyncSource
): Promise<{ success: boolean; diff?: Record<string, [unknown, unknown]> }> {
  if (!prisma) throw new Error("Database unavailable");

  const startTime = Date.now();
  const syncType: DealSyncType = source === "WEBHOOK" ? "WEBHOOK" : "MANUAL";
  const accessToken = getAccessToken();

  try {
    // Fetch deal properties
    const dealResponse = await fetchWithRetry(
      `https://api.hubapi.com/crm/v3/objects/deals/${encodeURIComponent(hubspotDealId)}?properties=${DEAL_SYNC_PROPERTIES.join(",")}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      }
    );

    if (!dealResponse.ok) {
      throw new Error(
        `Failed to fetch deal ${hubspotDealId}: ${dealResponse.status}`
      );
    }

    const dealData = (await dealResponse.json()) as {
      id: string;
      properties: Record<string, string | null>;
    };
    const properties = dealData.properties;

    // Map properties
    const mapped = mapHubSpotToDeal(properties);
    const dealPipeline = resolvePipeline(properties.pipeline);
    const stageName = await resolveStage(
      properties.dealstage ?? "",
      dealPipeline
    );

    // Resolve owner
    const ownerMap = await fetchOwnerMap();
    const ownerId = properties.hubspot_owner_id;
    const ownerName = ownerId ? ownerMap[ownerId] ?? null : null;

    // Resolve contact association (single-deal: use v4 endpoint with label check)
    let primaryContactId: string | null = null;
    let contactProps: { name: string; email: string; phone: string } | null = null;

    try {
      const contactAssocResponse = await fetchWithRetry(
        `https://api.hubapi.com/crm/v4/objects/deals/${encodeURIComponent(hubspotDealId)}/associations/contacts`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          cache: "no-store",
        }
      );

      if (contactAssocResponse.ok) {
        const assocData = (await contactAssocResponse.json()) as {
          results?: Array<{
            toObjectId: number;
            associationTypes: Array<{ label: string | null }>;
          }>;
        };
        const results = assocData.results ?? [];

        // Find primary-labeled contact
        for (const assoc of results) {
          const isPrimary = assoc.associationTypes?.some(
            (t) => t.label && t.label.toLowerCase().includes("primary")
          );
          if (isPrimary) {
            primaryContactId = String(assoc.toObjectId);
            break;
          }
        }
        // Fallback: sole contact
        if (!primaryContactId && results.length === 1) {
          primaryContactId = String(results[0].toObjectId);
        }
      }
    } catch {
      // Non-fatal — contact resolution is best-effort
    }

    if (primaryContactId) {
      const cMap = await batchReadContactProperties([primaryContactId]);
      contactProps = cMap.get(primaryContactId) ?? null;
    }

    // Resolve company association
    let primaryCompanyId: string | null = null;
    let companyName: string | null = null;

    try {
      const companyAssocResponse = await fetchWithRetry(
        `https://api.hubapi.com/crm/v4/objects/deals/${encodeURIComponent(hubspotDealId)}/associations/companies`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          cache: "no-store",
        }
      );

      if (companyAssocResponse.ok) {
        const assocData = (await companyAssocResponse.json()) as {
          results?: Array<{ toObjectId: number }>;
        };
        const results = assocData.results ?? [];
        if (results.length > 0) {
          primaryCompanyId = String(results[0].toObjectId);
          const cMap = await batchReadCompanyProperties([primaryCompanyId]);
          companyName = cMap.get(primaryCompanyId)?.name ?? null;
        }
      }
    } catch {
      // Non-fatal
    }

    // Build upsert data as a loosely-typed record (same pattern as batchSync)
    const upsertData: Record<string, unknown> = {
      ...mapped,
      hubspotDealId,
      pipeline: dealPipeline,
      stage: stageName,
      stageId: properties.dealstage ?? "",
      dealOwnerName: ownerName,
      // Resolve manager/surveyor owner IDs to names
      projectManager: mapped.projectManager && ownerMap[String(mapped.projectManager)]
        ? ownerMap[String(mapped.projectManager)]
        : (mapped.projectManager as string | null),
      operationsManager: mapped.operationsManager && ownerMap[String(mapped.operationsManager)]
        ? ownerMap[String(mapped.operationsManager)]
        : (mapped.operationsManager as string | null),
      siteSurveyor: mapped.siteSurveyor && ownerMap[String(mapped.siteSurveyor)]
        ? ownerMap[String(mapped.siteSurveyor)]
        : (mapped.siteSurveyor as string | null),
      hubspotContactId: primaryContactId,
      customerName: contactProps?.name ?? null,
      customerEmail: contactProps?.email ?? null,
      customerPhone: contactProps?.phone ?? null,
      hubspotCompanyId: primaryCompanyId,
      companyName,
      syncSource: source,
      lastSyncedAt: new Date(),
      rawProperties: properties,
    };

    // Check for existing deal and diff
    const existing = await prisma.deal.findUnique({
      where: { hubspotDealId },
    });

    let diff: Record<string, [unknown, unknown]> = {};

    if (existing) {
      const existingSnapshot: Record<string, unknown> = {};
      const incomingSnapshot: Record<string, unknown> = {};

      for (const key of Object.keys(upsertData)) {
        if (
          key === "lastSyncedAt" ||
          key === "syncSource" ||
          key === "rawProperties"
        )
          continue;
        existingSnapshot[key] = (existing as Record<string, unknown>)[key];
        incomingSnapshot[key] = upsertData[key];
      }

      diff = diffDealProperties(existingSnapshot, incomingSnapshot);

      if (Object.keys(diff).length === 0) {
        // No changes
        await prisma.deal.update({
          where: { hubspotDealId },
          data: { lastSyncedAt: new Date() },
        });

        await prisma.dealSyncLog.create({
          data: {
            dealId: existing.id,
            hubspotDealId,
            syncType,
            source: `single:${source.toLowerCase()}`,
            status: "SKIPPED",
            durationMs: Date.now() - startTime,
          },
        });

        return { success: true, diff };
      }

      // Changes detected
      await prisma.deal.update({
        where: { hubspotDealId },
        data: upsertData as Parameters<typeof prisma.deal.update>[0]["data"],
      });

      await prisma.dealSyncLog.create({
        data: {
          dealId: existing.id,
          hubspotDealId,
          syncType,
          source: `single:${source.toLowerCase()}`,
          status: "SUCCESS",
          changesDetected: JSON.parse(JSON.stringify(diff)),
          durationMs: Date.now() - startTime,
        },
      });
    } else {
      // New deal
      if (!upsertData.dealName) {
        upsertData.dealName = `Deal ${hubspotDealId}`;
      }

      const created = await prisma.deal.create({
        data: upsertData as Parameters<typeof prisma.deal.create>[0]["data"],
      });

      await prisma.dealSyncLog.create({
        data: {
          dealId: created.id,
          hubspotDealId,
          syncType,
          source: `single:${source.toLowerCase()}`,
          status: "SUCCESS",
          durationMs: Date.now() - startTime,
        },
      });
    }

    return { success: true, diff };
  } catch (err) {
    console.error("[DealSync] Error syncing single deal %s:", hubspotDealId, err);

    try {
      await prisma.dealSyncLog.create({
        data: {
          hubspotDealId,
          syncType,
          source: `single:${source.toLowerCase()}`,
          status: "FAILED",
          errorMessage: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - startTime,
        },
      });
    } catch {
      // Swallow log write failure
    }

    return { success: false };
  }
}

// ---------------------------------------------------------------------------
// Feature-flag helpers for local-DB cutover
// ---------------------------------------------------------------------------

/**
 * Read the data source flag for a given API route from SystemConfig.
 * Values: "hubspot" (default), "local-with-verify", "local"
 */
export async function getDealSyncSource(
  route: string
): Promise<"hubspot" | "local-with-verify" | "local"> {
  if (!prisma) return "hubspot";
  try {
    const config = await prisma.systemConfig.findUnique({
      where: { key: `deal-sync:source:${route}` },
    });
    return (config?.value as "hubspot" | "local-with-verify" | "local") ?? "hubspot";
  } catch {
    return "hubspot";
  }
}

/**
 * Human-readable staleness description for a lastSync timestamp.
 */
export function formatStaleness(lastSync: Date): string {
  const minutes = Math.floor((Date.now() - lastSync.getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

// ---------------------------------------------------------------------------
// Shadow verification — local-with-verify mode
// ---------------------------------------------------------------------------

/**
 * Fires a lightweight background comparison of local vs HubSpot deal counts.
 * Logs DEAL_SYNC_DISCREPANCY if counts diverge.
 * Called from API routes when syncSource === "local-with-verify".
 */
export async function verifyShadow(
  route: string,
  pipeline?: DealPipeline
): Promise<void> {
  try {
    // Resolve HubSpot pipeline ID — Sales is "default" which HubSpot's
    // search API rejects as a filter, so skip verification for Sales.
    const pipelineId = pipeline ? PIPELINE_ENUM_TO_ID[pipeline] : undefined;
    if (pipelineId === "default") return; // Sales — skip until stage-based query is added

    // Count local deals, excluding tombstoned rows (DELETED/MERGED)
    const localCount = await prisma.deal.count({
      where: {
        ...(pipeline ? { pipeline } : {}),
        stage: { notIn: ["DELETED", "MERGED"] },
      },
    });

    // Get HubSpot count via search API (limit 1, use total)
    const filterGroups = pipelineId
      ? [{ filters: [{ propertyName: "pipeline", operator: "EQ", value: pipelineId }] }]
      : [];

    const res = await fetchWithRetry(
      "https://api.hubapi.com/crm/v3/objects/deals/search",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({
          filterGroups,
          properties: ["hs_object_id"],
          limit: 1,
        }),
      }
    );
    if (!res.ok) return; // HubSpot error — treat as inconclusive, don't log false mismatch
    const data = await res.json();
    if (typeof data.total !== "number") return; // Unexpected shape — inconclusive
    const hubspotTotal: number = data.total;

    if (localCount !== hubspotTotal) {
      const message = `[shadow-verify:${route}${pipeline ? `:${pipeline}` : ""}] count mismatch: local=${localCount} hubspot=${hubspotTotal}`;
      console.warn(message);

      await prisma.activityLog.create({
        data: {
          type: "DEAL_SYNC_DISCREPANCY",
          description: message,
          metadata: { route, pipeline: pipeline ?? "all", localCount, hubspotTotal },
        },
      });
    }
  } catch (err) {
    // Shadow verification is best-effort — never fail the request
    console.error("[shadow-verify] Error:", err);
  }
}
