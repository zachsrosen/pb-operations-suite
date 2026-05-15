"use client";

import type { ServiceData } from "@/lib/office-performance-types";
import CountUp from "./CountUp";
import Leaderboard from "./Leaderboard";
import DealList from "./DealList";
import ComplianceBlock from "./ComplianceBlock";

interface ServiceSectionProps {
  data: ServiceData;
}

function stageBarColor(stage: string): string {
  switch (stage) {
    case "Project Preparation": return "#3b82f6";
    case "Site Visit Scheduling": return "#f59e0b";
    case "Work In Progress": return "#22c55e";
    case "Inspection": return "#06b6d4";
    case "Invoicing": return "#a855f7";
    default: return "#64748b";
  }
}

export default function ServiceSection({ data }: ServiceSectionProps) {
  const maxStageCount = Math.max(...data.dealsByStage.map((s) => s.count), 1);

  return (
    <div className="flex flex-col h-full px-8 py-5 overflow-hidden">
      {/* Top metrics */}
      <div className="grid grid-cols-4 gap-4 mb-4 flex-shrink-0">
        <div className="bg-white/[0.04] rounded-2xl p-5 text-center border border-white/5">
          <CountUp
            value={data.openTickets}
            className="text-[64px] font-extrabold text-red-400 leading-none"
          />
          <div className="text-sm text-slate-400 mt-2">Open Service Tickets</div>
        </div>

        <div className="bg-white/[0.04] rounded-2xl p-5 text-center border border-white/5">
          <CountUp
            value={data.resolvedMtd}
            className="text-[64px] font-extrabold text-green-400 leading-none"
          />
          <div className="text-sm text-slate-400 mt-2">Resolved This Month</div>
        </div>

        <div className="bg-white/[0.04] rounded-2xl p-5 text-center border border-white/5">
          <CountUp
            value={data.avgDaysToResolve}
            decimals={1}
            suffix="d"
            className="text-[64px] font-extrabold text-amber-400 leading-none"
          />
          <div className="text-sm text-slate-400 mt-2">Avg Days to Resolve</div>
        </div>

        <div className="bg-white/[0.04] rounded-2xl p-5 text-center border border-white/5">
          <CountUp
            value={data.activeDeals}
            className="text-[64px] font-extrabold text-blue-400 leading-none"
          />
          <div className="text-sm text-slate-400 mt-2">Active Service Deals</div>
        </div>
      </div>

      {/* Stage distribution bar chart */}
      {data.dealsByStage.length > 0 && (
        <div className="bg-white/[0.04] rounded-2xl p-4 border border-white/5 mb-3 flex-shrink-0">
          <div className="text-xs font-semibold text-slate-400 tracking-wider mb-3">
            SERVICE PIPELINE BY STAGE
          </div>
          <div className="flex gap-2 items-end h-16">
            {data.dealsByStage.map((s) => (
              <div key={s.stage} className="flex-1 flex flex-col items-center gap-1">
                <div className="text-xs font-bold text-slate-300">{s.count}</div>
                <div
                  className="w-full rounded-t-md transition-all"
                  style={{
                    height: `${Math.max((s.count / maxStageCount) * 48, 4)}px`,
                    backgroundColor: stageBarColor(s.stage),
                  }}
                />
                <div className="text-[10px] text-slate-500 truncate max-w-full" title={s.stage}>
                  {s.stage
                    .replace("Project Preparation", "Prep")
                    .replace("Site Visit Scheduling", "Scheduling")
                    .replace("Work In Progress", "WIP")}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Deal list */}
      <div className="mb-2 flex-shrink-0 overflow-hidden">
        <DealList deals={data.deals} variant="service" />
      </div>

      {/* Compliance block */}
      <div className="mb-3 flex-shrink-0">
        <ComplianceBlock compliance={data.compliance} />
      </div>

      {/* Tech leaderboard */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <Leaderboard
          title="SERVICE TECH LEADERBOARD — THIS MONTH"
          icon="🔧"
          entries={data.leaderboard}
          accentColor="#ef4444"
          metricLabel="jobs"
        />
      </div>
    </div>
  );
}
