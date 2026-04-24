"use client";

import { useState } from "react";
import { MapMode, JobMarkerKind } from "@/lib/map-types";
import { MARKER_COLORS } from "@/lib/map-colors";

interface FilterBarProps {
  mode: MapMode;
  types: readonly JobMarkerKind[];        // all available types
  enabledTypes: readonly JobMarkerKind[]; // currently selected
  availableLocations: readonly string[];  // union of pbLocation values present in data
  enabledLocations: readonly string[];    // currently selected — empty = all
  onModeChange: (mode: MapMode) => void;
  onTypeToggle: (kind: JobMarkerKind) => void;
  onLocationToggle: (location: string) => void;
  onLocationsReset: () => void;
  onExport?: () => void;
  exportDisabled?: boolean;
}

const MODES: Array<{ id: MapMode; label: string; enabled: boolean }> = [
  { id: "today", label: "Today", enabled: true },
  { id: "week", label: "Week", enabled: true },
  { id: "backlog", label: "Backlog", enabled: true },
];

export function FilterBar({
  mode,
  types,
  enabledTypes,
  availableLocations,
  enabledLocations,
  onModeChange,
  onTypeToggle,
  onLocationToggle,
  onLocationsReset,
  onExport,
  exportDisabled,
}: FilterBarProps) {
  const enabledSet = new Set(enabledTypes);
  const locationSet = new Set(enabledLocations);
  const [locationOpen, setLocationOpen] = useState(false);
  const locationLabel =
    locationSet.size === 0 || locationSet.size === availableLocations.length
      ? "All shops"
      : locationSet.size === 1
      ? Array.from(locationSet)[0]
      : `${locationSet.size} shops`;
  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 bg-surface border-b border-t-border">
      <div role="tablist" className="inline-flex rounded-md bg-surface-2 p-0.5">
        {MODES.map((m) => {
          const active = m.id === mode;
          const disabled = !m.enabled;
          return (
            <button
              key={m.id}
              role="tab"
              aria-pressed={active}
              aria-disabled={disabled}
              disabled={disabled}
              title={disabled ? "Coming in Phase 2" : undefined}
              onClick={() => !disabled && onModeChange(m.id)}
              className={`px-3 py-1 text-sm rounded ${
                active ? "bg-orange-500 text-white" : "text-foreground"
              } ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-1.5 flex-1">
        {types.map((t) => {
          const on = enabledSet.has(t);
          return (
            <button
              key={t}
              aria-pressed={on}
              onClick={() => onTypeToggle(t)}
              className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                on
                  ? "text-white"
                  : "bg-surface-2 text-muted border-t-border"
              }`}
              style={on ? {
                background: MARKER_COLORS[t],
                borderColor: MARKER_COLORS[t],
              } : undefined}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          );
        })}
      </div>

      {availableLocations.length > 0 && (
        <div className="relative">
          <button
            onClick={() => setLocationOpen((o) => !o)}
            className="px-3 py-1 text-xs rounded border border-t-border bg-surface-2 text-foreground hover:bg-surface-elevated flex items-center gap-1"
            aria-haspopup="true"
            aria-expanded={locationOpen}
            title="Filter by PB shop location"
          >
            <span>📍 {locationLabel}</span>
            <span className="text-muted">▾</span>
          </button>
          {locationOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setLocationOpen(false)} aria-hidden />
              <div className="absolute top-full mt-1 right-0 z-20 bg-surface border border-t-border rounded-lg shadow-xl p-2 min-w-[180px]">
                <div className="flex items-center justify-between mb-1 px-1">
                  <div className="text-[10px] uppercase tracking-wider text-muted font-semibold">
                    Shops
                  </div>
                  <button
                    onClick={() => { onLocationsReset(); }}
                    className="text-[10px] text-orange-400 hover:text-orange-300"
                  >
                    All
                  </button>
                </div>
                {availableLocations.map((loc) => {
                  const on = locationSet.has(loc);
                  return (
                    <label
                      key={loc}
                      className="flex items-center gap-2 px-2 py-1 hover:bg-surface-2 rounded cursor-pointer text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => onLocationToggle(loc)}
                        className="accent-orange-500"
                      />
                      <span className="text-foreground">{loc}</span>
                    </label>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {onExport && (
        <button
          onClick={onExport}
          disabled={exportDisabled}
          className="px-3 py-1 text-xs rounded border border-t-border bg-surface-2 text-foreground hover:bg-surface-elevated disabled:opacity-40 disabled:cursor-not-allowed"
          title="Export visible markers to CSV"
        >
          Export CSV
        </button>
      )}
    </div>
  );
}
