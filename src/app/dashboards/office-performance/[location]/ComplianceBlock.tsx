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

  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3">
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
      {compliance.stuckJobs.length > 0 && (
        <div className="text-xs text-slate-400 mt-2 flex flex-wrap gap-x-3 gap-y-1">
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
