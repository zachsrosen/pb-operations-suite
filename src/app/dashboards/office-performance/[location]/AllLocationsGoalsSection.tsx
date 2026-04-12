// src/app/dashboards/office-performance/[location]/AllLocationsGoalsSection.tsx

"use client";

import CountUp from "./CountUp";
import type { GoalsPipelineData, GoalRow, PaceColor } from "@/lib/goals-pipeline-types";

interface PerLocationGoals {
  location: string;
  goals: GoalsPipelineData["goals"];
}

interface AllLocationsGoalsSectionProps {
  goals: GoalsPipelineData["goals"];
  perLocation: PerLocationGoals[];
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
  key: keyof GoalsPipelineData["goals"];
  label: string;
  labelColor: string;
  format: "currency" | "count";
}

const DEPARTMENTS: DepartmentConfig[] = [
  { key: "sales",       label: "SALES",                    labelColor: "#f97316", format: "currency" },
  { key: "da",          label: "DESIGN APPROVALS",         labelColor: "#3b82f6", format: "currency" },
  { key: "cc",          label: "CONSTRUCTION COMPLETIONS", labelColor: "#22c55e", format: "currency" },
  { key: "inspections", label: "INSPECTIONS",              labelColor: "#06b6d4", format: "currency" },
  { key: "reviews",     label: "5-STAR REVIEWS",           labelColor: "#a855f7", format: "count"    },
];

/** Short display names for location breakdown */
const LOC_SHORT: Record<string, string> = {
  Westminster: "WM",
  Centennial: "DTC",
  "Colorado Springs": "COS",
  "San Luis Obispo": "SLO",
  Camarillo: "CAM",
};

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return `$${value}`;
}

function formatTarget(value: number, format: "currency" | "count"): string {
  if (format === "count") return String(value);
  return formatCurrency(value);
}

function CompanyGoalRow({
  row,
  config,
  perLocation,
}: {
  row: GoalRow;
  config: DepartmentConfig;
  perLocation: PerLocationGoals[];
}) {
  const colors = PACE_COLORS[row.color];
  const barWidth = Math.min(row.percent, 100);

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
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl px-5 py-3">
      {/* Header row */}
      <div className="flex justify-between items-baseline mb-1.5">
        <span
          className="text-[10px] font-bold tracking-[2px]"
          style={{ color: config.labelColor }}
        >
          {config.label}
        </span>
        <div className="text-right flex items-baseline gap-1">
          <span className="text-[20px] font-extrabold" style={{ color: colors.text }}>
            {isCurrency && "$"}
            <CountUp
              value={displayValue}
              decimals={decimals}
              suffix={suffix}
              className="inline"
              duration={600}
            />
          </span>
          <span className="text-[12px] text-slate-500 ml-1">
            / {formatTarget(row.target, config.format)}
          </span>
          <span
            className="text-sm font-bold ml-2"
            style={{ color: colors.text }}
          >
            {row.percent}%
          </span>
        </div>
      </div>

      {/* Company-wide progress bar */}
      <div className="h-2 bg-white/[0.06] rounded-full overflow-hidden mb-2">
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{
            width: `${barWidth}%`,
            background: `linear-gradient(90deg, ${colors.bar}, ${colors.barGlow})`,
          }}
        />
      </div>

      {/* Per-location breakdown */}
      <div className="flex gap-3 text-[10px]">
        {perLocation.map((loc) => {
          const locRow = loc.goals[config.key];
          const locColors = PACE_COLORS[locRow.color];
          const locValue = isCurrency
            ? formatCurrency(locRow.current)
            : String(locRow.current);
          return (
            <div key={loc.location} className="flex items-center gap-1">
              <span className="text-slate-500 font-medium">
                {LOC_SHORT[loc.location] || loc.location}
              </span>
              <span className="font-semibold" style={{ color: locColors.text }}>
                {locValue}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function AllLocationsGoalsSection({
  goals,
  perLocation,
  month,
  year,
  dayOfMonth,
  daysInMonth,
}: AllLocationsGoalsSectionProps) {
  const elapsedPercent = Math.round((dayOfMonth / daysInMonth) * 100);

  return (
    <div className="flex flex-col h-full px-8 py-5">
      <div className="flex flex-col gap-3 flex-1 justify-center">
        {DEPARTMENTS.map((dept) => (
          <CompanyGoalRow
            key={dept.key}
            row={goals[dept.key]}
            config={dept}
            perLocation={perLocation}
          />
        ))}
      </div>

      <div className="mt-3 text-center text-[11px] text-slate-500">
        Day {dayOfMonth} of {daysInMonth} — {elapsedPercent}% of{" "}
        {MONTH_NAMES[month]} {year} elapsed · Company-wide across 5 locations
      </div>
    </div>
  );
}
