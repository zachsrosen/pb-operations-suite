"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { UNKNOWN_UPLOADER } from "@/lib/pe-analytics";
import { prettyUploader } from "@/components/pe/uploader-colors";
import type {
  PeReworkPayload,
  ReplacerStat,
  RejectionReasons,
  ReworkWeek,
  SwapOutcome,
} from "@/lib/pe-rework";

const name = (u: string) => (u === UNKNOWN_UPLOADER ? "Unknown" : prettyUploader(u));

// ── shared bits ────────────────────────────────────────────────────────────
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

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2">
      <div className="text-lg font-semibold text-foreground tabular-nums">{value}</div>
      <div className="text-[11px] text-muted">{label}</div>
      {hint && <div className="text-[10px] text-muted/70 mt-0.5">{hint}</div>}
    </div>
  );
}

const OUTCOME_META: Record<SwapOutcome, { label: string; cls: string }> = {
  approved: { label: "Approved", cls: "bg-emerald-500/80" },
  under_review: { label: "Under review", cls: "bg-zinc-400/60" },
  rejected_again: { label: "Rejected again", cls: "bg-orange-500/80" },
  superseded_again: { label: "Redone again", cls: "bg-violet-500/70" },
};
const OUTCOME_ORDER: SwapOutcome[] = ["approved", "under_review", "rejected_again", "superseded_again"];

// ── 1. Who replaces whom ───────────────────────────────────────────────────
function SwapsView({ swaps }: { swaps: PeReworkPayload["swaps"] }) {
  const known = swaps.byReplacer.filter((s) => s.uploader !== UNKNOWN_UPLOADER);
  const maxTotal = Math.max(1, ...swaps.byReplacer.map((s) => s.total));
  return (
    <Section
      title="Who replaces whose work"
      subtitle="A swap = one person uploaded a new version over someone else's. Rejection-driven means a PE rejection landed on the replaced version first; voluntary means it was swapped in before any review."
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <Stat label="Cross-person swaps" value={swaps.totalSwaps} />
        <Stat label="Rejection-driven" value={swaps.rejectedSwaps} />
        <Stat label="Voluntary (pre-review)" value={swaps.voluntarySwaps} />
        <Stat label="Self-revisions (same person)" value={swaps.selfRevisions} />
      </div>
      <div className="space-y-2.5">
        {swaps.byReplacer.map((s) => (
          <div key={s.uploader} className="grid grid-cols-[8rem_1fr] gap-3 items-center">
            <div className="text-sm text-foreground truncate" title={name(s.uploader)}>{name(s.uploader)}</div>
            <div>
              <div className="flex items-center gap-2">
                <div className="h-4 rounded bg-surface-2 overflow-hidden flex" style={{ width: `${(s.total / maxTotal) * 100}%`, minWidth: 24 }}>
                  <div className="h-full bg-orange-500/80" style={{ width: `${(s.rejected / Math.max(1, s.total)) * 100}%` }} title={`${s.rejected} rejection-driven`} />
                  <div className="h-full bg-sky-500/60" style={{ width: `${(s.voluntary / Math.max(1, s.total)) * 100}%` }} title={`${s.voluntary} voluntary`} />
                </div>
                <span className="text-xs text-muted tabular-nums">{s.total}</span>
              </div>
              {s.whose.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {s.whose.slice(0, 4).map((w) => (
                    <span key={w.uploader} className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-muted">
                      {name(w.uploader)} ×{w.count}
                    </span>
                  ))}
                  {s.whose.length > 4 && <span className="text-[10px] text-muted/70">+{s.whose.length - 4} more</span>}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-3 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1"><i className="inline-block w-2.5 h-2.5 rounded-sm bg-orange-500/80" /> rejection-driven</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block w-2.5 h-2.5 rounded-sm bg-sky-500/60" /> voluntary</span>
        <span className="ml-auto">{known.length} attributed people · pre-June-12 uploads show as Unknown</span>
      </div>
    </Section>
  );
}

// ── 2. Rejection reasons ───────────────────────────────────────────────────
function ReasonsView({ reasons }: { reasons: RejectionReasons }) {
  const topCodes = reasons.codes.slice(0, 15);
  const maxDoc = Math.max(1, ...reasons.byDoc.map((d) => d.count));
  return (
    <div className="space-y-4">
      <Section title="Top rejection reasons" subtitle={`${reasons.withCode} of ${reasons.totalActionItems} rejections carry a parseable reason code. Codes come from the PE reviewer note text.`}>
        <div className="space-y-1.5">
          {topCodes.map((c) => (
            <div key={c.code} className="grid grid-cols-[3.5rem_1fr_2.5rem] gap-2 items-baseline text-sm">
              <span className="font-mono text-xs text-orange-400">{c.code}</span>
              <span className="text-foreground truncate" title={c.sample}>
                {c.label ? <span className="text-muted">{c.label}</span> : <span className="text-muted/70 italic">{c.sample}</span>}
              </span>
              <span className="text-right tabular-nums text-muted">{c.count}</span>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Rejections by document type" subtitle="Which documents draw the most reviewer pushback.">
        <div className="space-y-1.5">
          {reasons.byDoc.map((d) => (
            <div key={d.docName} className="grid grid-cols-[12rem_1fr_2.5rem] gap-2 items-center text-sm">
              <span className="text-foreground truncate" title={d.docName}>{d.docName}</span>
              <div className="h-3 rounded bg-orange-500/70" style={{ width: `${(d.count / maxDoc) * 100}%`, minWidth: 4 }} />
              <span className="text-right tabular-nums text-muted">{d.count}</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

// ── 3. Outcomes ────────────────────────────────────────────────────────────
function OutcomesView({ byReplacer }: { byReplacer: ReplacerStat[] }) {
  const rows = byReplacer.filter((s) => s.total > 0);
  const maxTotal = Math.max(1, ...rows.map((s) => s.total));
  return (
    <Section
      title="What happened to each replacement"
      subtitle="For every swap a person made, where it ended up: approved, still under review, rejected again, or redone again by yet another person."
    >
      <div className="space-y-2.5">
        {rows.map((s) => (
          <div key={s.uploader} className="grid grid-cols-[8rem_1fr] gap-3 items-center">
            <div className="text-sm text-foreground truncate" title={name(s.uploader)}>{name(s.uploader)}</div>
            <div className="flex items-center gap-2">
              <div className="h-4 rounded bg-surface-2 overflow-hidden flex" style={{ width: `${(s.total / maxTotal) * 100}%`, minWidth: 24 }}>
                {OUTCOME_ORDER.map((o) =>
                  s.outcomes[o] > 0 ? (
                    <div key={o} className={`h-full ${OUTCOME_META[o].cls}`} style={{ width: `${(s.outcomes[o] / s.total) * 100}%` }} title={`${s.outcomes[o]} ${OUTCOME_META[o].label}`} />
                  ) : null,
                )}
              </div>
              <span className="text-xs text-muted tabular-nums">{s.total}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-[11px] text-muted">
        {OUTCOME_ORDER.map((o) => (
          <span key={o} className="inline-flex items-center gap-1"><i className={`inline-block w-2.5 h-2.5 rounded-sm ${OUTCOME_META[o].cls}`} /> {OUTCOME_META[o].label}</span>
        ))}
      </div>
    </Section>
  );
}

// ── 4. Over time ───────────────────────────────────────────────────────────
function TimelineView({ timeline }: { timeline: ReworkWeek[] }) {
  const weeks = timeline.slice(-26); // trailing ~6 months
  const max = Math.max(1, ...weeks.map((w) => Math.max(w.rejections, w.resubmissions)));
  const padL = 28, padT = 10, padB = 40, h = 240, gap = 4;
  const barW = Math.max(6, Math.min(28, Math.floor((900 - padL) / Math.max(weeks.length, 1)) - gap));
  const chartW = padL + weeks.length * (barW + gap) + 4;
  const chartH = h - padT - padB;
  const y = (n: number) => padT + chartH - (n / max) * chartH;
  return (
    <Section title="Rework over time" subtitle="PE rejections vs. document resubmissions per week (trailing ~6 months). A falling gap means fewer redos.">
      <div className="overflow-x-auto">
        <svg width={chartW} height={h} className="min-w-full">
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={padL} x2={chartW} y1={padT + chartH * (1 - f)} y2={padT + chartH * (1 - f)} className="stroke-t-border" strokeWidth={0.5} />
              <text x={0} y={padT + chartH * (1 - f) + 3} className="fill-muted text-[9px] tabular-nums">{Math.round(max * f)}</text>
            </g>
          ))}
          {weeks.map((w, i) => {
            const x = padL + i * (barW + gap);
            const half = Math.max(2, barW / 2 - 1);
            return (
              <g key={w.weekStart}>
                <rect x={x} y={y(w.rejections)} width={half} height={Math.max(0, padT + chartH - y(w.rejections))} className="fill-orange-500/80">
                  <title>{`Week of ${w.weekStart}: ${w.rejections} rejections, ${w.resubmissions} resubmissions`}</title>
                </rect>
                <rect x={x + half + 2} y={y(w.resubmissions)} width={half} height={Math.max(0, padT + chartH - y(w.resubmissions))} className="fill-sky-500/70">
                  <title>{`Week of ${w.weekStart}: ${w.rejections} rejections, ${w.resubmissions} resubmissions`}</title>
                </rect>
                {i % Math.ceil(weeks.length / 12) === 0 && (
                  <text x={x + barW / 2} y={h - padB + 14} textAnchor="middle" className="fill-muted text-[9px]" transform={`rotate(35 ${x + barW / 2} ${h - padB + 14})`}>
                    {w.weekStart.slice(5)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-2 flex items-center gap-3 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1"><i className="inline-block w-2.5 h-2.5 rounded-sm bg-orange-500/80" /> rejections</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block w-2.5 h-2.5 rounded-sm bg-sky-500/70" /> resubmissions</span>
      </div>
    </Section>
  );
}

// ── shell ──────────────────────────────────────────────────────────────────
const VIEWS = [
  { key: "swaps", label: "Who replaces whom" },
  { key: "reasons", label: "Rejection reasons" },
  { key: "outcomes", label: "Outcomes" },
  { key: "timeline", label: "Over time" },
] as const;
type ViewKey = (typeof VIEWS)[number]["key"];

/** Document Rework & Attribution — embedded as a section on the Analytics tab
 *  (fetches its own /api/accounting/pe-rework data). */
export function ReworkSection() {
  const { data, isLoading, isError, refetch } = useQuery<PeReworkPayload & { lastUpdated?: string }>({
    queryKey: queryKeys.peRework.list(),
    queryFn: async () => {
      const r = await fetch("/api/accounting/pe-rework");
      if (!r.ok) throw new Error("Failed to load PE rework analytics");
      return r.json();
    },
    staleTime: 5 * 60 * 1000,
  });
  const [view, setView] = useState<ViewKey>("swaps");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              view === v.key ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40" : "border-t-border text-muted hover:text-foreground"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {isLoading && <div className="text-sm text-muted py-12 text-center">Loading rework data…</div>}
      {isError && (
        <div className="text-sm text-orange-400 py-12 text-center">
          Failed to load. <button onClick={() => refetch()} className="underline">Retry</button>
        </div>
      )}
      {data && (
        <>
          {view === "swaps" && <SwapsView swaps={data.swaps} />}
          {view === "reasons" && <ReasonsView reasons={data.reasons} />}
          {view === "outcomes" && <OutcomesView byReplacer={data.swaps.byReplacer} />}
          {view === "timeline" && <TimelineView timeline={data.timeline} />}
          {data.lastUpdated && <div className="text-[10px] text-muted/60 text-right">Updated {new Date(data.lastUpdated).toLocaleString()}</div>}
        </>
      )}
    </div>
  );
}
