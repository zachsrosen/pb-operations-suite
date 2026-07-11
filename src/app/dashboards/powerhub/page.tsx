"use client";

import { useCallback, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useSSE } from "@/hooks/useSSE";
import DashboardShell from "@/components/DashboardShell";
import { StatCard } from "@/components/ui/MetricCard";
import FleetTable from "@/components/powerhub/FleetTable";

interface VisibleSiteRow {
  siteId: string;
  siteName: string;
  address: string;
  city: string;
  state: string;
  linkMethod: string;
  dealId: string | null;
  resolvedDealId?: string | null;
  customerName?: string | null;
  dealName?: string | null;
  totalGateways: number;
  totalBatteries: number;
  totalInverters: number;
  telemetrySnapshot: {
    solarPowerW: number | null;
    batterySocPercent: number | null;
    gridConnectedStatus: string | null;
  } | null;
  alerts: Array<{ severity: string; alertName: string }>;
}

export default function PowerHubDashboard() {
  const [siteFilter, setSiteFilter] = useState<string>("provisioned");
  const [visibleRows, setVisibleRows] = useState<VisibleSiteRow[]>([]);
  const handleVisibleRowsChange = useCallback(
    (rows: VisibleSiteRow[]) => setVisibleRows(rows),
    []
  );

  const fleetQuery = useQuery({
    queryKey: queryKeys.powerhub.fleet(),
    queryFn: async () => {
      const res = await fetch("/api/powerhub/fleet");
      if (!res.ok) throw new Error("Failed to fetch fleet data");
      return res.json();
    },
    // Keep the page still during background updates
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const sitesQuery = useQuery({
    queryKey: [...queryKeys.powerhub.sites(), siteFilter],
    queryFn: async () => {
      const res = await fetch(`/api/powerhub/sites?filter=${siteFilter}`);
      if (!res.ok) throw new Error("Failed to fetch sites");
      return res.json();
    },
    // Hold the previous rows during refetches so the table never flashes
    // empty or reflows mid-read; client-side sort keeps order stable.
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  useSSE(
    () => {
      fleetQuery.refetch();
      sitesQuery.refetch();
    },
    { url: "/api/stream", cacheKeyFilter: "powerhub" }
  );

  const fleet = fleetQuery.data?.fleet;

  const exportRows = visibleRows.map((s) => ({
    site: s.siteName,
    customer: s.customerName || s.dealName || "",
    address: s.address,
    city: s.city,
    state: s.state,
    linkMethod: s.linkMethod,
    hubspotDealId: s.dealId || s.resolvedDealId || "",
    gateways: s.totalGateways,
    inverters: s.totalInverters,
    batteries: s.totalBatteries,
    solarPowerW: s.telemetrySnapshot?.solarPowerW ?? "",
    batterySocPercent: s.telemetrySnapshot?.batterySocPercent ?? "",
    gridStatus: s.telemetrySnapshot?.gridConnectedStatus ?? "",
    activeAlerts: s.alerts.length,
    alertNames: s.alerts.map((a) => a.alertName).join("; "),
  }));

  if (process.env.NEXT_PUBLIC_POWERHUB_ENABLED !== "true") {
    return null;
  }

  return (
    <DashboardShell
      title="PowerHub Fleet Monitor"
      accentColor="cyan"
      lastUpdated={
        sitesQuery.dataUpdatedAt
          ? new Date(sitesQuery.dataUpdatedAt).toISOString()
          : undefined
      }
      exportData={{ data: exportRows, filename: "powerhub-fleet.csv" }}
      fullWidth
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Fleet Solar"
          value={
            fleet?.totalSolarPowerW != null
              ? `${(fleet.totalSolarPowerW / 1000).toFixed(1)} kW`
              : "—"
          }
          color="cyan"
        />
        <StatCard
          label="Avg Battery SOC"
          value={
            fleet?.avgBatterySocPercent != null
              ? `${fleet.avgBatterySocPercent}%`
              : "—"
          }
          color="green"
        />
        <StatCard
          label="Sites Reporting"
          value={
            fleet
              ? `${fleet.sitesReporting} / ${fleet.provisionedSites}`
              : "—"
          }
          color="blue"
        />
        <StatCard
          label="Active Alerts"
          value={fleet?.activeAlertCount?.toString() || "0"}
          color={fleet?.activeAlertCount > 0 ? "red" : "green"}
        />
      </div>

      <div className="bg-surface rounded-xl p-4 shadow-card">
        <FleetTable
          sites={sitesQuery.data?.sites || []}
          loading={sitesQuery.isLoading}
          filter={siteFilter}
          onFilterChange={setSiteFilter}
          onVisibleRowsChange={handleVisibleRowsChange}
        />
      </div>
    </DashboardShell>
  );
}
