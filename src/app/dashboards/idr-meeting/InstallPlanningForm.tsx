"use client";

import { useCallback } from "react";
import type { IdrItem } from "./IdrMeetingClient";

interface Props {
  item: IdrItem;
  onChange: (updates: Partial<IdrItem>) => void;
  readOnly: boolean;
}

export function InstallPlanningForm({ item, onChange, readOnly }: Props) {
  const handleNumber = useCallback(
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

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      {/* Difficulty */}
      <div>
        <label className="text-xs font-semibold uppercase tracking-wider text-muted block mb-1">
          Difficulty
        </label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={5}
            value={item.difficulty ?? ""}
            onChange={(e) => handleNumber("difficulty", e.target.value)}
            disabled={readOnly}
            className="w-14 rounded-lg border border-t-border bg-surface-2 px-2 py-1.5 text-sm text-foreground disabled:opacity-50"
          />
          {/* Visual pips */}
          <div className="flex gap-0.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <span
                key={n}
                className={`h-3 w-3 rounded-full border border-t-border ${
                  n <= difficulty ? "bg-orange-500" : "bg-surface-2"
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Installers: Count + Days */}
      <div>
        <label className="text-xs font-semibold uppercase tracking-wider text-muted block mb-1">
          Installers
        </label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            placeholder="Count"
            value={item.installerCount ?? ""}
            onChange={(e) => handleNumber("installerCount", e.target.value)}
            disabled={readOnly}
            className="w-16 rounded-lg border border-t-border bg-surface-2 px-2 py-1.5 text-sm text-foreground disabled:opacity-50"
          />
          <span className="text-xs text-muted">x</span>
          <input
            type="number"
            min={0}
            placeholder="Days"
            value={item.installerDays ?? ""}
            onChange={(e) => handleNumber("installerDays", e.target.value)}
            disabled={readOnly}
            className="w-16 rounded-lg border border-t-border bg-surface-2 px-2 py-1.5 text-sm text-foreground disabled:opacity-50"
          />
          <span className="text-xs text-muted">days</span>
        </div>
      </div>

      {/* Electricians: Count + Days */}
      <div>
        <label className="text-xs font-semibold uppercase tracking-wider text-muted block mb-1">
          Electricians
        </label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            placeholder="Count"
            value={item.electricianCount ?? ""}
            onChange={(e) => handleNumber("electricianCount", e.target.value)}
            disabled={readOnly}
            className="w-16 rounded-lg border border-t-border bg-surface-2 px-2 py-1.5 text-sm text-foreground disabled:opacity-50"
          />
          <span className="text-xs text-muted">x</span>
          <input
            type="number"
            min={0}
            placeholder="Days"
            value={item.electricianDays ?? ""}
            onChange={(e) => handleNumber("electricianDays", e.target.value)}
            disabled={readOnly}
            className="w-16 rounded-lg border border-t-border bg-surface-2 px-2 py-1.5 text-sm text-foreground disabled:opacity-50"
          />
          <span className="text-xs text-muted">days</span>
        </div>
      </div>

      {/* Disco/Reco toggle */}
      <div>
        <label className="text-xs font-semibold uppercase tracking-wider text-muted block mb-1">
          Disco/Reco
        </label>
        <ToggleSwitch
          checked={!!item.discoReco}
          onChange={() => handleToggle("discoReco")}
          disabled={readOnly}
        />
      </div>

      {/* Interior Access toggle */}
      <div>
        <label className="text-xs font-semibold uppercase tracking-wider text-muted block mb-1">
          Interior Access
        </label>
        <ToggleSwitch
          checked={!!item.interiorAccess}
          onChange={() => handleToggle("interiorAccess")}
          disabled={readOnly}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toggle switch
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
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:opacity-50 disabled:cursor-not-allowed ${
        checked ? "bg-orange-500" : "bg-surface-2 border border-t-border"
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform duration-200 ease-in-out ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}
