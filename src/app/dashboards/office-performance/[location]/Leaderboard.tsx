"use client";

import { useEffect, useState } from "react";
import type { PersonStat, InspectionPersonStat, EnrichedPersonStat } from "@/lib/office-performance-types";
import CountUp from "./CountUp";

interface LeaderboardProps {
  title: string;
  icon: string;
  entries: (PersonStat | InspectionPersonStat | EnrichedPersonStat)[];
  accentColor: string;
  showPassRate?: boolean;
  showTurnaround?: boolean;
  metricLabel?: string;
}

const RANK_STYLES: Array<{
  color: string;
  bg: string;
  border: string;
  glow: string;
}> = [
  { // Gold
    color: "#fbbf24",
    bg: "linear-gradient(135deg, rgba(251,191,36,0.12) 0%, rgba(251,191,36,0.04) 100%)",
    border: "rgba(251,191,36,0.25)",
    glow: "0 0 20px rgba(251,191,36,0.1)",
  },
  { // Silver
    color: "#d1d5db",
    bg: "linear-gradient(135deg, rgba(209,213,219,0.08) 0%, rgba(209,213,219,0.02) 100%)",
    border: "rgba(209,213,219,0.15)",
    glow: "none",
  },
  { // Bronze
    color: "#d97706",
    bg: "linear-gradient(135deg, rgba(217,119,6,0.08) 0%, rgba(217,119,6,0.02) 100%)",
    border: "rgba(217,119,6,0.15)",
    glow: "none",
  },
];

export default function Leaderboard({
  title,
  icon,
  entries,
  accentColor,
  showPassRate = false,
  showTurnaround = false,
  metricLabel = "jobs",
}: LeaderboardProps) {
  const [visibleCount, setVisibleCount] = useState(0);

  // Staggered entrance
  useEffect(() => {
    setVisibleCount(0);
    const timers: ReturnType<typeof setTimeout>[] = [];
    entries.forEach((_, i) => {
      timers.push(setTimeout(() => setVisibleCount(i + 1), 80 * (i + 1)));
    });
    return () => timers.forEach(clearTimeout);
  }, [entries]);

  if (entries.length === 0) return null;

  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5 flex-1">
      <div className="text-xs font-semibold text-slate-400 tracking-wider mb-4">
        {icon} {title}
      </div>
      <div className="flex flex-col gap-2">
        {entries.map((entry, i) => {
          const rankStyle = RANK_STYLES[i];
          const isVisible = i < visibleCount;
          const rankColor = rankStyle?.color || "#64748b";

          return (
            <div
              key={entry.name}
              className="flex items-center gap-3 rounded-lg px-4 py-2.5 transition-all duration-300"
              style={{
                background: rankStyle?.bg || "transparent",
                border: `1px solid ${rankStyle?.border || "transparent"}`,
                boxShadow: rankStyle?.glow || "none",
                opacity: isVisible ? 1 : 0,
                transform: isVisible ? "translateX(0)" : "translateX(-20px)",
              }}
            >
              {/* Rank */}
              <span
                className="text-xl font-extrabold w-8 text-center"
                style={{ color: rankColor }}
              >
                {i + 1}
              </span>

              {/* Name */}
              <span className="text-base font-semibold flex-1 text-slate-100 truncate">
                {entry.name}
              </span>

              {/* Per-person turnaround (surveys) */}
              {showTurnaround && "avgTurnaround" in entry && (entry as EnrichedPersonStat).avgTurnaround != null && (
                <span className="text-xs text-slate-400 px-2 py-0.5 rounded bg-white/5">
                  {(entry as EnrichedPersonStat).avgTurnaround?.toFixed(1)}d avg
                </span>
              )}

              {/* Pass rate (inspections) */}
              {showPassRate && "passRate" in entry && (entry as InspectionPersonStat).passRate >= 0 && (
                <span
                  className="text-xs font-medium px-2 py-0.5 rounded"
                  style={{
                    color:
                      (entry as InspectionPersonStat).passRate >= 90
                        ? "#22c55e"
                        : (entry as InspectionPersonStat).passRate >= 75
                          ? "#eab308"
                          : "#ef4444",
                    backgroundColor:
                      (entry as InspectionPersonStat).passRate >= 90
                        ? "rgba(34,197,94,0.1)"
                        : (entry as InspectionPersonStat).passRate >= 75
                          ? "rgba(234,179,8,0.1)"
                          : "rgba(239,68,68,0.1)",
                  }}
                >
                  {(entry as InspectionPersonStat).passRate}% pass
                </span>
              )}

              {/* Consecutive passes (inspections) */}
              {showPassRate && "consecutivePasses" in entry &&
                (entry as InspectionPersonStat).consecutivePasses != null &&
                ((entry as InspectionPersonStat).consecutivePasses ?? 0) >= 3 && (
                <span className="text-xs bg-green-500/15 text-green-400 px-2 py-0.5 rounded-full">
                  🔥 {(entry as InspectionPersonStat).consecutivePasses} in a row
                </span>
              )}

              {/* Count */}
              <CountUp
                value={entry.count}
                className="text-2xl font-extrabold"
                style={{ color: accentColor }}
              />
              <span className="text-xs text-slate-500 w-12">
                {entry.count === 1 ? metricLabel.replace(/s$/, "") : metricLabel}
              </span>

              {/* Monthly leader streak */}
              {entry.streak && (
                <span className="text-xs bg-orange-500/15 text-orange-400 px-2 py-0.5 rounded-full whitespace-nowrap">
                  {entry.streak.label}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
