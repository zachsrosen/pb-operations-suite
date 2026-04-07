"use client";

import type { InstallData } from "@/lib/office-performance-types";
import GoalProgress from "./GoalProgress";
import Leaderboard from "./Leaderboard";

interface InstallsSectionProps {
  data: InstallData;
}

export default function InstallsSection({ data }: InstallsSectionProps) {
  const daysTrend = data.avgDaysPerInstallPrior > 0
    ? data.avgDaysPerInstall - data.avgDaysPerInstallPrior
    : 0;
  const trendImproving = daysTrend < 0;

  return (
    <div className="flex flex-col h-full px-6 py-4">
      <div className="text-sm font-semibold text-green-500 tracking-widest mb-4">
        INSTALLS
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white/5 rounded-xl p-4">
          <GoalProgress
            current={data.completedMtd}
            goal={data.completedGoal}
            label="Completed MTD"
            accentColor="#22c55e"
          />
        </div>

        <div className="bg-white/5 rounded-xl p-4 text-center">
          <div className="text-[42px] font-extrabold text-blue-500">
            {data.avgDaysPerInstall > 0 ? data.avgDaysPerInstall.toFixed(1) : "--"}
            {data.avgDaysPerInstall > 0 && <span className="text-xl">d</span>}
          </div>
          <div className="text-xs text-slate-400 mt-1">Avg Days/Install</div>
          {daysTrend !== 0 && (
            <div className={`text-xs mt-1 ${trendImproving ? "text-green-500" : "text-red-500"}`}>
              {trendImproving ? "▼" : "▲"} {Math.abs(daysTrend).toFixed(1)}d vs last month
            </div>
          )}
        </div>

        <div className="bg-white/5 rounded-xl p-4 text-center">
          <div className="text-[42px] font-extrabold text-orange-500">
            {data.capacityUtilization >= 0 ? `${data.capacityUtilization}` : "--"}
            {data.capacityUtilization >= 0 && <span className="text-xl">%</span>}
          </div>
          <div className="text-xs text-slate-400 mt-1">Capacity Used</div>
        </div>

        <div className="bg-white/5 rounded-xl p-4 text-center">
          <div className="text-[42px] font-extrabold text-cyan-400">{data.scheduledThisWeek}</div>
          <div className="text-xs text-slate-400 mt-1">Scheduled This Week</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Leaderboard
          title="INSTALLERS — THIS MONTH"
          icon="⚡"
          entries={data.installerLeaderboard}
          accentColor="#22c55e"
        />
        <Leaderboard
          title="ELECTRICIANS — THIS MONTH"
          icon="🔌"
          entries={data.electricianLeaderboard}
          accentColor="#22c55e"
        />
      </div>
    </div>
  );
}
