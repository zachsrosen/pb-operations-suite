/**
 * SolarEdge named-alert import.
 *
 * The public Monitoring API key is NOT entitled to the alerts endpoint
 * (`/site/{id}/alerts` → 403), so per-site alert *detail* (name, component,
 * RMA) can only come from the monitoring portal's Alerts export. The daily
 * sites/list sync still provides the alert COUNT + highest impact; this import
 * layers the named detail on top.
 *
 * The export is a complete snapshot of all currently-open alerts fleet-wide,
 * so import is a full replace: every SolarEdgeAlert row is rebuilt from the
 * latest export. Alerts that have since resolved simply drop out.
 *
 * This file is the PURE half — row normalization + site matching, no xlsx and
 * no prisma, so it stays importable from Jest. The DB writer lives in
 * solaredge-alerts-sync.ts and the xlsx parsing in the runner script.
 */

import { extractProjNumber } from "@/lib/solaredge-linkage";

/** One raw row from the Alerts export (header → value). */
export interface RawAlertRow {
  Impact?: number | string | null;
  "Site Name"?: string | null;
  "Alert Type"?: string | null;
  Component?: string | null;
  "RMA Status"?: string | null;
  "RMA Case Number"?: string | number | null;
  Status?: string | null;
}

/** A normalized alert, not yet matched to a site. */
export interface ParsedAlert {
  siteName: string;
  alertType: string;
  component: string | null;
  impact: number;
  rmaStatus: string | null;
  rmaCaseNumber: string | null;
  status: string;
  isActive: boolean;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** Normalize one export row; returns null for rows missing site name or type. */
export function parseAlertRow(raw: RawAlertRow): ParsedAlert | null {
  const siteName = str(raw["Site Name"]);
  const alertType = str(raw["Alert Type"]);
  if (!siteName || !alertType) return null;
  const status = str(raw.Status) || "Open";
  const impactNum = Number(raw.Impact);
  return {
    siteName,
    alertType,
    component: str(raw.Component),
    impact: Number.isFinite(impactNum) ? impactNum : 0,
    rmaStatus: str(raw["RMA Status"]),
    rmaCaseNumber: str(raw["RMA Case Number"]),
    status,
    isActive: status.toLowerCase() === "open",
  };
}

/** Site lookup maps built from SolarEdgeSite (exact name + unique PROJ). */
export interface SiteMatchMaps {
  byName: Map<string, number>;
  byProj: Map<string, number>; // only PROJ numbers that map to exactly one site
}

/** Resolve an export site name to a siteId — exact name first, then PROJ. */
export function resolveSiteId(siteName: string, maps: SiteMatchMaps): number | null {
  const exact = maps.byName.get(siteName);
  if (exact !== undefined) return exact;
  const proj = extractProjNumber(siteName);
  if (proj) {
    const viaProj = maps.byProj.get(proj);
    if (viaProj !== undefined) return viaProj;
  }
  return null;
}

/** Dedupe key mirrors the SolarEdgeAlert @@unique([siteId, alertType, component]). */
export function alertKey(siteId: number, alertType: string, component: string | null): string {
  return `${siteId}::${alertType}::${component ?? ""}`;
}

/** A DB-ready SolarEdgeAlert row (siteId resolved). */
export interface AlertRecord {
  siteId: number;
  alertType: string;
  component: string | null;
  impact: number;
  rmaStatus: string | null;
  rmaCaseNumber: string | null;
  status: string;
  isActive: boolean;
}

export interface AlertImportResult {
  totalRows: number;
  parsed: number;
  matched: number;
  unmatchedRows: number;
  unmatchedSites: string[];
  inserted: number;
  sitesWithAlerts: number;
}

/** Build the exact-name + unique-PROJ lookup maps from the synced fleet. */
export function buildSiteMatchMaps(
  sites: { siteId: number; siteName: string; projNumber: string | null }[]
): SiteMatchMaps {
  const byName = new Map<string, number>();
  const projCounts = new Map<string, number[]>();
  for (const s of sites) {
    byName.set(s.siteName, s.siteId);
    if (s.projNumber) {
      const arr = projCounts.get(s.projNumber) || [];
      arr.push(s.siteId);
      projCounts.set(s.projNumber, arr);
    }
  }
  const byProj = new Map<string, number>();
  for (const [proj, ids] of projCounts) if (ids.length === 1) byProj.set(proj, ids[0]);
  return { byName, byProj };
}

/**
 * Pure match + dedupe: parsed export rows + site maps → DB-ready records plus
 * an import summary. No IO — the caller supplies the fleet and does the write.
 */
export function matchAlerts(rawRows: RawAlertRow[], maps: SiteMatchMaps): { records: AlertRecord[]; summary: AlertImportResult } {
  const parsedAll = rawRows.map(parseAlertRow).filter((a): a is ParsedAlert => a !== null);
  const unmatchedSites = new Set<string>();
  const seen = new Set<string>();
  const records: AlertRecord[] = [];
  let unmatchedRows = 0;
  for (const a of parsedAll) {
    const siteId = resolveSiteId(a.siteName, maps);
    if (siteId === null) {
      unmatchedRows++;
      unmatchedSites.add(a.siteName);
      continue;
    }
    const key = alertKey(siteId, a.alertType, a.component);
    if (seen.has(key)) continue;
    seen.add(key);
    records.push({
      siteId,
      alertType: a.alertType,
      component: a.component,
      impact: a.impact,
      rmaStatus: a.rmaStatus,
      rmaCaseNumber: a.rmaCaseNumber,
      status: a.status,
      isActive: a.isActive,
    });
  }
  return {
    records,
    summary: {
      totalRows: rawRows.length,
      parsed: parsedAll.length,
      matched: records.length,
      unmatchedRows,
      unmatchedSites: [...unmatchedSites].sort(),
      inserted: records.length,
      sitesWithAlerts: new Set(records.map((r) => r.siteId)).size,
    },
  };
}
