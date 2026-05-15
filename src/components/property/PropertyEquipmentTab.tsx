"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { Skeleton } from "@/components/ui/Skeleton";
import type { EquipmentTabData } from "@/lib/property-hub";

interface Props {
  propertyId: string;
}

function formatSystemSize(kw: number): string {
  return kw >= 1 ? `${kw.toFixed(1)} kW` : `${(kw * 1000).toFixed(0)} W`;
}

export default function PropertyEquipmentTab({ propertyId }: Props) {
  const { data, isLoading, error } = useQuery<EquipmentTabData>({
    queryKey: queryKeys.propertyHub.tab(propertyId, "equipment"),
    queryFn: async () => {
      const res = await fetch(
        `/api/properties/${propertyId}/hub?tab=equipment`,
      );
      if (!res.ok) throw new Error("Failed to load equipment");
      return res.json();
    },
    staleTime: 60_000,
  });

  if (error) {
    return (
      <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-6 text-red-400">
        Failed to load equipment.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl bg-surface border border-t-border p-4">
              <Skeleton className="h-4 w-20 mb-2" />
              <Skeleton className="h-6 w-12" />
            </div>
          ))}
        </div>
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }

  const summary = data?.equipmentSummary;
  const snapshots = data?.snapshots ?? [];

  const hasEquipment =
    summary &&
    (summary.modules.count > 0 ||
      summary.inverters.count > 0 ||
      summary.batteries.count > 0 ||
      summary.evChargers.count > 0);

  return (
    <div className="space-y-6">
      {/* Equipment summary cards */}
      {hasEquipment ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {summary.modules.count > 0 && (
            <div className="rounded-xl bg-surface border border-t-border p-4">
              <p className="text-xs text-muted uppercase tracking-wider">
                Modules
              </p>
              <p className="text-lg font-bold text-foreground mt-1">
                {summary.modules.count}
              </p>
              {summary.modules.totalWattage > 0 && (
                <p className="text-xs text-muted mt-0.5">
                  {formatSystemSize(summary.modules.totalWattage / 1000)} total
                </p>
              )}
            </div>
          )}
          {summary.inverters.count > 0 && (
            <div className="rounded-xl bg-surface border border-t-border p-4">
              <p className="text-xs text-muted uppercase tracking-wider">
                Inverters
              </p>
              <p className="text-lg font-bold text-foreground mt-1">
                {summary.inverters.count}
              </p>
            </div>
          )}
          {summary.batteries.count > 0 && (
            <div className="rounded-xl bg-surface border border-t-border p-4">
              <p className="text-xs text-muted uppercase tracking-wider">
                Batteries
              </p>
              <p className="text-lg font-bold text-foreground mt-1">
                {summary.batteries.count}
              </p>
              {summary.batteries.totalKwh > 0 && (
                <p className="text-xs text-muted mt-0.5">
                  {summary.batteries.totalKwh.toFixed(1)} kWh total
                </p>
              )}
            </div>
          )}
          {summary.evChargers.count > 0 && (
            <div className="rounded-xl bg-surface border border-t-border p-4">
              <p className="text-xs text-muted uppercase tracking-wider">
                EV Chargers
              </p>
              <p className="text-lg font-bold text-foreground mt-1">
                {summary.evChargers.count}
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-8 text-muted">
          <svg className="w-10 h-10 mx-auto mb-2 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
          </svg>
          <p className="text-sm">No equipment data available</p>
        </div>
      )}

      {/* BOM snapshots history */}
      {snapshots.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-foreground mb-3">
            BOM History ({snapshots.length} snapshots)
          </h3>
          <div className="space-y-2">
            {snapshots.map((snap) => (
              <div
                key={snap.id}
                className="rounded-xl bg-surface border border-t-border p-4 hover:border-blue-500/20 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {snap.dealName}
                    </p>
                    <p className="text-xs text-muted mt-0.5">
                      Version {snap.version} &middot; {snap.itemCount} items
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-muted">
                      {new Date(snap.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </p>
                    <p className="text-xs text-muted">by {snap.savedBy}</p>
                  </div>
                </div>
                {snap.sourceFile && (
                  <p className="text-xs text-muted mt-1 truncate">
                    Source: {snap.sourceFile}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
