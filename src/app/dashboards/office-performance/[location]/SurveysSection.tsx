"use client";

import type { SurveyData } from "@/lib/office-performance-types";
import GoalProgress from "./GoalProgress";
import Leaderboard from "./Leaderboard";

interface SurveysSectionProps {
  data: SurveyData;
}

export default function SurveysSection({ data }: SurveysSectionProps) {
  const turnaroundTrend = data.avgTurnaroundPrior > 0
    ? data.avgTurnaroundDays - data.avgTurnaroundPrior
    : 0;
  const trendImproving = turnaroundTrend < 0;

  return (
    <div className="flex flex-col h-full px-6 py-4">
      <div className="text-sm font-semibold text-blue-500 tracking-widest mb-4">
        SURVEYS
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white/5 rounded-xl p-4">
          <GoalProgress
            current={data.completedMtd}
            goal={data.completedGoal}
            label="Completed MTD"
            accentColor="#3b82f6"
          />
        </div>

        <div className="bg-white/5 rounded-xl p-4 text-center">
          <div className="text-[42px] font-extrabold text-green-500">
            {data.avgTurnaroundDays > 0 ? data.avgTurnaroundDays.toFixed(1) : "--"}
            {data.avgTurnaroundDays > 0 && <span className="text-xl">d</span>}
          </div>
          <div className="text-xs text-slate-400 mt-1">Avg Turnaround</div>
          {turnaroundTrend !== 0 && (
            <div className={`text-xs mt-1 ${trendImproving ? "text-green-500" : "text-red-500"}`}>
              {trendImproving ? "▼" : "▲"} {Math.abs(turnaroundTrend).toFixed(1)}d vs last month
            </div>
          )}
        </div>

        <div className="bg-white/5 rounded-xl p-4 text-center">
          <div className="text-[42px] font-extrabold text-orange-500">{data.scheduledThisWeek}</div>
          <div className="text-xs text-slate-400 mt-1">Scheduled This Week</div>
        </div>
      </div>

      <Leaderboard
        title="SURVEYOR LEADERBOARD — THIS MONTH"
        icon="🏆"
        entries={data.leaderboard}
        accentColor="#3b82f6"
      />
    </div>
  );
}
