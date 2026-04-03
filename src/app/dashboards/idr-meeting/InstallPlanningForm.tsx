"use client";

import { useCallback } from "react";
import type { IdrItem } from "./IdrMeetingClient";

interface Props {
  item: IdrItem;
  onChange: (updates: Partial<IdrItem>) => void;
  readOnly: boolean;
}

const OPTIONS_1_5 = [1, 2, 3, 4, 5];

export function InstallPlanningForm({ item, onChange, readOnly }: Props) {
  const handleSelect = useCallback(
    (field: keyof IdrItem, value: string) => {
      const n = value === "" ? null : parseInt(value, 10);
      onChange({ [field]: Number.isNaN(n) ? null : n } as Partial<IdrItem>);
    },
    [onChange],
  );

  const handleToggle = useCallback(
    (field: keyof IdrItem) => {
      onChange({ [field]: !(item[field] as boolean | null | undefined) } as Partial<IdrItem>);
    },
    [onChange, item],
  );

  const difficulty = item.difficulty ?? 0;
  const selectCls = "w-14 rounded border border-t-border bg-surface-2 px-1.5 py-1 text-xs text-foreground disabled:opacity-50";

  return (
    <div className="space-y-2">
      {/* Difficulty — full-width row with pips */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted w-16 shrink-0">Difficulty</span>
        <select
          value={item.difficulty ?? ""}
          onChange={(e) => handleSelect("difficulty", e.target.value)}
          disabled={readOnly}
          className={selectCls}
        >
          <option value="">—</option>
          {OPTIONS_1_5.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <div className="flex gap-0.5">
          {OPTIONS_1_5.map((n) => (
            <span
              key={n}
              className={`h-2.5 w-2.5 rounded-full border border-t-border ${
                n <= difficulty ? "bg-orange-500" : "bg-surface-2"
              }`}
            />
          ))}
        </div>
      </div>

      {/* Crew rows */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted w-16 shrink-0">Installers</span>
        <select value={item.installerCount ?? ""} onChange={(e) => handleSelect("installerCount", e.target.value)} disabled={readOnly} className={selectCls}>
          <option value="">—</option>
          {OPTIONS_1_5.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <span className="text-[10px] text-muted">x</span>
        <select value={item.installerDays ?? ""} onChange={(e) => handleSelect("installerDays", e.target.value)} disabled={readOnly} className={selectCls}>
          <option value="">—</option>
          {OPTIONS_1_5.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <span className="text-[10px] text-muted">days</span>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted w-16 shrink-0">Electrical</span>
        <select value={item.electricianCount ?? ""} onChange={(e) => handleSelect("electricianCount", e.target.value)} disabled={readOnly} className={selectCls}>
          <option value="">—</option>
          {OPTIONS_1_5.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <span className="text-[10px] text-muted">x</span>
        <select value={item.electricianDays ?? ""} onChange={(e) => handleSelect("electricianDays", e.target.value)} disabled={readOnly} className={selectCls}>
          <option value="">—</option>
          {OPTIONS_1_5.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <span className="text-[10px] text-muted">days</span>
      </div>

      {/* Toggle row */}
      <div className="flex items-center gap-4 pt-1">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <ToggleSwitch checked={!!item.discoReco} onChange={() => handleToggle("discoReco")} disabled={readOnly} />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Disco/Reco</span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <ToggleSwitch checked={!!item.interiorAccess} onChange={() => handleToggle("interiorAccess")} disabled={readOnly} />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Interior</span>
        </label>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toggle switch (compact)
// ---------------------------------------------------------------------------

function ToggleSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:opacity-50 disabled:cursor-not-allowed ${
        checked ? "bg-orange-500" : "bg-surface-2 border border-t-border"
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform duration-200 ease-in-out ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}
