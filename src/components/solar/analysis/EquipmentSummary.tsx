/**
 * Equipment Summary Card
 *
 * Shows panel, inverter, optimizer, and battery details
 * resolved from the equipment catalog keys stored on the project.
 */

"use client";

import {
  getBuiltInEquipment,
  type BuiltInPanel,
  type BuiltInInverter,
  type BuiltInOptimizer,
  type BuiltInEss,
} from "@/lib/solar/equipment-catalog";

interface EquipmentSummaryProps {
  equipmentConfig: Record<string, unknown> | null;
}

function Spec({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-muted">{label}</span>
      <span className="text-foreground font-medium">{value}</span>
    </div>
  );
}

export default function EquipmentSummary({ equipmentConfig }: EquipmentSummaryProps) {
  if (!equipmentConfig) return null;

  const catalog = getBuiltInEquipment();

  const panelKey = equipmentConfig.panelKey as string | undefined;
  const inverterKey = equipmentConfig.inverterKey as string | undefined;
  const optimizerKey = equipmentConfig.optimizerKey as string | undefined;
  const essKey = equipmentConfig.essKey as string | undefined;

  const panel: BuiltInPanel | null = panelKey ? catalog.panels[panelKey] ?? null : null;
  const inverter: BuiltInInverter | null = inverterKey ? catalog.inverters[inverterKey] ?? null : null;
  const optimizer: BuiltInOptimizer | null =
    optimizerKey && optimizerKey !== "None" ? catalog.optimizers[optimizerKey] ?? null : null;
  const ess: BuiltInEss | null =
    essKey && essKey !== "None" ? catalog.ess[essKey] ?? null : null;

  if (!panel && !inverter) return null;

  return (
    <div className="rounded-lg border border-t-border bg-card p-4 space-y-4">
      <h3 className="text-sm font-medium text-foreground">Equipment Configuration</h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Panel */}
        {panel && (
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-orange-400 uppercase tracking-wider">Panel</div>
            <div className="text-sm text-foreground font-medium">{panel.name}</div>
            <div className="space-y-0.5">
              <Spec label="Power" value={`${panel.watts}W`} />
              <Spec label="Voc" value={`${panel.voc}V`} />
              <Spec label="Vmp" value={`${panel.vmp}V`} />
              <Spec label="Isc" value={`${panel.isc}A`} />
              <Spec label="Imp" value={`${panel.imp}A`} />
              <Spec label="Cells" value={panel.cells} />
              {panel.isBifacial && (
                <Spec label="Bifacial" value={`${((panel.bifacialityFactor ?? 0) * 100).toFixed(0)}% factor`} />
              )}
            </div>
          </div>
        )}

        {/* Inverter */}
        {inverter && (
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-blue-400 uppercase tracking-wider">Inverter</div>
            <div className="text-sm text-foreground font-medium">{inverter.name}</div>
            <div className="space-y-0.5">
              <Spec label="AC Power" value={`${(inverter.acPower / 1000).toFixed(1)} kW`} />
              <Spec label="DC Max" value={`${(inverter.dcMax / 1000).toFixed(1)} kW`} />
              <Spec label="MPPT Range" value={`${inverter.mpptMin}–${inverter.mpptMax}V`} />
              <Spec label="Channels" value={inverter.channels} />
              <Spec label="Max Isc" value={`${inverter.maxIsc}A`} />
              <Spec label="Efficiency" value={`${(inverter.efficiency * 100).toFixed(1)}%`} />
              <Spec label="Architecture" value={inverter.architectureType} />
            </div>
          </div>
        )}

        {/* Optimizer */}
        {optimizer && (
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-purple-400 uppercase tracking-wider">Optimizer</div>
            <div className="text-sm text-foreground font-medium">{optimizer.name}</div>
            <div className="space-y-0.5">
              <Spec label="DC Max Input" value={`${optimizer.dcMaxInput}W`} />
              <Spec label="Input Voltage" value={`${optimizer.inputVoltageMin}–${optimizer.inputVoltageMax}V`} />
              <Spec label="Output Voltage" value={`${optimizer.outputVoltageMin}–${optimizer.outputVoltageMax}V`} />
              <Spec label="Efficiency" value={`${(optimizer.weightedEfficiency * 100).toFixed(1)}%`} />
              <Spec label="Series" value={optimizer.series} />
            </div>
          </div>
        )}

        {/* ESS / Battery */}
        {ess && (
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-green-400 uppercase tracking-wider">Battery</div>
            <div className="text-sm text-foreground font-medium">{ess.name}</div>
            <div className="space-y-0.5">
              <Spec label="Capacity" value={`${ess.capacity} kWh`} />
              <Spec label="Power" value={`${ess.power} kW`} />
              <Spec label="Round-trip" value={`${(ess.roundTrip * 100).toFixed(0)}%`} />
              <Spec label="Type" value={ess.type.replace(/_/g, " ")} />
              {ess.expansionCapacity > 0 && (
                <Spec label="Expandable" value={`+${ess.expansionCapacity} kWh × ${ess.maxExpansions}`} />
              )}
            </div>
          </div>
        )}

        {/* No battery selected */}
        {!ess && (
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Battery</div>
            <div className="text-sm text-muted">None selected</div>
          </div>
        )}
      </div>
    </div>
  );
}
