"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { StatCard } from "@/components/ui/MetricCard";
import SolarEdgeFleetTable, { type SolarEdgeSiteRow } from "@/components/solaredge/SolarEdgeFleetTable";

interface FleetResponse {
  sites: SolarEdgeSiteRow[];
  fleet: { totalSites: number; withOpenAlerts: number; criticalSites: number; lastUpdated: string | null };
}

export default function SolarEdgeDashboard() {
  const query = useQuery({
    queryKey: ["solaredge", "sites"],
    queryFn: async () => {
      const res = await fetch("/api/solaredge/sites?filter=active");
      if (!res.ok) throw new Error("Failed to fetch SolarEdge sites");
      return res.json() as Promise<FleetResponse>;
    },
    placeholderData: keepPreviousData,
  });

  if (process.env.NEXT_PUBLIC_UI_SOLAREDGE_VIEWS_ENABLED !== "true") {
    return null;
  }

  const fleet = query.data?.fleet;

  return (
    <DashboardShell
      title="SolarEdge Fleet Monitor"
      accentColor="cyan"
      lastUpdated={fleet?.lastUpdated ?? undefined}
      fullWidth
    >
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        <StatCard label="Sites" value={fleet ? String(fleet.totalSites) : "—"} color="cyan" />
        <StatCard
          label="With Open Alerts"
          value={fleet ? String(fleet.withOpenAlerts) : "—"}
          color={fleet && fleet.withOpenAlerts > 0 ? "red" : "green"}
        />
        <StatCard
          label="Critical (impact ≥7)"
          value={fleet ? String(fleet.criticalSites) : "—"}
          color={fleet && fleet.criticalSites > 0 ? "red" : "green"}
        />
      </div>

      <div className="bg-surface rounded-xl p-4 shadow-card">
        {query.isLoading ? (
          <div className="animate-pulse space-y-3">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-12 bg-surface-2 rounded-lg" />
            ))}
          </div>
        ) : (
          <SolarEdgeFleetTable sites={query.data?.sites ?? []} />
        )}
      </div>
    </DashboardShell>
  );
}
