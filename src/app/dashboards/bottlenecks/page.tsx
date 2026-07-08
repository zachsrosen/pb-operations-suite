"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import MultiSelectFilter, { type FilterOption } from "@/components/ui/MultiSelectFilter";
import { queryKeys } from "@/lib/query-keys";
import type { BottleneckSnapshot, StageSnapshot } from "@/lib/bottlenecks";

type SummaryResponse = BottleneckSnapshot & { lastUpdated: string };

type TeamKey = "all" | "design" | "pi" | "ops" | "precon";

const TEAM_OPTIONS: { key: TeamKey; label: string }[] = [
  { key: "all", label: "All teams" },
  { key: "design", label: "Design" },
  { key: "pi", label: "P&I" },
  { key: "ops", label: "Ops" },
  { key: "precon", label: "Precon (PE)" },
];

/** First two "|"-separated segments of a HubSpot deal name. */
function shortenDealName(name: string): string {
  return name
    .split("|")
    .slice(0, 2)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" | ");
}

/** ISO-week Mondays (UTC) for the trailing N weeks, oldest first — matches the engine's bucketing. */
function lastWeekStarts(n: number): string[] {
  const now = new Date();
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const w = new Date(monday);
    w.setUTCDate(monday.getUTCDate() - i * 7);
    out.push(w.toISOString().slice(0, 10));
  }
  return out;
}

function weekLabel(weekStart: string): string {
  const [, m, d] = weekStart.split("-");
  return `${Number(m)}/${Number(d)}`;
}

function thresholdCaption(s: StageSnapshot): string {
  return s.threshold.thresholdDays != null
    ? `threshold: ${s.threshold.thresholdDays}d (${s.threshold.source})`
    : "no threshold (insufficient history)";
}

function StageTile({ stage }: { stage: StageSnapshot }) {
  const flaggedCount = stage.flagged.length;
  return (
    <div className="rounded-xl border border-t-border bg-surface p-4 shadow-card">
      <div className="text-sm font-medium text-foreground">{stage.label}</div>
      <div
        key={String(flaggedCount)}
        className={`mt-1 text-3xl font-bold animate-value-flash ${
          flaggedCount > 0 ? "text-red-400" : "text-foreground"
        }`}
      >
        {flaggedCount}
      </div>
      <div className="text-xs text-muted">flagged past threshold</div>
      <div className="mt-2 space-y-0.5 text-xs text-muted">
        <div>
          <span className="text-foreground">{stage.totalInStage}</span> in stage · norm{" "}
          {stage.volumeNorm90d ?? "—"}
        </div>
        <div>
          median dwell {stage.medianDwellDays != null ? `${stage.medianDwellDays}d` : "—"}
        </div>
        <div>age unknown: {stage.unknownAgeCount}</div>
      </div>
      <div className="mt-2 border-t border-t-border/60 pt-1.5 text-[11px] text-muted">
        {thresholdCaption(stage)}
      </div>
    </div>
  );
}

export default function BottlenecksPage() {
  const queryClient = useQueryClient();
  const [team, setTeam] = useState<TeamKey>("all");
  const [locations, setLocations] = useState<string[]>([]);
  const [showUnknown, setShowUnknown] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.bottlenecks.summary(),
    queryFn: async (): Promise<SummaryResponse> => {
      const r = await fetch("/api/bottlenecks/summary");
      if (!r.ok) throw new Error(`failed: ${r.status}`);
      return r.json();
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const allStages = useMemo(() => data?.stages ?? [], [data]);
  const stages = useMemo(
    () => allStages.filter((s) => team === "all" || s.team === team),
    [allStages, team]
  );

  // Location options come from every flagged deal across ALL stages (not team-filtered).
  const locationOptions: FilterOption[] = useMemo(() => {
    const distinct = new Set<string>();
    for (const s of allStages) {
      for (const f of s.flagged) if (f.pbLocation) distinct.add(f.pbLocation);
    }
    return [...distinct].sort().map((v) => ({ value: v, label: v }));
  }, [allStages]);

  const locationFilterActive = locations.length > 0;
  const flaggedFor = (s: StageSnapshot) =>
    locationFilterActive
      ? s.flagged.filter((f) => f.pbLocation != null && locations.includes(f.pbLocation))
      : s.flagged;

  const stuckStages = stages.filter((s) => s.flagged.length > 0);
  const unknownStages = stages.filter((s) => s.unknownAgeCount > 0);
  const weekStarts = useMemo(() => lastWeekStarts(8), []);

  return (
    <DashboardShell
      title="Bottleneck Monitor"
      accentColor="red"
      lastUpdated={data?.lastUpdated}
      headerRight={
        <button
          type="button"
          onClick={() => queryClient.invalidateQueries({ queryKey: queryKeys.bottlenecks.root })}
          className="rounded-md border border-t-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-2"
        >
          Refresh
        </button>
      }
    >
      {isError ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-8 text-center">
          <p className="text-sm font-medium text-red-400">Couldn&apos;t load bottleneck data.</p>
          <button
            onClick={() => refetch()}
            className="mt-3 rounded-md border border-t-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-elevated"
          >
            Retry
          </button>
        </div>
      ) : isLoading ? (
        <div className="rounded-lg border border-t-border bg-surface p-8 text-center text-muted">
          Loading…
        </div>
      ) : allStages.length === 0 ? (
        <div className="rounded-lg border border-t-border bg-surface p-8 text-center">
          <p className="text-sm font-medium text-foreground">No stage data</p>
          <p className="mt-1 text-xs text-muted">
            The deal mirror hasn&apos;t produced any stage snapshots yet.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-t-border/60 bg-surface p-3">
            {TEAM_OPTIONS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTeam(t.key)}
                aria-pressed={team === t.key}
                className={`rounded-md border border-t-border/60 px-2.5 py-1 text-xs font-medium transition-colors ${
                  team === t.key
                    ? "bg-surface-elevated text-foreground"
                    : "bg-surface-2 text-muted hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2">
              <MultiSelectFilter
                label="Location"
                options={locationOptions}
                selected={locations}
                onChange={setLocations}
              />
              <button
                type="button"
                onClick={() => setShowUnknown((v) => !v)}
                aria-pressed={showUnknown}
                className={`rounded-md border border-t-border/60 px-2.5 py-1 text-xs font-medium transition-colors ${
                  showUnknown
                    ? "bg-surface-elevated text-foreground"
                    : "bg-surface-2 text-muted hover:text-foreground"
                }`}
              >
                Unknown-age detail
              </button>
            </div>
          </div>

          {/* Stage tiles */}
          <section>
            <div className="mb-2 flex items-baseline gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
                Stages
              </h2>
              {locationFilterActive && (
                <span className="text-[11px] text-muted">
                  tiles show all locations — the filter applies to the stuck-deal tables below
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 stagger-grid">
              {stages.map((s) => (
                <StageTile key={s.key} stage={s} />
              ))}
            </div>
          </section>

          {/* Unknown-age breakdown */}
          {showUnknown && (
            <section className="rounded-lg border border-t-border/60 bg-surface p-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
                Age unknown
              </h2>
              <p className="mt-1 text-xs text-muted">
                Deals currently in a stage with no entry stamp — they can&apos;t be aged or
                flagged, so counts here may hide real bottlenecks until stamp hygiene improves.
              </p>
              {unknownStages.length === 0 ? (
                <p className="mt-3 text-sm text-foreground">
                  No unknown-age deals in the selected teams.
                </p>
              ) : (
                <ul className="mt-3 grid grid-cols-1 gap-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
                  {unknownStages.map((s) => (
                    <li key={s.key} className="flex items-baseline justify-between gap-2 rounded bg-surface-2 px-3 py-1.5">
                      <span className="text-foreground">{s.label}</span>
                      <span className="text-muted">{s.unknownAgeCount}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* Stuck-deal tables */}
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">
              Stuck deals
            </h2>
            {stuckStages.length === 0 ? (
              <div className="rounded-lg border border-t-border/60 bg-surface p-6 text-center text-sm text-muted">
                Nothing past threshold in the selected teams. 🎉
              </div>
            ) : (
              <div className="space-y-4">
                {stuckStages.map((s) => {
                  const rows = flaggedFor(s);
                  return (
                    <div key={s.key} className="overflow-hidden rounded-lg border border-t-border/60 bg-surface">
                      <div className="flex items-baseline justify-between border-b border-t-border/60 bg-surface-2 px-3 py-2">
                        <span className="text-sm font-medium text-foreground">{s.label}</span>
                        <span className="text-xs text-muted">
                          {rows.length}
                          {locationFilterActive ? ` of ${s.flagged.length}` : ""} flagged ·{" "}
                          {thresholdCaption(s)}
                        </span>
                      </div>
                      {rows.length === 0 ? (
                        <p className="px-3 py-3 text-sm text-muted">
                          No flagged deals in the selected locations.
                        </p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="border-b border-t-border/60 text-left text-[11px] uppercase tracking-wider text-muted">
                              <tr>
                                <th className="px-3 py-2 font-medium">Deal</th>
                                <th className="px-3 py-2 font-medium">PROJ #</th>
                                <th className="px-3 py-2 font-medium">Owner</th>
                                <th className="px-3 py-2 font-medium">Location</th>
                                <th className="px-3 py-2 text-right font-medium">Days in stage</th>
                                <th className="px-3 py-2 text-right font-medium">Threshold</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-t-border/60">
                              {rows.map((f) => (
                                <tr key={f.hubspotDealId}>
                                  <td className="px-3 py-2 text-foreground">
                                    {shortenDealName(f.dealName)}
                                  </td>
                                  <td className="px-3 py-2 font-mono text-xs text-muted">
                                    {f.projectNumber ?? "—"}
                                  </td>
                                  <td className="px-3 py-2 text-foreground">
                                    {f.dealOwnerName ?? "—"}
                                  </td>
                                  <td className="px-3 py-2 text-muted">{f.pbLocation ?? "—"}</td>
                                  <td className="px-3 py-2 text-right font-medium text-red-400">
                                    {f.dwellDays}
                                  </td>
                                  <td className="px-3 py-2 text-right text-muted">
                                    {f.thresholdDays}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Flow strips */}
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">
              Flow — last 8 weeks (entered / exited)
            </h2>
            <div className="overflow-hidden rounded-lg border border-t-border/60 bg-surface">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-t-border/60 bg-surface-2 text-left text-[11px] uppercase tracking-wider text-muted">
                    <tr>
                      <th className="px-3 py-2 font-medium">Stage</th>
                      {weekStarts.map((w) => (
                        <th key={w} className="px-3 py-2 text-center font-medium">
                          {weekLabel(w)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-t-border/60">
                    {stages.map((s) => {
                      const byWeek = new Map(s.flow.map((f) => [f.weekStart, f]));
                      return (
                        <tr key={s.key}>
                          <td className="whitespace-nowrap px-3 py-2 text-foreground">
                            {s.label}
                          </td>
                          {weekStarts.map((w) => {
                            const f = byWeek.get(w);
                            const entered = f?.entered ?? 0;
                            const exited = f?.exited ?? 0;
                            return (
                              <td key={w} className="px-3 py-2 text-center">
                                {entered === 0 && exited === 0 ? (
                                  <span className="text-muted">·</span>
                                ) : (
                                  <span className="whitespace-nowrap">
                                    <span className="text-foreground">{entered}</span>
                                    <span className="text-muted"> / {exited}</span>
                                  </span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      )}
    </DashboardShell>
  );
}
