"use client";

import type { IdrItem } from "./IdrMeetingClient";
import { useState } from "react";

const ROOF_ADDER_KEYS = [
  "adderTileRoof",
  "adderMetalRoof",
  "adderFlatFoamRoof",
  "adderShakeRoof",
] as const;

const ROOF_LABELS: Record<(typeof ROOF_ADDER_KEYS)[number], string> = {
  adderTileRoof: "Tile roof",
  adderMetalRoof: "Metal roof",
  adderFlatFoamRoof: "Flat/foam",
  adderShakeRoof: "Shake",
};

const ROOF_OTHER = [
  { key: "adderSteepPitch" as const, label: "Steep pitch" },
  { key: "adderTwoStorey" as const, label: "2+ storey" },
];

const SITE_ADDERS = [
  { key: "adderTrenching" as const, label: "Trenching" },
  { key: "adderGroundMount" as const, label: "Ground mount" },
  { key: "adderMpuUpgrade" as const, label: "MPU / svc upgrade" },
  { key: "adderEvCharger" as const, label: "EV charger install" },
];

interface Props {
  item: IdrItem;
  onChange: (updates: Partial<IdrItem>) => void;
  readOnly: boolean;
}

export function AddersChecklist({ item, onChange, readOnly }: Props) {
  const [newName, setNewName] = useState("");
  const [newAmount, setNewAmount] = useState("");

  const handleRoofChange = (key: (typeof ROOF_ADDER_KEYS)[number], checked: boolean) => {
    const updates: Partial<IdrItem> = {};
    for (const k of ROOF_ADDER_KEYS) {
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
          {ROOF_ADDER_KEYS.map((key) => (
            <label key={key} className="flex items-center gap-1.5 text-xs text-foreground">
              <input
                type="checkbox"
                checked={item[key]}
                onChange={(e) => handleRoofChange(key, e.target.checked)}
                disabled={readOnly}
                className="accent-orange-500"
              />
              {ROOF_LABELS[key]}
            </label>
          ))}
          {ROOF_OTHER.map(({ key, label }) => (
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
