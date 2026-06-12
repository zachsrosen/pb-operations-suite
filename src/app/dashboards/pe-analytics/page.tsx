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
  type DocRejectionEvent,
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
  rejectedLegend?: string; // when set, currently-rejected renders as an orange slice
  paidLegend?: string; // when set, already-paid splits out of done (emerald); done renders amber
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
  onBarClick?: (weekStart: string, segment?: string) => void;
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
          const rejAmt = doneSplit?.rejectedLegend ? (w.m1RejAmount ?? 0) + (w.m2RejAmount ?? 0) : 0;
          const paidAmt = doneSplit?.paidLegend ? (w.m1PaidAmount ?? 0) + (w.m2PaidAmount ?? 0) : 0;
          // Progress fill: green = fully done (paid when split out), amber =
          // approved awaiting payment, orange = currently rejected, gray = rest.
          const segments: { seg?: string; amount: number; cls: string; op: number }[] = doneSplit
            ? [
                ...(doneSplit.paidLegend
                  ? [
                      { seg: "paidSeg", amount: paidAmt, cls: "fill-emerald-500", op: 1 },
                      { seg: "done", amount: doneAmt - paidAmt, cls: "fill-amber-500", op: 1 },
                    ]
                  : [{ seg: "done", amount: doneAmt, cls: "fill-emerald-500", op: 1 }]),
                { seg: "rejected", amount: rejAmt, cls: "fill-orange-500", op: 0.85 },
                { seg: "remainder", amount: totalAmt - doneAmt - rejAmt, cls: "fill-zinc-500", op: 0.45 },
              ]
            : [{ amount: totalAmt, cls: "fill-emerald-500", op: 1 }];
          let yCursor = PAD_T + chartH;
          const rects = segments.map((s, j) => {
            const h = (Math.max(0, s.amount) / maxTotal) * chartH;
            yCursor -= h;
            return h > 0 ? (
              <rect key={j} x={x} y={yCursor} width={barW} height={h} rx={2} className={s.cls} opacity={s.op * dim}
                onClick={(e) => { e.stopPropagation(); onBarClick?.(w.weekStart, s.seg); }} />
            ) : null;
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
          {doneSplit?.paidLegend && ((series[hovered].m1PaidCount ?? 0) + (series[hovered].m2PaidCount ?? 0)) > 0 && (
            <div className="text-emerald-400">
              {doneSplit.paidLegend}: {(series[hovered].m1PaidCount ?? 0) + (series[hovered].m2PaidCount ?? 0)} · {fmtUsd((series[hovered].m1PaidAmount ?? 0) + (series[hovered].m2PaidAmount ?? 0))}
            </div>
          )}
          {doneSplit?.rejectedLegend && ((series[hovered].m1RejCount ?? 0) + (series[hovered].m2RejCount ?? 0)) > 0 && (
            <div className="text-orange-400">
              {doneSplit.rejectedLegend}: {(series[hovered].m1RejCount ?? 0) + (series[hovered].m2RejCount ?? 0)} · {fmtUsd((series[hovered].m1RejAmount ?? 0) + (series[hovered].m2RejAmount ?? 0))}
            </div>
          )}
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
            {doneSplit.paidLegend && (
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> {doneSplit.paidLegend}</span>
            )}
            <span className="flex items-center gap-1.5"><span className={`w-2.5 h-2.5 rounded-sm ${doneSplit.paidLegend ? "bg-amber-500" : "bg-emerald-500"}`} /> {doneSplit.doneLegend}</span>
            {doneSplit.rejectedLegend && (
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-orange-500/85" /> {doneSplit.rejectedLegend}</span>
            )}
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
  rejectedCount: 0, rejectedAmount: 0, waitingCount: 0, waitingAmount: 0,
});

function WeeklyLifecycleChart({ weekly, onBarClick }: { weekly: WeeklyLifecycle[]; onBarClick?: (weekStart: string, segment?: string) => void }) {
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
  const total = (w: WeeklyLifecycle) =>
    w.paidAmount + w.approvedAmount + w.inReviewAmount + (w.rejectedAmount ?? 0) + (w.waitingAmount ?? 0);
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
          const count = w.paidCount + w.approvedCount + w.inReviewCount + (w.rejectedCount ?? 0) + (w.waitingCount ?? 0);
          const dim = hovered === null || hovered === i ? 1 : 0.45;
          const segments = [
            { seg: "paid", amount: w.paidAmount, cls: "fill-emerald-500", op: 1 },
            { seg: "approved", amount: w.approvedAmount, cls: "fill-amber-500", op: 1 },
            { seg: "inReview", amount: w.inReviewAmount, cls: "fill-zinc-500", op: 0.55 },
            { seg: "rejected", amount: w.rejectedAmount ?? 0, cls: "fill-orange-500", op: 0.85 },
            { seg: "waiting", amount: w.waitingAmount ?? 0, cls: "fill-zinc-500", op: 0.25 },
          ];
          let yCursor = PAD_T + chartH;
          const rects = segments.map((s, j) => {
            const h = (Math.max(0, s.amount) / maxTotal) * chartH;
            yCursor -= h;
            return h > 0 ? (
              <rect key={j} x={x} y={yCursor} width={barW} height={h} rx={2} className={s.cls} opacity={s.op * dim}
                onClick={(e) => { e.stopPropagation(); onBarClick?.(w.weekStart, s.seg); }} />
            ) : null;
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
          <div className="font-semibold text-foreground mb-1">Ready week of {weekLabel(series[hovered].weekStart)}</div>
          <div className="text-emerald-400">Paid: {series[hovered].paidCount} · {fmtUsd(series[hovered].paidAmount)}</div>
          <div className="text-amber-400">Approved, awaiting payment: {series[hovered].approvedCount} · {fmtUsd(series[hovered].approvedAmount)}</div>
          <div className="text-muted">In PE review: {series[hovered].inReviewCount} · {fmtUsd(series[hovered].inReviewAmount)}</div>
          {(series[hovered].rejectedCount ?? 0) > 0 && (
            <div className="text-orange-400">Rejected — pending fix: {series[hovered].rejectedCount} · {fmtUsd(series[hovered].rejectedAmount ?? 0)}</div>
          )}
          {(series[hovered].waitingCount ?? 0) > 0 && (
            <div className="text-muted">Not yet submitted: {series[hovered].waitingCount} · {fmtUsd(series[hovered].waitingAmount ?? 0)}</div>
          )}
          <div className="text-foreground mt-1 border-t border-t-border pt-1">
            Total ready: {fmtUsd(total(series[hovered]))}
          </div>
        </div>
      )}
      <div className="flex items-center gap-4 mt-1 text-[11px] text-muted">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Paid</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500" /> Approved, awaiting payment</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-zinc-500/55" /> In PE review</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-orange-500/85" /> Rejected — pending fix</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-zinc-500/25" /> Not yet submitted</span>
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
  onBarClick?: (weekStart: string, segment?: string) => void;
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
              {subH > 0 && (
                <rect x={x} y={ySub} width={barW} height={subH} rx={2} className="fill-emerald-500" opacity={dim}
                  onClick={(e) => { e.stopPropagation(); onBarClick?.(w.weekStart, "done"); }} />
              )}
              {waitH > 0 && (
                <rect x={x} y={yWait} width={barW} height={waitH} rx={2} className={pendingClass} opacity={pendingOpacity * dim}
                  onClick={(e) => { e.stopPropagation(); onBarClick?.(w.weekStart, "pending"); }} />
              )}
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
// Daily doc-rejections chart — document-level reviewer responses per day
// ---------------------------------------------------------------------------

function DailyDocRejectionsChart({ events }: { events: DocRejectionEvent[] }) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [range, setRange] = useState<"8w" | "all">("8w");

  // Default to the last 8 weeks — early sparse outliers stretch the axis
  // and shrink the bars into illegibility.
  const filtered = useMemo(() => {
    if (range === "all" || events.length === 0) return events;
    const cutoff = new Date(events[events.length - 1].date + "T00:00:00Z");
    cutoff.setUTCDate(cutoff.getUTCDate() - 55);
    const c = cutoff.toISOString().slice(0, 10);
    return events.filter((e) => e.date >= c);
  }, [events, range]);

  const dealCount = useMemo(() => new Set(filtered.map((e) => e.dealId)).size, [filtered]);

  const days = useMemo(() => {
    if (filtered.length === 0) return [] as { date: string; count: number }[];
    const byWeek = new Map<string, number>();
    for (const e of filtered) {
      const wk = weekStartUTC(new Date(e.date + "T00:00:00Z"));
      byWeek.set(wk, (byWeek.get(wk) ?? 0) + 1);
    }
    const keys = [...byWeek.keys()].sort();
    const out: { date: string; count: number }[] = [];
    const start = new Date(keys[0] + "T00:00:00Z");
    const end = new Date(keys[keys.length - 1] + "T00:00:00Z");
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 7)) {
      const key = d.toISOString().split("T")[0];
      out.push({ date: key, count: byWeek.get(key) ?? 0 });
    }
    return out;
  }, [filtered]);

  if (days.length === 0) {
    return <div className="text-sm text-muted py-8 text-center">No document rejections recorded yet.</div>;
  }

  const W = 900;
  const H = 200;
  const PAD_L = 36;
  const PAD_B = 24;
  const PAD_T = 26;
  const chartW = W - PAD_L - 8;
  const chartH = H - PAD_T - PAD_B;
  const maxCount = Math.max(...days.map((d) => d.count), 1);
  const step = chartW / days.length;
  const barW = Math.max(4, Math.min(48, step * 0.7));
  const labelEvery = Math.max(1, Math.ceil(days.length / 12));
  const selectedEvents = selectedDay ? filtered.filter((e) => weekStartUTC(new Date(e.date + "T00:00:00Z")) === selectedDay) : [];

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="grid grid-cols-2 gap-2 flex-1 max-w-md">
          <MiniStat label="Doc Rejections" value={String(filtered.length)} subtitle={range === "all" ? "all time" : "last 8 weeks"} />
          <MiniStat label="Deals Affected" value={String(dealCount)} subtitle={range === "all" ? "all time" : "last 8 weeks"} />
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {([["8w", "Last 8 weeks"], ["all", "All time"]] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => { setRange(key); setSelectedDay(null); }}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${range === key ? "bg-orange-500/20 text-orange-400 border-orange-500/40" : "border-t-border text-muted hover:text-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
          aria-label="Daily bar chart of document-level PE rejections">
          {[0.5, 1].map((f) => {
            const y = PAD_T + chartH - chartH * f;
            return (
              <g key={f}>
                <line x1={PAD_L} x2={W - 8} y1={y} y2={y} className="stroke-t-border" strokeWidth={0.5} strokeDasharray="3 4" />
                <text x={PAD_L - 6} y={y + 3} textAnchor="end" className="fill-muted text-[9px]">{Math.round(maxCount * f)}</text>
              </g>
            );
          })}
          {days.map((d, i) => {
            const x = PAD_L + step * i + (step - barW) / 2;
            const h = (d.count / maxCount) * chartH;
            const y = PAD_T + chartH - h;
            const active = selectedDay === d.date;
            return (
              <g key={d.date}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => d.count > 0 && setSelectedDay(active ? null : d.date)}
                className={d.count > 0 ? "cursor-pointer" : undefined}>
                <rect x={PAD_L + step * i} y={PAD_T} width={step} height={chartH} fill="transparent" />
                {h > 0 && (
                  <>
                    <rect x={x} y={y} width={barW} height={h} rx={1.5} className="fill-orange-500"
                      opacity={(active ? 1 : 0.8) * (hovered === null || hovered === i ? 1 : 0.45)} />
                    <text x={PAD_L + step * i + step / 2} y={y - 5} textAnchor="middle" className="fill-foreground text-[10px] font-semibold">
                      {d.count}
                    </text>
                  </>
                )}
                {i % labelEvery === 0 && (
                  <text x={PAD_L + step * i + step / 2} y={H - 8} textAnchor="middle" className="fill-muted text-[9px]">
                    {weekLabel(d.date)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {hovered !== null && days[hovered] && days[hovered].count > 0 && (
          <div className="absolute top-0 right-0 rounded-lg bg-surface-elevated border border-t-border shadow-card px-3 py-2 text-xs">
            <div className="font-semibold text-foreground">Week of {weekLabel(days[hovered].date)}</div>
            <div className="text-orange-400">{days[hovered].count} doc rejection{days[hovered].count === 1 ? "" : "s"}</div>
            <div className="text-muted mt-0.5">click for details</div>
          </div>
        )}
      </div>
      {selectedDay && (
        <div className="mt-3 rounded-lg border border-t-border bg-surface-2 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-medium text-foreground">
              Week of {weekLabel(selectedDay)} — {selectedEvents.length} document rejection{selectedEvents.length === 1 ? "" : "s"}
            </div>
            <button onClick={() => setSelectedDay(null)} className="text-xs px-2 py-0.5 rounded border border-t-border text-muted hover:text-foreground transition-colors">
              Close
            </button>
          </div>
          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
            {selectedEvents.map((e, i) => (
              <div key={i} className="rounded bg-surface px-2.5 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-foreground truncate">{DOC_SHORT[e.docName] ?? e.docName}</span>
                  <span className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[10px] text-muted truncate max-w-56" title={e.dealName}>{e.dealName.split("|").slice(0, 2).join("|").trim()}</span>
                    <span className="text-[10px] text-muted">{weekLabel(e.date)}</span>
                  </span>
                </div>
                {e.note && <div className="text-[11px] text-orange-400/90 mt-0.5 line-clamp-2" title={e.note}>{e.note}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
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

function DrillPanel({ rows, weekStart, weekPrefix, segmentLabel, onClose }: {
  rows: MilestoneDrillRow[];
  weekStart: string | null;
  weekPrefix: string;
  segmentLabel?: string;
  onClose: () => void;
}) {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return (
    <div className="mt-4 rounded-lg border border-t-border bg-surface-2 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-medium text-foreground">
          {weekStart ? `${weekPrefix} week of ${weekLabel(weekStart)}${segmentLabel ? ` — ${segmentLabel}` : ""}` : segmentLabel} — {rows.length} milestones · {fmtUsd(total)}
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
    subtitle: "Bars dated by week of SUBMISSION. Green = paid; amber = approved awaiting payment; orange = currently rejected (our court); gray = in PE review.",
    empty: "No submissions recorded yet.",
    weekPrefix: "Submitted",
    split: {
      doneLegend: "Approved, awaiting payment",
      remainderLegend: "In PE review",
      doneWord: "approved",
      remainderLabel: "Not yet approved",
      rejectedLegend: "Rejected — pending fix",
      paidLegend: "Paid",
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
    title: "Ready-to-Submit Cohorts by Outcome",
    subtitle: "Bars dated by week each milestone became READY TO SUBMIT; colored by where it stands today, rejections included.",
    empty: "No milestones have reached Ready to Submit yet.",
    weekPrefix: "Ready",
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
  const [drill, setDrill] = useState<{ week: string | null; segment: string | null } | null>(null);
  const openDrill = (week: string, segment?: string) => setDrill({ week, segment: segment ?? null });
  const openAggregate = (key: string) => setDrill({ week: null, segment: key });

  // Rows behind the clicked bar/segment — date field + segment predicate
  // depend on the active view; predicates mirror the route's bucketing.
  const drillRows = useMemo(() => {
    if (!drill || !data?.milestones) return [];
    const isPaidAgg = (r: MilestoneDrillRow) => !!r.paidOn || r.status === "Paid";
    const isApprovedAgg = (r: MilestoneDrillRow) => !!r.approvedOn || r.status === "Approved" || isPaidAgg(r);
    if (drill.week === null) {
      const PRE_SUB = new Set([
        "Ready to Submit", "Waiting on Information", "Ready for Onboarding", "Onboarding Submitted",
        "Onboarding Rejected", "Onboarding Ready to Resubmit", "Onboarding Resubmitted",
      ]);
      switch (drill.segment) {
        case "waitSubmission":
          return data.milestones.filter((r) => !!r.readyOn && !r.submittedOn && (!r.status || PRE_SUB.has(r.status)));
        case "waitApproval":
          return data.milestones.filter((r) => !!r.submittedOn && !isApprovedAgg(r));
        case "waitPayment":
          return data.milestones.filter((r) => isApprovedAgg(r) && !isPaidAgg(r));
        case "paidAll":
          return data.milestones.filter(isPaidAgg);
        default:
          return [];
      }
    }
    const dateOf = (r: MilestoneDrillRow) =>
      weeklyMode === "ready" || weeklyMode === "lifecycle"
        ? r.readyOn ?? r.submittedOn // submission implies readiness (matches route bucketing)
        : weeklyMode === "rejections" ? r.rejectedOn
        : weeklyMode === "approved" ? r.approvedOn
          : weeklyMode === "paid" ? r.paidOn
            : r.submittedOn; // submitted
    const isPaid = (r: MilestoneDrillRow) => !!r.paidOn || r.status === "Paid";
    const isApprovedPlus = (r: MilestoneDrillRow) => !!r.approvedOn || r.status === "Approved" || isPaid(r);
    const segOk = (r: MilestoneDrillRow) => {
      if (!drill.segment) return true;
      switch (weeklyMode) {
        case "ready":
          return drill.segment === "done" ? !!r.submittedOn : !r.submittedOn;
        case "rejections": {
          const pending = r.status === "Rejected" || r.status === "Ready to Resubmit";
          return drill.segment === "pending" ? pending : !pending;
        }
        case "submitted": {
          const rejPending = r.status === "Rejected" || r.status === "Ready to Resubmit";
          if (drill.segment === "paidSeg") return isPaid(r);
          if (drill.segment === "done") return isApprovedPlus(r) && !isPaid(r);
          if (drill.segment === "rejected") return rejPending;
          return !isApprovedPlus(r) && !rejPending;
        }
        case "approved":
          return drill.segment === "done" ? isPaid(r) : !isPaid(r);
        case "lifecycle": {
          const paid = isPaid(r);
          const approved = isApprovedPlus(r) && !paid;
          const rejPending = !paid && !approved && (r.status === "Rejected" || r.status === "Ready to Resubmit");
          const waiting = !r.submittedOn && !paid && !approved && !rejPending;
          const inReview = !paid && !approved && !rejPending && !waiting;
          switch (drill.segment) {
            case "paid": return paid;
            case "approved": return approved;
            case "rejected": return rejPending;
            case "waiting": return waiting;
            default: return inReview;
          }
        }
        default:
          return true;
      }
    };
    return data.milestones.filter((r) => {
      const d = dateOf(r);
      return d ? weekStartUTC(new Date(d + "T00:00:00Z")) === drill.week && segOk(r) : false;
    });
  }, [drill, weeklyMode, data]);

  const AGGREGATE_LABELS: Record<string, string> = {
    waitSubmission: "All waiting on submission",
    waitApproval: "All submitted, awaiting PE approval",
    waitPayment: "All approved, awaiting payment",
    paidAll: "All paid",
  };

  const SEGMENT_LABELS: Record<string, Record<string, string>> = {
    ready: { done: "Submitted", pending: "Waiting on submission" },
    rejections: { done: "Resolved since", pending: "Still pending fix" },
    submitted: { paidSeg: "Paid", done: "Approved, awaiting payment", rejected: "Rejected — pending fix", remainder: "In PE review" },
    approved: { done: "Paid since", remainder: "Awaiting payment" },
    lifecycle: { paid: "Paid", approved: "Approved, awaiting payment", inReview: "In PE review", rejected: "Rejected — pending fix", waiting: "Not yet submitted" },
  };
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
                    onClick={() => { setWeeklyMode(mode); setDrill(null); }}
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
                <button type="button" className="text-left cursor-pointer transition-opacity hover:opacity-75" onClick={() => openAggregate("waitSubmission")} title="Click: all waiting on submission">
                <MiniStat
                  label="Total Ready to Submit"
                  value={fmtUsd(funnelTotals.ready.amount)}
                  subtitle={`${funnelTotals.ready.count} milestones — ${
                    funnelTotals.ready.amount > 0
                      ? Math.round(((funnelTotals.ready.amount - funnelTotals.ready.waitingAmount) / funnelTotals.ready.amount) * 100)
                      : 0
                  }% already submitted, ${funnelTotals.ready.waitingCount} (${fmtUsdK(funnelTotals.ready.waitingAmount)}) waiting`}
                />
                </button>
              )}
              <button type="button" className="text-left cursor-pointer transition-opacity hover:opacity-75" onClick={() => openAggregate("waitApproval")} title="Click: all awaiting PE approval">
                <MiniStat label="Total Submitted" value={fmtUsd(funnelTotals.submitted.amount)} subtitle={`${funnelTotals.submitted.count} milestones`} />
              </button>
              <button type="button" className="text-left cursor-pointer transition-opacity hover:opacity-75" onClick={() => openAggregate("waitPayment")} title="Click: all awaiting payment">
                <MiniStat label="Total Approved" value={fmtUsd(funnelTotals.approved.amount)} subtitle={`${funnelTotals.approved.count} milestones`} />
              </button>
              <button type="button" className="text-left cursor-pointer transition-opacity hover:opacity-75" onClick={() => openAggregate("paidAll")} title="Click: all paid">
                <MiniStat label="Total Paid" value={fmtUsd(funnelTotals.paid.amount)} subtitle={`${funnelTotals.paid.count} milestones`} />
              </button>
            </div>
            {weeklyMode === "lifecycle" ? (
              <WeeklyLifecycleChart weekly={data.weeklyLifecycle ?? []} onBarClick={openDrill} />
            ) : weeklyMode === "ready" ? (
              <SplitCohortChart
                weekly={data.weeklyReadiness ?? []}
                onBarClick={openDrill}
                weekPrefix="Ready"
                doneLabel="Submitted"
                pendingLabel="Waiting on submission"
                emptyMessage={WEEKLY_MODES.ready.empty}
              />
            ) : weeklyMode === "rejections" ? (
              <SplitCohortChart
                weekly={data.weeklyRejections ?? []}
                onBarClick={openDrill}
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
                onBarClick={openDrill}
              />
            )}
            {drill && (
              <DrillPanel
                rows={drillRows}
                weekStart={drill.week}
                weekPrefix={WEEKLY_MODES[weeklyMode].weekPrefix}
                segmentLabel={
                  drill.week === null
                    ? AGGREGATE_LABELS[drill.segment ?? ""]
                    : drill.segment
                      ? SEGMENT_LABELS[weeklyMode]?.[drill.segment]
                      : undefined
                }
                onClose={() => setDrill(null)}
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

          {/* 3.5 Doc-level rejections per day */}
          <Section
            title="Doc Rejections per Week"
            subtitle="Document-level rejections dated by PE's reviewer response. Click a week for the docs, deals, and notes."
          >
            <DailyDocRejectionsChart events={data.docRejectionEvents ?? []} />
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
