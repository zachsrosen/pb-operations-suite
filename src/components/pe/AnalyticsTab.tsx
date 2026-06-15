"use client";

import { useMemo, useState, useRef, useEffect, createContext, useContext } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { isSuperAdmin } from "@/lib/super-admin";
import { usePeAutoSync } from "@/hooks/usePeAutoSync";
import DashboardShell from "@/components/DashboardShell";
import { StatCard, MiniStat } from "@/components/ui/MetricCard";
import { prettyUploader, buildColorMap } from "@/components/pe/uploader-colors";
import { ReworkSection } from "@/components/pe/DocReworkTab";
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
  type UploaderStat,
  type UploaderOutcomeDocs,
  type UploaderDoc,
  type RejectionByDoc,
  type MissingByDoc,
  type RejectionDrillDeal,
  type DailyUpload,
  type UploadsByPeriod,
  type UploadGranularity,
  type UploaderDocTypes,
  type UploaderRow,
  type DealLink,
  buildUploaderStats,
  buildUploadsByPeriod,
  UNKNOWN_UPLOADER,
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

// "Unknown" uploader = no recorded uploader. After dropping phantom action-
// resolutions server-side, these are almost all uploads from before PE began
// attributing them (attributionStart). Shared via context so every sub-panel
// labels Unknown the same way without prop-threading.
function attrLabel(attr: string | null): { note: string; title: string } {
  if (!attr) return { note: "no recorded uploader", title: "Uploads with no recorded uploader." };
  const d = new Date(attr + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return {
    note: `before ${d}`,
    title: `Uploads with no recorded uploader — almost all from before PE began attributing uploads (~${d}); a few are recent uploads with no uploader on file.`,
  };
}
const UnknownLabelCtx = createContext<{ note: string; title: string }>({ note: "no recorded uploader", title: "Uploads with no recorded uploader." });

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
                      { seg: "done", amount: doneAmt - paidAmt, cls: "fill-cyan-500", op: 1 },
                    ]
                  : [{ seg: "done", amount: doneAmt, cls: "fill-emerald-500", op: 1 }]),
                { seg: "rejected", amount: rejAmt, cls: "fill-orange-500", op: 0.85 },
                { seg: "remainder", amount: totalAmt - doneAmt - rejAmt, cls: "fill-zinc-400", op: 0.7 },
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
            <span className="flex items-center gap-1.5"><span className={`w-2.5 h-2.5 rounded-sm ${doneSplit.paidLegend ? "bg-cyan-500" : "bg-emerald-500"}`} /> {doneSplit.doneLegend}</span>
            {doneSplit.rejectedLegend && (
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-orange-500/85" /> {doneSplit.rejectedLegend}</span>
            )}
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-zinc-400/70" /> {doneSplit.remainderLegend}</span>
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
            { seg: "approved", amount: w.approvedAmount, cls: "fill-cyan-500", op: 1 },
            { seg: "inReview", amount: w.inReviewAmount, cls: "fill-zinc-400", op: 0.7 },
            { seg: "rejected", amount: w.rejectedAmount ?? 0, cls: "fill-orange-500", op: 0.85 },
            { seg: "waiting", amount: w.waitingAmount ?? 0, cls: "fill-none stroke-zinc-500 [stroke-dasharray:3_2]", op: 0.9 },
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
          <div className="text-cyan-400">Approved, awaiting payment: {series[hovered].approvedCount} · {fmtUsd(series[hovered].approvedAmount)}</div>
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
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-cyan-500" /> Approved, awaiting payment</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-zinc-400/70" /> In PE review</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-orange-500/85" /> Rejected — pending fix</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm border border-dashed border-zinc-500" /> Not yet submitted</span>
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
  pendingClass = "fill-zinc-400",
  pendingOpacity = 0.7,
  pendingSwatch = "bg-zinc-400/70",
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

function DocActivityChart({ events, noun, statLabel, barClass, pillClass, swatchText, stackOutcomes = false, reviewStats }: {
  events: DocRejectionEvent[];
  noun: string; // "doc rejection"
  statLabel: string; // "Doc Rejections"
  barClass: string; // "fill-orange-500"
  pillClass: string; // active range-pill classes
  swatchText: string; // tooltip count text color
  stackOutcomes?: boolean; // submissions: color by each doc's current outcome
  reviewStats?: { avgApproveDays: number | null; avgRejectDays: number | null; avgInReviewAge: number | null };
}) {
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

  // Outcome mix of the (range-scoped) submissions — % of submitted now
  // approved / rejected / still in review.
  const outcomes = useMemo(() => {
    const o = { approved: 0, rejected: 0, inReview: 0 };
    for (const e of filtered) {
      if (e.outcome === "approved") o.approved++;
      else if (e.outcome === "rejected") o.rejected++;
      else o.inReview++;
    }
    const pct = (n: number) => (filtered.length ? Math.round((n / filtered.length) * 100) : 0);
    return { ...o, pctApproved: pct(o.approved), pctRejected: pct(o.rejected), pctInReview: pct(o.inReview) };
  }, [filtered]);

  interface DocWeek { date: string; count: number; approved: number; inReview: number; rejected: number }
  const days = useMemo(() => {
    if (filtered.length === 0) return [] as DocWeek[];
    const byWeek = new Map<string, DocWeek>();
    for (const e of filtered) {
      const wk = weekStartUTC(new Date(e.date + "T00:00:00Z"));
      const w = byWeek.get(wk) ?? { date: wk, count: 0, approved: 0, inReview: 0, rejected: 0 };
      w.count++;
      if (e.outcome === "approved") w.approved++;
      else if (e.outcome === "rejected") w.rejected++;
      else w.inReview++;
      byWeek.set(wk, w);
    }
    const keys = [...byWeek.keys()].sort();
    const out: DocWeek[] = [];
    const start = new Date(keys[0] + "T00:00:00Z");
    const end = new Date(keys[keys.length - 1] + "T00:00:00Z");
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 7)) {
      const key = d.toISOString().split("T")[0];
      out.push(byWeek.get(key) ?? { date: key, count: 0, approved: 0, inReview: 0, rejected: 0 });
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
        <div className={stackOutcomes ? "grid grid-cols-2 md:grid-cols-4 gap-2 flex-1" : "grid grid-cols-2 gap-2 flex-1 max-w-md"}>
          <MiniStat label={statLabel} value={String(filtered.length)} subtitle={range === "all" ? "all time" : "last 8 weeks"} />
          <MiniStat label="Deals Affected" value={String(dealCount)} subtitle={range === "all" ? "all time" : "last 8 weeks"} />
          {stackOutcomes && (
            <>
              <MiniStat label="% Approved" value={`${outcomes.pctApproved}%`} subtitle={`${outcomes.approved.toLocaleString("en-US")} docs`} />
              <MiniStat label="% Rejected" value={`${outcomes.pctRejected}%`} subtitle={`${outcomes.rejected.toLocaleString("en-US")} docs currently`} />
              <MiniStat label="% In Review" value={`${outcomes.pctInReview}%`} subtitle={`${outcomes.inReview.toLocaleString("en-US")} docs`} />
              {reviewStats && (
                <>
                  <MiniStat label="Avg Submit → Approve" value={reviewStats.avgApproveDays === null ? "—" : `${reviewStats.avgApproveDays}d`} subtitle="per doc, all time" />
                  <MiniStat label="Avg Submit → Reject" value={reviewStats.avgRejectDays === null ? "—" : `${reviewStats.avgRejectDays}d`} subtitle="per doc, all time" />
                  <MiniStat label="Avg Age In Review" value={reviewStats.avgInReviewAge === null ? "—" : `${reviewStats.avgInReviewAge}d`} subtitle="docs awaiting PE today" />
                </>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {([["8w", "Last 8 weeks"], ["all", "All time"]] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => { setRange(key); setSelectedDay(null); }}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${range === key ? pillClass : "border-t-border text-muted hover:text-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
          aria-label={`Weekly bar chart of document-level PE activity: ${statLabel}`}>
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
                    {stackOutcomes ? (
                      (() => {
                        const segs = [
                          { n: d.approved, cls: "fill-emerald-500", op: 1 },
                          { n: d.inReview, cls: "fill-zinc-400", op: 0.7 },
                          { n: d.rejected, cls: "fill-orange-500", op: 0.85 },
                        ];
                        let yCur = PAD_T + chartH;
                        return segs.map((sg, j) => {
                          const sh = (sg.n / maxCount) * chartH;
                          yCur -= sh;
                          return sh > 0 ? <rect key={j} x={x} y={yCur} width={barW} height={sh} rx={1.5} className={sg.cls}
                            opacity={sg.op * (active ? 1 : 0.85) * (hovered === null || hovered === i ? 1 : 0.45)} /> : null;
                        });
                      })()
                    ) : (
                      <rect x={x} y={y} width={barW} height={h} rx={1.5} className={barClass}
                        opacity={(active ? 1 : 0.8) * (hovered === null || hovered === i ? 1 : 0.45)} />
                    )}
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
            <div className={swatchText}>{days[hovered].count} {noun}{days[hovered].count === 1 ? "" : "s"}</div>
            {stackOutcomes && (
              <>
                <div className="text-emerald-400">Approved since: {days[hovered].approved}</div>
                <div className="text-muted">Still in review: {days[hovered].inReview}</div>
                <div className="text-orange-400">Rejected: {days[hovered].rejected}</div>
              </>
            )}
            <div className="text-muted mt-0.5">click for details</div>
          </div>
        )}
      </div>
      {stackOutcomes && (
        <div className="flex items-center gap-4 mt-1 text-[11px] text-muted">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Approved since</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-zinc-400/70" /> Still in review</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-orange-500/85" /> Rejected</span>
        </div>
      )}
      {selectedDay && (
        <div className="mt-3 rounded-lg border border-t-border bg-surface-2 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-medium text-foreground">
              Week of {weekLabel(selectedDay)} — {selectedEvents.length} {noun}{selectedEvents.length === 1 ? "" : "s"}
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
                    {stackOutcomes && (
                      <span className="text-[10px] text-cyan-400/90" title={e.uploadedBy ?? "Uploader unknown — version predates PE attribution tracking"}>
                        {e.uploadedBy ? prettyUploader(e.uploadedBy) : "Unknown"}
                      </span>
                    )}
                    {stackOutcomes && e.outcome && (
                      <span className={`text-[10px] ${e.outcome === "approved" ? "text-emerald-400" : e.outcome === "rejected" ? "text-orange-400" : "text-muted"}`}>
                        {e.outcome === "approved" ? "approved" : e.outcome === "rejected" ? "rejected" : "in review"}
                      </span>
                    )}
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
// Uploads-by-person leaderboard (PE portal version history)
// ---------------------------------------------------------------------------


/**
 * Horizontal outcome bar for one uploader. Bar LENGTH encodes volume — every
 * segment is scaled to a shared `scale` (the busiest uploader's doc count), so
 * a 600-doc person's bar dwarfs a 2-doc person's. Segments within show the
 * approved / in-review / rejected split. Overflows clip (e.g. the Unknown row).
 */
type Outcome = "approved" | "inReview" | "rejected";
function OutcomeBar({ approved, inReview, rejected, scale, uploads, onSeg }: { approved: number; inReview: number; rejected: number; scale: number; uploads?: number; onSeg?: (o: Outcome) => void }) {
  const owned = approved + inReview + rejected;
  // When `uploads` is given the bar is scaled to total uploads (matching the
  // table sort); the extra width past owned docs = superseded/resubmitted uploads.
  const superseded = uploads != null ? Math.max(0, uploads - owned) : 0;
  const w = (n: number) => `${Math.min(100, (n / scale) * 100)}%`;
  const seg = (n: number, o: Outcome, cls: string, label: string) =>
    n > 0 ? (
      <div
        className={`h-full ${cls} ${onSeg ? "cursor-pointer hover:brightness-125" : ""}`}
        style={{ width: w(n), minWidth: 2 }}
        title={`${n} ${label}${onSeg ? " — click to view" : ""}`}
        onClick={onSeg ? () => onSeg(o) : undefined}
      />
    ) : null;
  return (
    <div className="h-4 rounded bg-surface-2 overflow-hidden flex w-full" title={`${uploads ?? owned} ${uploads != null ? "uploads" : "docs"} · ${approved} approved · ${inReview} in review · ${rejected} rejected${superseded ? ` · ${superseded} superseded` : ""}`}>
      {seg(approved, "approved", "bg-emerald-500/80", "approved")}
      {seg(inReview, "inReview", "bg-zinc-400/60", "in review")}
      {seg(rejected, "rejected", "bg-orange-500/80", "rejected")}
      {superseded > 0 && <div className="h-full bg-zinc-700/50" style={{ width: w(superseded), minWidth: 2 }} title={`${superseded} superseded / resubmitted uploads`} />}
    </div>
  );
}

function UploaderPanel({ stats: statsOwner, docs: docsOwner, statsShared, docsShared }: { stats: UploaderStat[]; docs: Record<string, UploaderOutcomeDocs>; statsShared: UploaderStat[]; docsShared: Record<string, UploaderOutcomeDocs> }) {
  // Owner (latest-version wins) vs Shared (fractional, split by version count).
  const [mode, setMode] = useState<"owner" | "shared">("owner");
  const unk = useContext(UnknownLabelCtx);
  const stats = mode === "shared" ? statsShared : statsOwner;
  const docs = mode === "shared" ? docsShared : docsOwner;
  const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });
  const [drill, setDrill] = useState<{ uploader: string; outcome: Outcome } | null>(null);
  // Owner-override: admins can re-credit a doc to the correct uploader when a
  // later (wrong) version superseded the right one.
  const { data: session } = useSession();
  // Reassigning credit is a sensitive correction — restrict to super admins.
  const canOverride = isSuperAdmin(session?.user?.email);
  const qc = useQueryClient();
  const [reassignKey, setReassignKey] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const candidates = stats.filter((s) => s.uploader !== UNKNOWN_UPLOADER).map((s) => s.uploader);
  const reassign = async (r: UploaderDoc, uploader: string | null) => {
    const key = `${r.dealId}|${r.docName}`;
    setSavingKey(key);
    try {
      await fetch("/api/admin/pe/uploader-override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId: r.dealId, docName: r.docName, uploader, reason: "reassigned from Doc Uploaders panel" }),
      });
      await qc.invalidateQueries({ queryKey: queryKeys.peAnalytics.list() });
    } finally {
      setSavingKey(null);
      setReassignKey(null);
    }
  };
  if (stats.length === 0) {
    return (
      <div className="text-sm text-muted py-8 text-center">
        No upload attribution yet — version history syncs from the PE API hourly.
      </div>
    );
  }
  const attributed = stats.filter((s) => s.uploader !== UNKNOWN_UPLOADER);
  const unknown = stats.find((s) => s.uploader === UNKNOWN_UPLOADER);
  const attributedTotal = attributed.reduce((s, r) => s + r.total, 0);
  const grandTotal = attributedTotal + (unknown?.total ?? 0);
  // Roll up outcomes across attributed uploaders for the header stats.
  const agg = attributed.reduce(
    (a, s) => ({ approved: a.approved + s.approved, rejected: a.rejected + s.rejected, inReview: a.inReview + s.inReview }),
    { approved: 0, rejected: 0, inReview: 0 },
  );
  const reviewed = agg.approved + agg.rejected; // docs PE has ruled on
  const teamApprovalRate = reviewed ? Math.round((agg.approved / reviewed) * 100) : null;
  const rateOf = (s: UploaderStat) => {
    const ruled = s.approved + s.rejected;
    return ruled ? s.approved / ruled : null;
  };
  // Bar length encodes total uploads (matching the sort): scale to the busiest
  // attributed uploader so the Unknown bucket doesn't flatten everyone else.
  const barScale = Math.max(...attributed.map((s) => s.total), 1);
  const attributedDocs = attributed.reduce((sum, s) => sum + s.approved + s.inReview + s.rejected, 0);
  // Rank by total uploads (activity); the Uploads column makes the metric explicit.
  const ordered = [...attributed].sort(
    (a, b) => b.total - a.total || (b.approved + b.inReview + b.rejected) - (a.approved + a.inReview + a.rejected),
  );
  const isOn = (u: string, o: Outcome) => drill?.uploader === u && drill.outcome === o;
  const toggle = (u: string, o: Outcome) => setDrill(isOn(u, o) ? null : { uploader: u, outcome: o });
  // Clickable outcome count cell.
  const oc = (s: UploaderStat, o: Outcome, n: number, cls: string) => (
    <span className={`text-xs text-right tabular-nums ${cls}`}>
      {n > 0 ? (
        <button onClick={() => toggle(s.uploader, o)} className={`hover:underline cursor-pointer ${isOn(s.uploader, o) ? "font-semibold underline" : ""}`} title="Click to view these docs">{fmt(n)}</button>
      ) : "0"}
    </span>
  );
  const drillStyle: Record<Outcome, { border: string; bg: string; doc: string; noun: string }> = {
    approved: { border: "border-emerald-500/30", bg: "bg-emerald-500/5", doc: "text-emerald-400", noun: "approved" },
    inReview: { border: "border-zinc-400/30", bg: "bg-zinc-400/5", doc: "text-foreground", noun: "in review" },
    rejected: { border: "border-orange-500/30", bg: "bg-orange-500/5", doc: "text-orange-400", noun: "to fix" },
  };

  // Shared column template so the header labels line up with every row.
  const COLS = "grid items-center gap-x-2 grid-cols-[7rem_1fr_3rem_3rem_3rem_2.75rem_2.75rem_2.75rem_2.5rem]";
  const renderRow = (s: UploaderStat, muted: boolean) => {
    const rate = rateOf(s);
    const total = s.approved + s.inReview + s.rejected;
    return (
      <div className={`${COLS} ${muted ? "opacity-70" : ""}`}>
        <span className="text-xs text-foreground truncate" title={muted ? unk.title : `${s.uploader} · ${s.total} uploads across ${s.deals} deals`}>
          {muted ? "Unknown" : prettyUploader(s.uploader)}
          {muted && <span className="text-[10px] text-muted block leading-tight">{unk.note}</span>}
        </span>
        <OutcomeBar approved={s.approved} inReview={s.inReview} rejected={s.rejected} scale={barScale} uploads={s.total} onSeg={(o) => toggle(s.uploader, o)} />
        <span className="text-xs text-muted text-right tabular-nums" title="Every upload action, including resubmissions of the same doc">{s.total.toLocaleString("en-US")}</span>
        <span className="text-sm font-semibold text-foreground text-right tabular-nums" title={mode === "shared" ? "Fractional docs owned (split by version count)" : "Distinct docs you're the latest uploader on"}>{fmt(total)}</span>
        <span className="text-xs text-cyan-400 text-right tabular-nums" title={`distinct deals — ${s.deals}`}>{s.deals.toLocaleString("en-US")}</span>
        {oc(s, "approved", s.approved, "text-emerald-400")}
        {oc(s, "inReview", s.inReview, "text-muted")}
        {oc(s, "rejected", s.rejected, "text-orange-400")}
        <span className="text-xs text-foreground text-right tabular-nums" title="Approved ÷ (approved + rejected)">{rate === null ? "—" : `${Math.round(rate * 100)}%`}</span>
      </div>
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="text-[11px] text-muted">
          {mode === "shared"
            ? "Shared: each doc's credit split across its tracked uploaders by version count (overrides pin the whole doc)."
            : "Owner: the latest-version uploader gets full credit for each doc."}
        </div>
        <div className="inline-flex rounded-lg border border-t-border overflow-hidden text-xs shrink-0">
          {([["owner", "Owner"], ["shared", "Shared"]] as const).map(([m, label]) => (
            <button key={m} onClick={() => { setMode(m); setDrill(null); }}
              className={`px-2.5 py-1 transition-colors ${mode === m ? "bg-emerald-500/20 text-emerald-400" : "text-muted hover:text-foreground"}`}
              title={m === "shared" ? "Split credit fractionally by version contribution" : "Latest-version uploader owns the whole doc"}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        <MiniStat label="Attributed Uploads" value={attributedTotal.toLocaleString("en-US")}
          subtitle={grandTotal ? `${Math.round((attributedTotal / grandTotal) * 100)}% of ${grandTotal.toLocaleString("en-US")} total` : "all time"} />
        <MiniStat label="Documents Owned" value={fmt(attributedDocs)} subtitle={mode === "shared" ? "fractional (split by version count)" : "latest-version owner, attributed"} />
        <MiniStat label="Team Approval Rate" value={teamApprovalRate === null ? "—" : `${teamApprovalRate}%`}
          subtitle={`${fmt(agg.approved)} approved · ${fmt(agg.rejected)} rejected`} />
        <MiniStat label="Unknown Uploads" value={(unknown?.total ?? 0).toLocaleString("en-US")} subtitle="before PE tracked uploaders" />
      </div>

      {/* Column headers — align with each row via the shared COLS grid */}
      <div className={`${COLS} pb-1.5 mb-1 border-b border-t-border text-[10px] uppercase tracking-wide text-muted`}>
        <span>Person</span>
        <span>Uploads by outcome — bar length = uploads (approved/in&nbsp;review/rejected/superseded)</span>
        <span className="text-right" title="Every upload action incl. resubmissions">Uploads</span>
        <span className="text-right" title="Distinct docs you're the latest uploader on">Docs</span>
        <span className="text-right text-cyan-400/80" title="Distinct deals">Deals</span>
        <span className="text-right text-emerald-400/80" title="Click to view these docs">Appr. ⌕</span>
        <span className="text-right" title="Click to view these docs">In rev. ⌕</span>
        <span className="text-right text-orange-400/80" title="Click to view these docs">Rej. ⌕</span>
        <span className="text-right">Rate</span>
      </div>

      <div className="space-y-2">
        {ordered.map((s) => <div key={s.uploader}>{renderRow(s, false)}</div>)}
      </div>
      {unknown && unknown.approved + unknown.rejected + unknown.inReview > 0 && (
        <div className="mt-2 pt-2 border-t border-t-border">
          {renderRow(unknown, true)}
        </div>
      )}

      {/* Outcome drill-down: click any outcome count or a bar segment to list those docs. */}
      {drill && (() => {
        const list = docs[drill.uploader]?.[drill.outcome] ?? [];
        if (list.length === 0) return null;
        const st = drillStyle[drill.outcome];
        const noun = drill.outcome === "rejected" ? `doc${list.length === 1 ? "" : "s"} to fix` : `${st.noun} doc${list.length === 1 ? "" : "s"}`;
        return (
          <div className={`mt-3 rounded-lg border ${st.border} ${st.bg} p-3`}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-medium text-foreground">
                {drill.uploader === UNKNOWN_UPLOADER ? "Unknown" : prettyUploader(drill.uploader)} — {list.length} {noun}
              </div>
              <button onClick={() => setDrill(null)} className="text-xs px-2 py-0.5 rounded border border-t-border text-muted hover:text-foreground transition-colors">Close</button>
            </div>
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {list.map((r, i) => (
                <div key={`${r.dealName}-${r.docName}-${i}`} className="text-xs border-b border-t-border/40 pb-1.5 last:border-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`${st.doc} font-medium`}>{r.docName}</span>
                    {mode === "shared" && r.weight != null && r.weight < 0.999 && (
                      <span className="text-[10px] px-1 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/25" title="This person's fractional share of this shared doc">{fmt(r.weight)}</span>
                    )}
                    <span className="text-muted">·</span>
                    <a href={r.hubspotUrl} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline truncate max-w-48">{r.dealName.split("|").slice(0, 2).join("|").trim()}</a>
                    {r.pePortalUrl && <a href={r.pePortalUrl} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">PE ↗</a>}
                    {r.driveUrl && <a href={r.driveUrl} target="_blank" rel="noopener noreferrer" className="text-yellow-400 hover:underline">Drive ↗</a>}
                    {r.overridden && canOverride && <span className="text-[9px] px-1 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30" title="Credited uploader was set by a super-admin override">override</span>}
                    {r.resubmitted && canOverride && <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30" title="A newer version was uploaded after this override was set — re-check whether the credit is still correct">resubmitted ⚠</span>}
                    {canOverride && (
                      savingKey === `${r.dealId}|${r.docName}` ? (
                        <span className="text-[10px] text-muted">saving…</span>
                      ) : reassignKey === `${r.dealId}|${r.docName}` ? (
                        <select
                          autoFocus
                          defaultValue=""
                          onBlur={() => setReassignKey(null)}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (!v) return;
                            reassign(r, v === "__clear__" ? null : v === "__unknown__" ? "" : v);
                          }}
                          className="text-[10px] bg-surface-2 border border-t-border rounded px-1 py-0.5 text-foreground"
                        >
                          <option value="" disabled>credit to…</option>
                          {candidates.map((u) => <option key={u} value={u}>{prettyUploader(u)}</option>)}
                          <option value="__unknown__">Unknown</option>
                          {r.overridden && <option value="__clear__">↺ Clear override</option>}
                        </select>
                      ) : (
                        <button
                          onClick={() => setReassignKey(`${r.dealId}|${r.docName}`)}
                          className="text-[10px] px-1 py-0.5 rounded border border-t-border text-muted hover:text-foreground transition-colors"
                          title="Re-credit this doc to the correct uploader"
                        >
                          {r.overridden ? "re-credit ✎" : "reassign"}
                        </button>
                      )
                    )}
                  </div>
                  {r.note && <div className="text-muted mt-0.5 leading-snug">{r.note}</div>}
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

/** Uploads as stacked bars segmented by who uploaded, at day/week/month grain. */
function DailyUploadsChart({ daily, stats, granularity }: { daily: DailyUpload[]; stats: UploaderStat[]; granularity: UploadGranularity }) {
  // The day view spans ~90 periods and overflows wider than the card, so the
  // most-recent bars sit off-screen to the right. Scroll to the newest data.
  const scrollRef = useRef<HTMLDivElement>(null);
  const unk = useContext(UnknownLabelCtx);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [granularity, daily]);
  if (daily.length === 0) {
    return <div className="text-sm text-muted py-8 text-center">No uploads in this range.</div>;
  }
  const order = stats.filter((s) => s.uploader !== UNKNOWN_UPLOADER).map((s) => s.uploader);
  const stack = [...order, UNKNOWN_UPLOADER]; // Unknown stacks on top
  const colors = buildColorMap(order);
  const present = stack.filter((p) => daily.some((d) => (d.byUploader[p] ?? 0) > 0));
  const maxTotal = Math.max(...daily.map((d) => d.total), 1);
  const padL = 30, padT = 12, padB = 44, gap = 6, chartH = 320;
  // Bars grow to fill ~960px when there are few of them (week/month) and shrink
  // (with horizontal scroll) when there are many (day), within sensible bounds.
  const minBar = granularity === "day" ? 16 : 34;
  const maxBar = granularity === "month" ? 150 : granularity === "week" ? 64 : 24;
  const barW = Math.max(minBar, Math.min(maxBar, Math.floor((960 - padL) / Math.max(daily.length, 1)) - gap));
  const chartW = Math.max(padL + daily.length * (barW + gap) + 4, padL + 60);
  const yTicks = 5;
  const labelEvery = Math.max(1, Math.ceil(daily.length / 24));
  const fmtLabel = (key: string) =>
    granularity === "month" ? key : granularity === "week" ? `wk ${key.slice(5)}` : key.slice(5);
  // Combined whole-period tooltip: total + every person's count, biggest first.
  const periodTitle = (d: DailyUpload) => {
    const lines = Object.entries(d.byUploader)
      .sort((a, b) => b[1] - a[1])
      .map(([who, n]) => `  ${who === UNKNOWN_UPLOADER ? "Unknown" : prettyUploader(who)}: ${n}`);
    const label = granularity === "month" ? d.day : granularity === "week" ? `week of ${d.day}` : d.day;
    return `${label} — ${d.total} uploads across ${d.deals} deal${d.deals === 1 ? "" : "s"}\n${lines.join("\n")}`;
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-3 text-[11px]">
        {present.map((p) => (
          <span key={p} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: colors.get(p) }} />
            <span className={p === UNKNOWN_UPLOADER ? "text-muted" : "text-foreground"} title={p === UNKNOWN_UPLOADER ? unk.title : undefined}>{p === UNKNOWN_UPLOADER ? `Unknown (${unk.note})` : prettyUploader(p)}</span>
          </span>
        ))}
      </div>
      <div ref={scrollRef} className="overflow-x-auto">
        {/* When the natural width fits, stretch to fill the full page via the
            viewBox (bars spread out, centered); when crowded, fixed width +
            horizontal scroll. Fixes the left-weighted look on week/month. */}
        <svg
          viewBox={`0 0 ${chartW} ${chartH + padT + padB}`}
          width={chartW <= 980 ? "100%" : chartW}
          height={chartH + padT + padB}
          preserveAspectRatio="xMidYMid meet"
          className="block mx-auto"
        >
          {Array.from({ length: yTicks + 1 }, (_, i) => {
            const val = Math.round((maxTotal * i) / yTicks);
            const y = padT + chartH - (chartH * i) / yTicks;
            return (
              <g key={i}>
                <line x1={padL} y1={y} x2={chartW} y2={y} className="stroke-t-border" strokeWidth={i === 0 ? 1 : 0.5} strokeDasharray={i === 0 ? "" : "2 3"} />
                <text x={padL - 5} y={y + 3} textAnchor="end" className="fill-muted text-[9px]">{val}</text>
              </g>
            );
          })}
          {daily.map((d, i) => {
            const x = padL + i * (barW + gap);
            let yCursor = padT + chartH;
            return (
              <g key={d.day}>
                {stack.map((person) => {
                  const n = d.byUploader[person] ?? 0;
                  if (!n) return null;
                  const h = (n / maxTotal) * chartH;
                  yCursor -= h;
                  return <rect key={person} x={x} y={yCursor} width={barW} height={h} fill={colors.get(person)} rx={1} />;
                })}
                {/* invisible overlay carries the combined whole-period tooltip */}
                <rect x={x} y={padT} width={barW} height={chartH} fill="transparent">
                  <title>{periodTitle(d)}</title>
                </rect>
                {/* deal count above the doc total (skipped on the tallest bars to avoid clipping — tooltip still shows it) */}
                {yCursor - 13 >= padT && (
                  <text x={x + barW / 2} y={yCursor - 13} textAnchor="middle" className="fill-cyan-400 text-[8px] tabular-nums">{d.deals}d</text>
                )}
                <text x={x + barW / 2} y={yCursor - 4} textAnchor="middle" className="fill-foreground text-[10px] tabular-nums">{d.total}</text>
                {(i % labelEvery === 0 || i === daily.length - 1) && (
                  <text x={x + barW / 2} y={padT + chartH + 16} textAnchor="middle" className="fill-muted text-[10px]" transform={`rotate(35 ${x + barW / 2} ${padT + chartH + 16})`}>
                    {fmtLabel(d.day)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

/** Rejections by document type — open / resubmitted / approved, each segment and
 *  count clickable to drill into those deals with the reason, dates, and links. */
type RejBucket = "open" | "resubmitted" | "approved";
const REJ_BUCKETS: { key: RejBucket; seg: string; segHover: string; ring: string; text: string; short: string; border: string; bg: string }[] = [
  { key: "open", seg: "bg-orange-500/80", segHover: "hover:bg-orange-500", ring: "ring-orange-300", text: "text-orange-400", short: "open", border: "border-orange-500/30", bg: "bg-orange-500/5" },
  { key: "resubmitted", seg: "bg-cyan-500/70", segHover: "hover:bg-cyan-500", ring: "ring-cyan-300", text: "text-cyan-300", short: "resub", border: "border-cyan-500/30", bg: "bg-cyan-500/5" },
  { key: "approved", seg: "bg-emerald-500/60", segHover: "hover:bg-emerald-500", ring: "ring-emerald-300", text: "text-emerald-400", short: "ok", border: "border-emerald-500/30", bg: "bg-emerald-500/5" },
];
const rejDeals = (d: RejectionByDoc, k: RejBucket): RejectionDrillDeal[] =>
  k === "open" ? d.openDeals : k === "resubmitted" ? d.resubmittedDeals : d.approvedDeals;
const rejCount = (d: RejectionByDoc, k: RejBucket): number =>
  k === "open" ? d.open : k === "resubmitted" ? d.resubmitted : d.approved;

function RejectionsByDocPanel({ byDoc }: { byDoc: RejectionByDoc[] }) {
  const [drill, setDrill] = useState<{ docName: string; bucket: RejBucket } | null>(null);
  if (byDoc.length === 0) return <div className="text-xs text-muted py-4">No rejection data yet.</div>;
  const max = Math.max(...byDoc.map((x) => x.open + x.resubmitted + x.approved), 1);
  return (
    <div className="space-y-1.5">
      {byDoc.map((d) => {
        const toggle = (k: RejBucket) => {
          if (rejCount(d, k) === 0) return;
          setDrill((cur) => (cur && cur.docName === d.docName && cur.bucket === k ? null : { docName: d.docName, bucket: k }));
        };
        const drilled = drill?.docName === d.docName ? drill : null;
        const meta = drilled ? REJ_BUCKETS.find((b) => b.key === drilled.bucket)! : null;
        return (
          <div key={d.docName}>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted w-52 truncate" title={d.docName}>{d.docName}</span>
              <div className="flex-1 h-4 rounded bg-surface-2 overflow-hidden flex" title={`${d.open} open · ${d.resubmitted} resubmitted · ${d.approved} approved`}>
                {REJ_BUCKETS.map((b) => {
                  const n = rejCount(d, b.key);
                  if (n === 0) return null;
                  const on = drilled?.bucket === b.key;
                  return (
                    <button key={b.key} type="button" onClick={() => toggle(b.key)}
                      className={`h-full ${b.seg} ${b.segHover} cursor-pointer ${on ? `ring-1 ${b.ring}` : ""}`}
                      style={{ width: `${(n / max) * 100}%` }}
                      title={`${n} ${b.short} — click to list`} />
                  );
                })}
              </div>
              <div className="text-[10px] w-36 text-right tabular-nums flex gap-1.5 justify-end">
                {REJ_BUCKETS.map((b) => {
                  const n = rejCount(d, b.key);
                  return (
                    <button key={b.key} type="button" disabled={n === 0} onClick={() => toggle(b.key)}
                      className={n > 0 ? `${b.text} hover:underline cursor-pointer` : "text-muted/40 cursor-default"}>
                      {n} {b.short}
                    </button>
                  );
                })}
              </div>
            </div>
            {drilled && meta && (
              <div className={`mt-1 ml-2 rounded-lg border ${meta.border} ${meta.bg} p-2 space-y-1.5 max-h-64 overflow-y-auto`}>
                {rejDeals(d, drilled.bucket).map((od, i) => (
                  <div key={i} className="text-[11px] border-b border-t-border/30 pb-1 last:border-0 last:pb-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-foreground font-medium truncate max-w-[16rem]" title={od.dealName}>{od.dealName.split("|").slice(0, 2).join("|").trim()}</span>
                      <a href={od.hubspotUrl} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">HS ↗</a>
                      {od.pePortalUrl && <a href={od.pePortalUrl} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">PE ↗</a>}
                      {od.driveUrl && <a href={od.driveUrl} target="_blank" rel="noopener noreferrer" className="text-yellow-400 hover:underline">Drive ↗</a>}
                    </div>
                    {od.comment && <div className="text-muted mt-0.5 leading-snug">{od.comment}</div>}
                    <div className="text-[10px] text-muted/70 flex gap-2 mt-0.5 flex-wrap">
                      {od.dateRejected && <span className="text-orange-400/80">rejected {od.dateRejected}</span>}
                      {od.dateResubmitted && <span className="text-cyan-300/80">resubmitted {od.dateResubmitted}</span>}
                      {od.dateApproved && <span className="text-emerald-400/80">approved {od.dateApproved}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Missing-by-Document — one row per doc type, bar = # deals missing it,
 *  click to drill into those deals with HubSpot / PE portal / Drive links. */
function MissingByDocPanel({ byDoc }: { byDoc: MissingByDoc[] }) {
  const [drill, setDrill] = useState<string | null>(null);
  if (byDoc.length === 0) {
    return <div className="text-xs text-muted py-4">No missing documents — every owed doc has been uploaded.</div>;
  }
  const max = Math.max(...byDoc.map((x) => x.missing), 1);
  return (
    <div className="space-y-1.5">
      {byDoc.map((d) => {
        const open = drill === d.docName;
        const toggle = () => setDrill((c) => (c === d.docName ? null : d.docName));
        return (
          <div key={d.docName}>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted w-52 truncate" title={d.docName}>{d.docName}</span>
              <button type="button" onClick={toggle}
                className="flex-1 h-4 rounded bg-surface-2 overflow-hidden flex cursor-pointer" title={`${d.missing} missing — click to list`}>
                <div className={`h-full bg-zinc-400/60 hover:bg-zinc-400/80 ${open ? "ring-1 ring-zinc-300" : ""}`} style={{ width: `${(d.missing / max) * 100}%` }} />
              </button>
              <button type="button" onClick={toggle}
                className="text-[10px] w-20 text-right tabular-nums text-zinc-300 hover:underline cursor-pointer">{d.missing} missing</button>
            </div>
            {open && (
              <div className="mt-1 ml-2 rounded-lg border border-zinc-500/30 bg-zinc-500/5 p-2 space-y-1.5 max-h-64 overflow-y-auto">
                {d.deals.map((od, i) => (
                  <div key={i} className="text-[11px] flex items-center gap-2 flex-wrap border-b border-t-border/30 pb-1 last:border-0 last:pb-0">
                    <span className="text-foreground font-medium truncate max-w-[16rem]" title={od.dealName}>{od.dealName.split("|").slice(0, 2).join("|").trim()}</span>
                    <a href={od.hubspotUrl} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">HS ↗</a>
                    {od.pePortalUrl && <a href={od.pePortalUrl} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">PE ↗</a>}
                    {od.driveUrl && <a href={od.driveUrl} target="_blank" rel="noopener noreferrer" className="text-yellow-400 hover:underline">Drive ↗</a>}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Per-person × document-type matrix — who uploads which doc types. */
function DocTypeByUploaderPanel({ rows }: { rows: UploaderDocTypes[] }) {
  const unk = useContext(UnknownLabelCtx);
  if (rows.length === 0) {
    return <div className="text-sm text-muted py-8 text-center">No attributed uploads yet.</div>;
  }
  // Doc-type columns ordered by overall volume; short labels for the header.
  const SHORT: Record<string, string> = {
    "Customer Agreement (PPA/ESA)": "CustAgmt", "Installation Order": "InstOrder", "State Disclosures": "Disclos",
    "Utility Bill": "UtilBill", "Signed Proposal": "Proposal", "Design Plan": "Design", "Photos per Policy": "Photos",
    "Signed Final Permit": "Permit", "Access to Monitoring": "Monitor", "Certificate of Acceptance": "CoA",
    "Attestation of Customer Payment": "Attest", "Conditional Progress Lien Waiver": "ProgLien",
    "Signed Interconnection Agreement": "IC Agmt", "Conditional Waiver — Final Payment": "FinalLien", "Permission to Operate (PTO)": "PTO",
  };
  const totals = new Map<string, number>();
  for (const r of rows) for (const [doc, n] of Object.entries(r.byDoc)) totals.set(doc, (totals.get(doc) ?? 0) + n);
  const docs = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d);
  const max = Math.max(...rows.flatMap((r) => Object.values(r.byDoc)), 1);
  const cell = (n: number) => {
    if (!n) return <span className="text-t-border">·</span>;
    const a = 0.15 + 0.85 * (n / max); // heat
    return <span className="inline-block min-w-[1.75rem] px-1.5 py-0.5 rounded tabular-nums" style={{ background: `rgba(34,211,238,${a * 0.4})`, color: a > 0.55 ? "#e0f2fe" : undefined }}>{n}</span>;
  };
  return (
    <div className="overflow-x-auto">
      <table className="text-[13px] border-separate w-full" style={{ borderSpacing: "5px 4px" }}>
        <thead>
          <tr className="text-muted">
            <th className="text-left font-semibold pr-4 pb-1 sticky left-0 bg-surface text-xs uppercase tracking-wide">Person</th>
            {docs.map((d) => <th key={d} className="font-medium px-1.5 pb-1 text-center whitespace-nowrap text-[11px]" title={d}>{SHORT[d] ?? d.slice(0, 8)}</th>)}
            <th className="font-semibold px-1.5 pb-1 text-right text-xs">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.uploader} className={r.uploader === UNKNOWN_UPLOADER ? "opacity-70" : ""}>
              <td className="text-foreground pr-4 py-0.5 whitespace-nowrap sticky left-0 bg-surface font-medium" title={r.uploader === UNKNOWN_UPLOADER ? unk.title : undefined}>{r.uploader === UNKNOWN_UPLOADER ? `Unknown (${unk.note})` : prettyUploader(r.uploader)}</td>
              {docs.map((d) => <td key={d} className="text-center text-foreground">{cell(r.byDoc[d] ?? 0)}</td>)}
              <td className="text-right font-semibold text-foreground tabular-nums">{r.total.toLocaleString("en-US")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Compact dollar formatter shared by the payment views. */
function fmtMoney(n: number): string {
  return n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`;
}

/** Approved-payment ownership leaderboard — bar length = $ owned. */
function PaymentPanel({ stats, statsShared }: { stats: UploaderStat[]; statsShared: UploaderStat[] }) {
  const unk = useContext(UnknownLabelCtx);
  // Owner = whole milestone $ to its top uploader (winner-take-all).
  // Fractional = milestone $ split across its approved-doc uploaders by share.
  const [mode, setMode] = useState<"owner" | "fractional">("owner");
  const active = mode === "fractional" ? statsShared : stats;
  const fmtCt = (n: number) => (mode === "fractional" ? n.toFixed(1) : String(n));
  const attributed = active
    .filter((s) => s.uploader !== UNKNOWN_UPLOADER && (s.paymentsOwned > 0 || s.pendingPaymentsOwned > 0))
    .sort((a, b) => (b.paymentsOwned + b.pendingPaymentsOwned) - (a.paymentsOwned + a.pendingPaymentsOwned));
  const unknown = active.find((s) => s.uploader === UNKNOWN_UPLOADER);
  const hasUnknown = !!unknown && (unknown.paymentsOwned > 0 || unknown.pendingPaymentsOwned > 0);
  if (attributed.length === 0 && !hasUnknown) {
    return <div className="text-sm text-muted py-8 text-center">No milestone payments attributed yet.</div>;
  }
  const teamApproved = attributed.reduce((sum, s) => sum + s.paymentsOwned, 0);
  const teamPaid = attributed.reduce((sum, s) => sum + s.paidPaymentsOwned, 0);
  const teamPending = attributed.reduce((sum, s) => sum + s.pendingPaymentsOwned, 0);
  const unknownPay = unknown?.paymentsOwned ?? 0;
  const maxPay = Math.max(...attributed.map((s) => s.paymentsOwned + s.pendingPaymentsOwned), 1);
  const COLS = "grid items-center gap-x-2 grid-cols-[6.25rem_1fr_4.5rem_4.5rem_4.5rem]";
  const row = (s: UploaderStat, muted: boolean) => {
    const approvedUnpaid = Math.max(0, s.paymentsOwned - s.paidPaymentsOwned);
    return (
    <div className={`${COLS} ${muted ? "opacity-70" : ""}`}>
      <span className="text-xs text-foreground truncate" title={s.uploader}>
        {muted ? "Unknown" : prettyUploader(s.uploader)}
        {muted && <span className="text-[10px] text-muted block leading-tight" title={unk.title}>{unk.note}</span>}
      </span>
      <div className="h-4 rounded bg-surface-2 overflow-hidden w-full flex">
        <div className="h-full bg-emerald-500/80" style={{ width: `${Math.min(100, (s.paidPaymentsOwned / maxPay) * 100)}%` }} title={`Paid: ${fmtMoney(s.paidPaymentsOwned)}`} />
        <div className="h-full bg-cyan-500/70" style={{ width: `${Math.min(100, (approvedUnpaid / maxPay) * 100)}%` }} title={`Approved, awaiting payment: ${fmtMoney(approvedUnpaid)}`} />
        <div className="h-full bg-amber-500/50" style={{ width: `${Math.min(100, (s.pendingPaymentsOwned / maxPay) * 100)}%` }} title={`In review: ${fmtMoney(s.pendingPaymentsOwned)}`} />
      </div>
      <span className="text-sm font-semibold text-emerald-400 text-right tabular-nums" title={`${fmtCt(s.paidMilestonesOwned)} paid milestone(s)`}>{s.paidPaymentsOwned > 0 ? fmtMoney(s.paidPaymentsOwned) : "—"}</span>
      <span className="text-xs text-cyan-400 text-right tabular-nums" title={`${fmtCt(s.milestonesOwned - s.paidMilestonesOwned)} approved milestone(s) awaiting payment`}>{approvedUnpaid > 0 ? fmtMoney(approvedUnpaid) : "—"}</span>
      <span className="text-xs text-amber-400 text-right tabular-nums" title={`${fmtCt(s.pendingMilestonesOwned)} milestone(s) submitted, awaiting approval`}>{s.pendingPaymentsOwned > 0 ? fmtMoney(s.pendingPaymentsOwned) : "—"}</span>
    </div>
    );
  };
  return (
    <div>
      <div className="flex justify-end mb-2">
        <div className="inline-flex rounded-lg border border-t-border overflow-hidden text-[11px]" title="Owner: whole milestone $ to its top uploader. Fractional: split across its approved-doc uploaders by share.">
          {(["owner", "fractional"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-2.5 py-1 transition-colors ${mode === m ? "bg-emerald-500/20 text-emerald-400" : "text-muted hover:text-foreground"}`}>
              {m === "owner" ? "Owner" : "Fractional"}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        <MiniStat label="Paid $" value={fmtMoney(teamPaid)} subtitle="PE has paid" />
        <MiniStat label="Approved $" value={fmtMoney(teamApproved - teamPaid)} subtitle="approved, awaiting payment" />
        <MiniStat label="In Review $" value={fmtMoney(teamPending)} subtitle="submitted, awaiting PE approval" />
        <MiniStat label="Unknown $" value={fmtMoney(unknownPay)} subtitle={unk.note} />
      </div>
      <div className={`${COLS} pb-1.5 mb-1 border-b border-t-border text-[10px] uppercase tracking-wide text-muted`}>
        <span>Person</span>
        <span>Payments owned — bar = $ (<span className="text-emerald-400/80">paid</span> + <span className="text-cyan-400/80">approved</span> + <span className="text-amber-400/80">in review</span>)</span>
        <span className="text-right text-emerald-400/80">$ Paid</span>
        <span className="text-right text-cyan-400/80">$ Appr.</span>
        <span className="text-right text-amber-400/80">$ In Rev.</span>
      </div>
      <div className="space-y-2">
        {attributed.map((s) => <div key={s.uploader}>{row(s, false)}</div>)}
      </div>
      {hasUnknown && (
        <div className="mt-2 pt-2 border-t border-t-border">{row(unknown!, true)}</div>
      )}
      <p className="mt-3 text-[11px] text-muted">{mode === "fractional"
        ? "Fractional: each milestone's payment is split across its approved-doc uploaders by their share of those docs (counts shown to 1 decimal)."
        : "Owner: each milestone's payment goes to whoever uploaded the most of its docs — approved docs for approved milestones, in-review for ones still awaiting PE. Top known uploader wins."}</p>
    </div>
  );
}

/** Drill list of the matching uploads when an Uploads-Explorer filter is active. */
function ExplorerDrill({ rows, dealLinks, onClear }: { rows: UploaderRow[]; dealLinks: Record<string, DealLink>; onClear: () => void }) {
  const sorted = useMemo(() => [...rows].sort((a, b) => b.at.localeCompare(a.at) || a.doc.localeCompare(b.doc)), [rows]);
  const STATUS_CLS: Record<string, string> = {
    APPROVED: "text-green-400", UNDER_REVIEW: "text-blue-400", UPLOADED: "text-blue-400",
    ACTION_REQUIRED: "text-orange-400", REJECTED: "text-red-400", NOT_UPLOADED: "text-zinc-400",
  };
  const STATUS_LABEL: Record<string, string> = {
    APPROVED: "Approved", UNDER_REVIEW: "In review", UPLOADED: "In review",
    ACTION_REQUIRED: "Action req.", REJECTED: "Rejected", NOT_UPLOADED: "Not uploaded",
  };
  return (
    <div className="mt-4 pt-3 border-t border-t-border">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-foreground">Matching uploads <span className="text-muted font-normal">({sorted.length})</span></span>
        <button onClick={onClear} className="text-[11px] text-muted hover:text-foreground">Clear filters</button>
      </div>
      {sorted.length === 0 ? (
        <div className="text-xs text-muted py-3">No uploads match these filters.</div>
      ) : (
        <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
          {sorted.slice(0, 300).map((r, i) => {
            const dl = dealLinks[r.dealId];
            return (
              <div key={i} className="grid grid-cols-[1fr_auto] items-center gap-2 text-[11px] border-b border-t-border/30 pb-1 last:border-0">
                <div className="min-w-0 truncate">
                  <span className="text-foreground">{(dl?.name ?? r.dealId).split("|").slice(0, 2).join("|").trim()}</span>
                  <span className="text-muted"> · {r.doc} <span className="text-muted/60">v{r.ver}</span></span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={STATUS_CLS[r.status] ?? "text-muted"}>{STATUS_LABEL[r.status] ?? r.status}</span>
                  <span className="text-muted/60 tabular-nums">{r.at}</span>
                  {dl?.hubspotUrl && <a href={dl.hubspotUrl} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">HS↗</a>}
                  {dl?.pePortalUrl && <a href={dl.pePortalUrl} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">PE↗</a>}
                  {dl?.driveUrl && <a href={dl.driveUrl} target="_blank" rel="noopener noreferrer" className="text-yellow-400 hover:underline">Drive↗</a>}
                </div>
              </div>
            );
          })}
          {sorted.length > 300 && <div className="text-[10px] text-muted/60 pt-1">Showing first 300 of {sorted.length}.</div>}
        </div>
      )}
    </div>
  );
}

function UploadersSection({ stats, statsShared, periods, docTypes, docs, docsShared, attributionStart, uploaderRows, dealLinks }: { stats: UploaderStat[]; statsShared: UploaderStat[]; periods: UploadsByPeriod; docTypes: UploaderDocTypes[]; docs: Record<string, UploaderOutcomeDocs>; docsShared: Record<string, UploaderOutcomeDocs>; attributionStart: string | null; uploaderRows: UploaderRow[]; dealLinks: Record<string, DealLink> }) {
  const [tab, setTab] = useState<"submissions" | "timeline" | "doctype" | "payments">("submissions");
  const [grain, setGrain] = useState<UploadGranularity>("day");
  const [docFilter, setDocFilter] = useState<string>("all");
  const [uploaderFilter, setUploaderFilter] = useState<string>("all");
  const unk = useMemo(() => attrLabel(attributionStart), [attributionStart]);

  // Filter options from the atomic rows.
  const docOptions = useMemo(() => [...new Set(uploaderRows.map((r) => r.doc))].sort(), [uploaderRows]);
  const uploaderOptions = useMemo(() => {
    const set = new Set(uploaderRows.map((r) => r.by || UNKNOWN_UPLOADER));
    return [...set].sort((a, b) => (a === UNKNOWN_UPLOADER ? 1 : b === UNKNOWN_UPLOADER ? -1 : a.localeCompare(b)));
  }, [uploaderRows]);

  // Doc filter doesn't apply to Payments (milestone-based, not per-doc).
  const docFilterActive = docFilter !== "all" && tab !== "payments";
  const isFiltered = docFilterActive || uploaderFilter !== "all";
  const filteredRows = useMemo(() => uploaderRows.filter((r) =>
    (!docFilterActive || r.doc === docFilter) &&
    (uploaderFilter === "all" || (r.by || UNKNOWN_UPLOADER) === uploaderFilter),
  ), [uploaderRows, docFilter, docFilterActive, uploaderFilter]);

  const statusByDoc = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of uploaderRows) m.set(`${r.dealId}|${r.doc}`, r.status);
    return m;
  }, [uploaderRows]);

  // Recompute Submissions + Timeline on the filtered subset via the pure builders.
  const mapped = (rows: UploaderRow[]) => rows.map((r) => ({ uploadedAt: r.at, uploadedBy: r.by, dealId: r.dealId, docName: r.doc, version: r.ver }));
  const fStats = useMemo(() => (isFiltered ? buildUploaderStats(mapped(filteredRows), statusByDoc, new Date()) : null), [isFiltered, filteredRows, statusByDoc]);
  const fPeriods = useMemo(() => (isFiltered ? buildUploadsByPeriod(mapped(filteredRows)) : null), [isFiltered, filteredRows]);
  const effStats = fStats ?? stats;
  const effPeriods = fPeriods ?? periods;
  // Payments: uploader filter only (array filter); doc filter never applies.
  const payStats = uploaderFilter === "all" ? stats : stats.filter((s) => s.uploader === uploaderFilter);
  const payStatsShared = uploaderFilter === "all" ? statsShared : statsShared.filter((s) => s.uploader === uploaderFilter);

  const sel = "text-[11px] bg-surface-2 border border-t-border rounded-lg px-2 py-1 text-foreground focus:outline-none max-w-[11rem] truncate";
  return (
    <UnknownLabelCtx.Provider value={unk}>
    <Section
      title="Doc Uploaders"
      subtitle={
        tab === "submissions"
          ? `Who uploaded each doc and their approval rate. "Unknown" = uploads with no recorded uploader, almost all ${unk.note} (before PE began attributing uploads).`
          : tab === "timeline"
            ? `Documents uploaded per ${grain}, segmented by who uploaded them.${grain === "day" ? " Last 90 days." : " All time."}`
            : tab === "doctype"
              ? "Which document types each person uploads — count of docs they're the latest uploader on, by type."
              : "Milestone payments each person drove, split into paid, approved (awaiting payment), and in review."
      }
      actions={
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
          {tab !== "doctype" && (
            <select value={uploaderFilter} onChange={(e) => setUploaderFilter(e.target.value)} className={sel} title="Filter by uploader">
              <option value="all">All uploaders</option>
              {uploaderOptions.map((u) => <option key={u} value={u}>{u === UNKNOWN_UPLOADER ? "Unknown" : prettyUploader(u)}</option>)}
            </select>
          )}
          {(tab === "submissions" || tab === "timeline") && (
            <select value={docFilter} onChange={(e) => setDocFilter(e.target.value)} className={sel} title="Filter by document">
              <option value="all">All documents</option>
              {docOptions.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
          {tab === "timeline" && (
            <div className="flex items-center gap-1">
              {(["day", "week", "month"] as const).map((g) => (
                <button key={g} onClick={() => setGrain(g)}
                  className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors capitalize ${grain === g ? "bg-cyan-500/20 text-cyan-400 border-cyan-500/40" : "border-t-border text-muted hover:text-foreground"}`}>
                  {g}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1.5">
            {([["submissions", "Submissions"], ["timeline", "By Time"], ["doctype", "By Doc Type"], ["payments", "Approved $"]] as const).map(([t, label]) => (
              <button key={t} onClick={() => setTab(t)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${tab === t ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40" : "border-t-border text-muted hover:text-foreground"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      }
    >
      {tab === "submissions" ? <UploaderPanel stats={effStats} docs={docs} statsShared={isFiltered ? effStats : statsShared} docsShared={docsShared} />
        : tab === "timeline" ? <DailyUploadsChart daily={effPeriods[grain]} stats={effStats} granularity={grain} />
          : tab === "doctype" ? <DocTypeByUploaderPanel rows={docTypes} />
            : <PaymentPanel stats={payStats} statsShared={payStatsShared} />}
      {isFiltered && tab !== "doctype" && <ExplorerDrill rows={filteredRows} dealLinks={dealLinks} onClear={() => { setDocFilter("all"); setUploaderFilter("all"); }} />}
    </Section>
    </UnknownLabelCtx.Provider>
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
                  <td className="py-1.5 pr-3 max-w-72">
                    <div className="flex flex-col gap-0.5">
                      {r.hubspotUrl ? (
                        <a href={r.hubspotUrl} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline truncate" title={r.dealName}>
                          {r.dealName.split("|").slice(0, 2).join("|").trim()}
                        </a>
                      ) : (
                        <span className="truncate" title={r.dealName}>{r.dealName.split("|").slice(0, 2).join("|").trim()}</span>
                      )}
                      {(r.pePortalUrl || r.driveUrl) && (
                        <div className="flex items-center gap-2 text-[10px] leading-none">
                          {r.pePortalUrl && (
                            <a href={r.pePortalUrl} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline" title="Open PE portal project">PE portal ↗</a>
                          )}
                          {r.driveUrl && (
                            <a href={r.driveUrl} target="_blank" rel="noopener noreferrer" className="text-amber-400 hover:underline" title="Open Google Drive folder">Drive ↗</a>
                          )}
                        </div>
                      )}
                    </div>
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
    subtitle: "Bars dated by week each milestone became READY — inspection passed (M1) / PTO granted (M2). Green = submitted since; gray = still waiting on submission.",
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
    subtitle: "Bars dated by week each milestone became READY — inspection passed (M1) / PTO granted (M2); colored by where it stands today, rejections included.",
    empty: "No milestones have reached Ready to Submit yet.",
    weekPrefix: "Ready",
  },
};

const WEEKLY_MODE_ORDER: WeeklyMode[] = ["ready", "submitted", "approved", "paid", "lifecycle", "rejections"];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AnalyticsTab({ tabsSlot }: { tabsSlot?: React.ReactNode }) {
  const { data, isLoading, isError, refetch } = useQuery<PeAnalyticsPayload>({
    queryKey: queryKeys.peAnalytics.list(),
    queryFn: async () => {
      const r = await fetch("/api/accounting/pe-analytics");
      if (!r.ok) throw new Error("Failed to load PE analytics");
      return r.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  // On visit, kick a throttled incremental PE sync and refresh if it pulled changes.
  usePeAutoSync([queryKeys.peAnalytics.list()]);

  const [locFilter, setLocFilter] = useState<string | null>(null);
  const [weeklyMode, setWeeklyMode] = useState<WeeklyMode>("paid");
  const [docMode, setDocMode] = useState<"submitted" | "approved" | "rejected">("submitted");
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
    // Distinct deal counts per stage (from the drill rows, which carry deal
    // IDs; the weekly series don't). Predicates mirror the aggregate drills.
    const ms = data?.milestones ?? [];
    const PRE_SUB = new Set([
      "Ready to Submit", "Waiting on Information", "Ready for Onboarding", "Onboarding Submitted",
      "Onboarding Rejected", "Onboarding Ready to Resubmit", "Onboarding Resubmitted",
    ]);
    const distinct = (rows: typeof ms) => new Set(rows.map((r) => r.dealId)).size;
    const deals = {
      ready: distinct(ms.filter((r) => !!r.readyOn)),
      waiting: distinct(ms.filter((r) => !!r.readyOn && !r.submittedOn && (!r.status || PRE_SUB.has(r.status)))),
      submitted: distinct(ms.filter((r) => !!r.submittedOn)),
      approved: distinct(ms.filter((r) => !!r.approvedOn)),
      paid: distinct(ms.filter((r) => !!r.paidOn || r.status === "Paid")),
    };
    return {
      ready,
      deals,
      submitted: sum(data?.weeklySubmissions),
      approved: sum(data?.weeklyApprovals),
      paid: sum(data?.weekly),
    };
  }, [data]);

  // Doc-level review timing: join each PE response to the doc's latest prior
  // submission; in-review age = days since latest submission for pending docs.
  const docReviewStats = useMemo(() => {
    const subs = data?.docSubmissionEvents ?? [];
    if (subs.length === 0) return { avgApproveDays: null, avgRejectDays: null, avgInReviewAge: null };
    const byDoc = new Map<string, string[]>();
    for (const e of subs) {
      const k = `${e.dealId}|${e.docName}`;
      (byDoc.get(k) ?? byDoc.set(k, []).get(k)!).push(e.date);
    }
    for (const dates of byDoc.values()) dates.sort();
    const daysBetween = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
    const diffsFor = (events: { dealId: string; docName: string; date: string }[]) => {
      const out: number[] = [];
      for (const e of events) {
        const dates = byDoc.get(`${e.dealId}|${e.docName}`);
        if (!dates) continue;
        const prior = [...dates].reverse().find((d) => d <= e.date);
        if (!prior) continue;
        const diff = daysBetween(prior, e.date);
        if (diff >= 0) out.push(diff);
      }
      return out;
    };
    const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
    const approveDiffs = diffsFor(data?.docApprovalEvents ?? []);
    const rejectDiffs = diffsFor(data?.docRejectionEvents ?? []);
    const today = new Date().toISOString().slice(0, 10);
    const latestSubOutcome = new Map<string, { date: string; outcome?: string }>();
    for (const e of subs) {
      const k = `${e.dealId}|${e.docName}`;
      const cur = latestSubOutcome.get(k);
      if (!cur || e.date > cur.date) latestSubOutcome.set(k, { date: e.date, outcome: e.outcome });
    }
    const ages = [...latestSubOutcome.values()].filter((v) => v.outcome === "inReview").map((v) => daysBetween(v.date, today)).filter((d) => d >= 0);
    return { avgApproveDays: avg(approveDiffs), avgRejectDays: avg(rejectDiffs), avgInReviewAge: avg(ages) };
  }, [data]);

  const m1Timing = data?.timing.overall.find((t) => t.milestone === "M1");
  const m2Timing = data?.timing.overall.find((t) => t.milestone === "M2");

  return (
    <DashboardShell title="PE Analytics" accentColor="emerald" lastUpdated={data?.lastUpdated} fullWidth>
      {tabsSlot}
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
            <div className={`grid grid-cols-2 gap-2 mb-4 ${weeklyMode === "ready" || weeklyMode === "lifecycle" ? "md:grid-cols-4" : "md:grid-cols-3"}`}>
              {(weeklyMode === "ready" || weeklyMode === "lifecycle") && (
                <button type="button" className="text-left cursor-pointer transition-opacity hover:opacity-75" onClick={() => openAggregate("waitSubmission")} title="Click: all waiting on submission">
                <MiniStat
                  label="Total Ready to Submit"
                  value={fmtUsd(funnelTotals.ready.amount)}
                  subtitle={`${funnelTotals.ready.count} milestones · ${funnelTotals.deals.ready} deals — ${
                    funnelTotals.ready.amount > 0
                      ? Math.round(((funnelTotals.ready.amount - funnelTotals.ready.waitingAmount) / funnelTotals.ready.amount) * 100)
                      : 0
                  }% already submitted — ${funnelTotals.ready.waitingCount} milestones (${funnelTotals.deals.waiting} deals · ${fmtUsdK(funnelTotals.ready.waitingAmount)}) waiting`}
                />
                </button>
              )}
              <button type="button" className="text-left cursor-pointer transition-opacity hover:opacity-75" onClick={() => openAggregate("waitApproval")} title="Click: all awaiting PE approval">
                <MiniStat label="Total Submitted" value={fmtUsd(funnelTotals.submitted.amount)} subtitle={`${funnelTotals.submitted.count} milestones · ${funnelTotals.deals.submitted} deals`} />
              </button>
              <button type="button" className="text-left cursor-pointer transition-opacity hover:opacity-75" onClick={() => openAggregate("waitPayment")} title="Click: all awaiting payment">
                <MiniStat label="Total Approved" value={fmtUsd(funnelTotals.approved.amount)} subtitle={`${funnelTotals.approved.count} milestones · ${funnelTotals.deals.approved} deals`} />
              </button>
              <button type="button" className="text-left cursor-pointer transition-opacity hover:opacity-75" onClick={() => openAggregate("paidAll")} title="Click: all paid">
                <MiniStat label="Total Paid" value={fmtUsd(funnelTotals.paid.amount)} subtitle={`${funnelTotals.paid.count} milestones · ${funnelTotals.deals.paid} deals`} />
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

          {/* 1.5 Uploaders — own card: By Person leaderboard + By Day stacked bars */}
          <UploadersSection stats={data.uploaderStats ?? []} statsShared={data.uploaderStatsShared ?? []} periods={data.uploadsByPeriod ?? { day: [], week: [], month: [] }} docTypes={data.docTypeByUploader ?? []} docs={data.uploaderDocs ?? {}} docsShared={data.uploaderDocsShared ?? {}} attributionStart={data.attributionStart ?? null} uploaderRows={data.uploaderRows ?? []} dealLinks={data.dealLinks ?? {}} />

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
            title={
              docMode === "submitted" ? "Doc Submissions per Week"
                : docMode === "approved" ? "Doc Approvals per Week"
                  : "Doc Rejections per Week"
            }
            subtitle={
              docMode === "submitted"
                ? "Document-level uploads dated by the portal's Submitted stamp, colored by each doc's CURRENT outcome. Click a week for the docs and deals."
                : docMode === "approved"
                  ? "Document-level approvals, dated by PE's reviewer response. Click a week for the docs and deals."
                  : "Document-level rejections dated by PE's reviewer response. Click a week for the docs, deals, and notes."
            }
            actions={
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {([["submitted", "Submitted"], ["approved", "Approved"], ["rejected", "Rejected"]] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    onClick={() => setDocMode(mode)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${docMode === mode ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40" : "border-t-border text-muted hover:text-foreground"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            }
          >
            {docMode === "submitted" ? (
              <DocActivityChart key="sub" events={data.docSubmissionEvents ?? []} noun="doc submission" statLabel="Docs Submitted" stackOutcomes reviewStats={docReviewStats}
                barClass="fill-cyan-500" pillClass="bg-cyan-500/20 text-cyan-400 border-cyan-500/40" swatchText="text-cyan-400" />
            ) : docMode === "approved" ? (
              <DocActivityChart key="app" events={data.docApprovalEvents ?? []} noun="doc approval" statLabel="Docs Approved"
                barClass="fill-emerald-500" pillClass="bg-emerald-500/20 text-emerald-400 border-emerald-500/40" swatchText="text-emerald-400" />
            ) : (
              <DocActivityChart key="rej" events={data.docRejectionEvents ?? []} noun="doc rejection" statLabel="Doc Rejections"
                barClass="fill-orange-500" pillClass="bg-orange-500/20 text-orange-400 border-orange-500/40" swatchText="text-orange-400" />
            )}
          </Section>

          {/* 4. Rejection analysis */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Section
              title="Rejections by Document"
              subtitle="Historical rejection/action-required events plus current state, per doc type."
            >
              <RejectionsByDocPanel byDoc={data.rejections.byDoc} />
            </Section>

            <Section title="Recent Rejection Notes" subtitle="Latest PE reviewer comments on docs that are still rejected / action-required.">
              {data.rejections.recentNotes.length === 0 ? (
                <div className="text-xs text-muted py-4">No notes recorded.</div>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {data.rejections.recentNotes.map((n, i) => {
                    const href = n.pePortalUrl ?? n.hubspotUrl ?? "";
                    const inner = (
                      <>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-[11px] font-medium text-foreground truncate">{n.docName}</span>
                          <span className="text-[10px] text-muted flex-shrink-0">{n.pePortalUrl ? "PE ↗ " : ""}{n.date}</span>
                        </div>
                        {n.dealName && <div className="text-[10px] text-muted mb-1 truncate">{n.dealName.split("|").slice(0, 2).join("|").trim()}</div>}
                        <div className="text-[11px] text-orange-400/90 line-clamp-3">{n.note}</div>
                      </>
                    );
                    return href ? (
                      <a key={i} href={href} target="_blank" rel="noopener noreferrer" className="block rounded-lg bg-surface-2 p-2.5 hover:bg-surface-elevated transition-colors" title="Open in PE portal">
                        {inner}
                      </a>
                    ) : (
                      <div key={i} className="rounded-lg bg-surface-2 p-2.5">{inner}</div>
                    );
                  })}
                </div>
              )}
            </Section>
          </div>

          {/* 4b. Missing by Document */}
          <Section
            title="Missing by Document"
            subtitle="Documents genuinely not uploaded, per doc type — deals in a milestone (PTO owes the M1 docs; Close Out / Complete owe all 15). Excludes docs PE waived on an already-approved milestone. Click a bar to list the deals."
          >
            <MissingByDocPanel byDoc={data.missingByDoc} />
          </Section>

          {/* 5. Milestone funnel */}
          <Section title="Milestone Funnel" subtitle="Deal counts by current M1/M2 status — deals in PTO, Close Out, or Complete stages only.">
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

          {/* 6. Document rework & attribution (moved from its own tab) */}
          <Section title="Document Rework &amp; Attribution" subtitle="Who is redoing whose Participate Energy documents, why they bounce, and how the redos end up.">
            <ReworkSection />
          </Section>
        </div>
      )}
    </DashboardShell>
  );
}
