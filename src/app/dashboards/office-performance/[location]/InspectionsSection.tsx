"use client";

import type { InspectionData } from "@/lib/office-performance-types";
import GoalProgress from "./GoalProgress";
import CountUp from "./CountUp";
import Leaderboard from "./Leaderboard";
import DealList from "./DealList";
import ComplianceBlock from "./ComplianceBlock";

interface InspectionsSectionProps {
  data: InspectionData;
}

export default function InspectionsSection({ data }: InspectionsSectionProps) {
  const constructionTrend = data.avgConstructionDaysPrior > 0
    ? data.avgConstructionDays - data.avgConstructionDaysPrior
    : 0;
  const ccPtoTrend = data.avgCcToPtoDaysPrior > 0
    ? data.avgCcToPtoDays - data.avgCcToPtoDaysPrior
    : 0;

  function passRateColor(rate: number): string {
    if (rate >= 90) return "#22c55e";
    if (rate >= 75) return "#eab308";
    return "#ef4444";
  }

  return (
    <div className="flex flex-col h-full px-8 py-5">
      {/* Top metrics */}
      <div className="grid grid-cols-4 gap-5 mb-6">
        <div className="bg-white/[0.04] rounded-2xl p-5 flex items-center justify-center border border-white/5">
          <GoalProgress
            current={data.completedMtd}
            goal={data.completedGoal}
            label="Inspections MTD"
            accentColor="#06b6d4"
          />
        </div>

        <div className="bg-white/[0.04] rounded-2xl p-5 text-center border border-white/5">
          <CountUp
            value={data.firstPassRate > 0 ? data.firstPassRate : 0}
            suffix={data.firstPassRate > 0 ? "%" : ""}
            className="text-[64px] font-extrabold leading-none"
            style={{ color: data.firstPassRate > 0 ? passRateColor(data.firstPassRate) : "#64748b" }}
          />
          <div className="text-sm text-slate-400 mt-2">
            {data.firstPassRate > 0 ? "First-Pass Rate" : "Pass Rate N/A"}
          </div>
          {data.firstPassRate > 0 && (
            <div className="text-xs text-slate-500 mt-0.5">60-day rolling</div>
          )}
        </div>

        <div className="bg-white/[0.04] rounded-2xl p-5 text-center border border-white/5">
          <CountUp
            value={data.avgConstructionDays}
            decimals={1}
            suffix="d"
            className="text-[64px] font-extrabold text-green-400 leading-none"
          />
          <div className="text-sm text-slate-400 mt-2">Avg Construction</div>
          {constructionTrend !== 0 && (
            <div className={`text-xs mt-1.5 ${constructionTrend < 0 ? "text-green-400" : "text-red-400"}`}>
              {constructionTrend < 0 ? "▼" : "▲"} {Math.abs(constructionTrend).toFixed(1)}d vs prior
            </div>
          )}
        </div>

        <div className="bg-white/[0.04] rounded-2xl p-5 text-center border border-white/5">
          <CountUp
            value={data.avgCcToPtoDays}
            decimals={1}
            suffix="d"
            className="text-[64px] font-extrabold leading-none"
            style={{ color: data.avgCcToPtoDays > 15 ? "#ef4444" : data.avgCcToPtoDays > 10 ? "#eab308" : "#22c55e" }}
          />
          <div className="text-sm text-slate-400 mt-2">CC → PTO</div>
          {ccPtoTrend !== 0 && (
            <div className={`text-xs mt-1.5 ${ccPtoTrend < 0 ? "text-green-400" : "text-red-400"}`}>
              {ccPtoTrend < 0 ? "▼" : "▲"} {Math.abs(ccPtoTrend).toFixed(1)}d vs prior
            </div>
          )}
        </div>
      </div>

      {/* Deal list + compliance */}
      <div className="flex flex-col gap-3 mb-4">
        <DealList deals={data.deals} totalCount={data.totalCount} />
        <ComplianceBlock compliance={data.compliance} />
      </div>

      {/* Leaderboard with pass rates */}
      <Leaderboard
        title="INSPECTION TECHS — THIS MONTH"
        icon="🏆"
        entries={data.leaderboard}
        accentColor="#06b6d4"
        showPassRate
        metricLabel="inspections"
      />
    </div>
  );
}
