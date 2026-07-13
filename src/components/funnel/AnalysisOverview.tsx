"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatCurrencyCompact } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import type {
  ProjectFunnelResponse,
  ProjectFunnelDrillDown,
  ProjectFunnelDrillDownDeal,
} from "@/lib/project-funnel-aggregation";

/** Backlog buckets in pipeline order, with short labels. */
const BACKLOG_STAGES: Array<{ key: keyof ProjectFunnelDrillDown; label: string }> = [
  { key: "awaitingSurveySchedule", label: "Survey Schedule" },
  { key: "awaitingSurvey", label: "Survey Complete" },
  { key: "awaitingDaSend", label: "DA Send" },
  { key: "awaitingApproval", label: "DA Approval" },
  { key: "awaitingDesignComplete", label: "Design Complete" },
  { key: "awaitingPermitSubmit", label: "Permit Submit" },
  { key: "awaitingPermitIssue", label: "Permit Issue" },
  { key: "awaitingConstructionSchedule", label: "Construction Schedule" },
  { key: "awaitingConstructionComplete", label: "Construction Complete" },
  { key: "awaitingInspection", label: "Inspection" },
  { key: "awaitingPto", label: "PTO" },
  { key: "awaitingCloseOut", label: "Close Out" },
];

const FINAL_STRETCH = new Set(["awaitingInspection", "awaitingPto", "awaitingCloseOut"]);

const dealDays = (d: ProjectFunnelDrillDownDeal) => Math.max(0, d.daysWaiting);
const statusOf = (d: ProjectFunnelDrillDownDeal) => (d.status && d.status.trim() ? d.status : "No status");

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Analysis overview: where the live pipeline is stuck (bottlenecks) plus a few
 * positive highlights. Always fetches the active pipeline (no date window) so
 * it answers "where are things right now", regardless of the tab timeframe.
 */
export function AnalysisOverview({
  locations,
  pms,
  owners,
}: {
  locations: string[];
  pms: string[];
  owners: string[];
}) {
  const { data, isLoading } = useQuery<ProjectFunnelResponse>({
    queryKey: [...queryKeys.funnel.root, "analysis-active", locations, pms, owners],
    queryFn: async () => {
      const params = new URLSearchParams({ months: "6", scope: "active" });
      if (locations.length > 0) params.set("locations", locations.join(","));
      if (pms.length > 0) params.set("pms", pms.join(","));
      if (owners.length > 0) params.set("owners", owners.join(","));
      const res = await fetch(`/api/deals/project-funnel?${params}`);
      if (!res.ok) throw new Error("Failed to fetch analysis data");
      return res.json();
    },
    refetchInterval: 5 * 60 * 1000,
  });

  const c = useMemo(() => {
    if (!data) return null;
    const dd = data.drillDown;
    const stages = BACKLOG_STAGES.map((s) => {
      const deals = dd[s.key] || [];
      const count = deals.length;
      const amount = deals.reduce((a, d) => a + (d.amount || 0), 0);
      const totalDays = deals.reduce((a, d) => a + dealDays(d), 0);
      const avgDays = count ? Math.round(totalDays / count) : 0;
      const maxDays = deals.reduce((m, d) => Math.max(m, dealDays(d)), 0);
      const sm = new Map<string, number>();
      for (const d of deals) sm.set(statusOf(d), (sm.get(statusOf(d)) || 0) + 1);
      const topStatus = [...sm.entries()].sort((a, b) => b[1] - a[1])[0];
      return { ...s, count, amount, totalDays, avgDays, maxDays, topStatus, deals };
    }).filter((s) => s.count > 0);

    // Stuck score = total deal-days waiting (volume × age).
    const bottlenecks = [...stages].sort((a, b) => b.totalDays - a.totalDays);
    const maxScore = Math.max(1, ...bottlenecks.map((s) => s.totalDays));

    const allDeals = stages.flatMap((s) => s.deals.map((d) => ({ deal: d, stageLabel: s.label })));
    const oldest = [...allDeals].sort((a, b) => dealDays(b.deal) - dealDays(a.deal)).slice(0, 12);

    const blockers = new Map<string, { count: number; amount: number }>();
    for (const { deal } of allDeals) {
      const e = blockers.get(statusOf(deal)) || { count: 0, amount: 0 };
      e.count++;
      e.amount += deal.amount || 0;
      blockers.set(statusOf(deal), e);
    }
    const topBlockers = [...blockers.entries()]
      .map(([status, v]) => ({ status, ...v }))
      .filter((b) => b.status !== "No status")
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    const totalCount = stages.reduce((a, s) => a + s.count, 0);
    const totalAmount = stages.reduce((a, s) => a + s.amount, 0);
    const rtb = stages.find((s) => s.key === "awaitingConstructionSchedule");
    const finalCount = stages.filter((s) => FINAL_STRETCH.has(s.key)).reduce((a, s) => a + s.count, 0);
    const finalAmount = stages.filter((s) => FINAL_STRETCH.has(s.key)).reduce((a, s) => a + s.amount, 0);
    const fastest = [...stages].filter((s) => s.count >= 3).sort((a, b) => a.avgDays - b.avgDays)[0];

    return { stages, bottlenecks, maxScore, oldest, topBlockers, totalCount, totalAmount, rtb, finalCount, finalAmount, fastest };
  }, [data]);

  if (isLoading || !c) return <LoadingSpinner />;

  const ageColor = (avg: number) =>
    avg >= 45 ? "bg-red-500" : avg >= 21 ? "bg-amber-500" : "bg-emerald-500";

  return (
    <>
      {/* Highlights */}
      <div className="grid gap-4 mb-6 grid-cols-2 lg:grid-cols-4">
        <HighlightCard
          label="Active pipeline"
          value={`${c.totalCount}`}
          sub={`${formatCurrencyCompact(c.totalAmount)} in flight`}
          accent="cyan"
        />
        <HighlightCard
          label="Ready to build"
          value={`${c.rtb?.count ?? 0}`}
          sub={`${formatCurrencyCompact(c.rtb?.amount ?? 0)} permitted, awaiting schedule`}
          accent="green"
        />
        <HighlightCard
          label="In the final stretch"
          value={`${c.finalCount}`}
          sub={`${formatCurrencyCompact(c.finalAmount)} · inspection → close out`}
          accent="emerald"
        />
        <HighlightCard
          label="Fastest-moving stage"
          value={c.fastest ? c.fastest.label : "—"}
          sub={c.fastest ? `avg ${c.fastest.avgDays}d in stage` : "n/a"}
          accent="blue"
        />
      </div>

      {/* Bottlenecks */}
      <div className="bg-surface rounded-xl border border-t-border p-5 mb-6">
        <h3 className="text-sm font-semibold text-foreground/80 mb-1">Where it&apos;s stuck</h3>
        <p className="text-xs text-muted mb-4">
          Stages ranked by total waiting time (deals × days). Bar color flags how long deals have sat:
          <span className="text-emerald-400"> &lt;21d</span> ·<span className="text-amber-400"> 21–45d</span> ·
          <span className="text-red-400"> 45d+</span>.
        </p>
        <div className="space-y-1.5">
          {c.bottlenecks.map((s) => (
            <div key={s.key} className="flex items-center gap-3">
              <span className="w-36 text-xs text-muted text-right shrink-0 truncate" title={s.label}>{s.label}</span>
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div
                  className={`${ageColor(s.avgDays)} h-6 rounded-md flex items-center px-2`}
                  style={{ width: `${Math.max(8, (s.totalDays / c.maxScore) * 100)}%` }}
                >
                  <span className="text-white text-[11px] font-semibold whitespace-nowrap">{s.count} · avg {s.avgDays}d</span>
                </div>
                <span className="text-[11px] text-muted shrink-0 tabular-nums">
                  {formatCurrencyCompact(s.amount)} · max {s.maxDays}d
                  {s.topStatus ? ` · ${s.topStatus[1]} ${s.topStatus[0]}` : ""}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Top blockers + oldest deals */}
      <div className="grid gap-6 lg:grid-cols-2 mb-6">
        <div className="bg-surface rounded-xl border border-t-border p-5">
          <h3 className="text-sm font-semibold text-foreground/80 mb-1">Top blockers</h3>
          <p className="text-xs text-muted mb-3">Statuses holding up the most deals across the pipeline.</p>
          <div className="space-y-1.5">
            {c.topBlockers.map((b) => (
              <div key={b.status} className="flex items-center justify-between gap-3 text-xs">
                <span className="text-foreground/80 truncate" title={b.status}>{b.status}</span>
                <span className="shrink-0 tabular-nums">
                  <span className="text-foreground font-semibold">{b.count}</span>
                  <span className="text-muted"> · {formatCurrencyCompact(b.amount)}</span>
                </span>
              </div>
            ))}
            {c.topBlockers.length === 0 && <p className="text-xs text-muted/60 italic">No blocker statuses set.</p>}
          </div>
        </div>

        <div className="bg-surface rounded-xl border border-t-border p-5">
          <h3 className="text-sm font-semibold text-foreground/80 mb-1">Oldest stuck deals</h3>
          <p className="text-xs text-muted mb-3">
            Longest-waiting deals right now — the ones to chase. &ldquo;Since&rdquo; is the day the deal
            hit its previous milestone and the wait started.
          </p>
          <div className="space-y-1">
            {c.oldest.map(({ deal, stageLabel }) => (
              <a
                key={deal.id}
                href={deal.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-3 text-xs py-1 px-1 rounded hover:bg-surface-2/60"
              >
                <span className="truncate min-w-0">
                  <span className="text-foreground/90 font-medium">{deal.projectNumber || deal.name}</span>
                  <span className="text-muted"> · {stageLabel}</span>
                  {deal.status ? <span className="text-muted/70"> · {deal.status}</span> : null}
                </span>
                <span className="shrink-0 tabular-nums">
                  {deal.waitingSince && (
                    <span className="text-muted" title="Reached the prior milestone — when this wait started">
                      since {formatShortDate(deal.waitingSince)}
                    </span>
                  )}
                  {deal.scheduledDate && (
                    <span className="text-cyan-400/80" title="Scheduled date"> · sched {formatShortDate(deal.scheduledDate)}</span>
                  )}
                  <span className="text-red-400/90 font-semibold"> · {dealDays(deal)}d</span>
                </span>
              </a>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function HighlightCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent: "cyan" | "green" | "emerald" | "blue";
}) {
  const ring: Record<string, string> = {
    cyan: "border-l-cyan-500",
    green: "border-l-green-500",
    emerald: "border-l-emerald-500",
    blue: "border-l-blue-500",
  };
  return (
    <div className={`bg-surface rounded-xl border border-t-border border-l-4 ${ring[accent]} p-4`}>
      <div className="text-xs text-muted mb-1">{label}</div>
      <div className="text-2xl font-bold text-foreground truncate" title={value}>{value}</div>
      <div className="text-[11px] text-muted mt-0.5 truncate" title={sub}>{sub}</div>
    </div>
  );
}
