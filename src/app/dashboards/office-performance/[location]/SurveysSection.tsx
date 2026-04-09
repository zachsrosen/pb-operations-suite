"use client";

import type { SurveyData } from "@/lib/office-performance-types";
import CountUp from "./CountUp";
import Leaderboard from "./Leaderboard";
import DealList from "./DealList";
import ComplianceBlock from "./ComplianceBlock";

interface SurveysSectionProps {
  data: SurveyData;
}

export default function SurveysSection({ data }: SurveysSectionProps) {
  const turnaroundTrend = data.avgTurnaroundPrior > 0
    ? data.avgTurnaroundDays - data.avgTurnaroundPrior
    : 0;
  const trendImproving = turnaroundTrend < 0;

  return (
    <div className="flex flex-col h-full px-8 py-5">
      {/* Top metrics */}
      <div className="grid grid-cols-3 gap-5 mb-6">
        <div className="bg-white/[0.04] rounded-2xl p-5 text-center border border-white/5">
          <CountUp
            value={data.completedMtd}
            className="text-[64px] font-extrabold text-blue-400 leading-none"
          />
          <div className="text-sm text-slate-400 mt-2">Done This Month</div>
        </div>

        <div className="bg-white/[0.04] rounded-2xl p-5 text-center border border-white/5">
          <CountUp
            value={data.avgTurnaroundDays}
            decimals={1}
            suffix="d"
            className="text-[64px] font-extrabold text-green-400 leading-none"
          />
          <div className="text-sm text-slate-400 mt-2">Avg Days to Complete</div>
          {turnaroundTrend !== 0 && (
            <div className={`text-xs mt-1.5 ${trendImproving ? "text-green-400" : "text-red-400"}`}>
              {trendImproving ? "▼" : "▲"} {Math.abs(turnaroundTrend).toFixed(1)}d vs prior 60d
            </div>
          )}
        </div>

        <div className="bg-white/[0.04] rounded-2xl p-5 text-center border border-white/5">
          <CountUp
            value={data.scheduledThisWeek}
            className="text-[64px] font-extrabold text-orange-400 leading-none"
          />
          <div className="text-sm text-slate-400 mt-2">Scheduled This Week</div>
        </div>
      </div>

      {/* Deal list + compliance */}
      <div className="flex flex-col gap-3 mb-4">
        <DealList deals={data.deals} totalCount={data.totalCount} />
        <ComplianceBlock compliance={data.compliance} />
      </div>

      {/* Leaderboard with turnaround */}
      <Leaderboard
        title="SURVEYOR LEADERBOARD — THIS MONTH"
        icon="🏆"
        entries={data.leaderboard}
        accentColor="#3b82f6"
        showTurnaround
        metricLabel="surveys"
      />
    </div>
  );
}
