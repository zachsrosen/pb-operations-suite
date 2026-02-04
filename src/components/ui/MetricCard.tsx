"use client";

import { memo } from "react";

// ---- Accent StatCard (large, gradient background) ----

interface StatCardProps {
  label: string;
  value: string | number | null;
  subtitle?: string | null;
  color: string;
}

const ACCENT_CLASSES: Record<string, string> = {
  orange: "from-orange-500/20 to-orange-500/5 border-orange-500/30",
  green: "from-green-500/20 to-green-500/5 border-green-500/30",
  emerald: "from-emerald-500/20 to-emerald-500/5 border-emerald-500/30",
  blue: "from-blue-500/20 to-blue-500/5 border-blue-500/30",
  red: "from-red-500/20 to-red-500/5 border-red-500/30",
  purple: "from-purple-500/20 to-purple-500/5 border-purple-500/30",
  yellow: "from-yellow-500/20 to-yellow-500/5 border-yellow-500/30",
  cyan: "from-cyan-500/20 to-cyan-500/5 border-cyan-500/30",
};

export const StatCard = memo(function StatCard({
  label,
  value,
  subtitle,
  color,
}: StatCardProps) {
  return (
    <div
      className={`bg-gradient-to-br ${ACCENT_CLASSES[color] || ACCENT_CLASSES.blue} border rounded-xl p-6 animate-fadeIn`}
    >
      {value === null ? (
        <div className="h-9 w-20 bg-zinc-800/50 rounded animate-pulse mb-1" />
      ) : (
        <div className="text-3xl font-bold text-white mb-1">{value}</div>
      )}
      <div className="text-sm text-zinc-400">{label}</div>
      {subtitle && (
        <div className="text-xs text-zinc-500 mt-0.5">{subtitle}</div>
      )}
    </div>
  );
});

// ---- MiniStat (compact, centered) ----

interface MiniStatProps {
  label: string;
  value: string | number | null;
  subtitle?: string | null;
  alert?: boolean;
}

export const MiniStat = memo(function MiniStat({
  label,
  value,
  subtitle,
  alert,
}: MiniStatProps) {
  return (
    <div
      className={`bg-zinc-900/50 border rounded-lg p-4 text-center animate-fadeIn ${
        alert ? "border-red-500/50" : "border-zinc-800"
      }`}
    >
      {value === null ? (
        <div className="h-7 w-12 mx-auto bg-zinc-800/50 rounded animate-pulse" />
      ) : (
        <div
          className={`text-xl font-bold ${alert ? "text-red-400" : "text-white"}`}
        >
          {value}
        </div>
      )}
      <div className="text-xs text-zinc-500">{label}</div>
      {subtitle && (
        <div
          className={`text-xs mt-0.5 ${alert ? "text-red-400/70" : "text-zinc-500"}`}
        >
          {subtitle}
        </div>
      )}
    </div>
  );
});

// ---- MetricCard (flexible, with optional border accent) ----

interface MetricCardProps {
  label: string;
  value: string;
  sub?: string;
  border?: string;
  valueColor?: string;
  subColor?: string;
}

export const MetricCard = memo(function MetricCard({
  label,
  value,
  sub,
  border,
  valueColor,
  subColor,
}: MetricCardProps) {
  return (
    <div
      className={`bg-[#12121a] rounded-xl border border-zinc-800 p-5 animate-fadeIn ${border || ""}`}
    >
      <div className="text-zinc-400 text-sm font-medium">{label}</div>
      <div
        className={`text-3xl font-bold mt-1 ${valueColor || "text-white"}`}
      >
        {value}
      </div>
      {sub && (
        <div className={`text-sm mt-1 ${subColor || "text-zinc-500"}`}>
          {sub}
        </div>
      )}
    </div>
  );
});

// ---- SummaryCard (simple, minimal) ----

interface SummaryCardProps {
  value: string;
  label: string;
  color?: string;
}

export const SummaryCard = memo(function SummaryCard({
  value,
  label,
  color,
}: SummaryCardProps) {
  return (
    <div className="bg-[#12121a] border border-zinc-800 rounded-lg p-4 animate-fadeIn">
      <div className={`text-3xl font-bold ${color || "text-white"}`}>
        {value}
      </div>
      <div className="text-sm text-zinc-500">{label}</div>
    </div>
  );
});
