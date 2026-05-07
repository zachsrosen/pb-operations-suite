"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

interface SiteDetailProps {
  siteId: string;
}

export default function SiteDetail({ siteId }: SiteDetailProps) {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.powerhub.site(siteId),
    queryFn: async () => {
      const res = await fetch(`/api/powerhub/sites/${siteId}`);
      if (!res.ok) throw new Error("Failed to fetch site detail");
      return res.json();
    },
  });

  if (isLoading) {
    return <div className="animate-pulse h-32 bg-surface rounded" />;
  }

  const site = data?.site;
  if (!site) return <div className="text-muted">No data</div>;

  const snapshot = site.telemetrySnapshot;
  const devices = site.devices || [];

  return (
    <div className="space-y-4">
      {snapshot && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricBox label="Solar" value={formatPower(snapshot.solarPowerW)} />
          <MetricBox label="Battery SOC" value={formatPercent(snapshot.batterySocPercent)} />
          <MetricBox label="Grid" value={formatPower(snapshot.gridPowerW)} />
          <MetricBox label="Load" value={formatPower(snapshot.loadPowerW)} />
          <MetricBox label="Battery Mode" value={snapshot.batteryMode || "—"} />
          <MetricBox label="Grid Status" value={snapshot.gridConnectedStatus || "—"} />
        </div>
      )}

      {site.alerts?.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-foreground mb-2">Active Alerts</h4>
          <div className="space-y-1">
            {site.alerts.map((alert: any) => (
              <div
                key={alert.id}
                className="flex items-center gap-2 text-sm p-2 rounded bg-surface"
              >
                <SeverityBadge severity={alert.severity} />
                <span className="text-foreground">{alert.alertName}</span>
                <span className="text-muted text-xs ml-auto">
                  {alert.deviceId !== "site" ? `Device: ${alert.deviceId.slice(0, 8)}...` : "Site-level"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h4 className="text-sm font-medium text-foreground mb-2">
          Devices ({devices.length})
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
          {devices.map((device: any, i: number) => (
            <div key={i} className="p-2 bg-surface rounded">
              <div className="font-medium capitalize">{device.device_type}</div>
              <div className="text-muted">
                {device.manufacturer} {device.model}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MetricBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-2 bg-surface rounded">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const colors = {
    CRITICAL: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    PERFORMANCE: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    INFORMATIONAL: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${colors[severity as keyof typeof colors] || colors.INFORMATIONAL}`}>
      {severity}
    </span>
  );
}

function formatPower(watts: number | null): string {
  if (watts == null) return "—";
  if (Math.abs(watts) >= 1000) return `${(watts / 1000).toFixed(1)} kW`;
  return `${Math.round(watts)} W`;
}

function formatPercent(pct: number | null): string {
  if (pct == null) return "—";
  return `${Math.round(pct)}%`;
}
