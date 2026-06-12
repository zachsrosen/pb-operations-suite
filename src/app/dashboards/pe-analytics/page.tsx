"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { StatCard, MiniStat } from "@/components/ui/MetricCard";
import { queryKeys } from "@/lib/query-keys";
import {
  PIPELINE_GROUP_ORDER,
  weekStartUTC,
  type PeAnalyticsPayload,
  type WeeklyPayments,
  type WeeklyLifecycle,
  type WeeklySplitCohort,
  type MilestoneDrillRow,
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

interface DoneSplit {
  doneLegend: string; // legend: green = "Paid"
  remainderLegend: string; // legend: gray = "Approved, awaiting payment"
  doneWord: string; // tooltip: "3 paid ($12k)"
  remainderLabel: string; // tooltip total line, e.g. "Awaiting payment"
}

function WeeklyPaymentsChart({
  weekly,
  emptyMessage = "No payments recorded yet.",
  doneSplit,
  weekPrefix,
  onBarClick,
}: {
  weekly: WeeklyPayments[];
  emptyMessage?: string;
  doneSplit?: DoneSplit;
  weekPrefix: string; // tooltip header: "Approved week of Jun 8"
  onBarClick?: (weekStart: string) => void;
}) {
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
  const H = 280;
  const PAD_L = 56;
  const PAD_B = 28;
  const PAD_T = 36;
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
          const count = w.m1Count + w.m2Count;
          const dim = hovered === null || hovered === i ? 1 : 0.45;
          const totalAmt = w.m1Amount + w.m2Amount;
          const doneAmt = (w.m1DoneAmount ?? 0) + (w.m2DoneAmount ?? 0);
          // Progress fill: solid green = progressed past this stage, muted
          // gray = still outstanding. M1/M2 split lives in the tooltip.
          const segments = doneSplit
            ? [
                { amount: doneAmt, cls: "fill-emerald-500", op: 1 },
                { amount: totalAmt - doneAmt, cls: "fill-zinc-500", op: 0.45 },
              ]
            : [{ amount: totalAmt, cls: "fill-emerald-500", op: 1 }];
          let yCursor = PAD_T + chartH;
          const rects = segments.map((s, j) => {
            const h = (Math.max(0, s.amount) / maxTotal) * chartH;
            yCursor -= h;
            return h > 0 ? <rect key={j} x={x} y={yCursor} width={barW} height={h} rx={2} className={s.cls} opacity={s.op * dim} /> : null;
          });
          const yTop = yCursor;
          return (
            <g key={w.weekStart}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onBarClick?.(w.weekStart)}
              className={onBarClick ? "cursor-pointer" : undefined}>
              <rect x={PAD_L + step * i} y={PAD_T} width={step} height={chartH} fill="transparent" />
              {rects}
              {count > 0 && (
                <>
                  <text x={x + barW / 2} y={yTop - 18} textAnchor="middle" className="fill-foreground text-[10px] font-semibold">
                    {fmtUsdK(w.m1Amount + w.m2Amount)}
                  </text>
                  <text x={x + barW / 2} y={yTop - 6} textAnchor="middle" className="fill-muted text-[9px]">
                    {count}
                  </text>
                </>
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
          <div className="font-semibold text-foreground mb-1">{weekPrefix} week of {weekLabel(series[hovered].weekStart)}</div>
          <div className="text-foreground">
            M1: {series[hovered].m1Count} · {fmtUsd(series[hovered].m1Amount)}
            {doneSplit && (series[hovered].m1DoneCount ?? 0) > 0 && (
              <span className="text-muted"> — {series[hovered].m1DoneCount} {doneSplit.doneWord} ({fmtUsd(series[hovered].m1DoneAmount ?? 0)})</span>
            )}
          </div>
          <div className="text-foreground">
            M2: {series[hovered].m2Count} · {fmtUsd(series[hovered].m2Amount)}
            {doneSplit && (series[hovered].m2DoneCount ?? 0) > 0 && (
              <span className="text-muted"> — {series[hovered].m2DoneCount} {doneSplit.doneWord} ({fmtUsd(series[hovered].m2DoneAmount ?? 0)})</span>
            )}
          </div>
          <div className="text-foreground mt-1 border-t border-t-border pt-1">
            {doneSplit
              ? `${doneSplit.remainderLabel}: ${fmtUsd(series[hovered].m1Amount + series[hovered].m2Amount - (series[hovered].m1DoneAmount ?? 0) - (series[hovered].m2DoneAmount ?? 0))}`
              : `Total: ${fmtUsd(series[hovered].m1Amount + series[hovered].m2Amount)}`}
          </div>
        </div>
      )}
      <div className="flex items-center gap-4 mt-1 text-[11px] text-muted">
        {doneSplit ? (
          <>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> {doneSplit.doneLegend}</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-zinc-500/45" /> {doneSplit.remainderLegend}</span>
          </>
        ) : (
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Paid</span>
        )}
        <span>M1/M2 split on hover</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lifecycle chart — submission-week cohorts colored by current outcome
// ---------------------------------------------------------------------------

const EMPTY_LIFECYCLE_WEEK = (weekStart: string): WeeklyLifecycle => ({
  weekStart, paidCount: 0, paidAmount: 0, approvedCount: 0, approvedAmount: 0, inReviewCount: 0, inReviewAmount: 0,
});

function WeeklyLifecycleChart({ weekly, onBarClick }: { weekly: WeeklyLifecycle[]; onBarClick?: (weekStart: string) => void }) {
  const series = useMemo(() => {
    if (weekly.length === 0) return [];
    const out: WeeklyLifecycle[] = [];
    const start = new Date(weekly[0].weekStart + "T00:00:00Z");
    const end = new Date(weekly[weekly.length - 1].weekStart + "T00:00:00Z");
    const byWeek = new Map(weekly.map((w) => [w.weekStart, w]));
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 7)) {
      const key = d.toISOString().split("T")[0];
      out.push(byWeek.get(key) || EMPTY_LIFECYCLE_WEEK(key));
    }
    return out;
  }, [weekly]);

  const [hovered, setHovered] = useState<number | null>(null);

  if (series.length === 0) {
    return <div className="text-sm text-muted py-8 text-center">No submissions recorded yet.</div>;
  }

  const W = 900;
  const H = 280;
  const PAD_L = 56;
  const PAD_B = 28;
  const PAD_T = 36;
  const chartW = W - PAD_L - 8;
  const chartH = H - PAD_T - PAD_B;
  const total = (w: WeeklyLifecycle) => w.paidAmount + w.approvedAmount + w.inReviewAmount;
  const maxTotal = Math.max(...series.map(total), 1);
  const barW = Math.min(48, (chartW / series.length) * 0.7);
  const step = chartW / series.length;
  const yTicks = 4;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
        aria-label="Stacked weekly bar chart of submission cohorts by current outcome: paid, approved awaiting payment, in review">
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
          const count = w.paidCount + w.approvedCount + w.inReviewCount;
          const dim = hovered === null || hovered === i ? 1 : 0.45;
          const segments = [
            { amount: w.paidAmount, cls: "fill-emerald-500", op: 1 },
            { amount: w.approvedAmount, cls: "fill-amber-500", op: 1 },
            { amount: w.inReviewAmount, cls: "fill-zinc-500", op: 0.55 },
          ];
          let yCursor = PAD_T + chartH;
          const rects = segments.map((s, j) => {
            const h = (Math.max(0, s.amount) / maxTotal) * chartH;
            yCursor -= h;
            return h > 0 ? <rect key={j} x={x} y={yCursor} width={barW} height={h} rx={2} className={s.cls} opacity={s.op * dim} /> : null;
          });
          const yTop = yCursor;
          return (
            <g key={w.weekStart}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onBarClick?.(w.weekStart)}
              className={onBarClick ? "cursor-pointer" : undefined}>
              <rect x={PAD_L + step * i} y={PAD_T} width={step} height={chartH} fill="transparent" />
              {rects}
              {count > 0 && (
                <>
                  <text x={x + barW / 2} y={yTop - 18} textAnchor="middle" className="fill-foreground text-[10px] font-semibold">
                    {fmtUsdK(total(w))}
                  </text>
                  <text x={x + barW / 2} y={yTop - 6} textAnchor="middle" className="fill-muted text-[9px]">
                    {count}
                  </text>
                </>
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
          <div className="font-semibold text-foreground mb-1">Submitted week of {weekLabel(series[hovered].weekStart)}</div>
          <div className="text-emerald-400">Paid: {series[hovered].paidCount} · {fmtUsd(series[hovered].paidAmount)}</div>
          <div className="text-amber-400">Approved, awaiting payment: {series[hovered].approvedCount} · {fmtUsd(series[hovered].approvedAmount)}</div>
          <div className="text-muted">Still in review: {series[hovered].inReviewCount} · {fmtUsd(series[hovered].inReviewAmount)}</div>
          <div className="text-foreground mt-1 border-t border-t-border pt-1">
            Total submitted: {fmtUsd(total(series[hovered]))}
          </div>
        </div>
      )}
      <div className="flex items-center gap-4 mt-1 text-[11px] text-muted">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Paid</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500" /> Approved, awaiting payment</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-zinc-500/55" /> Still in review</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Two-segment cohort chart — done (green progress) vs still pending.
// Powers the Ready-to-Submit and Rejections views.
// ---------------------------------------------------------------------------

function SplitCohortChart({
  weekly,
  onBarClick,
  weekPrefix,
  doneLabel,
  pendingLabel,
  pendingClass = "fill-zinc-500",
  pendingOpacity = 0.55,
  pendingSwatch = "bg-zinc-500/55",
  emptyMessage,
}: {
  weekly: WeeklySplitCohort[];
  onBarClick?: (weekStart: string) => void;
  weekPrefix: string;
  doneLabel: string;
  pendingLabel: string;
  pendingClass?: string;
  pendingOpacity?: number;
  pendingSwatch?: string;
  emptyMessage: string;
}) {
  const series = useMemo(() => {
    if (weekly.length === 0) return [];
    const out: WeeklySplitCohort[] = [];
    const start = new Date(weekly[0].weekStart + "T00:00:00Z");
    const end = new Date(weekly[weekly.length - 1].weekStart + "T00:00:00Z");
    const byWeek = new Map(weekly.map((w) => [w.weekStart, w]));
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 7)) {
      const key = d.toISOString().split("T")[0];
      out.push(byWeek.get(key) || { weekStart: key, doneCount: 0, doneAmount: 0, pendingCount: 0, pendingAmount: 0 });
    }
    return out;
  }, [weekly]);

  const [hovered, setHovered] = useState<number | null>(null);

  if (series.length === 0) {
    return <div className="text-sm text-muted py-8 text-center">{emptyMessage}</div>;
  }

  const W = 900;
  const H = 280;
  const PAD_L = 56;
  const PAD_B = 28;
  const PAD_T = 36;
  const chartW = W - PAD_L - 8;
  const chartH = H - PAD_T - PAD_B;
  const total = (w: WeeklySplitCohort) => w.doneAmount + w.pendingAmount;
  const maxTotal = Math.max(...series.map(total), 1);
  const barW = Math.min(48, (chartW / series.length) * 0.7);
  const step = chartW / series.length;
  const yTicks = 4;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
        aria-label={`Stacked weekly cohort chart: ${doneLabel} (progress) vs ${pendingLabel}`}>
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
          const count = w.doneCount + w.pendingCount;
          const dim = hovered === null || hovered === i ? 1 : 0.45;
          const subH = (w.doneAmount / maxTotal) * chartH;
          const waitH = (w.pendingAmount / maxTotal) * chartH;
          const ySub = PAD_T + chartH - subH;
          const yWait = ySub - waitH;
          return (
            <g key={w.weekStart}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onBarClick?.(w.weekStart)}
              className={onBarClick ? "cursor-pointer" : undefined}>
              <rect x={PAD_L + step * i} y={PAD_T} width={step} height={chartH} fill="transparent" />
              {subH > 0 && <rect x={x} y={ySub} width={barW} height={subH} rx={2} className="fill-emerald-500" opacity={dim} />}
              {waitH > 0 && <rect x={x} y={yWait} width={barW} height={waitH} rx={2} className={pendingClass} opacity={pendingOpacity * dim} />}
              {count > 0 && (
                <>
                  <text x={x + barW / 2} y={yWait - 18} textAnchor="middle" className="fill-foreground text-[10px] font-semibold">
                    {fmtUsdK(total(w))}
                  </text>
                  <text x={x + barW / 2} y={yWait - 6} textAnchor="middle" className="fill-muted text-[9px]">
                    {count}
                  </text>
                </>
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
          <div className="font-semibold text-foreground mb-1">{weekPrefix} week of {weekLabel(series[hovered].weekStart)}</div>
          <div className="text-emerald-400">{doneLabel}: {series[hovered].doneCount} · {fmtUsd(series[hovered].doneAmount)}</div>
          <div className="text-muted">{pendingLabel}: {series[hovered].pendingCount} · {fmtUsd(series[hovered].pendingAmount)}</div>
          <div className="text-foreground mt-1 border-t border-t-border pt-1">
            Total: {fmtUsd(total(series[hovered]))}
          </div>
        </div>
      )}
      <div className="flex items-center gap-4 mt-1 text-[11px] text-muted">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> {doneLabel}</span>
        <span className="flex items-center gap-1.5"><span className={`w-2.5 h-2.5 rounded-sm ${pendingSwatch}`} /> {pendingLabel}</span>
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
// Drill-down panel — milestones behind a clicked bar
// ---------------------------------------------------------------------------

const DOC_SHORT: Record<string, string> = {
  "Customer Agreement (PPA/ESA)": "CustAgmt",
  "Installation Order": "InstOrder",
  "State Disclosures": "Disclosures",
  "Utility Bill": "UtilBill",
  "Signed Proposal": "Proposal",
  "Design Plan": "Design",
  "Photos per Policy": "Photos",
  "Signed Final Permit": "Permit",
  "Access to Monitoring": "Monitoring",
  "Certificate of Acceptance": "CoA",
  "Attestation of Customer Payment": "Attestation",
  "Conditional Progress Lien Waiver": "ProgLien",
  "Signed Interconnection Agreement": "IC Agmt",
  "Conditional Waiver — Final Payment": "FinalLien",
  "Permission to Operate (PTO)": "PTO",
};

function DrillPanel({ rows, weekStart, weekPrefix, onClose }: {
  rows: MilestoneDrillRow[];
  weekStart: string;
  weekPrefix: string;
  onClose: () => void;
}) {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return (
    <div className="mt-4 rounded-lg border border-t-border bg-surface-2 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-medium text-foreground">
          {weekPrefix} week of {weekLabel(weekStart)} — {rows.length} milestones · {fmtUsd(total)}
        </div>
        <button onClick={onClose} className="text-xs px-2 py-0.5 rounded border border-t-border text-muted hover:text-foreground transition-colors">
          Close
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="text-xs text-muted py-3">No milestones in this week.</div>
      ) : (
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="text-xs w-full">
            <thead className="sticky top-0 bg-surface-2">
              <tr className="text-muted text-left">
                <th className="py-1 pr-3 font-normal">Deal</th>
                <th className="py-1 pr-3 font-normal">MS</th>
                <th className="py-1 pr-3 font-normal text-right">Amount</th>
                <th className="py-1 pr-3 font-normal">Status</th>
                <th className="py-1 pr-3 font-normal">Ready</th>
                <th className="py-1 pr-3 font-normal">Submitted</th>
                <th className="py-1 pr-3 font-normal">Approved</th>
                <th className="py-1 pr-3 font-normal">Paid</th>
                <th className="py-1 pr-3 font-normal">Rejected</th>
                <th className="py-1 pr-3 font-normal">Missing docs</th>
                <th className="py-1 font-normal">Action required</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/20">
              {[...rows].sort((a, b) => b.amount - a.amount).map((r) => (
                <tr key={`${r.dealId}-${r.milestone}`}>
                  <td className="py-1.5 pr-3 max-w-64 truncate">
                    {r.hubspotUrl ? (
                      <a href={r.hubspotUrl} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline" title={r.dealName}>
                        {r.dealName.split("|").slice(0, 2).join("|").trim()}
                      </a>
                    ) : (
                      <span title={r.dealName}>{r.dealName.split("|").slice(0, 2).join("|").trim()}</span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-muted">{r.milestone}</td>
                  <td className="py-1.5 pr-3 text-right text-foreground">{fmtUsd(r.amount)}</td>
                  <td className="py-1.5 pr-3 text-foreground">{r.status ?? "—"}</td>
                  <td className="py-1.5 pr-3 text-muted">{r.readyOn ?? "—"}</td>
                  <td className="py-1.5 pr-3 text-muted">{r.submittedOn ?? "—"}</td>
                  <td className="py-1.5 pr-3 text-muted">{r.approvedOn ?? "—"}</td>
                  <td className="py-1.5 pr-3 text-muted">{r.paidOn ?? "—"}</td>
                  <td className="py-1.5 pr-3 text-muted">{r.rejectedOn ?? "—"}</td>
                  <td className="py-1.5 pr-3 text-orange-400/90">
                    {r.missingDocs.length ? r.missingDocs.map((d) => DOC_SHORT[d] ?? d).join(", ") : ""}
                  </td>
                  <td className="py-1.5 text-orange-400/90 max-w-48 truncate" title={r.latestRejectionNote ?? undefined}>
                    {(r.actionRequiredDocs ?? []).length ? (r.actionRequiredDocs ?? []).map((d) => DOC_SHORT[d] ?? d).join(", ") : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Weekly chart modes
// ---------------------------------------------------------------------------

type WeeklyMode = "ready" | "submitted" | "approved" | "paid" | "lifecycle" | "rejections";

const WEEKLY_MODES: Record<
  WeeklyMode,
  { label: string; title: string; subtitle: string; empty: string; weekPrefix: string; split?: DoneSplit }
> = {
  ready: {
    label: "Ready to Submit",
    title: "Ready-to-Submit Cohorts",
    subtitle: "Bars dated by week each milestone became READY TO SUBMIT. Green = submitted since; gray = still waiting on submission.",
    empty: "No milestones have reached Ready to Submit yet.",
    weekPrefix: "Ready",
  },
  submitted: {
    label: "Submissions",
    title: "Submissions per Week",
    subtitle: "Bars dated by week of SUBMISSION. Green = approved since; gray = still awaiting PE approval.",
    empty: "No submissions recorded yet.",
    weekPrefix: "Submitted",
    split: {
      doneLegend: "Approved since",
      remainderLegend: "Awaiting approval",
      doneWord: "approved",
      remainderLabel: "Not yet approved",
    },
  },
  approved: {
    label: "Approvals",
    title: "Approvals per Week",
    subtitle: "Bars dated by week of APPROVAL — not payment. Green = paid since; gray = still awaiting payment.",
    empty: "No approvals recorded yet.",
    weekPrefix: "Approved",
    split: {
      doneLegend: "Paid since",
      remainderLegend: "Awaiting payment",
      doneWord: "paid",
      remainderLabel: "Awaiting payment",
    },
  },
  paid: {
    label: "Payments",
    title: "Payments per Week",
    subtitle: "Bars dated by week of PAYMENT.",
    empty: "No payments recorded yet.",
    weekPrefix: "Paid",
  },
  rejections: {
    label: "Rejections",
    title: "Rejection Cohorts",
    subtitle: "Bars dated by week of first REJECTION. Green = resolved since (resubmitted/approved/paid); orange = still pending fix.",
    empty: "No rejections recorded.",
    weekPrefix: "Rejected",
  },
  lifecycle: {
    label: "Lifecycle",
    title: "Submission Cohorts by Outcome",
    subtitle: "Bars dated by week of SUBMISSION; colored by where each milestone stands today.",
    empty: "No submissions recorded yet.",
    weekPrefix: "Submitted",
  },
};

const WEEKLY_MODE_ORDER: WeeklyMode[] = ["ready", "submitted", "approved", "paid", "lifecycle", "rejections"];

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
  const [drillWeek, setDrillWeek] = useState<string | null>(null);

  // Rows behind the clicked bar — date field depends on the active view.
  const drillRows = useMemo(() => {
    if (!drillWeek || !data?.milestones) return [];
    const dateOf = (r: MilestoneDrillRow) =>
      weeklyMode === "ready" ? r.readyOn ?? r.submittedOn // submission implies readiness (matches route bucketing)
        : weeklyMode === "rejections" ? r.rejectedOn
        : weeklyMode === "approved" ? r.approvedOn
          : weeklyMode === "paid" ? r.paidOn
            : r.submittedOn; // submitted + lifecycle
    return data.milestones.filter((r) => {
      const d = dateOf(r);
      return d ? weekStartUTC(new Date(d + "T00:00:00Z")) === drillWeek : false;
    });
  }, [drillWeek, weeklyMode, data]);
  const locations = useMemo(
    () => [...new Set((data?.funnelDeals ?? []).map((d) => d.location).filter((l) => l && l !== "Unknown"))].sort(),
    [data],
  );

  // All-time funnel totals shown above the weekly chart (same date basis as the views)
  const funnelTotals = useMemo(() => {
    const sum = (arr?: WeeklyPayments[]) =>
      (arr ?? []).reduce((s, w) => ({ count: s.count + w.m1Count + w.m2Count, amount: s.amount + w.m1Amount + w.m2Amount }), { count: 0, amount: 0 });
    // Cumulative ever-ready, plus the slice still waiting on submission.
    const ready = (data?.weeklyReadiness ?? []).reduce(
      (s, w) => ({
        count: s.count + w.doneCount + w.pendingCount,
        amount: s.amount + w.doneAmount + w.pendingAmount,
        waitingCount: s.waitingCount + w.pendingCount,
        waitingAmount: s.waitingAmount + w.pendingAmount,
      }),
      { count: 0, amount: 0, waitingCount: 0, waitingAmount: 0 },
    );
    return {
      ready,
      submitted: sum(data?.weeklySubmissions),
      approved: sum(data?.weeklyApprovals),
      paid: sum(data?.weekly),
    };
  }, [data]);

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

      {/* Header stats — doc-status driven */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <StatCard
          label="Total Paid"
          value={isLoading || !data ? null : fmtUsd(data.totals.totalPaid)}
          subtitle={data ? `${data.totals.paidCount} milestone payments` : undefined}
          color="green"
        />
        <StatCard
          label="Action Required"
          value={isLoading || !data ? null : String(data.docStats?.actionRequired.docs ?? 0)}
          subtitle={data ? `docs across ${data.docStats?.actionRequired.deals ?? 0} PTO/Close Out deals — fixes owed to PE` : undefined}
          color="orange"
        />
        <StatCard
          label="In Review"
          value={isLoading || !data ? null : String(data.docStats?.underReview.docs ?? 0)}
          subtitle={data ? `docs across ${data.docStats?.underReview.deals ?? 0} PTO/Close Out deals — waiting on PE` : undefined}
          color="cyan"
        />
        <StatCard
          label="Docs Approved"
          value={
            isLoading || !data
              ? null
              : `${data.docStats?.uploadedDocs ? Math.round(((data.docStats.approvedDocs) / data.docStats.uploadedDocs) * 100) : 0}%`
          }
          subtitle={data ? `${data.docStats?.approvedDocs ?? 0} of ${data.docStats?.uploadedDocs ?? 0} uploaded docs (PTO/Close Out)` : undefined}
          color="emerald"
        />
        <StatCard
          label="Missing Docs"
          value={isLoading || !data ? null : String(data.docStats?.missingExpected?.docs ?? 0)}
          subtitle={data ? `owed for milestone, across ${data.docStats?.missingExpected?.deals ?? 0} of ${data.docStats?.scopedDeals ?? 0} PTO/Close Out deals` : undefined}
          color="blue"
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
            subtitle={WEEKLY_MODES[weeklyMode].subtitle}
            actions={
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {WEEKLY_MODE_ORDER.map((mode) => (
                  <button
                    key={mode}
                    onClick={() => { setWeeklyMode(mode); setDrillWeek(null); }}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${weeklyMode === mode ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40" : "border-t-border text-muted hover:text-foreground"}`}
                  >
                    {WEEKLY_MODES[mode].label}
                  </button>
                ))}
              </div>
            }
          >
            {/* Ready stat (and its waiting backlog) only on the internal Ready view —
                screenshots of the other views stay safe to share externally. */}
            <div className={`grid grid-cols-2 gap-2 mb-4 ${weeklyMode === "ready" ? "md:grid-cols-4" : "md:grid-cols-3"}`}>
              {weeklyMode === "ready" && (
                <MiniStat
                  label="Total Ready to Submit"
                  value={fmtUsd(funnelTotals.ready.amount)}
                  subtitle={`${funnelTotals.ready.count} milestones — ${
                    funnelTotals.ready.amount > 0
                      ? Math.round(((funnelTotals.ready.amount - funnelTotals.ready.waitingAmount) / funnelTotals.ready.amount) * 100)
                      : 0
                  }% already submitted, ${funnelTotals.ready.waitingCount} (${fmtUsdK(funnelTotals.ready.waitingAmount)}) waiting`}
                />
              )}
              <MiniStat label="Total Submitted" value={fmtUsd(funnelTotals.submitted.amount)} subtitle={`${funnelTotals.submitted.count} milestones`} />
              <MiniStat label="Total Approved" value={fmtUsd(funnelTotals.approved.amount)} subtitle={`${funnelTotals.approved.count} milestones`} />
              <MiniStat label="Total Paid" value={fmtUsd(funnelTotals.paid.amount)} subtitle={`${funnelTotals.paid.count} milestones`} />
            </div>
            {weeklyMode === "lifecycle" ? (
              <WeeklyLifecycleChart weekly={data.weeklyLifecycle ?? []} onBarClick={setDrillWeek} />
            ) : weeklyMode === "ready" ? (
              <SplitCohortChart
                weekly={data.weeklyReadiness ?? []}
                onBarClick={setDrillWeek}
                weekPrefix="Ready"
                doneLabel="Submitted"
                pendingLabel="Waiting on submission"
                emptyMessage={WEEKLY_MODES.ready.empty}
              />
            ) : weeklyMode === "rejections" ? (
              <SplitCohortChart
                weekly={data.weeklyRejections ?? []}
                onBarClick={setDrillWeek}
                weekPrefix="Rejected"
                doneLabel="Resolved since"
                pendingLabel="Still pending fix"
                pendingClass="fill-orange-500"
                pendingOpacity={0.85}
                pendingSwatch="bg-orange-500/85"
                emptyMessage={WEEKLY_MODES.rejections.empty}
              />
            ) : (
              <WeeklyPaymentsChart
                weekly={
                  weeklyMode === "paid"
                    ? data.weekly
                    : weeklyMode === "approved"
                      ? data.weeklyApprovals ?? []
                      : data.weeklySubmissions ?? []
                }
                emptyMessage={WEEKLY_MODES[weeklyMode].empty}
                doneSplit={WEEKLY_MODES[weeklyMode].split}
                weekPrefix={WEEKLY_MODES[weeklyMode].weekPrefix}
                onBarClick={setDrillWeek}
              />
            )}
            {drillWeek && (
              <DrillPanel
                rows={drillRows}
                weekStart={drillWeek}
                weekPrefix={WEEKLY_MODES[weeklyMode].weekPrefix}
                onClose={() => setDrillWeek(null)}
              />
            )}
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
