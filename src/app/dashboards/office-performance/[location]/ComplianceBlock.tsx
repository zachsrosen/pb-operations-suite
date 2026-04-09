"use client";

import type { SectionCompliance } from "@/lib/office-performance-types";

interface ComplianceBlockProps {
  compliance?: SectionCompliance;
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
  if (pct >= 90) return "#22c55e";
  if (pct >= 75) return "#eab308";
  return "#ef4444";
}

function stuckColor(count: number): string {
  if (count === 0) return "#22c55e";
  if (count <= 2) return "#eab308";
  return "#ef4444";
}

function oowColor(pct: number): string {
  if (pct >= 80) return "#22c55e";
  if (pct >= 60) return "#eab308";
  return "#ef4444";
}

/** Render the dual "usage / punctuality" OOW display. */
function OowDualDisplay({
  usage,
  punctuality,
  textSize,
}: {
  usage: number;
  punctuality: number;
  textSize: "xs" | "sm";
}) {
  const sizeClass = textSize === "sm" ? "text-sm" : "text-xs";
  const usageColor = usage >= 0 ? oowColor(usage) : "#475569";
  const punctColor = punctuality >= 0 ? oowColor(punctuality) : "#475569";
  return (
    <span className={`font-semibold ${sizeClass}`}>
      <span style={{ color: usageColor }}>
        {usage >= 0 ? `${usage}%` : "—"}
      </span>
      <span className="text-slate-600 mx-0.5">/</span>
      <span style={{ color: punctColor }}>
        {punctuality >= 0 ? `${punctuality}%` : "—"}
      </span>
    </span>
  );
}

export default function ComplianceBlock({ compliance }: ComplianceBlockProps) {
  if (!compliance) return null;

  const showOnTime = compliance.onTimePercent >= 0;
  const showOow =
    compliance.oowUsagePercent >= 0 || compliance.oowOnTimePercent >= 0;
  const hasEmployees = compliance.byEmployee.length > 0;

  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3">
      {/* Aggregate summary row */}
      <div className="flex items-center gap-4 text-sm flex-wrap">
        <div className="flex items-center gap-1">
          <span className="text-slate-500 text-xs">Jobs:</span>
          <span className="font-semibold text-slate-200">
            {compliance.completedJobs}/{compliance.totalJobs}
          </span>
        </div>
        {showOnTime && (
          <div className="flex items-center gap-1">
            <span className="text-slate-500 text-xs">On-time:</span>
            <span className="font-semibold" style={{ color: onTimeColor(compliance.onTimePercent) }}>
              {compliance.onTimePercent}%
            </span>
          </div>
        )}
        {showOow && (
          <div className="flex items-center gap-1">
            <span
              className="text-slate-500 text-xs"
              title="Used / On-time: how often OOW status was hit, and — of those — how often before scheduled start"
            >
              OOW (use/punct):
            </span>
            <OowDualDisplay
              usage={compliance.oowUsagePercent}
              punctuality={compliance.oowOnTimePercent}
              textSize="sm"
            />
          </div>
        )}
        <div className="flex items-center gap-1">
          <span className="text-slate-500 text-xs">Stuck:</span>
          <span className="font-semibold" style={{ color: stuckColor(compliance.stuckJobs.length) }}>
            {compliance.stuckJobs.length}
          </span>
        </div>
        {compliance.neverStartedCount > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-slate-500 text-xs">Not started:</span>
            <span className="font-semibold text-yellow-400">
              {compliance.neverStartedCount}
            </span>
          </div>
        )}
        {compliance.avgDaysToComplete > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-slate-500 text-xs">Avg to Complete:</span>
            <span className="font-semibold text-slate-300">
              {compliance.avgDaysToComplete}
            </span>
          </div>
        )}
        {compliance.avgDaysLate > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-slate-500 text-xs">Avg Days Late:</span>
            <span className="font-semibold text-orange-400">
              {compliance.avgDaysLate}d
            </span>
          </div>
        )}
      </div>

      {/* Per-employee breakdown */}
      {hasEmployees && (
        <div className="mt-3 border-t border-white/5 pt-2">
          <div className="text-[10px] font-semibold text-slate-500 tracking-wider mb-1.5">
            CREW PERFORMANCE
          </div>
          {/* Column headers */}
          <div className="grid grid-cols-[1fr_40px_48px_72px_48px_48px_48px] gap-1 text-[9px] text-slate-600 font-medium mb-0.5 px-0.5">
            <span>Name</span>
            <span className="text-center">Grade</span>
            <span className="text-right">On-time</span>
            <span
              className="text-right"
              title="OOW usage % / punctuality %"
            >
              OOW u/p
            </span>
            <span className="text-right">Jobs</span>
            <span className="text-right">Stuck</span>
            <span className="text-right">Avg d</span>
          </div>
          <div className="grid gap-0.5">
            {compliance.byEmployee.map((emp) => (
              <div
                key={emp.name}
                className="grid grid-cols-[1fr_40px_48px_72px_48px_48px_48px] gap-1 text-xs items-center px-0.5 py-0.5 rounded hover:bg-white/[0.02]"
              >
                {/* Name */}
                <span className="text-slate-300 font-medium truncate">
                  {emp.name}
                </span>
                {/* Grade */}
                <span
                  className="text-center font-bold text-sm"
                  style={{ color: gradeColor(emp.grade) }}
                >
                  {emp.grade}
                </span>
                {/* On-time % */}
                {emp.onTimePercent >= 0 ? (
                  <span
                    className="text-right font-semibold"
                    style={{ color: onTimeColor(emp.onTimePercent) }}
                  >
                    {emp.onTimePercent}%
                  </span>
                ) : (
                  <span className="text-right text-slate-600">—</span>
                )}
                {/* OOW usage / punctuality */}
                {emp.oowUsagePercent >= 0 || emp.oowOnTimePercent >= 0 ? (
                  <span className="text-right">
                    <OowDualDisplay
                      usage={emp.oowUsagePercent}
                      punctuality={emp.oowOnTimePercent}
                      textSize="xs"
                    />
                  </span>
                ) : (
                  <span className="text-right text-slate-600">—</span>
                )}
                {/* Jobs completed/total */}
                <span className="text-right text-slate-400">
                  {emp.completedJobs}/{emp.totalJobs}
                </span>
                {/* Stuck */}
                {emp.stuckCount > 0 ? (
                  <span
                    className="text-right font-semibold"
                    style={{ color: stuckColor(emp.stuckCount) }}
                  >
                    {emp.stuckCount}
                  </span>
                ) : (
                  <span className="text-right text-green-500/50">0</span>
                )}
                {/* Avg days to complete */}
                <span className="text-right text-slate-400">
                  {emp.avgDaysToComplete > 0 ? emp.avgDaysToComplete : "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stuck job details */}
      {compliance.stuckJobs.length > 0 && (
        <div className="text-xs text-slate-400 mt-2 pt-2 border-t border-white/5 flex flex-wrap gap-x-3 gap-y-1">
          <span className="text-slate-500 font-medium">Stuck:</span>
          {compliance.stuckJobs.map((job, i) => (
            <span key={i} className="text-slate-300">
              &ldquo;{job.name}&rdquo;
              <span className="text-slate-500">
                {" "}({job.assignedUser || "unassigned"}
                {job.daysSinceScheduled != null && `, ${job.daysSinceScheduled}d`})
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
