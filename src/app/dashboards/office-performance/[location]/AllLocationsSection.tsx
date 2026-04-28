"use client";

import type { LocationOverview } from "@/lib/office-performance-types";
import CountUp from "./CountUp";

interface AllLocationsSectionProps {
  locations: LocationOverview[];
}

function gradeColor(grade: string): string {
  switch (grade) {
    case "A": return "#22c55e";
    case "B": return "#3b82f6";
    case "C": return "#eab308";
    case "D": return "#f97316";
    default: return "#ef4444";
  }
}

function onTimeColor(pct: number): string {
  if (pct < 0) return "#475569";
  if (pct >= 90) return "#22c55e";
  if (pct >= 75) return "#eab308";
  return "#ef4444";
}

function stuckColor(count: number): string {
  if (count === 0) return "#22c55e";
  if (count <= 2) return "#eab308";
  return "#ef4444";
}

function MetricRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between items-baseline text-sm py-0.5">
      <span className="text-slate-500 text-xs">{label}</span>
      <span className="font-semibold text-slate-200">{children}</span>
    </div>
  );
}

function CategoryBlock({
  title,
  titleColor,
  loc,
  category,
  extraRows,
}: {
  title: string;
  titleColor: string;
  loc: LocationOverview;
  category: "surveys" | "installs" | "inspections";
  extraRows?: React.ReactNode;
}) {
  const data = loc[category];
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
      <div className="text-[10px] font-bold tracking-wider mb-1.5" style={{ color: titleColor }}>
        {title}
      </div>
      <MetricRow label="Completed">
        <CountUp value={data.completedMtd} className="text-sm font-bold text-slate-200" />
      </MetricRow>
      <MetricRow label="Avg Days">
        <CountUp value={data.avgDays} decimals={1} className="text-sm font-bold text-slate-200" />
      </MetricRow>
      <MetricRow label="On-time">
        <span style={{ color: onTimeColor(data.onTimePercent) }}>
          {data.onTimePercent >= 0 ? `${data.onTimePercent}%` : "—"}
        </span>
      </MetricRow>
      <MetricRow label="Grade">
        <span className="text-base font-bold" style={{ color: gradeColor(data.grade) }}>
          {data.grade}
        </span>
      </MetricRow>
      <MetricRow label="Stuck">
        <span style={{ color: stuckColor(data.stuckCount) }}>{data.stuckCount}</span>
      </MetricRow>
      <MetricRow label="This Week">
        <CountUp value={data.scheduledThisWeek} className="text-sm font-bold text-slate-200" />
      </MetricRow>
      {extraRows}
    </div>
  );
}

export default function AllLocationsSection({ locations }: AllLocationsSectionProps) {
  return (
    <div className="flex flex-col h-full px-6 py-5 overflow-hidden">
      {/* Header */}
      <div className="text-center mb-4 flex-shrink-0">
        <h1 className="text-2xl font-extrabold text-white tracking-tight">
          ALL LOCATIONS — PERFORMANCE OVERVIEW
        </h1>
        <div className="text-xs text-slate-500 mt-1">
          Score = On-time% − Stuck% − Not-started% · A ≥90 · B ≥80 · C ≥70 · D ≥60 · F &lt;60
        </div>
      </div>

      {/* Per-group location grid (4 groups: Westminster, Centennial, COS, California) */}
      <div className="grid grid-cols-4 gap-4 flex-1 min-h-0">
        {locations.map((loc) => (
          <div key={loc.location} className="flex flex-col gap-2 overflow-hidden">
            {/* Location header */}
            <div className="text-center px-2 py-2 rounded-xl bg-white/[0.04] border border-white/5">
              <div className="text-lg font-bold text-white">{loc.location}</div>
            </div>

            {/* Survey block */}
            <CategoryBlock
              title="SURVEYS"
              titleColor="#3b82f6"
              loc={loc}
              category="surveys"
            />

            {/* Install block */}
            <CategoryBlock
              title="INSTALLS"
              titleColor="#22c55e"
              loc={loc}
              category="installs"
              extraRows={
                <MetricRow label="kW Installed">
                  <CountUp
                    value={(loc.installs as LocationOverview["installs"]).kwInstalledMtd}
                    decimals={1}
                    className="text-sm font-bold text-slate-200"
                  />
                </MetricRow>
              }
            />

            {/* Inspection block */}
            <CategoryBlock
              title="INSPECTIONS"
              titleColor="#06b6d4"
              loc={loc}
              category="inspections"
              extraRows={
                <MetricRow label="Pass Rate">
                  <span style={{
                    color: onTimeColor(
                      (loc.inspections as LocationOverview["inspections"]).firstPassRate
                    ),
                  }}>
                    {(loc.inspections as LocationOverview["inspections"]).firstPassRate > 0
                      ? `${(loc.inspections as LocationOverview["inspections"]).firstPassRate}%`
                      : "—"}
                  </span>
                </MetricRow>
              }
            />
          </div>
        ))}
      </div>
    </div>
  );
}
