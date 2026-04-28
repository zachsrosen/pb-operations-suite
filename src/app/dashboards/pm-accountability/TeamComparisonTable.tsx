"use client";

import { useMemo } from "react";
import type { TeamSummary } from "@/lib/pm-tracker/types";
import { type PmName } from "@/lib/pm-tracker/owners";
import { bandFor, type ThresholdBand, type Tier } from "@/lib/pm-tracker/thresholds";

interface MetricDef {
  key: string;
  label: string;
  format: (s: TeamSummary["scorecards"][number]) => string;
  band?: (s: TeamSummary["scorecards"][number]) => Tier;
}

const TIER_CLASSES: Record<Tier, string> = {
  green: "text-emerald-400",
  yellow: "text-yellow-400",
  red: "text-red-400",
};

const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;
const fmtInt = (v: number) => v.toLocaleString();
const fmtFloat = (v: number, digits = 1) => v.toFixed(digits);

const METRICS: MetricDef[] = [
  {
    key: "ghostRate",
    label: "Ghost rate",
    format: (s) => fmtPct(s.metrics.ghostRate),
    band: (s) => bandFor("ghostRate" as ThresholdBand, s.metrics.ghostRate),
  },
  {
    key: "medianDays",
    label: "Median days since touch",
    format: (s) => fmtFloat(s.metrics.medianDaysSinceLastTouch),
  },
  {
    key: "touchFreq",
    label: "Touches/deal · 30d",
    format: (s) => fmtFloat(s.metrics.touchFrequency30d, 2),
  },
  {
    key: "readiness",
    label: "Readiness score",
    format: (s) => fmtPct(s.metrics.readinessScore),
    band: (s) => bandFor("readinessScore", s.metrics.readinessScore),
  },
  {
    key: "dayOfFails",
    label: "Day-of failures · 90d",
    format: (s) => fmtInt(s.metrics.dayOfFailures90d),
  },
  {
    key: "fieldPop",
    label: "Field population",
    format: (s) => fmtPct(s.metrics.fieldPopulationScore),
    band: (s) => bandFor("fieldPopulationScore", s.metrics.fieldPopulationScore),
  },
  {
    key: "stale",
    label: "Stale data count",
    format: (s) => fmtInt(s.metrics.staleDataCount),
  },
  {
    key: "stuck",
    label: "Stuck deals (now)",
    format: (s) => fmtInt(s.metrics.stuckCountNow),
  },
  {
    key: "reviewRate",
    label: "Review rate (Phase 2)",
    format: () => "—",
  },
  {
    key: "complaint",
    label: "Complaints/100 (Phase 2)",
    format: () => "—",
  },
  {
    key: "portfolio",
    label: "Portfolio size",
    format: (s) => fmtInt(s.portfolioCount),
  },
];

interface Props {
  team: TeamSummary;
  onSelectPm: (pm: PmName) => void;
  selectedPm: PmName | null;
}

export function TeamComparisonTable({ team, onSelectPm, selectedPm }: Props) {
  const sorted = useMemo(
    () => [...team.scorecards].sort((a, b) => a.metrics.ghostRate - b.metrics.ghostRate),
    [team.scorecards],
  );

  const period = useMemo(() => {
    const start = new Date(team.periodStart).toLocaleDateString();
    const end = new Date(team.periodEnd).toLocaleDateString();
    return `${start} → ${end}`;
  }, [team.periodStart, team.periodEnd]);

  return (
    <div className="bg-surface rounded-xl border border-t-border overflow-hidden">
      <div className="p-4 border-b border-t-border flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Team scorecards</h2>
          <p className="text-xs text-muted mt-0.5">
            Sorted by ghost rate (lowest first). Period: {period}
          </p>
        </div>
        <p className="text-xs text-muted font-mono">
          {team.scorecards.length} PMs · last computed{" "}
          {new Date(team.scorecards[0]?.computedAt ?? "").toLocaleString()}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-2/50 text-xs uppercase text-muted">
            <tr>
              <th className="px-4 py-2 text-left">Metric</th>
              {sorted.map((s) => (
                <th
                  key={s.pmName}
                  onClick={() => onSelectPm(s.pmName as PmName)}
                  className={`px-4 py-2 text-right cursor-pointer hover:bg-surface-2 transition-colors ${
                    selectedPm === s.pmName ? "bg-surface-2 text-foreground" : ""
                  }`}
                >
                  {s.pmName}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-t-border">
            {METRICS.map((m) => (
              <tr key={m.key} className="hover:bg-surface-2/30">
                <td className="px-4 py-2 text-muted">{m.label}</td>
                {sorted.map((s) => {
                  const tier = m.band?.(s);
                  return (
                    <td
                      key={`${m.key}-${s.pmName}`}
                      className={`px-4 py-2 text-right font-mono ${
                        tier ? TIER_CLASSES[tier] : "text-foreground"
                      }`}
                    >
                      {m.format(s)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
