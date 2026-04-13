import type { SerializedDeal } from "./types";

interface EquipmentCardProps {
  deal: SerializedDeal;
}

function EquipmentRow({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string | null;
}) {
  return (
    <div className="py-0.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[9px] uppercase tracking-wider text-muted">{label}</span>
        <span className="text-xs text-foreground">{value}</span>
      </div>
      {detail && (
        <div className="text-right text-[9px] text-muted">{detail}</div>
      )}
    </div>
  );
}

export default function EquipmentCard({ deal }: EquipmentCardProps) {
  const moduleWattage = deal["moduleWattage"] as number | null;
  const moduleLine = deal.moduleBrand && deal.moduleModel
    ? `${deal.moduleBrand} ${deal.moduleModel}${deal.moduleCount ? ` (×${deal.moduleCount})` : ""}`
    : "—";
  const moduleDetail = moduleWattage ? `${moduleWattage}W per panel` : null;

  const inverterSizeKwac = deal["inverterSizeKwac"] as number | null;
  const inverterLine = deal.inverterBrand && deal.inverterModel
    ? `${deal.inverterBrand} ${deal.inverterModel}${deal["inverterQty"] ? ` (×${deal["inverterQty"]})` : ""}`
    : "—";
  const inverterDetail = inverterSizeKwac ? `${inverterSizeKwac.toFixed(1)} kW AC` : null;

  const batterySizeKwh = deal["batterySizeKwh"] as number | null;
  const batteryLine = deal.batteryBrand && deal.batteryModel
    ? `${deal.batteryBrand} ${deal.batteryModel}${deal["batteryCount"] ? ` (×${deal["batteryCount"]})` : ""}`
    : "—";
  const batteryDetail = batterySizeKwh ? `${batterySizeKwh.toFixed(1)} kWh` : null;

  const batteryExpCount = deal["batteryExpansionCount"] as number | null;
  const batteryExpModel = deal["batteryExpansionModel"] as string | null;
  const batteryExpName = deal["batteryExpansionName"] as string | null;
  const showBatteryExp = batteryExpCount != null && batteryExpCount > 0;
  const batteryExpLine = batteryExpName || batteryExpModel || "—";

  const evCount = deal["evCount"] as number | null;

  const dcSize = deal["systemSizeKwdc"] as number | null;
  const acSize = deal["systemSizeKwac"] as number | null;
  const sizeStr = dcSize != null || acSize != null
    ? `${dcSize != null ? `${dcSize.toFixed(1)} kW DC` : "—"} / ${acSize != null ? `${acSize.toFixed(1)} kW AC` : "—"}`
    : "—";

  // Calculate total wattage if we have module info
  const totalWattage = moduleWattage && deal.moduleCount
    ? `${((moduleWattage * (deal.moduleCount as number)) / 1000).toFixed(1)} kW total`
    : null;

  return (
    <div className="rounded-lg border border-t-border bg-surface-2/30 p-3">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
        Equipment
      </h3>
      <div className="space-y-0.5">
        <EquipmentRow label="Module" value={moduleLine} detail={moduleDetail} />
        <EquipmentRow label="Inverter" value={inverterLine} detail={inverterDetail} />
        <EquipmentRow label="Battery" value={batteryLine} detail={batteryDetail} />
        {showBatteryExp && (
          <EquipmentRow
            label="Battery Exp."
            value={`${batteryExpLine} (×${batteryExpCount})`}
          />
        )}
        {evCount != null && evCount > 0 && (
          <EquipmentRow label="EV Charger" value={`×${evCount}`} />
        )}
        <EquipmentRow label="System Size" value={sizeStr} detail={totalWattage} />
      </div>
    </div>
  );
}
