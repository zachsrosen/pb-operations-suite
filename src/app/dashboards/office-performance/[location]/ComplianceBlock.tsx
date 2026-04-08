"use client";

import type { SectionCompliance } from "@/lib/office-performance-types";

interface ComplianceBlockProps {
  compliance?: SectionCompliance;
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

function neverStartedColor(count: number): string {
  return count === 0 ? "#22c55e" : "#eab308";
}

export default function ComplianceBlock({ compliance }: ComplianceBlockProps) {
  if (!compliance) return null;

  const showOnTime = compliance.onTimePercent >= 0;
  const hasEmployees = compliance.byEmployee.length > 0;

  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3">
      {/* Aggregate summary row */}
      <div className="flex items-center gap-6 text-sm">
        {showOnTime && (
          <div className="flex items-center gap-1.5">
            <span style={{ color: onTimeColor(compliance.onTimePercent) }}>✅</span>
            <span className="font-semibold" style={{ color: onTimeColor(compliance.onTimePercent) }}>
              {compliance.onTimePercent}%
            </span>
            <span className="text-slate-400">on-time</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <span style={{ color: stuckColor(compliance.stuckJobs.length) }}>⚠️</span>
          <span className="font-semibold" style={{ color: stuckColor(compliance.stuckJobs.length) }}>
            {compliance.stuckJobs.length}
          </span>
          <span className="text-slate-400">stuck</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span style={{ color: neverStartedColor(compliance.neverStartedCount) }}>🔴</span>
          <span className="font-semibold" style={{ color: neverStartedColor(compliance.neverStartedCount) }}>
            {compliance.neverStartedCount}
          </span>
          <span className="text-slate-400">never started</span>
        </div>
      </div>

      {/* Per-employee breakdown */}
      {hasEmployees && (
        <div className="mt-3 border-t border-white/5 pt-2">
          <div className="text-[10px] font-semibold text-slate-500 tracking-wider mb-1.5">
            BY EMPLOYEE
          </div>
          <div className="grid gap-1">
            {compliance.byEmployee.map((emp) => (
              <div key={emp.name} className="flex items-center gap-3 text-xs">
                <span className="text-slate-300 font-medium w-28 truncate">{emp.name}</span>
                {emp.onTimePercent >= 0 ? (
                  <span className="font-semibold w-12 text-right" style={{ color: onTimeColor(emp.onTimePercent) }}>
                    {emp.onTimePercent}%
                  </span>
                ) : (
                  <span className="w-12 text-right text-slate-600">—</span>
                )}
                {emp.stuckCount > 0 && (
                  <span className="text-yellow-500">{emp.stuckCount} stuck</span>
                )}
                {emp.neverStartedCount > 0 && (
                  <span className="text-yellow-400">{emp.neverStartedCount} not started</span>
                )}
                {emp.stuckCount === 0 && emp.neverStartedCount === 0 && emp.onTimePercent >= 90 && (
                  <span className="text-green-500/60">clean</span>
                )}
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
