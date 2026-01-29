"use client";

import { getStatCardGradient } from "@/lib/config";

export interface StatCardProps {
  label: string;
  value: string | number;
  subValue?: string;
  color?: "orange" | "green" | "emerald" | "blue" | "red" | "purple" | "cyan" | "yellow";
  loading?: boolean;
  alert?: boolean;
  size?: "default" | "mini";
}

export function StatCard({
  label,
  value,
  subValue,
  color = "blue",
  loading = false,
  alert = false,
  size = "default",
}: StatCardProps) {
  const gradientClasses = getStatCardGradient(color);

  if (size === "mini") {
    return (
      <div
        className={`bg-zinc-900/50 border rounded-lg p-4 text-center ${
          alert ? "border-red-500/50" : "border-zinc-800"
        }`}
      >
        <div className={`text-xl font-bold stat-number ${alert ? "text-red-400" : "text-white"}`}>
          {loading ? "..." : value}
        </div>
        <div className="text-xs text-zinc-500">{label}</div>
      </div>
    );
  }

  return (
    <div className={`bg-gradient-to-br ${gradientClasses} border rounded-xl p-6`}>
      <div className="text-3xl font-bold text-white stat-number mb-1">
        {loading ? "..." : value}
      </div>
      <div className="text-sm text-zinc-400">{label}</div>
      {subValue && <div className="text-xs text-zinc-500 mt-1">{subValue}</div>}
    </div>
  );
}

export function StatCardGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
      {children}
    </div>
  );
}

export function MiniStatGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
      {children}
    </div>
  );
}
