"use client";

import { useEffect, useState, useCallback } from "react";
import { useActivityTracking } from "@/hooks/useActivityTracking";

interface EquipmentProfile {
  name: string;
  watts?: number;
  acPower?: number;
  capacity?: number;
  power?: number;
  dcMaxInput?: number;
  [key: string]: unknown;
}

interface EquipmentData {
  builtIn: {
    panels: Record<string, EquipmentProfile>;
    inverters: Record<string, EquipmentProfile>;
    optimizers: Record<string, EquipmentProfile>;
    ess: Record<string, EquipmentProfile>;
  };
  custom: Array<{
    id: string;
    category: string;
    key: string;
    profile: EquipmentProfile;
  }>;
}

export interface EquipmentSelections {
  panelKey: string | null;
  inverterKey: string | null;
  essKey: string | null;
  optimizerKey: string | null;
}

interface StepEquipmentProps {
  initial: EquipmentSelections;
  onNext: (selections: EquipmentSelections) => void;
  onBack: () => void;
  saving: boolean;
}

function EquipmentCard({
  eqKey,
  profile,
  isCustom,
  isSelected,
  onSelect,
  spec,
}: {
  eqKey: string;
  profile: EquipmentProfile;
  isCustom: boolean;
  isSelected: boolean;
  onSelect: () => void;
  spec: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`text-left p-3 rounded-lg border transition-colors ${
        isSelected
          ? "border-orange-500/60 bg-orange-500/10"
          : "border-t-border bg-card hover:border-orange-500/30"
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground truncate">
            {profile.name}
          </p>
          <p className="text-xs text-muted mt-0.5">{spec}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          {isCustom && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/30">
              Custom
            </span>
          )}
          <div
            className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
              isSelected ? "border-orange-500" : "border-zinc-600"
            }`}
          >
            {isSelected && (
              <div className="w-2 h-2 rounded-full bg-orange-500" />
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

export default function StepEquipment({
  initial,
  onNext,
  onBack,
  saving,
}: StepEquipmentProps) {
  const [equipment, setEquipment] = useState<EquipmentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selections, setSelections] = useState<EquipmentSelections>(initial);
  const { trackFeature } = useActivityTracking();

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/solar/equipment");
        if (!res.ok) throw new Error(`Failed to load equipment (${res.status})`);
        const json = await res.json();
        setEquipment(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const select = useCallback(
    (
      category: keyof EquipmentSelections,
      key: string | null,
      source: "built_in" | "custom"
    ) => {
      setSelections((prev) => ({ ...prev, [category]: key }));
      trackFeature("solar_equipment_selected", undefined, {
        category,
        key,
        source,
      });
    },
    [trackFeature]
  );

  const canProceed = selections.panelKey && selections.inverterKey;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin h-6 w-6 border-2 border-orange-500 border-t-transparent rounded-full" />
        <span className="ml-3 text-sm text-muted">Loading equipment...</span>
      </div>
    );
  }

  if (error || !equipment) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
        <p className="text-sm text-red-400">{error ?? "Failed to load"}</p>
      </div>
    );
  }

  const { builtIn, custom } = equipment;

  const customPanels = custom.filter((c) => c.category === "PANEL");
  const customInverters = custom.filter((c) => c.category === "INVERTER");
  const customEss = custom.filter((c) => c.category === "ESS");
  const customOptimizers = custom.filter((c) => c.category === "OPTIMIZER");

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Equipment</h2>
        <p className="text-sm text-muted mt-1">
          Select panel and inverter (required). ESS and optimizer are optional.
        </p>
      </div>

      {/* Panels */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">
          Panels <span className="text-red-400">*</span>
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {Object.entries(builtIn.panels).map(([key, profile]) => (
            <EquipmentCard
              key={key}
              eqKey={key}
              profile={profile}
              isCustom={false}
              isSelected={selections.panelKey === key}
              onSelect={() => select("panelKey", key, "built_in")}
              spec={`${profile.watts}W | ${profile.cells} cells`}
            />
          ))}
          {customPanels.map((c) => (
            <EquipmentCard
              key={c.key}
              eqKey={c.key}
              profile={c.profile}
              isCustom
              isSelected={selections.panelKey === c.key}
              onSelect={() => select("panelKey", c.key, "custom")}
              spec={`${c.profile.watts ?? "?"}W`}
            />
          ))}
        </div>
      </section>

      {/* Inverters */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">
          Inverters <span className="text-red-400">*</span>
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {Object.entries(builtIn.inverters).map(([key, profile]) => (
            <EquipmentCard
              key={key}
              eqKey={key}
              profile={profile}
              isCustom={false}
              isSelected={selections.inverterKey === key}
              onSelect={() => select("inverterKey", key, "built_in")}
              spec={`${((profile.acPower ?? 0) / 1000).toFixed(1)}kW | ${profile.channels ?? "?"} MPPT`}
            />
          ))}
          {customInverters.map((c) => (
            <EquipmentCard
              key={c.key}
              eqKey={c.key}
              profile={c.profile}
              isCustom
              isSelected={selections.inverterKey === c.key}
              onSelect={() => select("inverterKey", c.key, "custom")}
              spec={`${((c.profile.acPower ?? 0) / 1000).toFixed(1)}kW`}
            />
          ))}
        </div>
      </section>

      {/* ESS (optional) */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-foreground">
            ESS{" "}
            <span className="text-muted/50 font-normal text-xs">
              (optional)
            </span>
          </h3>
          {selections.essKey && (
            <button
              type="button"
              onClick={() => select("essKey", null, "built_in")}
              className="text-[11px] text-muted hover:text-red-400 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {Object.entries(builtIn.ess).map(([key, profile]) => (
            <EquipmentCard
              key={key}
              eqKey={key}
              profile={profile}
              isCustom={false}
              isSelected={selections.essKey === key}
              onSelect={() => select("essKey", key, "built_in")}
              spec={`${profile.capacity ?? "?"}kWh | ${profile.power ?? "?"}kW`}
            />
          ))}
          {customEss.map((c) => (
            <EquipmentCard
              key={c.key}
              eqKey={c.key}
              profile={c.profile}
              isCustom
              isSelected={selections.essKey === c.key}
              onSelect={() => select("essKey", c.key, "custom")}
              spec={`${c.profile.capacity ?? "?"}kWh`}
            />
          ))}
        </div>
      </section>

      {/* Optimizers (optional) */}
      {(Object.keys(builtIn.optimizers).length > 0 ||
        customOptimizers.length > 0) && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-foreground">
              Optimizers{" "}
              <span className="text-muted/50 font-normal text-xs">
                (optional)
              </span>
            </h3>
            {selections.optimizerKey && (
              <button
                type="button"
                onClick={() => select("optimizerKey", null, "built_in")}
                className="text-[11px] text-muted hover:text-red-400 transition-colors"
              >
                Clear
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {Object.entries(builtIn.optimizers).map(([key, profile]) => (
              <EquipmentCard
                key={key}
                eqKey={key}
                profile={profile}
                isCustom={false}
                isSelected={selections.optimizerKey === key}
                onSelect={() => select("optimizerKey", key, "built_in")}
                spec={`${profile.dcMaxInput ?? "?"}W max`}
              />
            ))}
            {customOptimizers.map((c) => (
              <EquipmentCard
                key={c.key}
                eqKey={c.key}
                profile={c.profile}
                isCustom
                isSelected={selections.optimizerKey === c.key}
                onSelect={() => select("optimizerKey", c.key, "custom")}
                spec={`${c.profile.dcMaxInput ?? "?"}W max`}
              />
            ))}
          </div>
        </section>
      )}

      <div className="flex items-center justify-between pt-4 border-t border-t-border">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-muted hover:text-foreground transition-colors"
        >
          &larr; Back
        </button>
        <button
          type="button"
          onClick={() => canProceed && onNext(selections)}
          disabled={!canProceed || saving}
          className="px-4 py-2 rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-sm font-medium"
        >
          {saving ? "Saving..." : "Next: Shade Source"}
        </button>
      </div>
    </div>
  );
}
