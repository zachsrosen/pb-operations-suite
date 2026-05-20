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
            <>
              {/* Row 1: Instantaneous power flows */}
              <div className="grid grid-cols-4 gap-3 mb-3">
                <SnapshotStat
                  label="Solar"
                  value={formatPowerSigned(site.snapshot.solarPowerW)}
                  arrow={site.snapshot.solarPowerW != null && site.snapshot.solarPowerW > 0 ? "up" : null}
                  arrowColor="green"
                />
                <SnapshotStat
                  label="Battery"
                  value={formatBatteryPower(site.snapshot.batteryPowerW)}
                  subtitle={
                    site.snapshot.batterySocPercent != null
                      ? `${site.snapshot.batterySocPercent.toFixed(1)}%`
                      : undefined
                  }
                  arrow={
                    site.snapshot.batteryPowerW == null
                      ? null
                      : site.snapshot.batteryPowerW > 50
                        ? "up"
                        : site.snapshot.batteryPowerW < -50
                          ? "down"
                          : null
                  }
                  arrowColor={(site.snapshot.batteryPowerW ?? 0) > 50 ? "amber" : "blue"}
                />
                <SnapshotStat
                  label="Grid"
                  value={formatPowerSigned(site.snapshot.gridPowerW)}
                  subtitle={
                    site.snapshot.gridConnectedStatus === "0"
                      ? "Islanded"
                      : site.snapshot.gridConnectedStatus === "1"
                        ? "Connected"
                        : undefined
                  }
                  arrow={
                    site.snapshot.gridPowerW == null
                      ? null
                      : site.snapshot.gridPowerW > 50
                        ? "down"
                        : site.snapshot.gridPowerW < -50
                          ? "up"
                          : null
                  }
                  arrowColor={(site.snapshot.gridPowerW ?? 0) < -50 ? "green" : "red"}
                />
                <SnapshotStat
                  label="Load"
                  value={formatPower(site.snapshot.loadPowerW)}
                  subtitle="Home"
                />
              </div>

              {/* Row 2: Battery + equipment + reserve context */}
              <div className="grid grid-cols-4 gap-3 mb-3 text-xs text-muted">
                <div>
                  <span className="font-medium text-foreground">Battery: </span>
                  {formatEnergyKwh(site.snapshot.batteryEnergyRemainingWh)} /{" "}
                  {formatEnergyKwh(
                    site.snapshot.batteryNominalCapacityWh ??
                      site.equipment.batteryCapacityWh,
                  )}
                  {site.equipment.batteryCount > 1 &&
                    ` (${site.equipment.batteryCount}×)`}
                </div>
                <div>
                  <span className="font-medium text-foreground">Mode: </span>
                  {formatBatteryMode(site.snapshot.batteryMode)}
                </div>
                <div>
                  <span className="font-medium text-foreground">Reserve: </span>
                  {site.snapshot.backupReservePercent != null
                    ? `${site.snapshot.backupReservePercent.toFixed(0)}%`
                    : "—"}
                </div>
                <div>
                  <span className="font-medium text-foreground">Equipment: </span>
                  {site.equipment.gatewayCount}× GW · {site.equipment.batteryCount}× PW · {site.equipment.inverterCount}× INV
                </div>
              </div>

              {/* Row 3: Critical condition flags — only show if any are set */}
              {hasAnyFlag(site.snapshot) && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {site.snapshot.batteryFault && <FlagBadge tone="red">Battery Fault</FlagBadge>}
                  {site.snapshot.systemShutdown && <FlagBadge tone="red">System Shutdown</FlagBadge>}
                  {site.snapshot.loadsDropped && <FlagBadge tone="red">Loads Dropped</FlagBadge>}
                  {site.snapshot.islanderDisconnected && <FlagBadge tone="red">Islander Disconnected</FlagBadge>}
                  {site.snapshot.breakerOpenStatus && <FlagBadge tone="amber">Breaker Open</FlagBadge>}
                  {site.snapshot.islandMode && site.snapshot.islandMode !== "0" && <FlagBadge tone="amber">Island Mode {site.snapshot.islandMode}</FlagBadge>}
                  {site.snapshot.waitForUserLowSoe && <FlagBadge tone="amber">Waiting: Low SoE</FlagBadge>}
                  {site.snapshot.waitForUserManualBackup && <FlagBadge tone="amber">Waiting: Manual Backup</FlagBadge>}
                  {site.snapshot.waitForUserNoInverters && <FlagBadge tone="amber">Waiting: No Inverters</FlagBadge>}
                  {site.snapshot.waitForUserRetriesDone && <FlagBadge tone="red">Waiting: Retries Exhausted</FlagBadge>}
                  {site.snapshot.offGridFaultState && site.snapshot.offGridFaultState !== "0" && (
                    <FlagBadge tone="amber">Off-Grid Fault: {site.snapshot.offGridFaultState}</FlagBadge>
                  )}
                </div>
              )}

              {/* Row 4: Comms health badges */}
              {hasAnyComms(site.snapshot) && (
                <div className="flex flex-wrap items-center gap-3 mb-3 text-xs">
                  <span className="text-muted uppercase tracking-wide font-medium">Comms:</span>
                  <CommsBadge label="Battery" ok={site.snapshot.commsBattery} />
                  <CommsBadge label="Battery Meter" ok={site.snapshot.commsBatteryMeter} />
                  <CommsBadge label="Site Meter" ok={site.snapshot.commsSiteMeter} />
                  <CommsBadge label="Solar Meter" ok={site.snapshot.commsSolarMeter} />
                </div>
              )}

              {/* Row 5: Grid quality strip */}
              {(site.snapshot.voltageV != null || site.snapshot.frequencyHz != null) && (
                <div className="grid grid-cols-4 gap-3 mb-3 text-xs text-muted">
                  <MiniField label="Voltage" value={site.snapshot.voltageV != null ? `${site.snapshot.voltageV.toFixed(1)} V` : "—"} />
                  <MiniField label="Grid V" value={site.snapshot.gridVoltageV != null ? `${site.snapshot.gridVoltageV.toFixed(1)} V` : "—"} />
                  <MiniField label="Frequency" value={site.snapshot.frequencyHz != null ? `${site.snapshot.frequencyHz.toFixed(2)} Hz` : "—"} />
                  <MiniField label="Chassis V" value={site.snapshot.chassisVoltageV != null ? `${site.snapshot.chassisVoltageV.toFixed(1)} V` : "—"} />
                </div>
              )}

              {/* Row 6: VPP / Grid Services — only show if site has participated */}
              {site.snapshot.gridServicesPowerW != null && (
                <div className="grid grid-cols-3 gap-3 mb-3 text-xs text-muted">
                  <MiniField label="VPP Power" value={formatPower(site.snapshot.gridServicesPowerW)} />
                  <MiniField label="VPP In (lifetime)" value={formatEnergyKwh(site.snapshot.gridServicesEnergyInLifetimeWh)} />
                  <MiniField label="VPP Out (lifetime)" value={formatEnergyKwh(site.snapshot.gridServicesEnergyOutLifetimeWh)} />
                </div>
              )}

              {/* Row 7: Lifetime energy flow attribution */}
              <details className="mb-3 group">
                <summary className="cursor-pointer text-xs text-muted hover:text-foreground select-none">
                  Show lifetime energy + control details ↓
                </summary>
                <div className="mt-2 grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                  <MiniField label="Solar → Load (life)" value={formatEnergyKwh(site.snapshot.solarToLoadEnergyLifetimeWh)} />
                  <MiniField label="Solar → Battery (life)" value={formatEnergyKwh(site.snapshot.solarToBatteryEnergyLifetimeWh)} />
                  <MiniField label="Battery → Load (life)" value={formatEnergyKwh(site.snapshot.batteryToLoadEnergyLifetimeWh)} />
                  <MiniField label="Grid Imported (life)" value={formatEnergyKwh(site.snapshot.gridEnergyImportedLifetimeWh)} />
                  <MiniField label="Grid Exported (life)" value={formatEnergyKwh(site.snapshot.gridEnergyExportedLifetimeWh)} />
                  <MiniField label="Load Imported (life)" value={formatEnergyKwh(site.snapshot.loadEnergyImportedLifetimeWh)} />
                  <MiniField label="Battery Max Charge" value={formatPower(site.snapshot.batteryMaxChargeW)} />
                  <MiniField label="Battery Max Discharge" value={formatPower(site.snapshot.batteryMaxDischargeW)} />
                  <MiniField label="Battery Target" value={formatPower(site.snapshot.batteryTargetPowerW)} />
                  <MiniField label="Next-Period Forecast" value={formatPower(site.snapshot.estimatedBatteryNextPeriodW)} />
                  <MiniField label="Solar Curtailment" value={formatPower(site.snapshot.solarRealPowerLimitW)} />
                  <MiniField label="Opticaster Reason" value={site.snapshot.opticasterReasonCode ?? "—"} />
                  {site.snapshot.energyBuyPrice != null && (
                    <MiniField label="Buy Price" value={`$${site.snapshot.energyBuyPrice.toFixed(3)}/kWh`} />
                  )}
                  {site.snapshot.energySellPrice != null && (
                    <MiniField label="Sell Price" value={`$${site.snapshot.energySellPrice.toFixed(3)}/kWh`} />
                  )}
                  {site.snapshot.isPrimaryGateway != null && (
                    <MiniField label="Primary Gateway" value={site.snapshot.isPrimaryGateway ? "Yes" : "No"} />
                  )}
                </div>
              </details>
            </>
          )}

          {site.activeAlerts.length > 0 && (
            <div className="border-t border-t-border pt-3">
              <h4 className="text-xs font-medium text-muted mb-2 uppercase tracking-wide">
                Active Alerts ({site.activeAlerts.length})
              </h4>
              <ul className="space-y-2">
                {site.activeAlerts.map((alert) => (
                  <li
                    key={alert.id}
                    className="flex items-start justify-between text-sm gap-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-foreground truncate font-medium">
                          {alert.alertName}
                        </span>
                        <span
                          className={`text-xs px-2 py-0.5 rounded shrink-0 ${SEVERITY_BADGE[alert.severity] ?? ""}`}
                        >
                          {alert.severity}
                        </span>
                      </div>
                      {(alert.ecuSerial || alert.bcSerial) && (
                        <div className="text-xs text-muted mt-0.5 font-mono">
                          {alert.ecuSerial && <span>ECU: {alert.ecuSerial}</span>}
                          {alert.ecuSerial && alert.bcSerial && <span> · </span>}
                          {alert.bcSerial && <span>BC: {alert.bcSerial}</span>}
                        </div>
                      )}
                    </div>
                    {alert.supportAutoTicketUrl && (
                      <a
                        href={alert.supportAutoTicketUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs px-2 py-0.5 rounded bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 shrink-0 whitespace-nowrap"
                      >
                        Tesla Ticket ↗
                      </a>
                    )}
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

type Snap = NonNullable<
  import("@/lib/property-hub").MonitoringSitePayload["snapshot"]
>;

function hasAnyFlag(s: Snap): boolean {
  return Boolean(
    s.batteryFault ||
      s.systemShutdown ||
      s.loadsDropped ||
      s.islanderDisconnected ||
      s.breakerOpenStatus ||
      (s.islandMode && s.islandMode !== "0") ||
      s.waitForUserLowSoe ||
      s.waitForUserManualBackup ||
      s.waitForUserNoInverters ||
      s.waitForUserRetriesDone ||
      (s.offGridFaultState && s.offGridFaultState !== "0"),
  );
}

function hasAnyComms(s: Snap): boolean {
  return (
    s.commsBattery != null ||
    s.commsBatteryMeter != null ||
    s.commsSiteMeter != null ||
    s.commsSolarMeter != null
  );
}

function FlagBadge({ tone, children }: { tone: "red" | "amber" | "blue"; children: React.ReactNode }) {
  const color =
    tone === "red"
      ? "bg-red-500/15 text-red-400 border-red-500/30"
      : tone === "amber"
        ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
        : "bg-blue-500/15 text-blue-400 border-blue-500/30";
  return (
    <span className={`text-xs px-2 py-0.5 rounded border ${color}`}>{children}</span>
  );
}

function CommsBadge({ label, ok }: { label: string; ok: boolean | null }) {
  if (ok == null) return null;
  const dotClass = ok
    ? "bg-green-500"
    : "bg-red-500";
  const textClass = ok ? "text-foreground" : "text-red-400";
  return (
    <span className={`inline-flex items-center gap-1.5 ${textClass}`}>
      <span className={`h-2 w-2 rounded-full ${dotClass}`} aria-hidden="true" />
      {label}
    </span>
  );
}

function MiniField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="font-medium text-foreground">{label}: </span>
      <span>{value}</span>
    </div>
  );
}

function SnapshotStat({
  label,
  value,
  subtitle,
  arrow,
  arrowColor,
}: {
  label: string;
  value: string;
  subtitle?: string;
  arrow?: "up" | "down" | null;
  arrowColor?: "green" | "amber" | "blue" | "red";
}) {
  const colorClass =
    arrowColor === "green"
      ? "text-green-500"
      : arrowColor === "amber"
        ? "text-amber-500"
        : arrowColor === "blue"
          ? "text-blue-500"
          : arrowColor === "red"
            ? "text-red-500"
            : "text-muted";
  return (
    <div className="text-center">
      <div className="text-xs text-muted uppercase tracking-wide">{label}</div>
      <div className="text-base font-medium text-foreground flex items-center justify-center gap-1">
        {arrow && (
          <span className={colorClass} aria-hidden="true">
            {arrow === "up" ? "↑" : "↓"}
          </span>
        )}
        <span>{value}</span>
      </div>
      {subtitle && <div className="text-xs text-muted mt-0.5">{subtitle}</div>}
    </div>
  );
}

/** Unsigned power (always positive value). */
function formatPower(w: number | null): string {
  if (w == null) return "—";
  if (Math.abs(w) >= 1000) return `${(w / 1000).toFixed(1)} kW`;
  return `${w.toFixed(0)} W`;
}

/** Signed power (preserves sign for direction; magnitude shown). */
function formatPowerSigned(w: number | null): string {
  return formatPower(w == null ? null : Math.abs(w));
}

/** Battery: shows charge/discharge magnitude or "Idle". */
function formatBatteryPower(w: number | null): string {
  if (w == null) return "—";
  if (Math.abs(w) < 50) return "Idle";
  return formatPower(Math.abs(w));
}

function formatEnergyKwh(wh: number | null): string {
  if (wh == null) return "—";
  return `${(wh / 1000).toFixed(1)} kWh`;
}

/** command_real_mode → human-readable. Codes from Tesla GridLogic. */
function formatBatteryMode(code: string | null): string {
  if (code == null) return "—";
  const map: Record<string, string> = {
    "0": "Standby",
    "1": "Backup",
    "2": "Self-Consume",
    "3": "Time-of-Use",
    "4": "Autonomous",
    "5": "Sell to Grid",
    "6": "Site Master",
    "7": "Self-Powered",
    "8": "Backup Reserve",
    "9": "Off-Grid",
  };
  return map[code] ?? `Mode ${code}`;
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
