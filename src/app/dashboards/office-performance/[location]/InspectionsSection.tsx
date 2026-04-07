"use client";

import type { InspectionData } from "@/lib/office-performance-types";
import GoalProgress from "./GoalProgress";
import Leaderboard from "./Leaderboard";

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

  function trendColor(trend: number): string {
    return trend < 0 ? "text-green-500" : trend > 0 ? "text-red-500" : "text-slate-400";
  }

  function trendArrow(trend: number): string {
    return trend < 0 ? "▼" : trend > 0 ? "▲" : "";
  }

  function passRateColor(rate: number): string {
    if (rate >= 90) return "#22c55e";
    if (rate >= 75) return "#eab308";
    return "#ef4444";
  }

  return (
    <div className="flex flex-col h-full px-6 py-4">
      <div className="text-sm font-semibold text-cyan-400 tracking-widest mb-4">
        INSPECTIONS & QUALITY
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white/5 rounded-xl p-4">
          <GoalProgress
            current={data.completedMtd}
            goal={data.completedGoal}
            label="Inspections MTD"
            accentColor="#06b6d4"
          />
        </div>

        <div className="bg-white/5 rounded-xl p-4 text-center">
          <div className="text-[42px] font-extrabold" style={{ color: passRateColor(data.firstPassRate) }}>
            {data.firstPassRate > 0 ? data.firstPassRate : "--"}
            {data.firstPassRate > 0 && <span className="text-xl">%</span>}
          </div>
          <div className="text-xs text-slate-400 mt-1">First-Pass Rate</div>
          <div className="text-xs text-slate-500 mt-0.5">60-day rolling</div>
        </div>

        <div className="bg-white/5 rounded-xl p-4 text-center">
          <div className="text-[42px] font-extrabold text-green-500">
            {data.avgConstructionDays > 0 ? data.avgConstructionDays.toFixed(1) : "--"}
            {data.avgConstructionDays > 0 && <span className="text-xl">d</span>}
          </div>
          <div className="text-xs text-slate-400 mt-1">Avg Construction Time</div>
          {constructionTrend !== 0 && (
            <div className={`text-xs mt-1 ${trendColor(constructionTrend)}`}>
              {trendArrow(constructionTrend)} {Math.abs(constructionTrend).toFixed(1)}d vs last month
            </div>
          )}
        </div>

        <div className="bg-white/5 rounded-xl p-4 text-center">
          <div
            className="text-[42px] font-extrabold"
            style={{ color: data.avgCcToPtoDays > 15 ? "#ef4444" : data.avgCcToPtoDays > 10 ? "#eab308" : "#22c55e" }}
          >
            {data.avgCcToPtoDays > 0 ? data.avgCcToPtoDays.toFixed(1) : "--"}
            {data.avgCcToPtoDays > 0 && <span className="text-xl">d</span>}
          </div>
          <div className="text-xs text-slate-400 mt-1">CC → PTO</div>
          {ccPtoTrend !== 0 && (
            <div className={`text-xs mt-1 ${trendColor(ccPtoTrend)}`}>
              {trendArrow(ccPtoTrend)} {Math.abs(ccPtoTrend).toFixed(1)}d vs last month
            </div>
          )}
        </div>
      </div>

      <Leaderboard
        title="INSPECTION TECHS — THIS MONTH"
        icon="🏆"
        entries={data.leaderboard}
        accentColor="#06b6d4"
        showPassRate
      />
    </div>
  );
}
