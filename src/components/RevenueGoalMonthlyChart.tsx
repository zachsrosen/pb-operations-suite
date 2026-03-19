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

  // Compute per-month stacked totals
  const monthTotals = MONTH_LABELS.map((_, i) => ({
    actual: displayGroups.reduce((s, g) => s + g.months[i].actual, 0),
    target: displayGroups.reduce((s, g) => s + g.months[i].effectiveTarget, 0),
  }));
  // Scale bars against max actual only — targets shown as overlay lines
  const maxActual = Math.max(...monthTotals.map((m) => m.actual), 1);
  // For target line positioning, cap at bar area height
  const maxScale = Math.max(maxActual, ...monthTotals.map((m) => m.target));
  const isSingleGroup = displayGroups.length === 1;

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
          const { actual: monthActual, target: monthTarget } = monthTotals[monthIdx];
          // Target line scales against full range (may be above bars)
          const targetPct = maxScale > 0 ? Math.min((monthTarget / maxScale) * 100, 100) : 0;

          return (
            <div key={label} className="flex flex-col items-center">
              {/* Dollar label above bars */}
              <div className="h-6 flex items-end justify-center mb-0.5">
                {monthActual > 0 && (
                  <span className={`text-[9px] font-medium ${
                    isCurrent ? "text-orange-400" : "text-foreground/70"
                  }`}>{formatCompact(monthActual)}</span>
                )}
              </div>

              {/* Bar area — stacked bars */}
              <div className="relative w-full h-40 flex items-end justify-center"
                title={`${formatCurrency(monthActual)} actual / ${formatCurrency(monthTarget)} target`}>
                {/* Target dashed line */}
                <div className="absolute w-full border-t border-dashed border-white/25 z-10" style={{ bottom: `${targetPct}%` }} />

                {/* Future months: ghost target bar */}
                {isFuture && monthTarget > 0 && (
                  <div
                    className="absolute bottom-0 w-3/4 rounded-t border border-dashed border-white/15"
                    style={{ height: `${targetPct}%` }}
                  />
                )}

                {/* Stacked actual bars */}
                <div className="w-3/4 flex flex-col-reverse items-stretch">
                  {displayGroups.map((group) => {
                    const monthData = group.months[monthIdx];
                    const segmentPct = maxActual > 0 ? (monthData.actual / maxActual) * 100 : 0;
                    if (monthData.actual <= 0) return null;

                    return (
                      <div
                        key={group.groupKey}
                        className={`w-full transition-all duration-500 first:rounded-b last:rounded-t ${
                          monthData.hit ? "ring-1 ring-emerald-400/50" :
                          monthData.missed ? "opacity-80" : ""
                        }`}
                        style={{
                          height: `${segmentPct}%`,
                          backgroundColor: monthData.missed ? `${group.color}88` : group.color,
                          minHeight: "2px",
                        }}
                        title={`${group.displayName}: ${formatCurrency(monthData.actual)}`}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Month label */}
              <span className={`text-[9px] mt-1 ${
                isCurrent ? "text-orange-400 font-bold" :
                isFuture ? "text-muted/50" : "text-muted"
              }`}>{label}</span>

              {/* Status indicators + target for filtered views */}
              <div className="h-5 flex flex-col items-center justify-start">
                <div className="flex gap-0.5">
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
                {/* Show per-month target when filtered to specific group(s) */}
                {isSingleGroup && (isFuture || isCurrent) && monthTarget > 0 && (
                  <span className={`text-[8px] ${isCurrent ? "text-orange-400/70" : "text-amber-400/70"}`}>
                    {formatCompact(monthTarget)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
