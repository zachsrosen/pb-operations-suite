"use client";

import { Fragment, useState } from "react";
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
  totalBatteries: number;
  totalInverters: number;
  telemetrySnapshot: {
    solarPowerW: number | null;
    batterySocPercent: number | null;
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
}

export default function FleetTable({ sites, loading }: FleetTableProps) {
  const [expandedSiteId, setExpandedSiteId] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="animate-pulse space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-14 bg-surface rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-t-border text-left text-muted">
            <th className="pb-3 pr-4 font-medium">Site</th>
            <th className="pb-3 pr-4 font-medium">Location</th>
            <th className="pb-3 pr-4 font-medium">Solar</th>
            <th className="pb-3 pr-4 font-medium">Battery</th>
            <th className="pb-3 pr-4 font-medium">Grid</th>
            <th className="pb-3 pr-4 font-medium">Alerts</th>
            <th className="pb-3 font-medium">Link</th>
          </tr>
        </thead>
        <tbody>
          {sites.map((site) => {
            const snapshot = site.telemetrySnapshot;
            const isExpanded = expandedSiteId === site.siteId;
            const criticalAlerts = site.alerts.filter(
              (a) => a.severity === "CRITICAL"
            ).length;
            const perfAlerts = site.alerts.filter(
              (a) => a.severity === "PERFORMANCE"
            ).length;

            return (
              <Fragment key={site.siteId}>
                <tr
                  className="border-b border-t-border cursor-pointer hover:bg-surface transition-colors"
                  onClick={() =>
                    setExpandedSiteId(isExpanded ? null : site.siteId)
                  }
                >
                  <td className="py-3 pr-4">
                    <div className="font-medium text-foreground">
                      {site.siteName}
                    </div>
                    <div className="text-xs text-muted">{site.address}</div>
                  </td>
                  <td className="py-3 pr-4 text-muted">
                    {site.city}, {site.state}
                  </td>
                  <td className="py-3 pr-4">
                    {snapshot?.solarPowerW != null
                      ? `${(snapshot.solarPowerW / 1000).toFixed(1)} kW`
                      : "—"}
                  </td>
                  <td className="py-3 pr-4">
                    {snapshot?.batterySocPercent != null
                      ? `${Math.round(snapshot.batterySocPercent)}%`
                      : "—"}
                  </td>
                  <td className="py-3 pr-4">
                    {snapshot?.gridConnectedStatus === "Grid Connected" ? (
                      <span className="text-green-500">✓ On-grid</span>
                    ) : snapshot?.gridConnectedStatus ? (
                      <span className="text-red-500">⚠ Off-grid</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-3 pr-4">
                    {criticalAlerts > 0 && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 mr-1">
                        {criticalAlerts} Critical
                      </span>
                    )}
                    {perfAlerts > 0 && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                        {perfAlerts} Perf
                      </span>
                    )}
                    {site.alerts.length === 0 && (
                      <span className="text-muted">None</span>
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
        </tbody>
      </table>
    </div>
  );
}
