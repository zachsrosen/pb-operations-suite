// src/components/property/PropertyEquipmentList.tsx
"use client";

import type { PropertyDetail } from "@/lib/property-detail";

interface Props {
  summary: PropertyDetail["equipmentSummary"];
  systemSizeKwDc: number | null;
  hasBattery: boolean;
  hasEvCharger: boolean;
}

interface StatProps {
  label: string;
  count: number;
  subtext?: string | null;
}

function Stat({ label, count, subtext }: StatProps) {
  return (
    <div className="bg-surface-2 rounded p-3">
      <div className="text-muted text-xs">{label}</div>
      <div className="text-foreground text-lg font-semibold">{count}</div>
      {subtext ? (
        <div className="text-muted text-xs mt-0.5">{subtext}</div>
      ) : null}
    </div>
  );
}

export default function PropertyEquipmentList({
  summary,
  systemSizeKwDc,
  hasBattery,
  hasEvCharger,
}: Props) {
  const moduleSubtext =
    summary.modules.totalWattage > 0
      ? `${(summary.modules.totalWattage / 1000).toFixed(2)} kW`
      : null;
  const batterySubtext =
    summary.batteries.totalKwh > 0
      ? `${summary.batteries.totalKwh.toFixed(2)} kWh`
      : null;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Stat
          label="Modules"
          count={summary.modules.count}
          subtext={moduleSubtext}
        />
        <Stat label="Inverters" count={summary.inverters.count} />
        <Stat
          label="Batteries"
          count={summary.batteries.count}
          subtext={batterySubtext}
        />
        <Stat label="EV Chargers" count={summary.evChargers.count} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">
          System size:{" "}
          <span className="text-foreground font-medium">
            {systemSizeKwDc != null ? `${systemSizeKwDc.toFixed(2)} kW DC` : "—"}
          </span>
        </span>
        {hasBattery ? (
          <span className="inline-flex items-center rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-xs font-semibold text-emerald-400 ring-1 ring-emerald-500/30">
            Battery
          </span>
        ) : null}
        {hasEvCharger ? (
          <span className="inline-flex items-center rounded-md bg-cyan-500/15 px-1.5 py-0.5 text-xs font-semibold text-cyan-400 ring-1 ring-cyan-500/30">
            EV Charger
          </span>
        ) : null}
      </div>
    </div>
  );
}
