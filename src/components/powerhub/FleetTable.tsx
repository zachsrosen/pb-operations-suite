"use client";

import { Fragment, useState, useMemo, useEffect } from "react";
import SiteDetail from "./SiteDetail";
import { getHubSpotDealUrl, getHubSpotTicketUrl } from "@/lib/external-links";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import { type SortDir } from "@/hooks/useSort";

interface PowerhubSiteRow {
  siteId: string;
  siteName: string;
  address: string;
  city: string;
  state: string;
  status: string;
  linkMethod: string;
  linkConfidence: string;
  dealId: string | null;
  /** Deal resolved via the property when the site has no direct dealId. */
  resolvedDealId?: string | null;
  customerName?: string | null;
  dealName?: string | null;
  totalGateways: number;
  totalBatteries: number;
  totalInverters: number;
  totalBatteryEnergy?: number | null;
  /** From the linked property (server-enriched). */
  systemSizeKwDc?: number | null;
  installDate?: string | null;
  telemetrySnapshot: {
    timestamp?: string | null;
    solarPowerW: number | null;
    batterySocPercent: number | null;
    gridPowerW: number | null;
    gridConnectedStatus: string | null;
    gridVoltageV: number | null;
  } | null;
  alerts: Array<{
    id: string;
    severity: string;
    alertName: string;
  }>;
  /** Tesla PowerHub live-monitoring page for this site (computed from siteId). */
  portalUrl?: string | null;
  /** Open HubSpot service tickets on the linked property (server-enriched). */
  tickets?: Array<{
    id: string;
    subject: string;
  }>;
}

interface FleetTableProps {
  sites: PowerhubSiteRow[];
  loading?: boolean;
  filter?: string;
  onFilterChange?: (filter: string) => void;
  /** Fires with the currently visible (filtered + sorted) rows — used for CSV export. */
  onVisibleRowsChange?: (rows: PowerhubSiteRow[]) => void;
}

type GridStatus = "on" | "off" | "unknown";

function gridStatusOf(site: PowerhubSiteRow): GridStatus {
  // grid_connected_status is only sent by ~1% of gateways (and as "0"/"1", not
  // "Grid Connected"), so it's useless fleet-wide. Grid VOLTAGE is what the fleet
  // actually reports: present (>0) = on-grid, ~0 = off-grid/islanded, absent =
  // status unknown. (Adjust here if a canonical Tesla on-grid field is confirmed.)
  const v = site.telemetrySnapshot?.gridVoltageV;
  if (v == null) return "unknown";
  return v > 0 ? "on" : "off";
}

/** Severity weight so the Alerts column sorts worst-first. */
const SEVERITY_WEIGHT: Record<string, number> = {
  CRITICAL: 1000,
  RMA: 100,
  PERFORMANCE: 10,
  INFORMATIONAL: 1,
};

/** Chip colors per severity — keeps the pre-existing RMA purple distinction. */
const ALERT_CHIP_COLORS: Record<string, string> = {
  CRITICAL: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  RMA: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  PERFORMANCE: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  INFORMATIONAL: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
};

export default function FleetTable({
  sites,
  loading,
  filter = "provisioned",
  onFilterChange,
  onVisibleRowsChange,
}: FleetTableProps) {
  const [expandedSiteId, setExpandedSiteId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [linkSel, setLinkSel] = useState<string[]>([]);
  const [alertSel, setAlertSel] = useState<string[]>([]);
  const [alertNameSel, setAlertNameSel] = useState<string[]>([]);
  const [gridSel, setGridSel] = useState<string[]>([]);
  const [stateSel, setStateSel] = useState<string[]>([]);
  // Default: worst alerts first, visibly indicated on the Alerts header.
  const [sortKey, setSortKey] = useState<string | null>("_alertWeight");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Text columns sort A→Z on first click; numeric columns sort biggest-first.
  const TEXT_FIELDS = ["siteName", "_customer", "_grid", "_link"];
  const toggle = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(TEXT_FIELDS.includes(key) ? "asc" : "desc");
    }
  };

  // Filter options derived from the data
  const linkOptions = useMemo(() => {
    const methods = [...new Set(sites.map((s) => s.linkMethod).filter(Boolean))].sort();
    return methods.map((m) => ({
      value: m,
      label: m === "UNLINKED" ? "Unlinked" : m,
    }));
  }, [sites]);

  const stateOptions = useMemo(() => {
    const states = [...new Set(sites.map((s) => s.state).filter(Boolean))].sort();
    return states.map((st) => ({ value: st, label: st }));
  }, [sites]);

  const alertOptions = useMemo(() => {
    const severities = [
      ...new Set(sites.flatMap((s) => s.alerts.map((a) => a.severity))),
    ].sort((a, b) => (SEVERITY_WEIGHT[b] || 0) - (SEVERITY_WEIGHT[a] || 0));
    return [
      ...severities.map((sev) => ({
        value: sev,
        label: sev.charAt(0) + sev.slice(1).toLowerCase(),
      })),
      { value: "__any__", label: "Any alert" },
      { value: "__none__", label: "No alerts" },
    ];
  }, [sites]);

  // Distinct alert names present in the fleet, most-common first, so the team
  // can filter to a specific fault (e.g. all "Solar Meter Comms" sites).
  const alertNameOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of sites) {
      for (const a of s.alerts) {
        counts.set(a.alertName, (counts.get(a.alertName) || 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ value: name, label: `${name} (${count})` }));
  }, [sites]);

  const gridOptions = [
    { value: "on", label: "On-grid" },
    { value: "off", label: "Off-grid" },
    { value: "unknown", label: "Not reporting" },
  ];

  // Derived sortable fields per row
  const derived = useMemo(
    () =>
      sites.map((s) => ({
        ...s,
        _customer: s.customerName || s.dealName || null,
        _solar: s.telemetrySnapshot?.solarPowerW ?? null,
        _soc: s.telemetrySnapshot?.batterySocPercent ?? null,
        _alertWeight:
          s.alerts.reduce((sum, a) => sum + (SEVERITY_WEIGHT[a.severity] || 1), 0) || null,
        _tickets: s.tickets?.length || null,
        _lastReport: s.telemetrySnapshot?.timestamp
          ? Date.parse(s.telemetrySnapshot.timestamp)
          : null,
        _battKwh: s.totalBatteryEnergy ? s.totalBatteryEnergy / 1000 : null,
        _sizeKw: s.systemSizeKwDc ?? null,
        _installDate: s.installDate ? Date.parse(s.installDate) : null,
        _grid: gridStatusOf(s),
        _devices:
          (s.totalGateways || 0) + (s.totalInverters || 0) + (s.totalBatteries || 0) || null,
        _link: s.linkMethod,
      })),
    [sites]
  );

  const visible = useMemo(() => {
    let rows = derived;

    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (s) =>
          s.siteName?.toLowerCase().includes(q) ||
          s.siteId.toLowerCase().includes(q) ||
          s.address?.toLowerCase().includes(q) ||
          s.city?.toLowerCase().includes(q) ||
          s.customerName?.toLowerCase().includes(q) ||
          s.dealName?.toLowerCase().includes(q)
      );
    }

    if (linkSel.length > 0) {
      rows = rows.filter((s) => linkSel.includes(s.linkMethod));
    }
    if (stateSel.length > 0) {
      rows = rows.filter((s) => stateSel.includes(s.state));
    }
    if (gridSel.length > 0) {
      rows = rows.filter((s) => gridSel.includes(s._grid));
    }
    if (alertSel.length > 0) {
      rows = rows.filter((s) => {
        const severities = new Set(s.alerts.map((a) => a.severity));
        return alertSel.some((sel) => {
          if (sel === "__any__") return s.alerts.length > 0;
          if (sel === "__none__") return s.alerts.length === 0;
          return severities.has(sel);
        });
      });
    }
    if (alertNameSel.length > 0) {
      rows = rows.filter((s) => s.alerts.some((a) => alertNameSel.includes(a.alertName)));
    }

    return sortStable(rows, sortKey, sortDir);
  }, [derived, search, linkSel, stateSel, gridSel, alertSel, alertNameSel, sortKey, sortDir]);

  useEffect(() => {
    onVisibleRowsChange?.(visible);
  }, [visible, onVisibleRowsChange]);

  // Stats
  const withAlerts = sites.filter((s) => s.alerts.length > 0).length;
  const withTelemetry = sites.filter((s) => s.telemetrySnapshot).length;
  const withDevices = sites.filter(
    (s) => (s.totalGateways || 0) + (s.totalBatteries || 0) + (s.totalInverters || 0) > 0
  ).length;

  const hasActiveFilters =
    search ||
    linkSel.length > 0 ||
    alertSel.length > 0 ||
    alertNameSel.length > 0 ||
    gridSel.length > 0 ||
    stateSel.length > 0;

  if (loading) {
    return (
      <div className="animate-pulse space-y-3">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="h-14 bg-surface rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div>
      {/* ── Toolbar ────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onFilterChange?.(filter === "provisioned" ? "all" : "provisioned")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filter === "provisioned"
                ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                : "bg-surface text-muted border border-t-border"
            }`}
          >
            Provisioned Only
          </button>
          <button
            onClick={() => onFilterChange?.("all")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filter === "all"
                ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                : "bg-surface text-muted border border-t-border"
            }`}
          >
            All Sites
          </button>
          <button
            onClick={() =>
              setAlertSel((sel) => (sel.includes("__any__") ? [] : ["__any__"]))
            }
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              alertSel.includes("__any__")
                ? "bg-red-500/20 text-red-400 border border-red-500/30"
                : "bg-surface text-muted border border-t-border"
            }`}
          >
            Active Alerts
          </button>
        </div>

        <input
          type="text"
          placeholder="Search sites..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-1.5 rounded-lg text-sm bg-surface border border-t-border text-foreground placeholder:text-muted w-60"
        />

        <MultiSelectFilter
          label="Link"
          options={linkOptions}
          selected={linkSel}
          onChange={setLinkSel}
          accentColor="cyan"
        />
        <MultiSelectFilter
          label="Alerts"
          options={alertOptions}
          selected={alertSel}
          onChange={setAlertSel}
          accentColor="cyan"
        />
        {alertNameOptions.length > 0 && (
          <MultiSelectFilter
            label="Alert Type"
            options={alertNameOptions}
            selected={alertNameSel}
            onChange={setAlertNameSel}
            accentColor="cyan"
          />
        )}
        <MultiSelectFilter
          label="Grid"
          options={gridOptions}
          selected={gridSel}
          onChange={setGridSel}
          accentColor="cyan"
        />
        {stateOptions.length > 1 && (
          <MultiSelectFilter
            label="State"
            options={stateOptions}
            selected={stateSel}
            onChange={setStateSel}
            accentColor="cyan"
          />
        )}
        {hasActiveFilters && (
          <button
            onClick={() => {
              setSearch("");
              setLinkSel([]);
              setAlertSel([]);
              setAlertNameSel([]);
              setGridSel([]);
              setStateSel([]);
            }}
            className="text-xs text-muted hover:text-foreground underline"
          >
            Clear filters
          </button>
        )}

        <div className="ml-auto flex items-center gap-3 text-xs text-muted">
          <span>
            {visible.length === sites.length
              ? `${sites.length} sites`
              : `${visible.length} of ${sites.length} sites`}
          </span>
          <span className="text-cyan-500">{withTelemetry} reporting</span>
          <span>{withDevices} with devices</span>
          {withAlerts > 0 && (
            <span className="text-red-400">{withAlerts} with alerts</span>
          )}
        </div>
      </div>

      {/* ── Table ──────────────────────────────────────────── */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-t-border text-left text-muted">
              <SortHeader label="Customer / Site" field="_customer" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
              <SortHeader label="Devices" field="_devices" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
              <SortHeader label="Solar" field="_solar" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
              <SortHeader label="Battery" field="_soc" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
              <SortHeader label="Grid" field="_grid" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
              <SortHeader label="Alerts" field="_alertWeight" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
              <SortHeader label="Tickets" field="_tickets" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
              <SortHeader label="Size" field="_sizeKw" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
              <SortHeader label="Capacity" field="_battKwh" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
              <SortHeader label="Installed" field="_installDate" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
              <SortHeader label="Last Report" field="_lastReport" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
              <th className="pb-3 font-medium">Monitor</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((site) => {
              const snapshot = site.telemetrySnapshot;
              const isExpanded = expandedSiteId === site.siteId;
              // Worst-severity-first for inline display + tooltip
              const sortedAlerts = [...site.alerts].sort(
                (a, b) =>
                  (SEVERITY_WEIGHT[b.severity] || 1) - (SEVERITY_WEIGHT[a.severity] || 1)
              );
              const alertTooltip = sortedAlerts
                .map((a) => `${a.severity} ${a.alertName}`)
                .join("\n");
              const tickets = site.tickets || [];

              // Determine if the site name is a real name or just the UUID
              const isUuidName = site.siteName === site.siteId;
              const displayName = isUuidName
                ? site.siteId.slice(0, 8) + "…"
                : site.siteName;

              // Device summary
              const gw = site.totalGateways || 0;
              const batt = site.totalBatteries || 0;
              const inv = site.totalInverters || 0;
              const deviceParts: string[] = [];
              if (gw > 0) deviceParts.push(`${gw} GW`);
              if (inv > 0) deviceParts.push(`${inv} INV`);
              if (batt > 0) deviceParts.push(`${batt} BAT`);
              const deviceSummary = deviceParts.join(" · ") || "—";

              // Location: prefer address, then city/state
              const location = site.address
                ? site.address
                : site.city
                  ? `${site.city}, ${site.state || ""}`
                  : "";

              return (
                <Fragment key={site.siteId}>
                  <tr
                    className="border-b border-t-border cursor-pointer hover:bg-surface transition-colors"
                    onClick={() =>
                      setExpandedSiteId(isExpanded ? null : site.siteId)
                    }
                  >
                    <td className="py-3 pr-4">
                      {(site.dealId || site.resolvedDealId) &&
                      (site.customerName || site.dealName) ? (
                        <a
                          href={getHubSpotDealUrl(site.dealId || site.resolvedDealId!)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="font-medium text-cyan-500 hover:underline truncate inline-block max-w-[240px]"
                          title={site.dealName || site.customerName || undefined}
                        >
                          {site.customerName || site.dealName}
                        </a>
                      ) : (
                        <div
                          className={`font-medium ${
                            isUuidName ? "text-muted" : "text-foreground"
                          }`}
                        >
                          {displayName}
                        </div>
                      )}
                      <div className="text-xs text-muted truncate max-w-[240px]">
                        {(site.dealId || site.resolvedDealId) &&
                        (site.customerName || site.dealName)
                          ? [displayName, location].filter(Boolean).join(" · ")
                          : location}
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-xs text-muted">
                      {deviceSummary}
                    </td>
                    <td className="py-3 pr-4">
                      {snapshot?.solarPowerW != null
                        ? formatPower(snapshot.solarPowerW)
                        : "—"}
                    </td>
                    <td className="py-3 pr-4">
                      {snapshot?.batterySocPercent != null
                        ? `${Math.round(snapshot.batterySocPercent)}%`
                        : "—"}
                    </td>
                    <td className="py-3 pr-4">
                      {/* grid_connected_status is dead fleet-wide; voltage is the real signal (see gridStatusOf) */}
                      {site._grid === "on" ? (
                        <span className="text-green-500 text-xs">✓ On-grid</span>
                      ) : site._grid === "off" ? (
                        <span className="text-red-500 text-xs">⚠ Off-grid</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-3 pr-4" title={alertTooltip || undefined}>
                      <div className="flex flex-wrap items-center gap-1 max-w-[260px]">
                        {sortedAlerts.map((alert) => {
                          const label =
                            alert.severity === "RMA" ? `RMA ${alert.alertName}` : alert.alertName;
                          return (
                            <span
                              key={alert.id}
                              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium max-w-[160px] ${
                                ALERT_CHIP_COLORS[alert.severity] || ALERT_CHIP_COLORS.INFORMATIONAL
                              }`}
                            >
                              {/* truncate needs a block/inline-block child */}
                              <span className="truncate">{label}</span>
                            </span>
                          );
                        })}
                        {sortedAlerts.length === 0 && (
                          <span className="text-muted">—</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex flex-col gap-0.5 max-w-[200px]">
                        {tickets.slice(0, 2).map((ticket) => (
                          <a
                            key={ticket.id}
                            href={getHubSpotTicketUrl(ticket.id)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs text-cyan-500 hover:underline truncate"
                            title={ticket.subject || `Ticket ${ticket.id}`}
                          >
                            {ticket.subject || `Ticket ${ticket.id}`} ↗
                          </a>
                        ))}
                        {tickets.length > 2 && (
                          <span className="text-xs text-muted">
                            +{tickets.length - 2} more
                          </span>
                        )}
                        {tickets.length === 0 && (
                          <span className="text-muted">—</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-xs">
                      {site._sizeKw != null ? `${site._sizeKw} kW` : "—"}
                    </td>
                    <td className="py-3 pr-4 text-xs">
                      {site._battKwh != null ? `${site._battKwh.toFixed(1)} kWh` : "—"}
                    </td>
                    <td className="py-3 pr-4 text-xs text-muted">
                      {formatInstallDate(site.installDate)}
                    </td>
                    <td className="py-3 pr-4 text-xs">
                      {(() => {
                        const lr = formatLastReport(site._lastReport);
                        return lr ? (
                          <span
                            className={lr.stale ? "text-red-400" : "text-muted"}
                            title={new Date(site._lastReport!).toLocaleString()}
                          >
                            {lr.label}
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        );
                      })()}
                    </td>
                    <td className="py-3 text-xs">
                      {site.portalUrl ? (
                        <a
                          href={site.portalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-0.5 text-cyan-500 hover:underline"
                          title="Open live monitoring in Tesla PowerHub"
                        >
                          Monitor
                          <span aria-hidden="true">↗</span>
                        </a>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={12} className="bg-surface-2 p-4">
                        <SiteDetail siteId={site.siteId} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td
                  colSpan={12}
                  className="py-8 text-center text-muted"
                >
                  {hasActiveFilters
                    ? "No sites match your filters"
                    : "No provisioned sites found"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SortHeader({
  label,
  field,
  sortKey,
  sortDir,
  onSort,
  last,
}: {
  label: string;
  field: string;
  sortKey: string | null;
  sortDir: "asc" | "desc";
  onSort: (key: string) => void;
  last?: boolean;
}) {
  const active = sortKey === field;
  return (
    <th className={`pb-3 font-medium ${last ? "" : "pr-4"}`}>
      <button
        onClick={() => onSort(field)}
        className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${
          active ? "text-foreground" : ""
        }`}
      >
        {label}
        <span aria-hidden="true" className="text-xs w-3">
          {active ? (sortDir === "asc" ? "↑" : "↓") : ""}
        </span>
      </button>
    </th>
  );
}

/**
 * sortRows + a stable siteId tiebreak so rows with equal sort values never
 * swap places when the server response arrives in a different order
 * (the every-5-min SSE refetch used to visibly reshuffle the table).
 */
function sortStable<T extends { siteId: string }>(
  rows: T[],
  key: string | null,
  dir: SortDir
): T[] {
  if (!key) return [...rows].sort((a, b) => a.siteId.localeCompare(b.siteId));
  return [...rows].sort((a, b) => {
    const av = (a as Record<string, unknown>)[key];
    const bv = (b as Record<string, unknown>)[key];
    let cmp = 0;
    if (av == null && bv == null) cmp = 0;
    else if (av == null) return 1;
    else if (bv == null) return -1;
    else if (typeof av === "number" && typeof bv === "number")
      cmp = dir === "asc" ? av - bv : bv - av;
    else
      cmp =
        dir === "asc"
          ? String(av).localeCompare(String(bv))
          : String(bv).localeCompare(String(av));
    return cmp !== 0 ? cmp : a.siteId.localeCompare(b.siteId);
  });
}

function formatPower(watts: number): string {
  if (Math.abs(watts) >= 1000) return `${(watts / 1000).toFixed(1)} kW`;
  return `${Math.round(watts)} W`;
}

function formatInstallDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

const STALE_REPORT_MS = 24 * 60 * 60 * 1000;

/** Relative "last telemetry" age; stale once the site has been dark >24h. */
function formatLastReport(timestampMs: number | null): {
  label: string;
  stale: boolean;
} | null {
  if (timestampMs == null) return null;
  const ageMs = Date.now() - timestampMs;
  let label: string;
  if (ageMs < 60_000) label = "just now";
  else if (ageMs < 3_600_000) label = `${Math.round(ageMs / 60_000)}m ago`;
  else if (ageMs < 86_400_000) label = `${Math.round(ageMs / 3_600_000)}h ago`;
  else label = `${Math.round(ageMs / 86_400_000)}d ago`;
  return { label, stale: ageMs > STALE_REPORT_MS };
}
