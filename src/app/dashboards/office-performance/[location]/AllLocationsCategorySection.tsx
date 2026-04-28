// src/app/dashboards/office-performance/[location]/AllLocationsCategorySection.tsx

/**
 * Shared layout for all-locations Surveys / Installs / Inspections slides.
 * Shows 4 hero metric cards (aggregated) plus a per-location comparison grid.
 */

"use client";

import CountUp from "./CountUp";
import type { LocationOverview } from "@/lib/office-performance-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MetricDef {
  label: string;
  value: number;
  suffix?: string;
  decimals?: number;
  color: string;
  subLabel?: string;
}

export interface LocationRow {
  location: string;
  metrics: Array<{ value: number | string; color?: string }>;
}

interface AllLocationsCategorySectionProps {
  title: string;
  titleColor: string;
  metrics: MetricDef[];
  locations: LocationOverview[];
  columnHeaders: string[];
  buildLocationRow: (loc: LocationOverview) => LocationRow;
}

// Short location labels — keys match the dashboard group label (DASHBOARD_LOCATION_GROUPS)
// or canonical-location names for any pre-grouped data. SLO + Camarillo roll up to California.
const LOC_SHORT: Record<string, string> = {
  Westminster: "WM",
  Centennial: "DTC",
  "Colorado Springs": "COS",
  California: "CA",
  // Pre-grouping fallbacks (kept for any callers passing canonical labels):
  "San Luis Obispo": "SLO",
  Camarillo: "CAM",
};

function gradeColor(grade: string): string {
  switch (grade) {
    case "A": return "#22c55e";
    case "B": return "#3b82f6";
    case "C": return "#eab308";
    case "D": return "#f97316";
    default: return "#ef4444";
  }
}

export { gradeColor, LOC_SHORT };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AllLocationsCategorySection({
  title,
  titleColor,
  metrics,
  locations,
  columnHeaders,
  buildLocationRow,
}: AllLocationsCategorySectionProps) {
  const rows = locations.map(buildLocationRow);

  return (
    <div className="flex flex-col h-full px-8 py-5 overflow-hidden">
      {/* Section title */}
      <div
        className="text-[11px] font-bold tracking-[2px] mb-4"
        style={{ color: titleColor }}
      >
        {title}
      </div>

      {/* Hero metric cards */}
      <div className="grid grid-cols-4 gap-4 mb-5 flex-shrink-0">
        {metrics.map((m) => (
          <div
            key={m.label}
            className="bg-white/[0.04] rounded-2xl p-5 text-center border border-white/5"
          >
            <CountUp
              value={m.value}
              decimals={m.decimals ?? 0}
              suffix={m.suffix ?? ""}
              className="text-[52px] font-extrabold leading-none"
              style={{ color: m.color }}
            />
            <div className="text-sm text-slate-400 mt-2">{m.label}</div>
            {m.subLabel && (
              <div className="text-xs text-slate-500 mt-0.5">{m.subLabel}</div>
            )}
          </div>
        ))}
      </div>

      {/* Per-location comparison table */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <div className="bg-white/[0.02] rounded-xl border border-white/5 overflow-hidden h-full">
          {/* Header */}
          <div className="grid gap-2 px-4 py-2 border-b border-white/5"
            style={{ gridTemplateColumns: `100px repeat(${columnHeaders.length}, 1fr)` }}
          >
            <div className="text-[10px] font-bold text-slate-500 tracking-wider">LOCATION</div>
            {columnHeaders.map((h) => (
              <div key={h} className="text-[10px] font-bold text-slate-500 tracking-wider text-center">
                {h}
              </div>
            ))}
          </div>

          {/* Rows */}
          {rows.map((row) => (
            <div
              key={row.location}
              className="grid gap-2 px-4 py-2.5 border-b border-white/[0.03] last:border-0"
              style={{ gridTemplateColumns: `100px repeat(${columnHeaders.length}, 1fr)` }}
            >
              <div className="text-sm font-semibold text-slate-300">
                {LOC_SHORT[row.location] || row.location}
              </div>
              {row.metrics.map((cell, i) => (
                <div
                  key={i}
                  className="text-center text-sm font-bold"
                  style={{ color: cell.color || "#e2e8f0" }}
                >
                  {cell.value}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
