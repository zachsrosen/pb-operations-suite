"use client";

import { useMemo, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { StatCard } from "@/components/ui/MetricCard";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorState } from "@/components/ui/ErrorState";
import { ForecastBasisBadge } from "@/components/ui/ForecastBasisBadge";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import type { ForecastBasis } from "@/lib/forecasting";

// ─── Types ────────────────────────────────────────────────────────

interface MilestoneAccuracy {
  medianError: number | null;
  meanAbsError: number | null;
  sampleCount: number;
  withinOneWeek: number;
  withinTwoWeeks: number;
}

interface BasisDistribution {
  segment: number;
  location: number;
  global: number;
  actual: number;
  insufficient: number;
}

interface MonthlyAccuracyPoint {
  month: string;
  meanAbsError: number | null;
  sampleCount: number;
}

interface AccuracyData {
  milestoneAccuracy: Record<string, MilestoneAccuracy>;
  basisDistribution: BasisDistribution;
  monthlyTrend: MonthlyAccuracyPoint[];
  overallAccuracy: {
    medianError: number | null;
    meanAbsError: number | null;
    withinOneWeek: number;
    withinTwoWeeks: number;
    totalProjectsAnalyzed: number;
  };
  lastUpdated: string;
}

// ─── Constants ────────────────────────────────────────────────────

const MILESTONE_LABELS: Record<string, string> = {
  designComplete: "Design Complete",
  permitSubmit: "Permit Submit",
  permitApproval: "Permit Approval",
  icSubmit: "IC Submit",
  icApproval: "IC Approval",
  rtb: "RTB",
  install: "Install",
  inspection: "Inspection",
  pto: "PTO",
};

// ─── Sub-components ───────────────────────────────────────────────

function AccuracyGrade({ withinTwoWeeks }: { withinTwoWeeks: number }) {
  if (withinTwoWeeks >= 80) return <span className="text-emerald-400 font-bold">A</span>;
  if (withinTwoWeeks >= 60) return <span className="text-green-400 font-bold">B</span>;
  if (withinTwoWeeks >= 40) return <span className="text-yellow-400 font-bold">C</span>;
  if (withinTwoWeeks >= 20) return <span className="text-orange-400 font-bold">D</span>;
  return <span className="text-red-400 font-bold">F</span>;
}

function ErrorBar({ value, max }: { value: number | null; max: number }) {
  if (value === null) return <span className="text-muted">—</span>;
  const pct = Math.min((Math.abs(value) / max) * 100, 100);
  const color =
    Math.abs(value) <= 7
      ? "bg-emerald-500"
      : Math.abs(value) <= 14
        ? "bg-yellow-500"
        : Math.abs(value) <= 30
          ? "bg-orange-500"
          : "bg-red-500";

  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-2 rounded-full bg-surface-2 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-foreground/70 tabular-nums">{Math.abs(value).toFixed(0)}d</span>
    </div>
  );
}

function BasisBar({ basis, pct }: { basis: ForecastBasis; pct: number }) {
  return (
    <div className="flex items-center gap-2">
      <ForecastBasisBadge basis={basis} />
      <div className="flex-1 h-2 rounded-full bg-surface-2 overflow-hidden">
        <div className="h-full rounded-full bg-foreground/30" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted tabular-nums w-10 text-right">{pct}%</span>
    </div>
  );
}

function MonthlyChart({ data }: { data: MonthlyAccuracyPoint[] }) {
  const maxError = Math.max(...data.map((d) => d.meanAbsError ?? 0), 1);
  // Show last 12 months
  const recent = data.slice(-12);

  return (
    <div className="flex items-end gap-1 h-32">
      {recent.map((d) => {
        const height = d.meanAbsError !== null ? (d.meanAbsError / maxError) * 100 : 0;
        const color =
          (d.meanAbsError ?? 0) <= 7
            ? "bg-emerald-500"
            : (d.meanAbsError ?? 0) <= 14
              ? "bg-yellow-500"
              : (d.meanAbsError ?? 0) <= 30
                ? "bg-orange-500"
                : "bg-red-500";
        return (
          <div key={d.month} className="flex-1 flex flex-col items-center gap-1">
            <div className="w-full flex items-end justify-center" style={{ height: "100px" }}>
              <div
                className={`w-full max-w-6 rounded-t ${color}/70`}
                style={{ height: `${height}%`, minHeight: height > 0 ? "4px" : "0" }}
                title={`${d.month}: ${d.meanAbsError?.toFixed(0)}d avg error (n=${d.sampleCount})`}
              />
            </div>
            <span className="text-[9px] text-muted truncate w-full text-center">
              {d.month.slice(5)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────

export default function ForecastAccuracyPage() {
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  const { data, isLoading, error } = useQuery<AccuracyData>({
    queryKey: ["forecasting", "accuracy"],
    queryFn: async () => {
      const res = await fetch("/api/forecasting/accuracy");
      if (!res.ok) throw new Error("Failed to fetch accuracy data");
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  useEffect(() => {
    if (!isLoading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("forecast-accuracy", {});
    }
  }, [isLoading, trackDashboardView]);

  const maxMedianError = useMemo(() => {
    if (!data) return 60;
    const errors = Object.values(data.milestoneAccuracy)
      .map((m) => Math.abs(m.medianError ?? 0))
      .filter(Boolean);
    return Math.max(...errors, 30);
  }, [data]);

  if (isLoading) return <LoadingSpinner message="Computing forecast accuracy…" />;
  if (error || !data)
    return <ErrorState message={error ? String(error) : "Failed to load accuracy data"} />;

  const { overallAccuracy, milestoneAccuracy, basisDistribution, monthlyTrend } = data;

  return (
    <DashboardShell
      title="Forecast Accuracy"
      subtitle="How well the forecasting model predicts reality"
      accentColor="cyan"
      lastUpdated={data.lastUpdated}
    >
      {/* ── Hero Stats ───────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 stagger-grid">
        <StatCard
          label="Median Error"
          value={
            overallAccuracy.medianError !== null
              ? `${overallAccuracy.medianError > 0 ? "+" : ""}${overallAccuracy.medianError.toFixed(0)}d`
              : "—"
          }
          subtitle="Install milestone (original forecast)"
          color="cyan"
        />
        <StatCard
          label="Mean Abs Error"
          value={
            overallAccuracy.meanAbsError !== null
              ? `${overallAccuracy.meanAbsError.toFixed(0)}d`
              : "—"
          }
          subtitle="Average deviation from actual"
          color="blue"
        />
        <StatCard
          label="Within 1 Week"
          value={`${overallAccuracy.withinOneWeek}%`}
          subtitle="Forecasts within 7 days"
          color="emerald"
        />
        <StatCard
          label="Within 2 Weeks"
          value={`${overallAccuracy.withinTwoWeeks}%`}
          subtitle="Forecasts within 14 days"
          color="green"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* ── Per-Milestone Accuracy ──────────────────────────── */}
        <div className="lg:col-span-2 bg-surface border border-t-border rounded-lg p-4">
          <h2 className="text-lg font-semibold text-foreground/90 mb-4">Per-Milestone Accuracy</h2>
          <div className="space-y-3">
            <div className="grid grid-cols-[140px_1fr_80px_60px_60px] gap-2 text-xs text-muted font-medium pb-2 border-b border-t-border">
              <span>Milestone</span>
              <span>Median Error</span>
              <span className="text-center">±7d</span>
              <span className="text-center">±14d</span>
              <span className="text-center">n</span>
            </div>
            {Object.entries(milestoneAccuracy).map(([key, ma]) => (
              <div
                key={key}
                className="grid grid-cols-[140px_1fr_80px_60px_60px] gap-2 items-center text-sm"
              >
                <span className="text-foreground/80 font-medium">
                  {MILESTONE_LABELS[key] ?? key}
                </span>
                <ErrorBar value={ma.medianError} max={maxMedianError} />
                <span className="text-center text-xs">
                  <span
                    className={
                      ma.withinOneWeek >= 60
                        ? "text-emerald-400"
                        : ma.withinOneWeek >= 30
                          ? "text-yellow-400"
                          : "text-red-400"
                    }
                  >
                    {ma.withinOneWeek}%
                  </span>
                </span>
                <span className="text-center text-xs">
                  <AccuracyGrade withinTwoWeeks={ma.withinTwoWeeks} />
                  <span className="ml-1 text-muted">{ma.withinTwoWeeks}%</span>
                </span>
                <span className="text-center text-xs text-muted">{ma.sampleCount}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Basis Distribution ──────────────────────────────── */}
        <div className="bg-surface border border-t-border rounded-lg p-4">
          <h2 className="text-lg font-semibold text-foreground/90 mb-4">Forecast Basis Mix</h2>
          <p className="text-xs text-muted mb-4">
            Distribution of forecast confidence levels across all milestones and projects.
          </p>
          <div className="space-y-3">
            <BasisBar basis="actual" pct={basisDistribution.actual} />
            <BasisBar basis="segment" pct={basisDistribution.segment} />
            <BasisBar basis="location" pct={basisDistribution.location} />
            <BasisBar basis="global" pct={basisDistribution.global} />
            <BasisBar basis="insufficient" pct={basisDistribution.insufficient} />
          </div>
        </div>
      </div>

      {/* ── Monthly Trend ────────────────────────────────────── */}
      {monthlyTrend.length > 0 && (
        <div className="bg-surface border border-t-border rounded-lg p-4">
          <h2 className="text-lg font-semibold text-foreground/90 mb-2">
            Monthly Accuracy Trend (Install Milestone)
          </h2>
          <p className="text-xs text-muted mb-4">
            Mean absolute error by completion month. Lower bars = more accurate forecasts.
          </p>
          <MonthlyChart data={monthlyTrend} />
        </div>
      )}

      {/* ── Metadata ─────────────────────────────────────────── */}
      <div className="mt-6 text-xs text-muted text-center">
        Install accuracy based on {overallAccuracy.totalProjectsAnalyzed} projects with both
        forecast and actual dates. Original forecasts computed from closeDate using current baseline table.
      </div>
    </DashboardShell>
  );
}
