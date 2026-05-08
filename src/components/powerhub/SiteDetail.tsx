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
  const deal = data?.deal;
  if (!site) return <div className="text-muted">No data</div>;

  const snapshot = site.telemetrySnapshot;
  const property = site.property;

  // Flatten device JSON object into a typed array
  const deviceObj =
    typeof site.devices === "object" && site.devices && !Array.isArray(site.devices)
      ? site.devices
      : {};
  const devices = [
    ...(deviceObj.gateways || []).map((d: any) => ({ ...d, device_type: "gateway" })),
    ...(deviceObj.batteries || []).map((d: any) => ({ ...d, device_type: "battery" })),
    ...(deviceObj.inverters || []).map((d: any) => ({ ...d, device_type: "inverter" })),
    ...(deviceObj.meters || []).map((d: any) => ({ ...d, device_type: "meter" })),
    ...(deviceObj.evse || []).map((d: any) => ({ ...d, device_type: "evse" })),
  ];

  // Resolve address: prefer property > deal > site fields
  const address =
    property?.fullAddress ||
    (deal?.address ? `${deal.address}, ${deal.city || ""} ${deal.state || ""}`.trim() : null) ||
    (site.address ? `${site.address}, ${site.city || ""} ${site.state || ""}`.trim() : null);

  return (
    <div className="space-y-5">
      {/* ── Header: Address + Link Status ───────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-foreground">{site.siteName}</h3>
          {address && address !== ", " ? (
            <div className="text-sm text-muted mt-0.5">{address}</div>
          ) : (
            <div className="text-sm text-yellow-500 mt-0.5">No address linked</div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <LinkBadge method={site.linkMethod} confidence={site.linkConfidence} />
          <StatusBadge status={site.status} />
        </div>
      </div>

      {/* ── System Summary ──────────────────────────────────────── */}
      <Section title="System Details">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricBox
            label="System Size"
            value={
              deal?.systemSizeKw
                ? `${deal.systemSizeKw} kW`
                : property?.systemSizeKwDc
                  ? `${property.systemSizeKwDc} kW`
                  : "—"
            }
          />
          <MetricBox
            label="Battery Capacity"
            value={
              site.totalBatteryEnergy
                ? `${(site.totalBatteryEnergy / 1000).toFixed(1)} kWh`
                : "—"
            }
          />
          <MetricBox
            label="Gateways"
            value={String(site.totalGateways || 0)}
          />
          <MetricBox
            label="Inverters"
            value={String(site.totalInverters || 0)}
          />
          <MetricBox
            label="Batteries"
            value={String(site.totalBatteries || 0)}
          />
          <MetricBox
            label="Modules"
            value={deal?.moduleCount ? String(deal.moduleCount) : "—"}
          />
          <MetricBox
            label="AHJ"
            value={property?.ahjName || "—"}
          />
          <MetricBox
            label="Utility"
            value={property?.utilityName || "—"}
          />
        </div>
      </Section>

      {/* ── Live Telemetry ──────────────────────────────────────── */}
      {snapshot && (
        <Section title="Live Telemetry">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricBox label="Solar" value={formatPower(snapshot.solarPowerW)} />
            <MetricBox label="Battery SOC" value={formatPercent(snapshot.batterySocPercent)} />
            <MetricBox label="Grid" value={formatPower(snapshot.gridPowerW)} />
            <MetricBox label="Load" value={formatPower(snapshot.loadPowerW)} />
            <MetricBox label="Battery Mode" value={snapshot.batteryMode || "—"} />
            <MetricBox label="Grid Status" value={snapshot.gridConnectedStatus || "—"} />
          </div>
        </Section>
      )}

      {/* ── HubSpot Deal ────────────────────────────────────────── */}
      {deal && (
        <Section title="HubSpot Deal">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <MetricBox label="Deal" value={deal.dealName || "—"} />
            <MetricBox label="Stage" value={formatStage(deal.stage)} />
            <MetricBox label="Location" value={deal.pbLocation || "—"} />
            {deal.customerName && (
              <MetricBox label="Customer" value={deal.customerName} />
            )}
            {deal.customerEmail && (
              <MetricBox label="Email" value={deal.customerEmail} />
            )}
            {deal.customerPhone && (
              <MetricBox label="Phone" value={deal.customerPhone} />
            )}
          </div>
        </Section>
      )}

      {/* ── Property ────────────────────────────────────────────── */}
      {property && (
        <Section title="Property">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricBox label="Address" value={property.fullAddress || "—"} />
            <MetricBox
              label="Install Date"
              value={property.mostRecentInstallDate ? formatDate(property.mostRecentInstallDate) : "—"}
            />
            <MetricBox
              label="Warranty Expiry"
              value={property.earliestWarrantyExpiry ? formatDate(property.earliestWarrantyExpiry) : "—"}
            />
            <MetricBox
              label="Open Tickets"
              value={String(property.openTicketsCount || 0)}
            />
            <MetricBox
              label="Has Battery"
              value={property.hasBattery ? "Yes" : "No"}
            />
            <MetricBox
              label="Has EV Charger"
              value={property.hasEvCharger ? "Yes" : "No"}
            />
            <MetricBox
              label="Total Deals"
              value={String(property.associatedDealsCount || 0)}
            />
            <MetricBox
              label="PB Location"
              value={property.pbLocation || "—"}
            />
          </div>

          {/* Property contacts */}
          {property.contactLinks?.length > 0 && (
            <div className="mt-3">
              <div className="text-xs text-muted mb-1">Contacts</div>
              <div className="flex flex-wrap gap-2">
                {property.contactLinks.map((link: any) => (
                  <span
                    key={`${link.contactId}-${link.label}`}
                    className="inline-flex items-center px-2 py-1 rounded bg-surface text-xs text-foreground"
                  >
                    <span className="text-muted mr-1">{link.label}:</span>
                    {link.contactId}
                  </span>
                ))}
              </div>
            </div>
          )}
        </Section>
      )}

      {/* ── No HubSpot Data Banner ──────────────────────────────── */}
      {!deal && !property && site.linkMethod === "UNLINKED" && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3 text-sm text-yellow-600 dark:text-yellow-400">
          This site is not linked to a HubSpot deal or property. Address linkage requires
          a matching street address in HubSpot, or manual admin linking via the fleet admin tools.
        </div>
      )}

      {/* ── Active Alerts ──────────────────────────────────────── */}
      {site.alerts?.length > 0 && (
        <Section title={`Active Alerts (${site.alerts.length})`}>
          <div className="space-y-1">
            {site.alerts.map((alert: any) => (
              <div
                key={alert.id}
                className="flex items-center gap-2 text-sm p-2 rounded bg-surface"
              >
                <SeverityBadge severity={alert.severity} />
                <span className="text-foreground">{alert.alertName}</span>
                <span className="text-muted text-xs ml-auto">
                  {alert.deviceId !== "site"
                    ? `Device: ${alert.deviceId?.slice(0, 8)}...`
                    : "Site-level"}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── Devices ────────────────────────────────────────────── */}
      {devices.length > 0 && (
        <Section title={`Devices (${devices.length})`}>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 text-xs">
            {devices.map((device: any, i: number) => (
              <div key={device.device_id || device.din || i} className="p-2 bg-surface rounded">
                <div className="font-medium capitalize">
                  {device.device_type?.replace("_", " ")}
                </div>
                <div className="text-muted truncate">
                  {device.part_number || device.din || device.serial_number || "—"}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

// ─── Helper Components ──────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-sm font-medium text-foreground mb-2">{title}</h4>
      {children}
    </div>
  );
}

function MetricBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-2 bg-surface rounded">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-sm font-medium text-foreground truncate" title={value}>
        {value}
      </div>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    CRITICAL: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    PERFORMANCE: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    INFORMATIONAL: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  };
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${colors[severity] || colors.INFORMATIONAL}`}
    >
      {severity}
    </span>
  );
}

function LinkBadge({ method, confidence }: { method: string; confidence: string }) {
  if (method === "UNLINKED") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
        Unlinked
      </span>
    );
  }
  const confColor =
    confidence === "HIGH"
      ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
      : confidence === "MEDIUM"
        ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
        : "bg-zinc-100 text-zinc-800 dark:bg-zinc-900/30 dark:text-zinc-400";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${confColor}`}>
      {method} ({confidence})
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "ACTIVE"
      ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
      : "bg-zinc-100 text-zinc-800 dark:bg-zinc-900/30 dark:text-zinc-400";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${color}`}>
      {status}
    </span>
  );
}

// ─── Formatters ─────────────────────────────────────────────────────────────

function formatPower(watts: number | null): string {
  if (watts == null) return "—";
  if (Math.abs(watts) >= 1000) return `${(watts / 1000).toFixed(1)} kW`;
  return `${Math.round(watts)} W`;
}

function formatPercent(pct: number | null): string {
  if (pct == null) return "—";
  return `${Math.round(pct)}%`;
}

function formatStage(stage: string | null): string {
  if (!stage) return "—";
  return stage
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}
