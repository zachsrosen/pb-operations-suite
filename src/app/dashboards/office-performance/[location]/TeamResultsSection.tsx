"use client";

import type { TeamResultsData } from "@/lib/office-performance-types";
import CountUp from "./CountUp";

interface TeamResultsSectionProps {
  data: TeamResultsData;
}

function formatRevenue(amount: number): string {
  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(1)}M`;
  }
  if (amount >= 1_000) {
    return `$${Math.round(amount / 1_000)}K`;
  }
  return `$${Math.round(amount)}`;
}

const IMPACT_CARDS = [
  { key: "homes", label: "Homes Powered", color: "#f97316", gradientFrom: "rgba(249,115,22,0.12)", gradientTo: "rgba(249,115,22,0.04)", borderColor: "rgba(249,115,22,0.15)" },
  { key: "kw", label: "kW Installed", color: "#22c55e", gradientFrom: "rgba(34,197,94,0.12)", gradientTo: "rgba(34,197,94,0.04)", borderColor: "rgba(34,197,94,0.15)" },
  { key: "batteries", label: "Batteries Installed", color: "#8b5cf6", gradientFrom: "rgba(139,92,246,0.12)", gradientTo: "rgba(139,92,246,0.04)", borderColor: "rgba(139,92,246,0.15)" },
  { key: "revenue", label: "Revenue Earned", color: "#3b82f6", gradientFrom: "rgba(59,130,246,0.12)", gradientTo: "rgba(59,130,246,0.04)", borderColor: "rgba(59,130,246,0.15)" },
] as const;

const CREW_COLUMNS = [
  { key: "surveys", label: "SURVEYS", color: "#3b82f6" },
  { key: "installs", label: "INSTALLS", color: "#22c55e" },
  { key: "inspections", label: "INSPECTIONS", color: "#06b6d4" },
  { key: "kwInstalled", label: "kW", color: "#22c55e" },
  { key: "batteriesInstalled", label: "BATTERIES", color: "#8b5cf6" },
] as const;

export default function TeamResultsSection({ data }: TeamResultsSectionProps) {
  const year = new Date().getFullYear();

  return (
    <div className="flex flex-col h-full px-8 py-5 overflow-hidden">
      {/* Impact cards */}
      <div className="grid grid-cols-4 gap-3 mb-4 flex-shrink-0">
        {IMPACT_CARDS.map((card) => (
          <div
            key={card.key}
            className="rounded-2xl p-5 text-center border"
            style={{
              background: `linear-gradient(135deg, ${card.gradientFrom}, ${card.gradientTo})`,
              borderColor: card.borderColor,
            }}
          >
            {card.key === "revenue" ? (
              <div
                className="text-[48px] font-extrabold leading-none"
                style={{ color: card.color }}
              >
                {formatRevenue(data.revenueEarned)}
              </div>
            ) : (
              <CountUp
                value={
                  card.key === "homes"
                    ? data.homesPowered
                    : card.key === "kw"
                      ? data.kwInstalled
                      : data.batteriesInstalled
                }
                decimals={card.key === "kw" ? 1 : 0}
                className="text-[48px] font-extrabold leading-none"
                style={{ color: card.color }}
              />
            )}
            <div className="text-sm text-slate-400 mt-2">{card.label}</div>
            <div className="text-xs text-slate-500 mt-0.5">in {year}</div>
          </div>
        ))}
      </div>

      {/* Crew breakdown table */}
      {data.crewBreakdown.length > 0 && (
        <div className="flex-1 min-h-0 bg-white/[0.02] rounded-xl p-4 border border-white/5 mb-3 flex flex-col overflow-hidden">
          <div className="text-xs font-semibold text-slate-400 tracking-wider mb-3 flex-shrink-0">
            ⚡ CREW BREAKDOWN — {year}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500 tracking-wider">
                <th className="text-left pb-2 font-semibold">NAME</th>
                {CREW_COLUMNS.map((col) => (
                  <th key={col.key} className="text-center pb-2 font-semibold w-20">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.crewBreakdown.map((member, i) => {
                const isUnattributed = member.isUnattributed === true;
                return (
                  <tr
                    key={member.name}
                    className={`border-t border-white/[0.04] ${isUnattributed ? "italic" : ""}`}
                    style={{
                      animation: `fadeInLeft 300ms ${i * 60}ms both`,
                    }}
                  >
                    <td
                      className={`py-1.5 font-semibold ${isUnattributed ? "text-slate-500" : "text-slate-200"}`}
                    >
                      {isUnattributed ? "Unattributed*" : member.name}
                    </td>
                    {CREW_COLUMNS.map((col) => {
                      const val = member[col.key];
                      const display =
                        col.key === "kwInstalled"
                          ? val > 0 ? val.toFixed(1) : "—"
                          : val > 0 ? String(val) : "—";
                      return (
                        <td
                          key={col.key}
                          className="py-1.5 text-center font-bold"
                          style={{
                            color: val > 0
                              ? (isUnattributed ? "#64748b" : col.color)
                              : "#475569",
                          }}
                        >
                          {display}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          <div className="text-[10px] text-slate-500 mt-3 leading-relaxed flex-shrink-0">
            * Deals completed per HubSpot dates but without a matching Zuper crew (stale cache or missing assignment).
            <br />
            Survey / Install / Inspection counts credit each tech on a multi-tech job (column totals may exceed top-line counts). kW and Batteries are split proportionally across crew.
          </div>
        </div>
      )}

      {/* Recent wins ticker */}
      {data.recentWins.length > 0 && (
        <div className="rounded-xl border border-white/5 bg-white/[0.02] px-5 py-3 flex items-center gap-4 overflow-hidden flex-shrink-0">
          <span className="text-xs font-semibold text-slate-500 tracking-wider shrink-0">
            🎉 RECENT
          </span>
          <div className="flex gap-6 overflow-hidden">
            {data.recentWins.map((win, i) => (
              <span key={i} className="text-sm text-slate-200 whitespace-nowrap">
                {win.customerName} —{" "}
                <span className="text-green-400 font-semibold">
                  {formatRevenue(win.amount)}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
