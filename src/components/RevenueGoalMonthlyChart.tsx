"use client";

import { useState, useMemo } from "react";
import type { RevenueGroupResult } from "@/lib/revenue-groups-config";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import type { FilterOption } from "@/components/ui/MultiSelectFilter";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface Props {
  groups: RevenueGroupResult[];
}

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount.toFixed(0)}`;
}

/** Compact format for tight column labels (no dollar sign, shorter) */
function formatCompact(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 100_000) return `$${(amount / 1_000).toFixed(0)}K`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount.toFixed(0)}`;
}

export function RevenueGoalMonthlyChart({ groups }: Props) {
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const currentMonth = new Date().getMonth();

  const filterOptions: FilterOption[] = useMemo(
    () => groups.map((g) => ({ value: g.groupKey, label: g.displayName })),
    [groups]
  );

  // Empty selection = show all
  const displayGroups = selectedGroups.length === 0
    ? groups
    : groups.filter((g) => selectedGroups.includes(g.groupKey));

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
        <MultiSelectFilter
          label="Groups"
          options={filterOptions}
          selected={selectedGroups}
          onChange={setSelectedGroups}
          placeholder="All Groups"
          accentColor="orange"
        />
      </div>

      <div className="grid grid-cols-12 gap-1.5">
        {MONTH_LABELS.map((label, monthIdx) => {
          const isFuture = monthIdx > currentMonth;
          const isCurrent = monthIdx === currentMonth;

          // Aggregate actual and effective target across displayed groups for this month
          const monthActualTotal = displayGroups.reduce((sum, g) => sum + g.months[monthIdx].actual, 0);
          const monthTargetTotal = displayGroups.reduce((sum, g) => sum + g.months[monthIdx].effectiveTarget, 0);

          return (
            <div key={label} className="flex flex-col items-center">
              {/* Dollar label above bars */}
              <div className="h-8 flex flex-col items-center justify-end mb-0.5">
                {monthActualTotal > 0 ? (
                  <span className={`text-[9px] font-medium ${
                    isCurrent ? "text-orange-400" : "text-foreground/70"
                  }`}>{formatCompact(monthActualTotal)}</span>
                ) : isFuture && monthTargetTotal > 0 ? (
                  <span className="text-[9px] text-muted/50">need</span>
                ) : null}
              </div>

              {/* Bar area */}
              <div className="relative w-full h-40 flex items-end justify-center gap-px">
                {displayGroups.map((group) => {
                  const monthData = group.months[monthIdx];
                  const barHeight = maxMonthly > 0 ? (monthData.actual / maxMonthly) * 100 : 0;
                  const targetHeight = maxMonthly > 0 ? (monthData.effectiveTarget / maxMonthly) * 100 : 0;

                  return (
                    <div key={group.groupKey} className="relative flex-1 flex items-end"
                      title={`${group.displayName}: ${formatCurrency(monthData.actual)} / ${formatCurrency(monthData.effectiveTarget)}`}>
                      {/* Target dashed line */}
                      <div className="absolute w-full border-t border-dashed border-white/20" style={{ bottom: `${targetHeight}%` }} />
                      {/* Future months: ghost bar showing target needed */}
                      {isFuture && monthData.effectiveTarget > 0 && (
                        <div
                          className="absolute bottom-0 w-full rounded-t border border-dashed opacity-20"
                          style={{
                            height: `${targetHeight}%`,
                            borderColor: group.color,
                          }}
                        />
                      )}
                      {/* Actual bar */}
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

              {/* Month label */}
              <span className={`text-[9px] mt-1 ${
                isCurrent ? "text-orange-400 font-bold" :
                isFuture ? "text-muted/50" : "text-muted"
              }`}>{label}</span>

              {/* Status indicators + future target amount */}
              <div className="h-5 flex flex-col items-center justify-start">
                {displayGroups.some((g) => g.months[monthIdx].hit) && (
                  <span className="text-[8px] text-emerald-400">&#10003;</span>
                )}
                {displayGroups.some((g) => g.months[monthIdx].missed) && (
                  <span className="text-[8px] text-red-400">&#10007;</span>
                )}
                {displayGroups.some((g) => g.months[monthIdx].currentMonthOnTarget) && (
                  <span className="text-[8px] text-emerald-400">&#9733;</span>
                )}
                {isFuture && monthTargetTotal > 0 && (
                  <span className="text-[8px] text-amber-400/70">{formatCompact(monthTargetTotal)}</span>
                )}
                {isCurrent && monthTargetTotal > 0 && (
                  <span className="text-[8px] text-orange-400/70">{formatCompact(monthTargetTotal)}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
