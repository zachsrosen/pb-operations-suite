/**
 * Live HubSpot label resolution for PowerHub fleet-monitor surfaces.
 *
 * The HubSpotProjectCache table these surfaces originally read from has no
 * writer and sits empty in prod, so deal/ticket/contact context must be
 * resolved from HubSpot directly. Every resolver here degrades to an empty
 * map on failure — the fleet monitor renders IDs/dashes rather than erroring.
 * Results are cached in-memory (10 min TTL) to keep the every-5s SSE-driven
 * refetch pattern from hammering HubSpot.
 */

import {
  batchReadDealsWithRetry,
  hubspotClient,
  DEAL_STAGE_MAP,
} from "@/lib/hubspot";
import { getTicketStageMap } from "@/lib/hubspot-tickets";
import { appCache } from "@/lib/cache";

const CACHE_TTL_MS = 10 * 60 * 1000;
const BATCH_SIZE = 100; // HubSpot batch-read API limit

export interface PowerhubDealSummary {
  dealName: string | null;
  stageLabel: string | null;
}

export interface PowerhubTicketSummary {
  subject: string;
  statusName: string | null;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Resolve deal names + human stage labels for a set of HubSpot deal IDs.
 */
export async function resolveDealSummaries(
  dealIds: string[]
): Promise<Map<string, PowerhubDealSummary>> {
  const result = new Map<string, PowerhubDealSummary>();
  const ids = [...new Set(dealIds.filter(Boolean))];
  if (ids.length === 0) return result;

  const missing: string[] = [];
  for (const id of ids) {
    const cached = appCache.get<PowerhubDealSummary>(`powerhub:deal-summary:${id}`);
    if (cached.hit && cached.data) result.set(id, cached.data);
    else missing.push(id);
  }
  if (missing.length === 0) return result;

  try {
    for (const batch of chunk(missing, BATCH_SIZE)) {
      const response = await batchReadDealsWithRetry(batch, [
        "dealname",
        "dealstage",
      ]);
      for (const r of response.results) {
        const props = r.properties as Record<string, string | null>;
        const stageId = props.dealstage || "";
        const summary: PowerhubDealSummary = {
          dealName: props.dealname || null,
          stageLabel: stageId ? DEAL_STAGE_MAP[stageId] || stageId : null,
        };
        result.set(r.id, summary);
        appCache.set(`powerhub:deal-summary:${r.id}`, summary, { ttl: CACHE_TTL_MS });
      }
    }
  } catch (err) {
    console.error("[powerhub-site-context] deal batch-read failed:", err);
  }
  return result;
}

/**
 * Resolve ticket subjects + pipeline-stage labels for HubSpot ticket IDs.
 */
export async function resolveTicketSummaries(
  ticketIds: string[]
): Promise<Map<string, PowerhubTicketSummary>> {
  const result = new Map<string, PowerhubTicketSummary>();
  const ids = [...new Set(ticketIds.filter(Boolean))];
  if (ids.length === 0) return result;

  const cacheKey = `powerhub:ticket-summaries:${ids.slice().sort().join(",")}`;
  const cached = appCache.get<Array<[string, PowerhubTicketSummary]>>(cacheKey);
  if (cached.hit && cached.data) return new Map(cached.data);

  try {
    const { map: stageMap } = await getTicketStageMap();
    for (const batch of chunk(ids, BATCH_SIZE)) {
      const response = await hubspotClient.crm.tickets.batchApi.read({
        inputs: batch.map((id) => ({ id })),
        properties: ["subject", "hs_pipeline_stage"],
        propertiesWithHistory: [],
      });
      for (const r of response.results) {
        const props = r.properties as Record<string, string | null>;
        const stageId = props.hs_pipeline_stage || "";
        result.set(r.id, {
          subject: props.subject || `Ticket ${r.id}`,
          statusName: stageId ? stageMap[stageId] || stageId : null,
        });
      }
    }
    appCache.set(cacheKey, [...result.entries()], { ttl: CACHE_TTL_MS });
  } catch (err) {
    console.error("[powerhub-site-context] ticket batch-read failed:", err);
  }
  return result;
}

/**
 * Resolve display names for HubSpot contact IDs (first+last, email fallback).
 */
export async function resolveContactNames(
  contactIds: string[]
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const ids = [...new Set(contactIds.filter(Boolean))];
  if (ids.length === 0) return result;

  const cacheKey = `powerhub:contact-names:${ids.slice().sort().join(",")}`;
  const cached = appCache.get<Array<[string, string]>>(cacheKey);
  if (cached.hit && cached.data) return new Map(cached.data);

  try {
    for (const batch of chunk(ids, BATCH_SIZE)) {
      const response = await hubspotClient.crm.contacts.batchApi.read({
        inputs: batch.map((id) => ({ id })),
        properties: ["firstname", "lastname", "email"],
        propertiesWithHistory: [],
      });
      for (const r of response.results) {
        const props = r.properties as Record<string, string | null>;
        const name = [props.firstname, props.lastname]
          .filter(Boolean)
          .join(" ")
          .trim();
        const label = name || props.email || "";
        if (label) result.set(r.id, label);
      }
    }
    appCache.set(cacheKey, [...result.entries()], { ttl: CACHE_TTL_MS });
  } catch (err) {
    console.error("[powerhub-site-context] contact batch-read failed:", err);
  }
  return result;
}
