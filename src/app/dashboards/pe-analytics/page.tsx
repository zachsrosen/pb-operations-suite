"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { StatCard, MiniStat } from "@/components/ui/MetricCard";
import { queryKeys } from "@/lib/query-keys";
import {
  PIPELINE_GROUP_ORDER,
  type PeAnalyticsPayload,
  type WeeklyPayments,
} from "@/lib/pe-analytics";

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const fmtUsd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const fmtUsdK = (n: number) => (n >= 1000 ? `$${Math.round(n / 1000)}k` : fmtUsd(n));
const fmtDays = (n: number | null) => (n === null ? "—" : `${n}d`);

function weekLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

// ---------------------------------------------------------------------------
// Weekly stacked bar chart (inline SVG, no deps)
// ---------------------------------------------------------------------------

function WeeklyPaymentsChart({ weekly, emptyMessage = "No payments recorded yet." }: { weekly: WeeklyPayments[]; emptyMessage?: string }) {
  // Fill gaps so empty weeks render as gaps in time, not skipped
  const series = useMemo(() => {
    if (weekly.length === 0) return [];
    const out: WeeklyPayments[] = [];
    const start = new Date(weekly[0].weekStart + "T00:00:00Z");
    const end = new Date(weekly[weekly.length - 1].weekStart + "T00:00:00Z");
    const byWeek = new Map(weekly.map((w) => [w.weekStart, w]));
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 7)) {
      const key = d.toISOString().split("T")[0];
      out.push(byWeek.get(key) || { weekStart: key, m1Count: 0, m2Count: 0, m1Amount: 0, m2Amount: 0 });
    }
    return out;
  }, [weekly]);

  const [hovered, setHovered] = useState<number | null>(null);

  if (series.length === 0) {
    return <div className="text-sm text-muted py-8 text-center">{emptyMessage}</div>;
  }

  const W = 900;
  const H = 260;
  const PAD_L = 56;
  const PAD_B = 28;
  const PAD_T = 16;
  const chartW = W - PAD_L - 8;
  const chartH = H - PAD_T - PAD_B;
  const maxTotal = Math.max(...series.map((w) => w.m1Amount + w.m2Amount), 1);
  const barW = Math.min(48, (chartW / series.length) * 0.7);
  const step = chartW / series.length;

  const yTicks = 4;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
        aria-label="Stacked weekly bar chart of PE payments, M1 and M2">
        {[...Array(yTicks + 1)].map((_, i) => {
          const y = PAD_T + chartH - (chartH * i) / yTicks;
          const val = (maxTotal * i) / yTicks;
          return (
            <g key={i}>
              <line x1={PAD_L} x2={W - 8} y1={y} y2={y} className="stroke-t-border" strokeWidth={0.5} strokeDasharray="3 4" />
              <text x={PAD_L - 8} y={y + 3} textAnchor="end" className="fill-muted text-[10px]">
                {fmtUsdK(val)}
              </text>
            </g>
          );
        })}
        {series.map((w, i) => {
          const x = PAD_L + step * i + (step - barW) / 2;
          const m1H = (w.m1Amount / maxTotal) * chartH;
          const m2H = (w.m2Amount / maxTotal) * chartH;
          const yM1 = PAD_T + chartH - m1H;
          const yM2 = yM1 - m2H;
          const count = w.m1Count + w.m2Count;
          return (
            <g key={w.weekStart}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}>
              <rect x={PAD_L + step * i} y={PAD_T} width={step} height={chartH} fill="transparent" />
              <rect x={x} y={yM1} width={barW} height={m1H} rx={2} className="fill-emerald-500" opacity={hovered === null || hovered === i ? 1 : 0.45} />
              <rect x={x} y={yM2} width={barW} height={m2H} rx={2} className="fill-cyan-500" opacity={hovered === null || hovered === i ? 1 : 0.45} />
              {count > 0 && (
                <text x={x + barW / 2} y={yM2 - 5} textAnchor="middle" className="fill-muted text-[10px] font-medium">
                  {count}
                </text>
              )}
              <text x={x + barW / 2} y={H - 10} textAnchor="middle" className="fill-muted text-[10px]">
                {weekLabel(w.weekStart)}
              </text>
            </g>
          );
        })}
      </svg>
      {hovered !== null && series[hovered] && (
        <div className="absolute top-0 right-0 rounded-lg bg-surface-elevated border border-t-border shadow-card px-3 py-2 text-xs">
          <div className="font-semibold text-foreground mb-1">Week of {weekLabel(series[hovered].weekStart)}</div>
          <div className="text-emerald-400">M1: {series[hovered].m1Count} · {fmtUsd(series[hovered].m1Amount)}</div>
          <div className="text-cyan-400">M2: {series[hovered].m2Count} · {fmtUsd(series[hovered].m2Amount)}</div>
          <div className="text-foreground mt-1 border-t border-t-border pt-1">
            Total: {fmtUsd(series[hovered].m1Amount + series[hovered].m2Amount)}
          </div>
        </div>
      )}
      <div className="flex items-center gap-4 mt-1 text-[11px] text-muted">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> M1 (Inspection Complete)</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-cyan-500" /> M2 (Project Complete)</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------

function Section({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-surface border border-t-border shadow-card p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Funnel
// ---------------------------------------------------------------------------

const FUNNEL_STATUS_ORDER = [
  "Waiting on Information",
  "Ready for Onboarding",
  "Onboarding Submitted",
  "Onboarding Rejected",
  "Onboarding Ready to Resubmit",
  "Onboarding Resubmitted",
  "Ready to Submit",
  "Submitted",
  "Resubmitted",
  "Rejected",
  "Ready to Resubmit",
  "Approved",
  "Paid",
];

function MilestoneFunnel({ deals, milestone, locFilter }: {
  deals: PeAnalyticsPayload["funnelDeals"];
  milestone: "m1" | "m2";
  locFilter: string | null;
}) {
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of deals) {
      if (locFilter && d.location !== locFilter) continue;
      const status = d[milestone];
      if (!status) continue;
      m.set(status, (m.get(status) || 0) + 1);
    }
    return m;
  }, [deals, milestone, locFilter]);

  const rows = FUNNEL_STATUS_ORDER.filter((s) => counts.has(s)).map((s) => ({ status: s, count: counts.get(s)! }));
  const extra = [...counts.keys()].filter((s) => !FUNNEL_STATUS_ORDER.includes(s));
  for (const s of extra) rows.push({ status: s, count: counts.get(s)! });
  const max = Math.max(...rows.map((r) => r.count), 1);

  if (rows.length === 0) return <div className="text-xs text-muted py-4">No deals.</div>;

  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.status} className="flex items-center gap-2">
          <span className="text-[11px] text-muted w-44 truncate" title={r.status}>{r.status}</span>
          <div className="flex-1 h-4 rounded bg-surface-2 overflow-hidden">
            <div
              className={`h-full rounded ${r.status === "Paid" ? "bg-green-500/70" : r.status === "Approved" ? "bg-emerald-500/70" : r.status.includes("Reject") ? "bg-orange-500/70" : "bg-cyan-500/60"}`}
              style={{ width: `${(r.count / max) * 100}%` }}
            />
          </div>
          <span className="text-xs text-foreground w-8 text-right">{r.count}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Weekly chart modes
// ---------------------------------------------------------------------------

type WeeklyMode = "submitted" | "approved" | "paid";

const WEEKLY_MODES: Record<WeeklyMode, { label: string; title: string; empty: string }> = {
  submitted: {
    label: "Submissions",
    title: "Submissions per Week",
    empty: "No submissions recorded yet.",
  },
  approved: {
    label: "Approvals",
    title: "Approvals per Week",
    empty: "No approvals recorded yet.",
  },
  paid: {
    label: "Payments",
    title: "Payments per Week",
    empty: "No payments recorded yet.",
  },
};

const WEEKLY_MODE_ORDER: WeeklyMode[] = ["submitted", "approved", "paid"];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PeAnalyticsPage() {
  const { data, isLoading, isError, refetch } = useQuery<PeAnalyticsPayload>({
    queryKey: queryKeys.peAnalytics.list(),
    queryFn: async () => {
      const r = await fetch("/api/accounting/pe-analytics");
      if (!r.ok) throw new Error("Failed to load PE analytics");
      return r.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const [locFilter, setLocFilter] = useState<string | null>(null);
  const [weeklyMode, setWeeklyMode] = useState<WeeklyMode>("paid");
  const locations = useMemo(
    () => [...new Set((data?.funnelDeals ?? []).map((d) => d.location).filter((l) => l && l !== "Unknown"))].sort(),
    [data],
  );

  const m1Timing = data?.timing.overall.find((t) => t.milestone === "M1");
  const m2Timing = data?.timing.overall.find((t) => t.milestone === "M2");

  return (
    <DashboardShell title="PE Analytics" accentColor="emerald" lastUpdated={data?.lastUpdated} fullWidth>
      {isError && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-4 mb-6 text-sm text-foreground flex items-center justify-between">
          <span>Failed to load PE analytics — HubSpot may be slow or rate-limited.</span>
          <button onClick={() => refetch()} className="text-xs px-3 py-1.5 rounded bg-red-500/20 text-red-400 border border-red-500/40 hover:bg-red-500/30 transition-colors">
            Retry
          </button>
        </div>
      )}

      {/* Header stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard
          label="Total Paid"
          value={isLoading || !data ? null : fmtUsd(data.totals.totalPaid)}
          subtitle={data ? `${data.totals.paidCount} milestone payments` : undefined}
          color="green"
        />
        <StatCard
          label="In Flight"
          value={isLoading || !data ? null : fmtUsd(data.totals.inFlight)}
          subtitle={data ? `${data.totals.inFlightCount} submitted or approved, unpaid` : undefined}
          color="cyan"
        />
        <StatCard
          label="Approval → Payment"
          value={isLoading || !data ? null : fmtDays(data.totals.medianApproveToPaidDays)}
          subtitle="Median days"
          color="emerald"
        />
        <StatCard
          label="Rejection Rate"
          value={isLoading || !data ? null : data.totals.rejectionRatePct === null ? "—" : `${data.totals.rejectionRatePct}%`}
          subtitle="Submitted milestones rejected at least once"
          color={data && (data.totals.rejectionRatePct ?? 0) > 25 ? "orange" : "blue"}
        />
      </div>

      {isLoading && (
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-48 rounded-xl bg-surface-2 animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && data && (
        <div className="space-y-6">
          {/* 1. Submissions / approvals / payments per week */}
          <Section
            title={WEEKLY_MODES[weeklyMode].title}
            actions={
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {WEEKLY_MODE_ORDER.map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setWeeklyMode(mode)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${weeklyMode === mode ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40" : "border-t-border text-muted hover:text-foreground"}`}
                  >
                    {WEEKLY_MODES[mode].label}
                  </button>
                ))}
              </div>
            }
          >
            <WeeklyPaymentsChart
              weekly={
                weeklyMode === "paid"
                  ? data.weekly
                  : weeklyMode === "approved"
                    ? data.weeklyApprovals ?? []
                    : data.weeklySubmissions ?? []
              }
              emptyMessage={WEEKLY_MODES[weeklyMode].empty}
            />
          </Section>

          {/* 2. Expected revenue pipeline */}
          <Section
            title="Expected Revenue Pipeline"
            subtitle="Where every milestone payment sits right now — money moves left to right."
          >
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
              {PIPELINE_GROUP_ORDER.filter((g) => data.pipeline.some((p) => p.group === g)).map((g) => {
                const row = data.pipeline.find((p) => p.group === g)!;
                const total = row.m1Amount + row.m2Amount;
                return (
                  <div key={g} className={`rounded-lg border p-3 ${g === "Paid" ? "border-green-500/40 bg-green-500/5" : g === "Approved (unpaid)" ? "border-emerald-500/40 bg-emerald-500/5" : g === "Rejected — pending fix" ? "border-orange-500/40 bg-orange-500/5" : "border-t-border bg-surface-2"}`}>
                    <div className="text-[11px] text-muted mb-1 truncate" title={g}>{g}</div>
                    <div className="text-lg font-semibold text-foreground">{fmtUsdK(total)}</div>
                    <div className="text-[10px] text-muted mt-1">
                      M1: {row.m1Count} · {fmtUsdK(row.m1Amount)}
                    </div>
                    <div className="text-[10px] text-muted">
                      M2: {row.m2Count} · {fmtUsdK(row.m2Amount)}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>

          {/* 3. Timing */}
          <Section
            title="PE Timing"
            subtitle="How long PE takes — submission to approval, approval to payment."
          >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
              <MiniStat label="M1 Submit → Approve" value={fmtDays(m1Timing?.medianSubmitToApprove ?? null)} subtitle={`p75 ${fmtDays(m1Timing?.p75SubmitToApprove ?? null)} · n=${m1Timing?.approvedCount ?? 0}`} />
              <MiniStat label="M1 Approve → Paid" value={fmtDays(m1Timing?.medianApproveToPaid ?? null)} subtitle={`p75 ${fmtDays(m1Timing?.p75ApproveToPaid ?? null)} · n=${m1Timing?.paidCount ?? 0}`} />
              <MiniStat label="M2 Submit → Approve" value={fmtDays(m2Timing?.medianSubmitToApprove ?? null)} subtitle={`p75 ${fmtDays(m2Timing?.p75SubmitToApprove ?? null)} · n=${m2Timing?.approvedCount ?? 0}`} />
              <MiniStat label="M2 Approve → Paid" value={fmtDays(m2Timing?.medianApproveToPaid ?? null)} subtitle={`p75 ${fmtDays(m2Timing?.p75ApproveToPaid ?? null)} · n=${m2Timing?.paidCount ?? 0}`} />
            </div>
            {data.timing.monthly.length > 0 && (
              <div>
                <div className="text-xs font-medium text-foreground mb-2">Median submission → approval by month</div>
                <div className="overflow-x-auto">
                  <table className="text-xs w-full">
                    <thead>
                      <tr className="text-muted text-left">
                        <th className="py-1 pr-4 font-normal">Month</th>
                        <th className="py-1 pr-4 font-normal">Median days</th>
                        <th className="py-1 font-normal">Approvals</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/20">
                      {data.timing.monthly.map((m) => (
                        <tr key={m.month}>
                          <td className="py-1.5 pr-4 text-foreground">{m.month}</td>
                          <td className="py-1.5 pr-4 text-foreground">{fmtDays(m.medianSubmitToApprove)}</td>
                          <td className="py-1.5 text-muted">{m.approvals}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Section>

          {/* 4. Rejection analysis */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Section
              title="Rejections by Document"
              subtitle="Historical rejection/action-required events plus current state, per doc type."
            >
              {data.rejections.byDoc.length === 0 ? (
                <div className="text-xs text-muted py-4">No rejection data yet.</div>
              ) : (
                <div className="space-y-1.5">
                  {data.rejections.byDoc.map((d) => {
                    const max = Math.max(...data.rejections.byDoc.map((x) => x.totalEvents), 1);
                    return (
                      <div key={d.docName} className="flex items-center gap-2">
                        <span className="text-[11px] text-muted w-52 truncate" title={d.docName}>{d.docName}</span>
                        <div className="flex-1 h-4 rounded bg-surface-2 overflow-hidden">
                          <div className="h-full rounded bg-orange-500/70" style={{ width: `${(d.totalEvents / max) * 100}%` }} />
                        </div>
                        <span className="text-xs text-foreground w-10 text-right">{d.totalEvents}</span>
                        <span className="text-[10px] text-orange-400 w-16 text-right" title="Currently rejected or action required">
                          {d.currentlyRejected + d.currentActionRequired} open
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>

            <Section title="Recent Rejection Notes" subtitle="Latest PE reviewer comments on rejected docs.">
              {data.rejections.recentNotes.length === 0 ? (
                <div className="text-xs text-muted py-4">No notes recorded.</div>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {data.rejections.recentNotes.map((n, i) => (
                    <div key={i} className="rounded-lg bg-surface-2 p-2.5">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-[11px] font-medium text-foreground truncate">{n.docName}</span>
                        <span className="text-[10px] text-muted flex-shrink-0">{n.date}</span>
                      </div>
                      {n.dealName && <div className="text-[10px] text-muted mb-1 truncate">{n.dealName}</div>}
                      <div className="text-[11px] text-orange-400/90 line-clamp-3">{n.note}</div>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </div>

          {/* 5. Milestone funnel */}
          <Section title="Milestone Funnel" subtitle="Deal counts by current M1/M2 status.">
            <div className="flex flex-wrap items-center gap-1.5 mb-4">
              <button
                onClick={() => setLocFilter(null)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${locFilter === null ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40" : "border-t-border text-muted hover:text-foreground"}`}
              >
                All locations
              </button>
              {locations.map((l) => (
                <button
                  key={l}
                  onClick={() => setLocFilter(l === locFilter ? null : l)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${locFilter === l ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40" : "border-t-border text-muted hover:text-foreground"}`}
                >
                  {l}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <div className="text-xs font-medium text-foreground mb-2">M1 (Inspection Complete)</div>
                <MilestoneFunnel deals={data.funnelDeals} milestone="m1" locFilter={locFilter} />
              </div>
              <div>
                <div className="text-xs font-medium text-foreground mb-2">M2 (Project Complete)</div>
                <MilestoneFunnel deals={data.funnelDeals} milestone="m2" locFilter={locFilter} />
              </div>
            </div>
          </Section>
        </div>
      )}
    </DashboardShell>
  );
}
