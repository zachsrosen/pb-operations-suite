"use client";

import type { PipelineData } from "@/lib/office-performance-types";
import GoalProgress from "./GoalProgress";

interface PipelineSectionProps {
  data: PipelineData;
}

export default function PipelineSection({ data }: PipelineSectionProps) {
  const avgTrend = data.avgDaysInStagePrior > 0
    ? data.avgDaysInStage - data.avgDaysInStagePrior
    : 0;
  const trendImproving = avgTrend < 0;

  return (
    <div className="flex flex-col h-full px-6 py-4">
      <div className="text-sm font-semibold text-orange-500 tracking-widest mb-4">
        PIPELINE OVERVIEW
      </div>

      {/* Top metrics */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white/5 rounded-xl p-4 text-center">
          <div className="text-[42px] font-extrabold text-orange-500">{data.activeProjects}</div>
          <div className="text-xs text-slate-400 mt-1">Active Projects</div>
        </div>

        <div className="bg-white/5 rounded-xl p-4">
          <GoalProgress
            current={data.completedMtd}
            goal={data.completedGoal}
            label="Completed MTD"
            accentColor="#22c55e"
          />
        </div>

        <div className="bg-white/5 rounded-xl p-4 text-center">
          <div
            className="text-[42px] font-extrabold"
            style={{ color: data.overdueCount > 5 ? "#ef4444" : data.overdueCount > 0 ? "#eab308" : "#22c55e" }}
          >
            {data.overdueCount}
          </div>
          <div className="text-xs text-slate-400 mt-1">Overdue</div>
        </div>

        <div className="bg-white/5 rounded-xl p-4 text-center">
          <div className="text-[42px] font-extrabold text-cyan-400">{data.avgDaysInStage}</div>
          <div className="text-xs text-slate-400 mt-1">Avg Days in Stage</div>
          {avgTrend !== 0 && (
            <div className={`text-xs mt-1 ${trendImproving ? "text-green-500" : "text-red-500"}`}>
              {trendImproving ? "▼" : "▲"} {Math.abs(avgTrend).toFixed(1)}d vs last month
            </div>
          )}
        </div>
      </div>

      {/* Stage distribution bar chart */}
      <div className="flex gap-1 mb-5 items-end flex-1 min-h-0">
        {data.stageDistribution.map((s) => {
          const maxCount = Math.max(...data.stageDistribution.map((d) => d.count), 1);
          const height = Math.max((s.count / maxCount) * 100, 10);
          const stageColors: Record<string, string> = {
            Survey: "#3b82f6",
            Design: "#8b5cf6",
            Permit: "#f97316",
            RTB: "#22c55e",
            Install: "#06b6d4",
            Inspect: "#ec4899",
          };
          return (
            <div key={s.stage} className="flex-1 text-center">
              <div
                className="rounded-t-md flex items-center justify-center font-bold text-lg mx-auto"
                style={{
                  backgroundColor: stageColors[s.stage] || "#6b7280",
                  height: `${height}%`,
                  minHeight: "24px",
                }}
              >
                {s.count}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">{s.stage}</div>
            </div>
          );
        })}
      </div>

      {/* Recent wins */}
      {data.recentWins.length > 0 && (
        <div className="rounded-lg border border-white/5 bg-white/[0.03] px-4 py-2.5 flex items-center gap-3">
          <span className="text-xs font-semibold text-slate-400 tracking-wider">RECENT WINS</span>
          {data.recentWins.map((win, i) => (
            <span key={i} className="text-sm text-slate-200">{win}</span>
          ))}
        </div>
      )}
    </div>
  );
}
