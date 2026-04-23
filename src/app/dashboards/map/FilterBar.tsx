"use client";

import { MapMode, JobMarkerKind } from "@/lib/map-types";
import { MARKER_COLORS } from "@/lib/map-colors";

interface FilterBarProps {
  mode: MapMode;
  types: readonly JobMarkerKind[];        // all available types
  enabledTypes: readonly JobMarkerKind[]; // currently selected
  onModeChange: (mode: MapMode) => void;
  onTypeToggle: (kind: JobMarkerKind) => void;
}

const MODES: Array<{ id: MapMode; label: string }> = [
  { id: "today", label: "Today" },
  { id: "week", label: "Week" },
  { id: "backlog", label: "Backlog" },
];

export function FilterBar({
  mode,
  types,
  enabledTypes,
  onModeChange,
  onTypeToggle,
}: FilterBarProps) {
  const enabledSet = new Set(enabledTypes);
  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-surface border-b border-t-border">
      <div role="tablist" className="inline-flex rounded-md bg-surface-2 p-0.5">
        {MODES.map((m) => {
          const active = m.id === mode;
          return (
            <button
              key={m.id}
              role="tab"
              aria-pressed={active}
              onClick={() => onModeChange(m.id)}
              className={`px-3 py-1 text-sm rounded ${
                active ? "bg-orange-500 text-white" : "text-foreground"
              }`}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-1.5">
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
    </div>
  );
}
