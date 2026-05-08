"use client";

import { Fragment, useState, useMemo } from "react";
import SiteDetail from "./SiteDetail";

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
  totalGateways: number;
  totalBatteries: number;
  totalInverters: number;
  telemetrySnapshot: {
    solarPowerW: number | null;
    batterySocPercent: number | null;
    gridPowerW: number | null;
    gridConnectedStatus: string | null;
  } | null;
  alerts: Array<{
    id: string;
    severity: string;
    alertName: string;
  }>;
}

interface FleetTableProps {
  sites: PowerhubSiteRow[];
  loading?: boolean;
  filter?: string;
  onFilterChange?: (filter: string) => void;
}

export default function FleetTable({
  sites,
  loading,
  filter = "provisioned",
  onFilterChange,
}: FleetTableProps) {
  const [expandedSiteId, setExpandedSiteId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search) return sites;
    const q = search.toLowerCase();
    return sites.filter(
      (s) =>
        s.siteName?.toLowerCase().includes(q) ||
        s.siteId.toLowerCase().includes(q) ||
        s.address?.toLowerCase().includes(q) ||
        s.city?.toLowerCase().includes(q)
    );
  }, [sites, search]);

  // Stats
  const withAlerts = sites.filter((s) => s.alerts.length > 0).length;
  const withTelemetry = sites.filter((s) => s.telemetrySnapshot).length;
  const withDevices = sites.filter(
    (s) => (s.totalGateways || 0) + (s.totalBatteries || 0) + (s.totalInverters || 0) > 0
  ).length;

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
        </div>

        <input
          type="text"
          placeholder="Search sites..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-1.5 rounded-lg text-sm bg-surface border border-t-border text-foreground placeholder:text-muted w-60"
        />

        <div className="ml-auto flex items-center gap-3 text-xs text-muted">
          <span>{filtered.length} sites</span>
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
              <th className="pb-3 pr-4 font-medium">Site</th>
              <th className="pb-3 pr-4 font-medium">Devices</th>
              <th className="pb-3 pr-4 font-medium">Solar</th>
              <th className="pb-3 pr-4 font-medium">Battery</th>
              <th className="pb-3 pr-4 font-medium">Grid</th>
              <th className="pb-3 pr-4 font-medium">Alerts</th>
              <th className="pb-3 font-medium">Link</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((site) => {
              const snapshot = site.telemetrySnapshot;
              const isExpanded = expandedSiteId === site.siteId;
              const criticalAlerts = site.alerts.filter(
                (a) => a.severity === "CRITICAL"
              ).length;
              const perfAlerts = site.alerts.filter(
                (a) => a.severity === "PERFORMANCE"
              ).length;

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
                      <div
                        className={`font-medium ${
                          isUuidName ? "text-muted" : "text-foreground"
                        }`}
                      >
                        {displayName}
                      </div>
                      {location && (
                        <div className="text-xs text-muted truncate max-w-[200px]">
                          {location}
                        </div>
                      )}
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
                      {snapshot?.gridConnectedStatus === "Grid Connected" ? (
                        <span className="text-green-500 text-xs">✓ On-grid</span>
                      ) : snapshot?.gridConnectedStatus ? (
                        <span className="text-red-500 text-xs">⚠ Off-grid</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      {criticalAlerts > 0 && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 mr-1">
                          {criticalAlerts}
                        </span>
                      )}
                      {perfAlerts > 0 && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                          {perfAlerts}
                        </span>
                      )}
                      {site.alerts.length === 0 && (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="py-3">
                      {site.linkMethod === "UNLINKED" ? (
                        <span className="text-yellow-500 text-xs">Unlinked</span>
                      ) : (
                        <span className="text-green-500 text-xs">
                          ✓ {site.linkMethod}
                        </span>
                      )}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={7} className="bg-surface-2 p-4">
                        <SiteDetail siteId={site.siteId} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="py-8 text-center text-muted"
                >
                  {search
                    ? "No sites match your search"
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

function formatPower(watts: number): string {
  if (Math.abs(watts) >= 1000) return `${(watts / 1000).toFixed(1)} kW`;
  return `${Math.round(watts)} W`;
}
