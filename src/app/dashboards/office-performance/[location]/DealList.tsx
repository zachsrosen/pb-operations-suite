"use client";

import { useEffect, useState } from "react";
import type { DealRow } from "@/lib/office-performance-types";

interface DealListProps {
  deals: DealRow[];
  totalCount: number;
  showAssigned?: boolean;
}

export default function DealList({ deals, totalCount, showAssigned = true }: DealListProps) {
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

  const remaining = totalCount - deals.length;

  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-2">
      <table className="w-full text-sm table-auto">
        <thead>
          <tr className="text-xs text-slate-500 tracking-wider">
            <th className="text-left pb-1 font-semibold whitespace-nowrap">DEAL</th>
            <th className="text-left pb-1 font-semibold w-20 whitespace-nowrap">STAGE</th>
            <th className="text-right pb-1 font-semibold w-14 whitespace-nowrap">DAYS</th>
            <th className="text-center pb-1 font-semibold w-6"></th>
            {showAssigned && (
              <th className="text-left pb-1 font-semibold whitespace-nowrap">ASSIGNED</th>
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
                <td className="py-0.5 pr-2">
                  <div
                    className="text-slate-200 font-medium"
                    style={{
                      borderLeft: deal.overdue ? "3px solid rgba(239,68,68,0.6)" : "3px solid transparent",
                      paddingLeft: "8px",
                    }}
                  >
                    {deal.name}
                  </div>
                </td>
                <td className="py-0.5 text-slate-400">{deal.stage}</td>
                <td className="py-0.5 text-right text-slate-300 font-mono">
                  {deal.daysInStage}d
                </td>
                <td className="py-0.5 text-center">
                  {deal.overdue && (
                    <span title={`${deal.daysOverdue}d overdue`}>⚠️</span>
                  )}
                </td>
                {showAssigned && (
                  <td className="py-0.5 pl-4 text-slate-400 whitespace-nowrap">
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
      {remaining > 0 && (
        <div className="text-xs text-slate-500 mt-1 pl-3">
          +{remaining} more project{remaining !== 1 ? "s" : ""}
        </div>
      )}
    </div>
  );
}
