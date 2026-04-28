"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { TeamSummary, PmScorecard, AtRiskDeal } from "@/lib/pm-tracker/types";
import { PM_NAMES, type PmName } from "@/lib/pm-tracker/owners";
import { TeamComparisonTable } from "./TeamComparisonTable";
import { PmScorecardTab } from "./PmScorecardTab";

export function PMDashboard() {
  const [selectedPm, setSelectedPm] = useState<PmName | null>(null);

  const { data: team, isLoading, error } = useQuery<TeamSummary>({
    queryKey: ["pm-team-summary"],
    queryFn: async () => {
      const res = await fetch("/api/pm/team-summary");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="bg-surface rounded-xl border border-t-border p-8 text-center text-muted">
        Loading PM scorecards…
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-surface rounded-xl border border-red-500/40 p-6 text-sm">
        <p className="text-red-400 font-medium">Failed to load team summary</p>
        <p className="text-muted mt-1">{(error as Error).message}</p>
      </div>
    );
  }

  if (!team || team.scorecards.length === 0) {
    return (
      <div className="bg-surface rounded-xl border border-t-border p-8 text-center">
        <p className="text-foreground font-medium">No snapshots yet</p>
        <p className="text-muted text-sm mt-1">
          The nightly cron at <code className="font-mono text-xs">/api/cron/pm-snapshot</code>{" "}
          hasn&apos;t run, or no PMs have data yet. Run the cron manually or wait for
          the next 02:00 MT firing.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Team comparison table */}
      <TeamComparisonTable
        team={team}
        onSelectPm={setSelectedPm}
        selectedPm={selectedPm}
      />

      {/* Per-PM tabs */}
      <div className="bg-surface rounded-xl border border-t-border overflow-hidden">
        <div className="flex border-b border-t-border">
          {PM_NAMES.map((pm) => {
            const isActive = selectedPm === pm;
            return (
              <button
                key={pm}
                onClick={() => setSelectedPm(pm)}
                className={`px-4 py-3 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-surface-2 text-foreground border-b-2 border-purple-500"
                    : "text-muted hover:text-foreground hover:bg-surface-2/50"
                }`}
              >
                {pm}
              </button>
            );
          })}
        </div>
        <div className="p-4">
          {selectedPm ? (
            <PmScorecardTab
              pmName={selectedPm}
              scorecard={team.scorecards.find((s) => s.pmName === selectedPm)}
            />
          ) : (
            <p className="text-muted text-sm text-center py-4">
              Select a PM above for the detailed scorecard + at-risk deals.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export type { TeamSummary, PmScorecard, AtRiskDeal };
