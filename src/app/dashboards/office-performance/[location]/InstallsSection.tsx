"use client";

import type { InstallData } from "@/lib/office-performance-types";
import GoalProgress from "./GoalProgress";
import CountUp from "./CountUp";
import Leaderboard from "./Leaderboard";
import DealList from "./DealList";
import ComplianceBlock from "./ComplianceBlock";

interface InstallsSectionProps {
  data: InstallData;
}

export default function InstallsSection({ data }: InstallsSectionProps) {
  const daysTrend = data.avgDaysPerInstallPrior > 0
    ? data.avgDaysPerInstall - data.avgDaysPerInstallPrior
    : 0;
  const trendImproving = daysTrend < 0;

  return (
    <div className="flex flex-col h-full px-8 py-5">
      {/* Top metrics */}
      <div className="grid grid-cols-4 gap-5 mb-6">
        <div className="bg-white/[0.04] rounded-2xl p-5 flex items-center justify-center border border-white/5">
          <GoalProgress
            current={data.completedMtd}
            goal={data.completedGoal}
            label="Done This Month"
            accentColor="#22c55e"
          />
        </div>

        <div className="bg-white/[0.04] rounded-2xl p-5 text-center border border-white/5">
          <CountUp
            value={data.avgDaysPerInstall}
            decimals={1}
            suffix="d"
            className="text-[64px] font-extrabold text-blue-400 leading-none"
          />
          <div className="text-sm text-slate-400 mt-2">Avg Days per Install</div>
          {daysTrend !== 0 && (
            <div className={`text-xs mt-1.5 ${trendImproving ? "text-green-400" : "text-red-400"}`}>
              {trendImproving ? "▼" : "▲"} {Math.abs(daysTrend).toFixed(1)}d vs prior
            </div>
          )}
        </div>

        <div className="bg-white/[0.04] rounded-2xl p-5 text-center border border-white/5">
          <CountUp
            value={data.capacityUtilization >= 0 ? data.capacityUtilization : 0}
            suffix={data.capacityUtilization >= 0 ? "%" : ""}
            className="text-[64px] font-extrabold text-orange-400 leading-none"
          />
          <div className="text-sm text-slate-400 mt-2">
            {data.capacityUtilization >= 0 ? "Capacity Used" : "Capacity N/A"}
          </div>
        </div>

        <div className="bg-white/[0.04] rounded-2xl p-5 text-center border border-white/5">
          <CountUp
            value={data.scheduledThisWeek}
            className="text-[64px] font-extrabold text-cyan-400 leading-none"
          />
          <div className="text-sm text-slate-400 mt-2">Scheduled This Week</div>
        </div>
      </div>

      {/* Deal list + compliance */}
      <div className="flex flex-col gap-3 mb-4">
        <DealList deals={data.deals} totalCount={data.totalCount} />
        <ComplianceBlock compliance={data.compliance} />
      </div>

      {/* Dual leaderboards */}
      <div className="grid grid-cols-2 gap-5 flex-1 min-h-0">
        <Leaderboard
          title="INSTALLERS — THIS MONTH"
          icon="⚡"
          entries={data.installerLeaderboard}
          accentColor="#22c55e"
          metricLabel="installs"
        />
        <Leaderboard
          title="ELECTRICIANS — THIS MONTH"
          icon="🔌"
          entries={data.electricianLeaderboard}
          accentColor="#22c55e"
          metricLabel="jobs"
        />
      </div>
    </div>
  );
}
