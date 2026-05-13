"use client";

import { useEffect, useState } from "react";
import type { DealRow } from "@/lib/office-performance-types";

interface DealListProps {
  deals: DealRow[];
  showAssigned?: boolean;
}

export default function DealList({ deals, showAssigned = true }: DealListProps) {
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(setTimeout(() => setVisibleCount(0), 0));
    deals.forEach((_, i) => {
      timers.push(setTimeout(() => setVisibleCount(i + 1), 60 * (i + 1)));
    });
    return () => timers.forEach(clearTimeout);
  }, [deals]);

  if (deals.length === 0) return null;

  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-2 overflow-hidden">
      <table className="w-full text-base table-fixed">
        <thead>
          <tr className="text-sm text-slate-500 tracking-wider">
            <th className="text-left pb-1.5 font-semibold whitespace-nowrap" style={{ width: "55%" }}>DEAL</th>
            <th className="text-left pb-1.5 font-semibold whitespace-nowrap" style={{ width: "20%" }}>STAGE</th>
            <th className="text-right pb-1.5 font-semibold whitespace-nowrap" style={{ width: "10%" }}>DAYS</th>
            <th className="text-center pb-1.5 font-semibold" style={{ width: "5%" }}></th>
            {showAssigned && (
              <th className="text-left pb-1.5 font-semibold whitespace-nowrap" style={{ width: "10%" }}>ASSIGNED</th>
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
                <td className="py-1 pr-2 max-w-0">
                  <div
                    className="text-slate-200 font-medium truncate"
                    style={{
                      borderLeft: deal.overdue ? "3px solid rgba(239,68,68,0.6)" : "3px solid transparent",
                      paddingLeft: "8px",
                    }}
                    title={deal.name}
                  >
                    {deal.name}
                  </div>
                </td>
                <td
                  className="py-1 truncate"
                  style={{
                    color: deal.stage === "Completed" ? "#22c55e" :
                           deal.stage === "Failed" ? "#ef4444" :
                           "#94a3b8",
                  }}
                >
                  {deal.stage}
                </td>
                <td className="py-1 text-right text-slate-300 font-mono">
                  {deal.stage === "Completed" ? "" : `${deal.daysInStage}d`}
                </td>
                <td className="py-1 text-center">
                  {deal.stage === "Completed" ? (
                    <span className="text-green-400">✓</span>
                  ) : deal.overdue ? (
                    <span title={`${deal.daysOverdue}d overdue`}>⚠️</span>
                  ) : null}
                </td>
                {showAssigned && (
                  <td className="py-1 pl-4 text-slate-400 truncate">
                    {deal.assignedUsers && deal.assignedUsers.length > 0
                      ? deal.assignedUsers.join(", ")
                      : "—"}
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
