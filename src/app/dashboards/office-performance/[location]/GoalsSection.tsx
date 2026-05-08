// src/app/dashboards/office-performance/[location]/GoalsSection.tsx

"use client";

import CountUp from "./CountUp";
import type { GoalsPipelineData, GoalRow, PaceColor } from "@/lib/goals-pipeline-types";

interface GoalsSectionProps {
  goals: GoalsPipelineData["goals"];
  month: number;
  year: number;
  dayOfMonth: number;
  daysInMonth: number;
}

const PACE_COLORS: Record<PaceColor, { bar: string; barGlow: string; text: string }> = {
  green:  { bar: "#22c55e", barGlow: "#4ade80", text: "#22c55e" },
  yellow: { bar: "#eab308", barGlow: "#facc15", text: "#eab308" },
  red:    { bar: "#ef4444", barGlow: "#f87171", text: "#ef4444" },
};

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface DepartmentConfig {
  key: keyof GoalsSectionProps["goals"];
  label: string;
  labelColor: string;
  format: "currency" | "count";
}

const DEPARTMENTS: DepartmentConfig[] = [
  { key: "sales",       label: "SALES",                    labelColor: "#f97316", format: "currency" },
  { key: "surveys",     label: "SITE SURVEYS",             labelColor: "#3b82f6", format: "currency" },
  { key: "da",          label: "DESIGN APPROVALS",         labelColor: "#8b5cf6", format: "currency" },
  { key: "cc",          label: "CONSTRUCTION COMPLETIONS", labelColor: "#22c55e", format: "currency" },
  { key: "inspections", label: "INSPECTIONS",              labelColor: "#06b6d4", format: "currency" },
  { key: "pto",         label: "PTO GRANTED",              labelColor: "#10b981", format: "currency" },
  { key: "reviews",     label: "5-STAR REVIEWS",           labelColor: "#a855f7", format: "count"    },
];

function formatTarget(value: number, format: "currency" | "count"): string {
  if (format === "count") return String(value);
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return `$${value}`;
}

const GOLD = { bar: "#d97706", barGlow: "#f59e0b" };

function GoalRowDisplay({ row, config }: { row: GoalRow; config: DepartmentConfig }) {
  const colors = PACE_COLORS[row.color];
  const hasStretch = row.stretchTarget > row.target;

  // Bar positions: the full bar = stretchTarget (or target if no stretch)
  const barMax = hasStretch ? row.stretchTarget : row.target;
  const baseMarkerPct = hasStretch ? (row.target / barMax) * 100 : 100;
  const fillPct = barMax > 0 ? Math.min((row.current / barMax) * 100, 100) : 0;
  const inStretchZone = row.current > row.target && hasStretch;

  // The base portion fills up to the marker; the gold portion fills beyond
  const baseFillPct = Math.min(fillPct, baseMarkerPct);
  const goldFillPct = inStretchZone ? fillPct - baseMarkerPct : 0;

  const isCurrency = config.format === "currency";
  let displayValue: number;
  let suffix = "";
  let decimals = 0;

  if (!isCurrency) {
    displayValue = row.current;
  } else if (row.current >= 1_000_000) {
    displayValue = row.current / 1_000_000;
    suffix = "M";
    decimals = 2;
  } else if (row.current >= 1_000) {
    displayValue = row.current / 1_000;
    suffix = "k";
  } else {
    displayValue = row.current;
  }

  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl px-5 py-4">
      <div className="flex justify-between items-baseline mb-2">
        <span
          className="text-[11px] font-bold tracking-[2px]"
          style={{ color: config.labelColor }}
        >
          {config.label}
        </span>
        <div className="text-right flex items-baseline gap-1">
          <span className="text-[22px] font-extrabold" style={{ color: inStretchZone ? GOLD.barGlow : colors.text }}>
            {isCurrency && "$"}
            <CountUp
              value={displayValue}
              decimals={decimals}
              suffix={suffix}
              className="inline"
              duration={600}
            />
          </span>
          <span className="text-[13px] text-slate-500 ml-1">
            / {formatTarget(row.target, config.format)}
            {hasStretch && (
              <span className="text-amber-500/60 ml-0.5">
                / {formatTarget(row.stretchTarget, config.format)}
              </span>
            )}
          </span>
          <span
            className="text-sm font-bold ml-2"
            style={{ color: inStretchZone ? GOLD.barGlow : colors.text }}
          >
            {row.percent}%
          </span>
        </div>
      </div>
      <div className="relative h-2 bg-white/[0.06] rounded-full overflow-hidden">
        {/* Base progress (pace-colored) */}
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out"
          style={{
            width: `${baseFillPct}%`,
            background: `linear-gradient(90deg, ${colors.bar}, ${colors.barGlow})`,
          }}
        />
        {/* Stretch/gold progress beyond base target */}
        {goldFillPct > 0 && (
          <div
            className="absolute inset-y-0 rounded-full transition-all duration-700 ease-out"
            style={{
              left: `${baseMarkerPct}%`,
              width: `${goldFillPct}%`,
              background: `linear-gradient(90deg, ${GOLD.bar}, ${GOLD.barGlow})`,
            }}
          />
        )}
        {/* Base target marker line */}
        {hasStretch && (
          <div
            className="absolute inset-y-0 w-[2px] bg-white/30"
            style={{ left: `${baseMarkerPct}%` }}
          />
        )}
      </div>
    </div>
  );
}

export default function GoalsSection({
  goals,
  month,
  year,
  dayOfMonth,
  daysInMonth,
}: GoalsSectionProps) {
  const elapsedPercent = Math.round((dayOfMonth / daysInMonth) * 100);

  return (
    <div className="flex flex-col h-full px-8 py-5">
      <div className="flex flex-col gap-4 flex-1 justify-center">
        {DEPARTMENTS.map((dept) => (
          <GoalRowDisplay
            key={dept.key}
            row={goals[dept.key]}
            config={dept}
          />
        ))}
      </div>

      <div className="mt-4 text-center text-[11px] text-slate-500">
        Day {dayOfMonth} of {daysInMonth} — {elapsedPercent}% of{" "}
        {MONTH_NAMES[month]} {year} elapsed · Green = on pace · Yellow = slightly behind · Red = behind
      </div>
    </div>
  );
}
