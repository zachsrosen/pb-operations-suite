"use client";

import type { RevenueGroupResult, RevenueGoalResponse } from "@/lib/revenue-groups-config";

interface Props {
  groups: RevenueGroupResult[];
  companyTotal: RevenueGoalResponse["companyTotal"];
}

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount.toFixed(0)}`;
}

export function RevenueGoalBars({ groups, companyTotal }: Props) {
  const companyPct = companyTotal.annualTarget > 0
    ? (companyTotal.ytdActual / companyTotal.annualTarget) * 100
    : 0;
  const pacePct = companyTotal.annualTarget > 0
    ? (companyTotal.ytdPaceExpected / companyTotal.annualTarget) * 100
    : 0;

  return (
    <div className="mb-6">
      {/* Company-wide hero bar */}
      <div className="bg-surface-2 rounded-xl p-4 mb-4">
        <div className="flex justify-between items-baseline mb-2">
          <span className="text-foreground font-semibold">Company Total</span>
          <span className="text-orange-400 font-bold text-sm">
            {formatCurrency(companyTotal.ytdActual)} / {formatCurrency(companyTotal.annualTarget)}
            {" "}({companyPct.toFixed(0)}%)
          </span>
        </div>
        <div className="relative bg-surface rounded-full h-5 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-orange-500 to-orange-400 transition-all duration-1000 ease-out"
            style={{ width: `${Math.min(companyPct, 100)}%` }}
          />
          {pacePct > 0 && (
            <div
              className="absolute top-0 h-full w-[2px] bg-white/70"
              style={{ left: `${Math.min(pacePct, 100)}%` }}
              title={`Expected pace: ${pacePct.toFixed(0)}%`}
            />
          )}
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[10px] text-muted">Jan</span>
          <span className="text-[10px] text-muted">Expected pace ({pacePct.toFixed(0)}%)</span>
          <span className="text-[10px] text-muted">Dec</span>
        </div>
      </div>

      {/* Per-group bars */}
      <div className="flex flex-col gap-3">
        {groups.map((group) => {
          const pct = group.annualTarget > 0
            ? (group.ytdActual / group.annualTarget) * 100
            : 0;
          const groupPacePct = group.annualTarget > 0
            ? (group.ytdPaceExpected / group.annualTarget) * 100
            : 0;
          const deficit = group.paceStatus === "behind"
            ? group.ytdPaceExpected - group.ytdActual
            : undefined;
          const isApproximate = group.groupKey === "roofing_dnr" || group.groupKey === "service";

          return (
            <div key={group.groupKey}>
              <div className="flex justify-between items-center mb-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm" style={{ color: group.color }}>{group.displayName}</span>
                  {group.paceStatus === "ahead" && (
                    <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" title="Ahead of pace" />
                  )}
                  {group.paceStatus === "behind" && deficit && (
                    <span className="text-[10px] text-amber-400">behind by {formatCurrency(deficit)}</span>
                  )}
                  {group.discoveryGated && (
                    <span className="text-[10px] text-amber-500/70">not configured</span>
                  )}
                  {isApproximate && (
                    <span className="text-[9px] text-muted/60 italic" title="Revenue for this group is based on Zuper job completion data and may be approximate">~approx</span>
                  )}
                </div>
                <span className="text-xs text-muted">
                  {formatCurrency(group.ytdActual)} / {formatCurrency(group.annualTarget)}
                </span>
              </div>
              <div className="relative bg-surface rounded-full h-3 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-1000 ease-out"
                  style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: group.color }}
                />
                {groupPacePct > 0 && (
                  <div
                    className="absolute top-0 h-full w-[2px] bg-white/60"
                    style={{ left: `${Math.min(groupPacePct, 100)}%` }}
                    title={`Expected pace: ${groupPacePct.toFixed(0)}%`}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
