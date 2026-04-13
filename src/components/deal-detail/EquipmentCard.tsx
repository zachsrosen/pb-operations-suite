import type { SerializedDeal } from "./types";

interface EquipmentCardProps {
  deal: SerializedDeal;
}

function EquipmentRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="text-[9px] uppercase tracking-wider text-muted">{label}</span>
      <span className="text-xs text-foreground">{value}</span>
    </div>
  );
}

export default function EquipmentCard({ deal }: EquipmentCardProps) {
  const moduleLine = deal.moduleBrand && deal.moduleModel
    ? `${deal.moduleBrand} ${deal.moduleModel}${deal.moduleCount ? ` (×${deal.moduleCount})` : ""}`
    : "—";

  const inverterLine = deal.inverterBrand && deal.inverterModel
    ? `${deal.inverterBrand} ${deal.inverterModel}${deal["inverterQty"] ? ` (×${deal["inverterQty"]})` : ""}`
    : "—";

  const batteryLine = deal.batteryBrand && deal.batteryModel
    ? `${deal.batteryBrand} ${deal.batteryModel}${deal["batteryCount"] ? ` (×${deal["batteryCount"]})` : ""}`
    : "—";

  const batteryExpCount = deal["batteryExpansionCount"] as number | null;
  const batteryExpModel = deal["batteryExpansionModel"] as string | null;
  const showBatteryExp = batteryExpCount != null && batteryExpCount > 0;

  const evCount = deal["evCount"] as number | null;

  const dcSize = deal["systemSizeKwdc"] as number | null;
  const acSize = deal["systemSizeKwac"] as number | null;
  const sizeStr = dcSize != null || acSize != null
    ? `${dcSize != null ? `${dcSize.toFixed(1)} kW DC` : "—"} / ${acSize != null ? `${acSize.toFixed(1)} kW AC` : "—"}`
    : "—";

  return (
    <div className="rounded-lg border border-t-border bg-surface-2/30 p-3">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
        Equipment
      </h3>
      <div className="space-y-0.5">
        <EquipmentRow label="Module" value={moduleLine} />
        <EquipmentRow label="Inverter" value={inverterLine} />
        <EquipmentRow label="Battery" value={batteryLine} />
        {showBatteryExp && (
          <EquipmentRow
            label="Battery Exp."
            value={`${batteryExpModel || "—"} (×${batteryExpCount})`}
          />
        )}
        <EquipmentRow label="EV Charger" value={evCount ? `×${evCount}` : "—"} />
        <EquipmentRow label="System Size" value={sizeStr} />
      </div>
    </div>
  );
}
