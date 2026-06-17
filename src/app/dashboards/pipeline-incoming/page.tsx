"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorState } from "@/components/ui/ErrorState";
import { useSSE } from "@/hooks/useSSE";
import { queryKeys } from "@/lib/query-keys";
import { formatCurrencyCompact } from "@/lib/format";
import { CANONICAL_LOCATIONS } from "@/lib/locations";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import type { ProjectFunnelResponse, ProjectFunnelStageKey } from "@/lib/project-funnel-aggregation";

const TIMEFRAMES = [
  { label: "3 months", value: 3 },
  { label: "6 months", value: 6 },
  { label: "12 months", value: 12 },
  { label: "24 months", value: 24 },
] as const;

// Each backlog gate: the drill-down bucket it maps to, the milestone deals reach
// to LEAVE it, and the prior milestone deals reach to ENTER it.
const GATES: Array<{
  key: keyof ProjectFunnelResponse["drillDown"];
  label: string;
  milestone: ProjectFunnelStageKey | null;
  prev: ProjectFunnelStageKey | null;
  color: string;
}> = [
  { key: "awaitingSurveySchedule", label: "Survey Scheduling", milestone: "surveyScheduled", prev: "salesClosed", color: "bg-orange-500" },
  { key: "awaitingSurvey", label: "Survey Completion", milestone: "surveyDone", prev: "surveyScheduled", color: "bg-amber-500" },
  { key: "awaitingDaSend", label: "DA Send", milestone: "daSent", prev: "surveyDone", color: "bg-lime-500" },
  { key: "awaitingApproval", label: "DA Approval", milestone: "daApproved", prev: "daSent", color: "bg-blue-500" },
  { key: "awaitingDesignComplete", label: "Design Complete", milestone: "designCompleted", prev: "daApproved", color: "bg-indigo-500" },
  { key: "awaitingPermitSubmit", label: "Permit Submit", milestone: "permitsSubmitted", prev: "designCompleted", color: "bg-purple-500" },
  { key: "awaitingPermitIssue", label: "Permit Issue", milestone: "permitsIssued", prev: "permitsSubmitted", color: "bg-violet-500" },
  { key: "awaitingConstructionSchedule", label: "Construction Scheduling", milestone: "constructionScheduled", prev: "permitsIssued", color: "bg-cyan-500" },
  { key: "awaitingConstructionComplete", label: "Construction Complete", milestone: "constructionComplete", prev: "constructionScheduled", color: "bg-green-500" },
  { key: "awaitingInspection", label: "Inspection", milestone: "inspectionPassed", prev: "constructionComplete", color: "bg-emerald-500" },
  { key: "awaitingPto", label: "PTO", milestone: "ptoGranted", prev: "inspectionPassed", color: "bg-teal-500" },
  { key: "awaitingCloseOut", label: "Close Out", milestone: null, prev: "ptoGranted", color: "bg-sky-500" },
];

interface Row {
  key: string;
  label: string;
  color: string;
  backlogNow: number;
  queued: number;
  notHereYet: number;
  in30: number | null;
  out30: number | null;
  net: number;
  amount: number;
}

function buildRows(data: ProjectFunnelResponse): Row[] {
  const counts = GATES.map((g) => data.drillDown[g.key]?.length ?? 0);
  let cumulative = 0;
  return GATES.map((g, i) => {
    const backlogNow = counts[i];
    const queued = i > 0 ? counts[i - 1] : 0;
    const notHereYet = cumulative; // everything in strictly-upstream gates
    cumulative += backlogNow;
    const in30 = g.prev ? data.inflow30d[g.prev] ?? 0 : null;
    const out30 = g.milestone ? data.inflow30d[g.milestone] ?? 0 : null;
    const amount = (data.drillDown[g.key] ?? []).reduce((s, d) => s + (d.amount || 0), 0);
    return {
      key: g.key,
      label: g.label,
      color: g.color,
      backlogNow,
      queued,
      notHereYet,
      in30,
      out30,
      net: (in30 ?? 0) - (out30 ?? 0),
      amount,
    };
  });
}

function netTone(net: number): string {
  if (net > 0) return "text-amber-400"; // growing backlog
  if (net < 0) return "text-green-400"; // shrinking
  return "text-muted";
}

export default function PipelineIncomingPage() {
  const [scope, setScope] = useState<"active" | "cohort">("active");
  const [months, setMonths] = useState(6);
  const [locations, setLocations] = useState<string[]>([]);

  const { data, isLoading, error, dataUpdatedAt, refetch } = useQuery<ProjectFunnelResponse>({
    queryKey: queryKeys.funnel.pipelineIncoming(months, locations, scope),
    queryFn: async () => {
      const params = new URLSearchParams({ scope });
      if (scope === "cohort") params.set("months", String(months));
      if (locations.length > 0) params.set("locations", locations.join(","));
      const res = await fetch(`/api/deals/project-funnel?${params}`);
      if (!res.ok) throw new Error("Failed to fetch pipeline data");
      return res.json();
    },
    refetchInterval: 5 * 60 * 1000,
  });

  useSSE(() => refetch(), { cacheKeyFilter: "funnel" });

  const locationOptions = useMemo(
    () => CANONICAL_LOCATIONS.map((loc) => ({ value: loc, label: loc })),
    []
  );

  const rows = useMemo(() => (data ? buildRows(data) : []), [data]);
  const maxNotHereYet = Math.max(1, ...rows.map((r) => r.notHereYet));
  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : null;

  return (
    <DashboardShell title="Pipeline Incoming" accentColor="cyan" lastUpdated={lastUpdated} fullWidth>
      <div className="space-y-5">
        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-lg border border-t-border overflow-hidden">
            {(["active", "cohort"] as const).map((sc) => (
              <button
                key={sc}
                onClick={() => setScope(sc)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  scope === sc ? "bg-cyan-500/20 text-foreground" : "text-muted hover:text-foreground"
                }`}
              >
                {sc === "active" ? "Active Pipeline" : "By Cohort"}
              </button>
            ))}
          </div>
          {scope === "cohort" && (
            <select
              value={months}
              onChange={(e) => setMonths(Number(e.target.value))}
              className="bg-surface border border-t-border rounded-lg px-3 py-1.5 text-xs text-foreground"
            >
              {TIMEFRAMES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          )}
          <MultiSelectFilter label="Location" options={locationOptions} selected={locations} onChange={setLocations} />
        </div>

        {error ? (
          <ErrorState message="Failed to load pipeline incoming data." onRetry={() => refetch()} />
        ) : isLoading || !data ? (
          <div className="py-20 flex justify-center"><LoadingSpinner /></div>
        ) : (
          <>
            {/* Chart: how big the pipeline feeding each step is */}
            <div className="bg-surface rounded-xl border border-t-border p-5">
              <h3 className="text-sm font-semibold text-foreground/80 mb-1">Not Here Yet — pipeline feeding each step</h3>
              <p className="text-xs text-muted mb-4">Active deals sitting upstream of each step (haven&apos;t reached its prerequisite yet)</p>
              <div className="space-y-1.5">
                {rows.map((r) => (
                  <div key={r.key} className="flex items-center gap-3">
                    <span className="w-48 text-xs text-muted text-right shrink-0 truncate" title={r.label}>{r.label}</span>
                    <div className="flex items-center gap-2 flex-1">
                      {r.notHereYet > 0 ? (
                        <div
                          className={`h-5 rounded-md ${r.color}`}
                          style={{ width: `${Math.max(3, (r.notHereYet / maxNotHereYet) * 100)}%`, opacity: 0.75 }}
                        />
                      ) : (
                        <span className="text-xs text-muted/50 italic">—</span>
                      )}
                      <span className="text-xs font-semibold text-foreground tabular-nums shrink-0">{r.notHereYet}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Detail table */}
            <div className="bg-surface rounded-xl border border-t-border p-5 overflow-x-auto">
              <h3 className="text-sm font-semibold text-foreground/80 mb-3">Flow by step</h3>
              <table className="w-full text-xs border-collapse min-w-[680px]">
                <thead>
                  <tr className="text-muted border-b border-t-border">
                    <th className="text-left font-medium py-1.5 pr-3">Step</th>
                    <th className="text-right font-medium py-1.5 pr-3" title="At this step right now, waiting">Backlog now</th>
                    <th className="text-right font-medium py-1.5 pr-3" title="In the immediately-upstream step — the next wave in">Queued behind</th>
                    <th className="text-right font-medium py-1.5 pr-3" title="Everything in any strictly-upstream step — the full pipeline feeding this one">Not here yet</th>
                    <th className="text-right font-medium py-1.5 pr-3" title="Reached this step in the last 30 days">30d In</th>
                    <th className="text-right font-medium py-1.5 pr-3" title="Moved past this step in the last 30 days">30d Out</th>
                    <th className="text-right font-medium py-1.5" title="In − Out: positive = backlog growing">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} className="border-b border-t-border/40 hover:bg-surface-2/40">
                      <td className="py-1.5 pr-3 whitespace-nowrap">
                        <span className={`inline-block h-2 w-2 rounded-sm mr-2 ${r.color}`} />
                        {r.label}
                        <span className="text-muted/60"> · {formatCurrencyCompact(r.amount)}</span>
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums font-semibold text-foreground">{r.backlogNow}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-muted">{r.queued || "—"}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-foreground/90">{r.notHereYet || "—"}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-cyan-400/90">{r.in30 ?? "—"}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-muted">{r.out30 ?? "—"}</td>
                      <td className={`py-1.5 text-right tabular-nums font-semibold ${netTone(r.net)}`}>
                        {r.net > 0 ? "+" : ""}{r.net}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[10px] text-muted/70 mt-3">
                Net is last-30-day inflow − outflow: <span className="text-amber-400">amber</span> = backlog growing,{" "}
                <span className="text-green-400">green</span> = shrinking.
              </p>
            </div>
          </>
        )}
      </div>
    </DashboardShell>
  );
}
