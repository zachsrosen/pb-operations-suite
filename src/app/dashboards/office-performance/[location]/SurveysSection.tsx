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

  const completionRate = data.scheduledMtd > 0
    ? Math.round((data.completedMtd / data.scheduledMtd) * 100)
    : 0;

  function completionRateColor(rate: number): string {
    if (rate >= 90) return "#22c55e";
    if (rate >= 75) return "#eab308";
    return "#ef4444";
  }

  return (
    <div className="flex flex-col h-full px-8 py-5 overflow-hidden">
      {/* Top metrics */}
      <div className="grid grid-cols-4 gap-4 mb-4 flex-shrink-0">
        <div className="bg-white/[0.04] rounded-2xl p-5 text-center border border-white/5">
          <CountUp
            value={data.completedMtd}
            className="text-[64px] font-extrabold text-blue-400 leading-none"
          />
          <div className="text-sm text-slate-400 mt-2">Surveys Completed This Month</div>
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

        <div className="bg-white/[0.04] rounded-2xl p-5 text-center border border-white/5">
          <CountUp
            value={completionRate}
            suffix="%"
            className="text-[64px] font-extrabold leading-none"
            style={{ color: data.scheduledMtd > 0 ? completionRateColor(completionRate) : "#64748b" }}
          />
          <div className="text-sm text-slate-400 mt-2">
            {data.scheduledMtd > 0 ? "Completion Rate" : "Completion Rate N/A"}
          </div>
          {data.scheduledMtd > 0 && (
            <div className="text-xs text-slate-500 mt-0.5">
              {data.completedMtd} of {data.scheduledMtd} scheduled
            </div>
          )}
        </div>
      </div>

      {/* Deal list + compliance */}
      <div className="grid grid-cols-2 gap-3 mb-3 flex-shrink-0 overflow-hidden items-start">
        <DealList deals={data.deals} />
        <ComplianceBlock compliance={data.compliance} />
      </div>

      {/* Leaderboard with turnaround */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <Leaderboard
          title="SURVEYOR LEADERBOARD — THIS MONTH"
          icon="🏆"
          entries={data.leaderboard}
          accentColor="#3b82f6"
          showTurnaround
          metricLabel="surveys"
        />
      </div>
    </div>
  );
}
