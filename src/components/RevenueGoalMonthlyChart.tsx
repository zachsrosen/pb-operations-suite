"use client";

import { useState } from "react";
import type { RevenueGroupResult } from "@/lib/revenue-groups-config";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface Props {
  groups: RevenueGroupResult[];
}

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount.toFixed(0)}`;
}

export function RevenueGoalMonthlyChart({ groups }: Props) {
  const [selectedGroup, setSelectedGroup] = useState<string | "all">("all");
  const currentMonth = new Date().getMonth();

  const displayGroups = selectedGroup === "all"
    ? groups
    : groups.filter((g) => g.groupKey === selectedGroup);

  const maxMonthly = Math.max(
    ...displayGroups.flatMap((g) =>
      g.months.map((m) => Math.max(m.actual, m.effectiveTarget))
    ),
    1
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground">Monthly Breakdown</h3>
        <select
          value={selectedGroup}
          onChange={(e) => setSelectedGroup(e.target.value)}
          className="bg-surface-2 text-foreground text-xs rounded-lg px-2 py-1 border border-t-border"
        >
          <option value="all">All Groups</option>
          {groups.map((g) => (
            <option key={g.groupKey} value={g.groupKey}>{g.displayName}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-12 gap-1">
        {MONTH_LABELS.map((label, monthIdx) => {
          const isFuture = monthIdx > currentMonth;
          const isCurrent = monthIdx === currentMonth;

          return (
            <div key={label} className="flex flex-col items-center">
              <div className="relative w-full h-24 flex items-end justify-center gap-px">
                {displayGroups.map((group) => {
                  const monthData = group.months[monthIdx];
                  const barHeight = maxMonthly > 0 ? (monthData.actual / maxMonthly) * 100 : 0;
                  const targetHeight = maxMonthly > 0 ? (monthData.effectiveTarget / maxMonthly) * 100 : 0;

                  return (
                    <div key={group.groupKey} className="relative flex-1 flex items-end"
                      title={`${group.displayName}: ${formatCurrency(monthData.actual)} / ${formatCurrency(monthData.effectiveTarget)}`}>
                      <div className="absolute w-full border-t border-dashed border-white/20" style={{ bottom: `${targetHeight}%` }} />
                      <div
                        className={`w-full rounded-t transition-all duration-500 ${
                          monthData.hit ? "ring-1 ring-emerald-400/50" :
                          monthData.missed ? "opacity-70" :
                          isFuture ? "opacity-30" : ""
                        }`}
                        style={{
                          height: `${barHeight}%`,
                          backgroundColor: monthData.missed ? `${group.color}88` : group.color,
                          minHeight: monthData.actual > 0 ? "2px" : "0px",
                        }}
                      />
                    </div>
                  );
                })}
              </div>
              <span className={`text-[9px] mt-1 ${
                isCurrent ? "text-orange-400 font-bold" :
                isFuture ? "text-muted/50" : "text-muted"
              }`}>{label}</span>
              <div className="h-3 flex items-center">
                {displayGroups.some((g) => g.months[monthIdx].hit) && (
                  <span className="text-[8px] text-emerald-400">&#10003;</span>
                )}
                {displayGroups.some((g) => g.months[monthIdx].missed) && (
                  <span className="text-[8px] text-red-400">&#10007;</span>
                )}
                {displayGroups.some((g) => g.months[monthIdx].currentMonthOnTarget) && (
                  <span className="text-[8px] text-emerald-400">&#9733;</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
