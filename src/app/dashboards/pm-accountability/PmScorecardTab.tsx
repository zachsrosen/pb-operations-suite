"use client";

import { useQuery } from "@tanstack/react-query";
import type { PmScorecard, AtRiskDeal } from "@/lib/pm-tracker/types";
import type { PmName } from "@/lib/pm-tracker/owners";

const REASON_LABEL: Record<AtRiskDeal["reason"], string> = {
  STUCK: "Stuck",
  GHOSTED: "Ghosted",
  PERMIT_OVERDUE: "Permit overdue",
  READINESS_GAP: "Readiness gap",
};

const REASON_BADGE: Record<AtRiskDeal["reason"], string> = {
  STUCK: "bg-yellow-500/20 text-yellow-300",
  GHOSTED: "bg-orange-500/20 text-orange-300",
  PERMIT_OVERDUE: "bg-red-500/20 text-red-300",
  READINESS_GAP: "bg-red-500/20 text-red-300",
};

interface Props {
  pmName: PmName;
  scorecard: PmScorecard | undefined;
}

export function PmScorecardTab({ pmName, scorecard }: Props) {
  const { data: atRisk, isLoading: atRiskLoading } = useQuery<{ items: AtRiskDeal[] }>({
    queryKey: ["pm-at-risk", pmName],
    queryFn: async () => {
      const res = await fetch(`/api/pm/at-risk?pm=${pmName}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  if (!scorecard) {
    return (
      <p className="text-sm text-muted py-4">
        No snapshot for {pmName}. Run the nightly cron to populate.
      </p>
    );
  }

  const m = scorecard.metrics;

  return (
    <div className="space-y-6">
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi
          label="Portfolio"
          value={scorecard.portfolioCount.toLocaleString()}
          sub="active deals"
        />
        <Kpi
          label="Ghost rate"
          value={`${(m.ghostRate * 100).toFixed(1)}%`}
          sub={`median ${m.medianDaysSinceLastTouch.toFixed(1)}d since touch`}
        />
        <Kpi
          label="Readiness"
          value={`${(m.readinessScore * 100).toFixed(1)}%`}
          sub={`${m.dayOfFailures90d} day-of failures · 90d`}
        />
        <Kpi
          label="Stuck deals"
          value={m.stuckCountNow.toLocaleString()}
          sub="in stage > 14d"
        />
      </div>

      {/* Secondary metrics row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi
          label="Touch frequency"
          value={m.touchFrequency30d.toFixed(2)}
          sub="per deal · 30d"
        />
        <Kpi
          label="Field population"
          value={`${(m.fieldPopulationScore * 100).toFixed(1)}%`}
          sub={`${m.staleDataCount} stale-data deals`}
        />
        <Kpi
          label="Reviews"
          value="—"
          sub="Phase 2"
        />
        <Kpi
          label="Complaints/100"
          value="—"
          sub="Phase 2"
        />
      </div>

      {/* At-risk list */}
      <div className="bg-surface-2 rounded-lg border border-t-border overflow-hidden">
        <div className="px-4 py-3 border-b border-t-border flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">
            At-risk deals
            {atRisk && (
              <span className="ml-2 text-muted font-normal">({atRisk.items.length})</span>
            )}
          </h3>
          <span className="text-xs text-muted">
            STUCK · PERMIT_OVERDUE · READINESS_GAP (GHOSTED in Phase 2)
          </span>
        </div>
        {atRiskLoading ? (
          <p className="px-4 py-4 text-sm text-muted">Loading…</p>
        ) : !atRisk || atRisk.items.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted">No at-risk deals on portfolio. 🎉</p>
        ) : (
          <ul className="divide-y divide-t-border">
            {atRisk.items.map((d, i) => (
              <li key={`${d.hubspotDealId}-${d.reason}-${i}`} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <a
                      href={d.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-foreground hover:text-cyan-400 truncate inline-block max-w-full"
                    >
                      {d.dealName}
                    </a>
                    {d.detail && (
                      <p className="text-xs text-muted mt-0.5">{d.detail}</p>
                    )}
                  </div>
                  <span
                    className={`shrink-0 inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                      REASON_BADGE[d.reason]
                    }`}
                  >
                    {REASON_LABEL[d.reason]}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-surface-2 border border-t-border p-3">
      <div className="text-xs text-muted uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-semibold text-foreground mt-0.5">{value}</div>
      {sub && <div className="text-xs text-muted mt-0.5">{sub}</div>}
    </div>
  );
}
