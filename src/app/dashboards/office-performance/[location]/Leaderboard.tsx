"use client";

import type { PersonStat, InspectionPersonStat } from "@/lib/office-performance-types";

interface LeaderboardProps {
  title: string;
  icon: string;
  entries: (PersonStat | InspectionPersonStat)[];
  accentColor: string;
  showPassRate?: boolean;
}

const RANK_COLORS = ["#fbbf24", "#d1d5db", "#b45309"];

export default function Leaderboard({
  title,
  icon,
  entries,
  accentColor,
  showPassRate = false,
}: LeaderboardProps) {
  if (entries.length === 0) return null;

  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.03] p-4">
      <div className="text-xs font-semibold text-slate-400 tracking-wider mb-3">
        {icon} {title}
      </div>
      <div className="flex flex-col gap-2.5">
        {entries.map((entry, i) => (
          <div
            key={entry.name}
            className="flex items-center gap-2 rounded-md px-3 py-2"
            style={{
              background: i === 0 ? "rgba(251,191,36,0.08)" : "transparent",
              border: i === 0 ? "1px solid rgba(251,191,36,0.15)" : "none",
            }}
          >
            <span
              className="text-lg font-extrabold w-6"
              style={{ color: RANK_COLORS[i] || "#94a3b8" }}
            >
              {i + 1}
            </span>
            <span className="text-sm font-semibold flex-1 text-slate-200">
              {entry.name}
            </span>
            <span
              className="text-xl font-extrabold"
              style={{ color: accentColor }}
            >
              {entry.count}
            </span>
            <span className="text-xs text-slate-400 w-16">
              {entry.count === 1 ? "job" : "jobs"}
            </span>
            {showPassRate && "passRate" in entry && (
              <span
                className="text-xs font-medium"
                style={{
                  color:
                    entry.passRate >= 90
                      ? "#22c55e"
                      : entry.passRate >= 75
                        ? "#eab308"
                        : "#ef4444",
                }}
              >
                {entry.passRate}% pass
              </span>
            )}
            {entry.streak && (
              <span className="text-xs bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full">
                {entry.streak.label}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
