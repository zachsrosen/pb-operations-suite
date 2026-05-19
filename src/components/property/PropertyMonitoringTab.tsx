"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { Skeleton } from "@/components/ui/Skeleton";
import { PowerhubLink } from "@/components/powerhub/PowerhubLink";
import type { MonitoringTabData } from "@/lib/property-hub";

interface Props {
  propertyId: string;
}

const SEVERITY_BADGE: Record<string, string> = {
  CRITICAL:
    "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  PERFORMANCE:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  INFORMATIONAL:
    "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
};

export default function PropertyMonitoringTab({ propertyId }: Props) {
  const { data, isLoading, error } = useQuery<MonitoringTabData>({
    queryKey: queryKeys.powerhub.propertySites(propertyId),
    queryFn: async () => {
      const res = await fetch(
        `/api/powerhub/properties/${propertyId}/sites`,
      );
      if (!res.ok) throw new Error("Failed to load monitoring data");
      return res.json();
    },
    staleTime: 60_000,
  });

  if (error) {
    return (
      <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-6 text-red-400">
        Failed to load monitoring data.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl bg-surface border border-t-border p-4"
          >
            <Skeleton className="h-5 w-48 mb-3" />
            <div className="grid grid-cols-3 gap-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!data || data.sites.length === 0) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted text-sm">
          This property has no Tesla PowerHub sites linked.
        </p>
        <p className="text-xs text-muted mt-2">
          Sites are linked automatically by the asset-sync cron.{" "}
          <a
            href="/dashboards/admin/powerhub"
            className="underline hover:text-foreground"
          >
            Open Admin Linkage
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {data.sites.map((site) => (
        <div
          key={site.id}
          className="rounded-xl border border-t-border bg-surface p-4 shadow-card"
        >
          <div className="flex items-start justify-between mb-3 gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-semibold text-foreground">
                  {site.siteName}
                </h3>
                {site.isPrimary && (
                  <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                    Primary
                  </span>
                )}
                <StatusBadge status={site.status} />
              </div>
              <p className="text-xs text-muted mt-1 truncate">
                {site.siteId}
              </p>
            </div>
            <PowerhubLink
              url={site.portalUrl}
              siteName={site.siteName}
              variant="button"
            />
          </div>

          {site.snapshot && (
            <div className="grid grid-cols-3 gap-3 mb-3">
              <SnapshotStat
                label="Solar"
                value={formatPower(site.snapshot.solarPowerW)}
              />
              <SnapshotStat
                label="Battery"
                value={
                  site.snapshot.batterySocPercent != null
                    ? `${site.snapshot.batterySocPercent.toFixed(0)}%`
                    : "—"
                }
              />
              <SnapshotStat
                label="Grid"
                value={site.snapshot.gridConnectedStatus ?? "—"}
              />
            </div>
          )}

          {site.activeAlerts.length > 0 && (
            <div className="border-t border-t-border pt-3">
              <h4 className="text-xs font-medium text-muted mb-2 uppercase tracking-wide">
                Active Alerts ({site.activeAlerts.length})
              </h4>
              <ul className="space-y-1">
                {site.activeAlerts.map((alert) => (
                  <li
                    key={alert.id}
                    className="flex items-center justify-between text-sm gap-2"
                  >
                    <span className="text-foreground truncate">
                      {alert.alertName}
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded shrink-0 ${SEVERITY_BADGE[alert.severity] ?? ""}`}
                    >
                      {alert.severity}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs text-muted mt-3">
            {site.lastTelemetryAt
              ? `Synced ${formatRelativeTime(site.lastTelemetryAt)}`
              : "Never synced"}
          </p>
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: "ACTIVE" | "OFFLINE" | "ERROR" }) {
  const color =
    status === "ACTIVE"
      ? "bg-green-500"
      : status === "OFFLINE"
        ? "bg-gray-400"
        : "bg-red-500";
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${color}`}
      title={status}
      aria-label={`Status: ${status}`}
    />
  );
}

function SnapshotStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="text-xs text-muted uppercase tracking-wide">
        {label}
      </div>
      <div className="text-base font-medium text-foreground">{value}</div>
    </div>
  );
}

function formatPower(w: number | null): string {
  if (w == null) return "—";
  if (Math.abs(w) >= 1000) return `${(w / 1000).toFixed(1)} kW`;
  return `${w.toFixed(0)} W`;
}

// Simple relative-time formatter; date-fns isn't used in this codebase
function formatRelativeTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
