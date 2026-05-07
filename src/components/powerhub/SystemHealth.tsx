"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

interface SystemHealthProps {
  siteId: string;
}

export default function SystemHealth({ siteId }: SystemHealthProps) {
  const enabled = process.env.NEXT_PUBLIC_POWERHUB_ENABLED === "true";

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.powerhub.site(siteId),
    queryFn: async () => {
      const res = await fetch(`/api/powerhub/sites/${siteId}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled,
    retry: false,
  });

  if (!enabled) return null;

  if (isLoading) {
    return (
      <div className="animate-pulse h-24 bg-surface rounded-lg" />
    );
  }

  if (!data?.site) return null;

  const site = data.site;
  const snapshot = site.telemetrySnapshot;
  const activeAlerts = site.alerts || [];

  return (
    <div className="bg-surface rounded-xl p-4 shadow-card">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-cyan-500">⚡</span>
        <h4 className="text-sm font-medium text-foreground">
          System Health — {site.siteName}
        </h4>
      </div>

      {snapshot ? (
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div className="text-center">
            <div className="text-xs text-muted">Solar</div>
            <div className="text-sm font-medium text-foreground">
              {snapshot.solarPowerW != null
                ? `${(snapshot.solarPowerW / 1000).toFixed(1)} kW`
                : "—"}
            </div>
          </div>
          <div className="text-center">
            <div className="text-xs text-muted">Battery</div>
            <div className="text-sm font-medium text-foreground">
              {snapshot.batterySocPercent != null
                ? `${Math.round(snapshot.batterySocPercent)}%`
                : "—"}
            </div>
          </div>
          <div className="text-center">
            <div className="text-xs text-muted">Grid</div>
            <div className="text-sm font-medium text-foreground">
              {snapshot.gridConnectedStatus === "Grid Connected"
                ? "Connected"
                : "Disconnected"}
            </div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted mb-3">No telemetry data yet</p>
      )}

      {activeAlerts.length > 0 && (
        <div className="border-t border-t-border pt-2">
          <div className="text-xs text-yellow-500">
            ⚠ {activeAlerts.length} active alert{activeAlerts.length !== 1 ? "s" : ""}:{" "}
            {activeAlerts.map((a: any) => a.alertName).join(", ")}
          </div>
        </div>
      )}
    </div>
  );
}
