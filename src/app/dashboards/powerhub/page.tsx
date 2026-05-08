"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useSSE } from "@/hooks/useSSE";
import DashboardShell from "@/components/DashboardShell";
import { StatCard } from "@/components/ui/MetricCard";
import FleetTable from "@/components/powerhub/FleetTable";

export default function PowerHubDashboard() {
  const [siteFilter, setSiteFilter] = useState<string>("provisioned");

  const fleetQuery = useQuery({
    queryKey: queryKeys.powerhub.fleet(),
    queryFn: async () => {
      const res = await fetch("/api/powerhub/fleet");
      if (!res.ok) throw new Error("Failed to fetch fleet data");
      return res.json();
    },
  });

  const sitesQuery = useQuery({
    queryKey: [...queryKeys.powerhub.sites(), siteFilter],
    queryFn: async () => {
      const res = await fetch(`/api/powerhub/sites?filter=${siteFilter}`);
      if (!res.ok) throw new Error("Failed to fetch sites");
      return res.json();
    },
  });

  useSSE(
    () => {
      fleetQuery.refetch();
      sitesQuery.refetch();
    },
    { url: "/api/stream", cacheKeyFilter: "powerhub" }
  );

  const fleet = fleetQuery.data?.fleet;

  if (process.env.NEXT_PUBLIC_POWERHUB_ENABLED !== "true") {
    return null;
  }

  return (
    <DashboardShell
      title="PowerHub Fleet Monitor"
      accentColor="cyan"
      lastUpdated={new Date().toISOString()}
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
        />
      </div>
    </DashboardShell>
  );
}
