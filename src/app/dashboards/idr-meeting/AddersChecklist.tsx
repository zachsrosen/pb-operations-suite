"use client";

import type { IdrItem } from "./IdrMeetingClient";
import { useState } from "react";

const ROOF_ADDER_KEYS = [
  "adderTileRoof",
  "adderMetalRoof",
  "adderFlatFoamRoof",
  "adderShakeRoof",
] as const;

const ROOF_COSTS: Record<(typeof ROOF_ADDER_KEYS)[number], { label: string; perSystem: number; perWatt: number }> = {
  adderTileRoof:     { label: "Tile roof",  perSystem: 3500, perWatt: 0.80 },
  adderMetalRoof:    { label: "Metal roof", perSystem: 0,    perWatt: 0.35 },
  adderFlatFoamRoof: { label: "Flat/foam",  perSystem: 0,    perWatt: 0.35 },
  adderShakeRoof:    { label: "Shake",      perSystem: 0,    perWatt: 0.35 },
};

const ROOF_OTHER = [
  { key: "adderSteepPitch" as const, label: "Steep pitch", perWatt: 0.35 },
  { key: "adderTwoStorey" as const, label: "2+ storey", perWatt: 0.05 },
];

const SITE_ADDERS = [
  { key: "adderTrenching" as const, label: "Trenching" },
  { key: "adderGroundMount" as const, label: "Ground mount" },
  { key: "adderMpuUpgrade" as const, label: "MPU / svc upgrade" },
  { key: "adderEvCharger" as const, label: "EV charger install" },
];

const TIER_ADDER_KEYS = ["adderTier1", "adderTier2"] as const;

const TIER_LABELS: Record<(typeof TIER_ADDER_KEYS)[number], { label: string; pct: number }> = {
  adderTier1: { label: "Tier 1", pct: 15 },
  adderTier2: { label: "Tier 2", pct: 20 },
};

interface Props {
  item: IdrItem;
  onChange: (updates: Partial<IdrItem>) => void;
  readOnly: boolean;
}

function fmt(n: number): string {
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function fmtRate(perSystem: number, perWatt: number): string {
  const parts: string[] = [];
  if (perSystem > 0) parts.push(fmt(perSystem));
  if (perWatt > 0) parts.push(`$${perWatt}/W`);
  return parts.join(" + ");
}

export function AddersChecklist({ item, onChange, readOnly }: Props) {
  const [newName, setNewName] = useState("");
  const [newAmount, setNewAmount] = useState("");

  const watts = (item.systemSizeKw ?? 0) * 1000;

  const handleRoofChange = (key: (typeof ROOF_ADDER_KEYS)[number], checked: boolean) => {
    const updates: Partial<IdrItem> = {};
    for (const k of ROOF_ADDER_KEYS) {
      (updates as Record<string, boolean>)[k] = k === key ? checked : false;
    }
    onChange(updates);
  };

  const handleTierChange = (key: (typeof TIER_ADDER_KEYS)[number], checked: boolean) => {
    const updates: Partial<IdrItem> = {};
    for (const k of TIER_ADDER_KEYS) {
      (updates as Record<string, boolean>)[k] = k === key ? checked : false;
    }
    onChange(updates);
  };

  const handleBoolChange = (key: string, checked: boolean) => {
    onChange({ [key]: checked } as Partial<IdrItem>);
  };

  const customs = Array.isArray(item.customAdders) ? item.customAdders : [];

  const handleAddCustom = () => {
    const name = newName.trim();
    const amount = parseFloat(newAmount);
    if (!name || !isFinite(amount)) return;
    onChange({ customAdders: [...customs, { name, amount }] });
    setNewName("");
    setNewAmount("");
  };

  const handleRemoveCustom = (index: number) => {
    onChange({ customAdders: customs.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-3">
      {/* Roof */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1.5">Roof</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          {ROOF_ADDER_KEYS.map((key) => {
            const { label, perSystem, perWatt } = ROOF_COSTS[key];
            const hasCost = perSystem > 0 || perWatt > 0;
            const cost = watts > 0 ? perSystem + watts * perWatt : null;
            return (
              <label key={key} className="flex items-center gap-1.5 text-xs text-foreground">
                <input
                  type="checkbox"
                  checked={item[key]}
                  onChange={(e) => handleRoofChange(key, e.target.checked)}
                  disabled={readOnly}
                  className="accent-orange-500"
                />
                <span>
                  {label}
                  {hasCost && (
                    <span className="text-muted ml-1">
                      {cost != null ? fmt(cost) : fmtRate(perSystem, perWatt)}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
          {ROOF_OTHER.map(({ key, label, perWatt }) => {
            const cost = watts > 0 ? watts * perWatt : null;
            return (
              <label key={key} className="flex items-center gap-1.5 text-xs text-foreground">
                <input
                  type="checkbox"
                  checked={item[key]}
                  onChange={(e) => handleBoolChange(key, e.target.checked)}
                  disabled={readOnly}
                  className="accent-orange-500"
                />
                <span>
                  {label}
                  {perWatt > 0 && (
                    <span className="text-muted ml-1">
                      {cost != null ? fmt(cost) : `$${perWatt}/W`}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {/* Site */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1.5">Site</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          {SITE_ADDERS.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-1.5 text-xs text-foreground">
              <input
                type="checkbox"
                checked={item[key]}
                onChange={(e) => handleBoolChange(key, e.target.checked)}
                disabled={readOnly}
                className="accent-orange-500"
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      {/* Tier */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1.5">Tier Adders</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          {TIER_ADDER_KEYS.map((key) => {
            const { label, pct } = TIER_LABELS[key];
            const amt = item.dealAmount ? Math.round(item.dealAmount * (pct / 100)) : null;
            return (
              <label key={key} className="flex items-center gap-1.5 text-xs text-foreground">
                <input
                  type="checkbox"
                  checked={item[key]}
                  onChange={(e) => handleTierChange(key, e.target.checked)}
                  disabled={readOnly}
                  className="accent-orange-500"
                />
                <span>
                  {label} ({pct}%)
                  {amt != null && (
                    <span className="text-muted ml-1">
                      — ${amt.toLocaleString()}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
        {!item.dealAmount && (item.adderTier1 || item.adderTier2) && (
          <p className="text-[10px] text-yellow-400 mt-1">Deal amount unknown — tier amount will not be calculated</p>
        )}
      </div>

      {/* Custom */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1.5">Custom</p>
        {customs.length > 0 && (
          <div className="space-y-1 mb-2">
            {customs.map((c, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="text-foreground">{c.name}</span>
                <span className="text-muted ml-auto">${c.amount.toLocaleString()}</span>
                {!readOnly && (
                  <button
                    onClick={() => handleRemoveCustom(i)}
                    className="text-muted hover:text-foreground transition-colors"
                  >
                    x
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {!readOnly && (
          <div className="flex gap-1.5">
            <input
              type="text"
              placeholder="Adder name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="flex-1 rounded border border-t-border bg-surface-2 px-2 py-1 text-xs text-foreground placeholder:text-muted"
              maxLength={100}
            />
            <input
              type="number"
              placeholder="$"
              value={newAmount}
              onChange={(e) => setNewAmount(e.target.value)}
              className="w-16 rounded border border-t-border bg-surface-2 px-2 py-1 text-xs text-foreground placeholder:text-muted"
            />
            <button
              onClick={handleAddCustom}
              disabled={!newName.trim() || !newAmount}
              className="rounded bg-orange-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-orange-600 transition-colors disabled:opacity-50"
            >
              +
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
