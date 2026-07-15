/**
 * SolarEdge Monitoring API client.
 *
 * Auth: a single account-level API key (SOLAREDGE_API_KEY) passed as the
 * `api_key` URL param — one credential covers the whole installer fleet.
 *
 * Rate limits (the real constraint): 300 requests/day per account token,
 * 300/day per site id, max 3 concurrent from one source IP. A daily fleet
 * refresh via sites/list (100 sites/page → ~27 calls for ~2,635 sites) sits
 * well under the account cap; deep per-site telemetry draws from each site's
 * own quota and is fetched on demand.
 *
 * See docs/superpowers/specs/2026-07-13-solaredge-monitoring-integration-design.md
 */

const SOLAREDGE_API_BASE = "https://monitoringapi.solaredge.com";
const PAGE_SIZE = 100; // sites/list max
const MAX_CONCURRENT = 3;

/** Per-site fields from GET /sites/list. */
export interface SolarEdgeApiSite {
  id: number;
  name: string;
  peakPower?: number;
  type?: string; // e.g. "Residential" | "Commercial"
  status?: string; // "Active" | "Pending" | "Disabled"
  location?: {
    address?: string;
    address2?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  };
  alertQuantity?: number;
  alertSeverity?: string; // "NONE" | "LOW" | "MEDIUM" | "HIGH"
  primaryModule?: { manufacturerName?: string; modelName?: string };
}

export interface SolarEdgeClient {
  /** Fetch ALL sites (paged). ~ceil(count/100) account-quota calls. */
  listAllSites(): Promise<SolarEdgeApiSite[]>;
  /** One page of sites/list. */
  listSites(startIndex: number): Promise<{ count: number; sites: SolarEdgeApiSite[] }>;
}

/** SolarEdge portal deep-link for a single site. */
export function computeSolarEdgePortalUrl(siteId: number): string {
  const template =
    process.env.SOLAREDGE_PORTAL_URL_TEMPLATE ||
    "https://monitoring.solaredge.com/solaredge-web/p/site/{siteId}";
  return template.replaceAll("{siteId}", String(siteId));
}

/** Map SolarEdge alertSeverity → a 0-9 impact, matching the export's scale. */
export function alertSeverityToImpact(severity?: string | null): number {
  switch ((severity || "").toUpperCase()) {
    case "HIGH": return 9;
    case "MEDIUM": return 5;
    case "LOW": return 2;
    default: return 0; // NONE / unknown
  }
}

import { extractProjNumber } from "@/lib/solaredge-linkage";

export interface SolarEdgeRowInput {
  siteId: number;
  siteName: string;
  portalUrl: string;
  siteType: string | null;
  activationStatus: string | null;
  peakPowerKw: number | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  projNumber: string | null;
  highestAlertImpact: number;
  openAlertCount: number;
}

/** Pure map from an API site to the DB row shape (no prisma — unit-testable). */
export function apiSiteToRow(site: SolarEdgeApiSite): SolarEdgeRowInput {
  return {
    siteId: site.id,
    siteName: site.name,
    portalUrl: computeSolarEdgePortalUrl(site.id),
    siteType: site.type ?? null,
    activationStatus: site.status ?? null,
    peakPowerKw: site.peakPower ?? null,
    address: site.location?.address ?? null,
    city: site.location?.city ?? null,
    state: site.location?.state ?? null,
    zip: site.location?.zip ?? null,
    projNumber: extractProjNumber(site.name),
    highestAlertImpact: alertSeverityToImpact(site.alertSeverity),
    openAlertCount: site.alertQuantity ?? 0,
  };
}

export function createSolarEdgeClient(): SolarEdgeClient {
  if (process.env.SOLAREDGE_ENABLED !== "true") {
    throw new Error("SolarEdge is disabled (SOLAREDGE_ENABLED != true)");
  }
  const apiKey = process.env.SOLAREDGE_API_KEY;
  if (!apiKey) throw new Error("Missing SOLAREDGE_API_KEY");
  const baseUrl = process.env.SOLAREDGE_PROXY_URL || SOLAREDGE_API_BASE;

  async function get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    const qs = new URLSearchParams({ api_key: apiKey!, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
    const url = `${baseUrl}${path}?${qs.toString()}`;
    let lastErr: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(url, { headers: { Accept: "application/json" } });
        if (res.status === 429) {
          // Account/site quota or concurrency — back off and retry.
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
          continue;
        }
        if (!res.ok) throw new Error(`SolarEdge ${path} → HTTP ${res.status}`);
        return (await res.json()) as T;
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(`SolarEdge ${path} failed`);
  }

  async function listSites(startIndex: number) {
    const data = await get<{ sites?: { count?: number; site?: SolarEdgeApiSite[] } }>(
      "/sites/list",
      { size: PAGE_SIZE, startIndex, sortProperty: "name" }
    );
    return {
      count: data.sites?.count ?? 0,
      sites: data.sites?.site ?? [],
    };
  }

  async function listAllSites(): Promise<SolarEdgeApiSite[]> {
    const first = await listSites(0);
    const total = first.count;
    const all = [...first.sites];
    // Remaining pages, capped at MAX_CONCURRENT in flight.
    const starts: number[] = [];
    for (let i = PAGE_SIZE; i < total; i += PAGE_SIZE) starts.push(i);
    for (let i = 0; i < starts.length; i += MAX_CONCURRENT) {
      const batch = starts.slice(i, i + MAX_CONCURRENT);
      const pages = await Promise.all(batch.map((s) => listSites(s)));
      for (const p of pages) all.push(...p.sites);
    }
    return all;
  }

  return { listAllSites, listSites };
}
