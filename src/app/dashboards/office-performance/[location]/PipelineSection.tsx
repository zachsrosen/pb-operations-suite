"use client";

import type { PipelineData } from "@/lib/office-performance-types";
import GoalProgress from "./GoalProgress";
import CountUp from "./CountUp";
import AnimatedBar from "./AnimatedBar";

interface PipelineSectionProps {
  data: PipelineData;
}

const STAGE_COLORS: Record<string, string> = {
  Survey: "#3b82f6",
  Design: "#8b5cf6",
  Permit: "#f97316",
  RTB: "#22c55e",
  Install: "#06b6d4",
  Inspect: "#ec4899",
};

export default function PipelineSection({ data }: PipelineSectionProps) {
  const avgTrend = data.avgDaysInStagePrior > 0
    ? data.avgDaysInStage - data.avgDaysInStagePrior
    : 0;
  const trendImproving = avgTrend < 0;
  const maxStageCount = Math.max(...data.stageDistribution.map((d) => d.count), 1);

  return (
    <div className="flex flex-col h-full px-8 py-5">
      {/* Top metrics row */}
      <div className="grid grid-cols-4 gap-5 mb-6">
        <div className="bg-white/[0.04] rounded-2xl p-5 text-center border border-white/5">
          <CountUp
            value={data.activeProjects}
            className="text-[64px] font-extrabold text-orange-500 leading-none"
          />
          <div className="text-sm text-slate-400 mt-2">Active Projects</div>
        </div>

        <div className="bg-white/[0.04] rounded-2xl p-5 flex items-center justify-center border border-white/5">
          <GoalProgress
            current={data.completedMtd}
            goal={data.completedGoal}
            label="Completed MTD"
            accentColor="#22c55e"
          />
        </div>

        <div className="bg-white/[0.04] rounded-2xl p-5 text-center border border-white/5">
          <CountUp
            value={data.overdueCount}
            className="text-[64px] font-extrabold leading-none"
            style={{ color: data.overdueCount > 5 ? "#ef4444" : data.overdueCount > 0 ? "#eab308" : "#22c55e" }}
          />
          <div className="text-sm text-slate-400 mt-2">Overdue</div>
        </div>

        <div className="bg-white/[0.04] rounded-2xl p-5 text-center border border-white/5">
          <CountUp
            value={data.avgDaysInStage}
            decimals={1}
            suffix="d"
            className="text-[64px] font-extrabold text-cyan-400 leading-none"
          />
          <div className="text-sm text-slate-400 mt-2">Avg Days in Stage</div>
          {avgTrend !== 0 && (
            <div className={`text-xs mt-1.5 ${trendImproving ? "text-green-400" : "text-red-400"}`}>
              {trendImproving ? "▼" : "▲"} {Math.abs(avgTrend).toFixed(1)}d vs prior
            </div>
          )}
        </div>
      </div>

      {/* Main content: stage distribution + person leaderboards */}
      <div className="grid grid-cols-5 gap-5 flex-1 min-h-0">
        {/* Stage distribution — 3 cols */}
        <div className="col-span-3 bg-white/[0.02] rounded-xl p-5 border border-white/5 flex flex-col">
          <div className="text-xs font-semibold text-slate-400 tracking-wider mb-3">
            📊 STAGE DISTRIBUTION
          </div>
          <div className="flex flex-col justify-center flex-1 gap-0.5">
            {data.stageDistribution.map((s, i) => (
              <AnimatedBar
                key={s.stage}
                count={s.count}
                maxCount={maxStageCount}
                label={s.stage}
                color={STAGE_COLORS[s.stage] || "#6b7280"}
                delay={i * 80}
              />
            ))}
          </div>
        </div>

        {/* Person breakdowns — 2 cols */}
        <div className="col-span-2 flex flex-col gap-4 overflow-auto">
          {/* PM breakdown */}
          {(data.pmLeaderboard?.length ?? 0) > 0 && (
            <div className="bg-white/[0.02] rounded-xl p-4 border border-white/5">
              <div className="text-xs font-semibold text-slate-400 tracking-wider mb-2.5">
                👤 PROJECT MANAGERS
              </div>
              {(data.pmLeaderboard ?? []).slice(0, 4).map((pm, i) => (
                <div key={pm.name} className="flex items-center gap-2 py-1.5">
                  <span className="text-sm font-semibold text-slate-200 flex-1 truncate">
                    {i === 0 ? "👑 " : ""}{pm.name}
                  </span>
                  <span className="text-sm font-bold text-orange-400">{pm.activeCount}</span>
                  <span className="text-[10px] text-slate-500">active</span>
                  {pm.completedMtd > 0 && (
                    <span className="text-[10px] text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded">
                      +{pm.completedMtd} MTD
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Designer breakdown */}
          {(data.designerLeaderboard?.length ?? 0) > 0 && (
            <div className="bg-white/[0.02] rounded-xl p-4 border border-white/5">
              <div className="text-xs font-semibold text-slate-400 tracking-wider mb-2.5">
                🎨 DESIGNERS
              </div>
              {(data.designerLeaderboard ?? []).slice(0, 4).map((d, i) => (
                <div key={d.name} className="flex items-center gap-2 py-1.5">
                  <span className="text-sm font-semibold text-slate-200 flex-1 truncate">
                    {i === 0 ? "👑 " : ""}{d.name}
                  </span>
                  <span className="text-sm font-bold text-purple-400">{d.activeCount}</span>
                  <span className="text-[10px] text-slate-500">active</span>
                  {d.avgDaysInStage != null && (
                    <span className="text-[10px] text-slate-400 bg-white/5 px-1.5 py-0.5 rounded">
                      {d.avgDaysInStage}d avg
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Deal owner breakdown */}
          {(data.ownerLeaderboard?.length ?? 0) > 0 && (
            <div className="bg-white/[0.02] rounded-xl p-4 border border-white/5">
              <div className="text-xs font-semibold text-slate-400 tracking-wider mb-2.5">
                💼 DEAL OWNERS
              </div>
              {(data.ownerLeaderboard ?? []).slice(0, 4).map((o, i) => (
                <div key={o.name} className="flex items-center gap-2 py-1.5">
                  <span className="text-sm font-semibold text-slate-200 flex-1 truncate">
                    {i === 0 ? "👑 " : ""}{o.name}
                  </span>
                  <span className="text-sm font-bold text-blue-400">{o.activeCount}</span>
                  <span className="text-[10px] text-slate-500">active</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent wins ticker */}
      {data.recentWins.length > 0 && (
        <div className="rounded-xl border border-white/5 bg-white/[0.02] px-5 py-3 mt-4 flex items-center gap-4 overflow-hidden">
          <span className="text-xs font-semibold text-slate-500 tracking-wider shrink-0">RECENT</span>
          <div className="flex gap-6 overflow-hidden">
            {data.recentWins.map((win, i) => (
              <span key={i} className="text-sm text-slate-200 whitespace-nowrap">{win}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
