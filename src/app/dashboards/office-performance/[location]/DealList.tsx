"use client";

import { useEffect, useState } from "react";
import type { DealRow } from "@/lib/office-performance-types";

type DealListVariant = "survey" | "install" | "inspection" | "service";

interface DealListProps {
  deals: DealRow[];
  variant?: DealListVariant;
}

function formatDollar(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}k`;
  return `$${amount.toFixed(0)}`;
}

function stageColor(deal: DealRow): string {
  if (deal.isCompleted) return "#22c55e";
  if (deal.isFailed) return "#ef4444";
  if (deal.overdue) return "#f59e0b";
  return "#94a3b8";
}

function statusBadgeColor(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("completed") || s.includes("passed") || s === "construction complete") return "#22c55e";
  if (s.includes("started") || s.includes("in progress")) return "#3b82f6";
  if (s.includes("scheduled")) return "#8b5cf6";
  if (s.includes("failed")) return "#ef4444";
  return "#64748b";
}

export default function DealList({ deals, variant = "survey" }: DealListProps) {
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(setTimeout(() => setVisibleCount(0), 0));
    deals.forEach((_, i) => {
      timers.push(setTimeout(() => setVisibleCount(i + 1), 50 * (i + 1)));
    });
    return () => timers.forEach(clearTimeout);
  }, [deals]);

  if (deals.length === 0) return null;

  const showAmount = variant === "survey" || variant === "service";
  const showPE = variant === "install" || variant === "inspection";

  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-2 overflow-hidden">
      <table className="w-full text-sm table-fixed">
        <thead>
          <tr className="text-[11px] text-slate-500 tracking-wider uppercase">
            <th className="text-left pb-1.5 font-semibold" style={{ width: "40%" }}>DEAL</th>
            <th className="text-left pb-1.5 font-semibold" style={{ width: "15%" }}>STAGE</th>
            <th className="text-left pb-1.5 font-semibold" style={{ width: "12%" }}>STATUS</th>
            <th className="text-right pb-1.5 font-semibold" style={{ width: "8%" }}>DAYS</th>
            <th className="text-left pb-1.5 font-semibold pl-3" style={{ width: showAmount ? "10%" : "15%" }}>ASSIGNED</th>
            {showAmount && (
              <th className="text-right pb-1.5 font-semibold" style={{ width: "10%" }}>AMOUNT</th>
            )}
            {showPE && (
              <th className="text-center pb-1.5 font-semibold" style={{ width: "5%" }}></th>
            )}
          </tr>
        </thead>
        <tbody>
          {deals.map((deal, i) => {
            const isVisible = i < visibleCount;
            return (
              <tr
                key={`${deal.name}-${i}`}
                className="transition-all duration-200"
                style={{
                  opacity: isVisible ? 1 : 0,
                  transform: isVisible ? "translateX(0)" : "translateX(-12px)",
                }}
              >
                {/* Deal name with left border indicator */}
                <td className="py-1 pr-2 max-w-0">
                  <div
                    className="text-slate-200 font-medium truncate"
                    style={{
                      borderLeft: `3px solid ${
                        deal.isCompleted ? "rgba(34,197,94,0.5)" :
                        deal.isFailed ? "rgba(239,68,68,0.6)" :
                        deal.overdue ? "rgba(239,68,68,0.6)" :
                        "transparent"
                      }`,
                      paddingLeft: "8px",
                    }}
                    title={deal.name}
                  >
                    {deal.name}
                  </div>
                </td>

                {/* Stage */}
                <td className="py-1 truncate" style={{ color: stageColor(deal) }}>
                  {deal.stage}
                </td>

                {/* Job status badge */}
                <td className="py-1">
                  {deal.jobStatus ? (
                    <span
                      className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold leading-tight truncate max-w-full"
                      style={{
                        color: statusBadgeColor(deal.jobStatus),
                        backgroundColor: `${statusBadgeColor(deal.jobStatus)}18`,
                        border: `1px solid ${statusBadgeColor(deal.jobStatus)}30`,
                      }}
                    >
                      {deal.jobStatus}
                    </span>
                  ) : deal.isCompleted ? (
                    <span className="text-green-400 text-xs">Done</span>
                  ) : (
                    <span className="text-slate-600 text-xs">—</span>
                  )}
                </td>

                {/* Days in stage */}
                <td className="py-1 text-right text-slate-300 font-mono text-xs">
                  {deal.isCompleted ? (
                    <span className="text-green-400">✓</span>
                  ) : deal.isFailed ? (
                    <span className="text-red-400">{deal.daysInStage}d</span>
                  ) : deal.overdue ? (
                    <span className="text-amber-400" title={`${deal.daysOverdue}d overdue`}>
                      {deal.daysInStage}d ⚠️
                    </span>
                  ) : (
                    `${deal.daysInStage}d`
                  )}
                </td>

                {/* Assigned users */}
                <td className="py-1 pl-3 text-slate-400 truncate text-xs">
                  {deal.assignedUsers && deal.assignedUsers.length > 0
                    ? deal.assignedUsers.map((u) => u.split(" ")[0]).join(", ")
                    : "—"}
                </td>

                {/* Amount (surveys only) */}
                {showAmount && (
                  <td className="py-1 text-right text-slate-300 font-mono text-xs">
                    {deal.amount ? formatDollar(deal.amount) : "—"}
                  </td>
                )}

                {/* PE flag (installs + inspections) */}
                {showPE && (
                  <td className="py-1 text-center">
                    {deal.isPE && (
                      <span
                        className="inline-block px-1 py-0.5 rounded text-[9px] font-bold leading-none"
                        style={{ color: "#f59e0b", backgroundColor: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.3)" }}
                        title="Participate Energy — push for completion"
                      >
                        PE
                      </span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
