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
import {
  DESIGN_FUNNEL_STAGES,
  DESIGN_STAGE_LABELS,
  type DesignFunnelResponse,
  type DesignFunnelStageKey,
  type DesignFunnelDeal,
  type DesignRevisionLoop,
} from "@/lib/design-funnel-aggregation";

const TIMEFRAMES = [
  { label: "3 months", value: 3 },
  { label: "6 months", value: 6 },
  { label: "12 months", value: 12 },
  { label: "24 months", value: 24 },
] as const;

// Per-stage accent for the funnel chain cards.
const STAGE_STYLES: Record<DesignFunnelStageKey, { card: string; text: string }> = {
  enteredDesign: { card: "from-slate-500/20 border-slate-500/30", text: "text-slate-300" },
  daSent: { card: "from-blue-500/20 border-blue-500/30", text: "text-blue-300" },
  daApproved: { card: "from-cyan-500/20 border-cyan-500/30", text: "text-cyan-300" },
  designDrafted: { card: "from-violet-500/20 border-violet-500/30", text: "text-violet-300" },
  designComplete: { card: "from-emerald-500/20 border-emerald-500/30", text: "text-emerald-300" },
};

function pct(numerator: number, denominator: number): string {
  if (!denominator) return "—";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function ageTone(days: number): string {
  if (days >= 21) return "text-red-400";
  if (days >= 10) return "text-amber-400";
  return "text-muted";
}

// ── Funnel chain ─────────────────────────────────────────────────────────────
function FunnelChain({ summary }: { summary: DesignFunnelResponse["summary"] }) {
  const top = summary.enteredDesign.count || 1;
  return (
    <div className="flex flex-wrap items-stretch gap-2">
      {DESIGN_FUNNEL_STAGES.map((key, i) => {
        const stage = summary[key];
        const style = STAGE_STYLES[key];
        const prevKey = i > 0 ? DESIGN_FUNNEL_STAGES[i - 1] : null;
        const prev = prevKey ? summary[prevKey] : null;
        return (
          <div key={key} className="flex items-stretch gap-2">
            {prev && (
              <div className="flex flex-col items-center justify-center px-1 min-w-[44px]">
                <span className="text-muted text-lg leading-none">→</span>
                <span className="text-[11px] font-semibold text-foreground tabular-nums">
                  {pct(stage.count, prev.count)}
                </span>
              </div>
            )}
            <div
              className={`relative bg-gradient-to-br ${style.card} to-transparent border rounded-lg px-4 py-3 min-w-[132px]`}
            >
              <div className="text-2xl font-bold text-foreground tabular-nums leading-none">
                {stage.count}
              </div>
              <div className={`text-xs font-semibold mt-1.5 ${style.text}`}>
                {DESIGN_STAGE_LABELS[key]}
              </div>
              <div className="text-[11px] text-muted mt-0.5 tabular-nums">
                {formatCurrencyCompact(stage.amount)}
                {stage.count > 0 && <span className="text-muted/70"> · {pct(stage.count, top)} of inflow</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Revision loop panel ──────────────────────────────────────────────────────
function RevisionLoopPanel({
  title,
  gate,
  accent,
  loop,
  showCounter,
}: {
  title: string;
  gate: string;
  accent: string;
  loop: DesignRevisionLoop;
  showCounter: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-surface border border-t-border rounded-lg p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={`text-base ${accent}`}>↻</span>
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          </div>
          <p className="text-[11px] text-muted mt-0.5">{gate}</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-foreground tabular-nums leading-none">{loop.inRevisionNow}</div>
          <div className="text-[10px] text-muted uppercase tracking-wide">in revision now</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mt-3">
        {showCounter ? (
          <>
            <Stat label="Avg / DA" value={loop.avgRevisions == null ? "—" : loop.avgRevisions.toFixed(2)} />
            <Stat label="Total revisions" value={loop.totalRevisions} />
            <Stat label="Worst deal" value={loop.maxRevisions ? `${loop.maxRevisions}×` : "—"} />
          </>
        ) : (
          <>
            <Stat label="Deals stuck" value={loop.inRevisionNow} />
            <Stat label="Revenue held" value={formatCurrencyCompact(loop.inRevisionAmount)} />
            <Stat label="Statuses" value={loop.byStatus.length} />
          </>
        )}
      </div>

      {loop.byStatus.length > 0 && (
        <div className="mt-3 space-y-1">
          {loop.byStatus.slice(0, 6).map((s) => (
            <div key={s.status} className="flex items-center gap-2">
              <div className="flex-1 h-4 bg-surface-2 rounded overflow-hidden">
                <div
                  className={`h-full ${accent.replace("text-", "bg-")}/40`}
                  style={{ width: `${(s.count / Math.max(1, loop.inRevisionNow)) * 100}%` }}
                />
              </div>
              <span className="text-[11px] text-muted w-44 truncate" title={s.status}>{s.status}</span>
              <span className="text-[11px] font-semibold text-foreground tabular-nums w-6 text-right">{s.count}</span>
            </div>
          ))}
        </div>
      )}

      {loop.deals.length > 0 && (
        <button
          onClick={() => setOpen((v) => !v)}
          className="mt-3 text-[11px] text-muted hover:text-foreground transition-colors"
        >
          {open ? "Hide" : "Show"} {loop.deals.length} deal{loop.deals.length === 1 ? "" : "s"} stuck in this loop
        </button>
      )}
      {open && (
        <div className="mt-2 max-h-72 overflow-y-auto">
          <DealTable deals={loop.deals} showRevisions={showCounter} />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-surface-2 rounded px-2 py-1.5">
      <div className="text-base font-bold text-foreground tabular-nums leading-none">{value}</div>
      <div className="text-[10px] text-muted mt-0.5">{label}</div>
    </div>
  );
}

// ── Velocity strip ───────────────────────────────────────────────────────────
function VelocityStrip({ medianDays }: { medianDays: DesignFunnelResponse["medianDays"] }) {
  const items: Array<{ label: string; value: number | null }> = [
    { label: "Entered → DA Sent", value: medianDays.enteredToDaSent },
    { label: "DA Sent → Approved", value: medianDays.daSentToApproved },
    { label: "Approved → Drafted", value: medianDays.approvedToDrafted },
    { label: "Drafted → Complete", value: medianDays.draftedToComplete },
    { label: "Approved → Complete", value: medianDays.approvedToComplete },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
      {items.map((it) => (
        <div key={it.label} className="bg-surface border border-t-border rounded-lg px-3 py-2">
          <div className="text-lg font-bold text-foreground tabular-nums leading-none">
            {it.value == null ? "—" : `${it.value}d`}
          </div>
          <div className="text-[10px] text-muted mt-1 leading-tight">{it.label}</div>
        </div>
      ))}
    </div>
  );
}

// ── Backlog bucket ───────────────────────────────────────────────────────────
function BacklogBucket({
  label,
  hint,
  deals,
  showRevisions,
}: {
  label: string;
  hint: string;
  deals: DesignFunnelDeal[];
  showRevisions: boolean;
}) {
  const [open, setOpen] = useState(false);
  const statusBreakdown = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of deals) m.set(d.status || "No status", (m.get(d.status || "No status") || 0) + 1);
    return [...m.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count);
  }, [deals]);
  const amount = deals.reduce((s, d) => s + d.amount, 0);

  return (
    <div className="bg-surface border border-t-border rounded-lg p-4">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between gap-3 text-left">
        <div>
          <div className="text-sm font-semibold text-foreground">{label}</div>
          <div className="text-[11px] text-muted">{hint}</div>
        </div>
        <div className="text-right">
          <div className="text-xl font-bold text-foreground tabular-nums leading-none">{deals.length}</div>
          <div className="text-[10px] text-muted tabular-nums">{formatCurrencyCompact(amount)}</div>
        </div>
      </button>

      {statusBreakdown.length > 0 && (
        <div className="mt-3 space-y-1">
          {statusBreakdown.slice(0, 5).map((s) => (
            <div key={s.status} className="flex items-center gap-2">
              <div className="flex-1 h-3.5 bg-surface-2 rounded overflow-hidden">
                <div className="h-full bg-blue-500/40" style={{ width: `${(s.count / Math.max(1, deals.length)) * 100}%` }} />
              </div>
              <span className="text-[11px] text-muted w-44 truncate" title={s.status}>{s.status}</span>
              <span className="text-[11px] font-semibold text-foreground tabular-nums w-6 text-right">{s.count}</span>
            </div>
          ))}
        </div>
      )}

      {deals.length > 0 && (
        <button
          onClick={() => setOpen((v) => !v)}
          className="mt-3 text-[11px] text-muted hover:text-foreground transition-colors"
        >
          {open ? "Hide" : "Show"} deals
        </button>
      )}
      {open && (
        <div className="mt-2 max-h-80 overflow-y-auto">
          <DealTable deals={deals} showRevisions={showRevisions} />
        </div>
      )}
    </div>
  );
}

function DealTable({ deals, showRevisions }: { deals: DesignFunnelDeal[]; showRevisions: boolean }) {
  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className="text-muted border-b border-t-border">
          <th className="text-left font-medium py-1 pr-2">Project</th>
          <th className="text-left font-medium py-1 pr-2">Status</th>
          <th className="text-left font-medium py-1 pr-2 hidden sm:table-cell">Design Lead</th>
          {showRevisions && <th className="text-right font-medium py-1 pr-2">Rev</th>}
          <th className="text-right font-medium py-1">Days</th>
        </tr>
      </thead>
      <tbody>
        {deals.map((d) => (
          <tr key={d.id} className="border-b border-t-border/50 hover:bg-surface-2">
            <td className="py-1 pr-2">
              <a href={d.url} target="_blank" rel="noreferrer" className="text-foreground hover:text-blue-400">
                {d.projectNumber || d.name}
              </a>
              <span className="text-muted"> · {d.pbLocation}</span>
              {d.flag && (
                <span
                  className={`ml-1 px-1 rounded text-[9px] ${
                    d.flag.tone === "red"
                      ? "bg-red-500/20 text-red-300"
                      : d.flag.tone === "orange"
                        ? "bg-orange-500/20 text-orange-300"
                        : "bg-yellow-500/20 text-yellow-300"
                  }`}
                  title={d.flag.reason || undefined}
                >
                  {d.flag.label}
                </span>
              )}
            </td>
            <td className="py-1 pr-2 text-muted truncate max-w-[160px]" title={d.status || ""}>{d.status || "—"}</td>
            <td className="py-1 pr-2 text-muted hidden sm:table-cell truncate max-w-[120px]">{d.designLead || "—"}</td>
            {showRevisions && (
              <td className="py-1 pr-2 text-right tabular-nums">
                {d.revisionCount > 0 ? <span className="text-amber-400 font-semibold">{d.revisionCount}×</span> : <span className="text-muted">—</span>}
              </td>
            )}
            <td className={`py-1 text-right tabular-nums font-semibold ${d.flag?.parked ? "text-muted/50" : ageTone(d.daysWaiting)}`}>
              {d.daysWaiting}d
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Status depth ─────────────────────────────────────────────────────────────
function StatusDepth({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ status: string; count: number; amount: number }>;
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="bg-surface border border-t-border rounded-lg p-4">
      <h3 className="text-sm font-semibold text-foreground mb-3">{title}</h3>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.status} className="flex items-center gap-2">
            <span className="text-[11px] text-muted w-48 truncate" title={r.status}>{r.status}</span>
            <div className="flex-1 h-4 bg-surface-2 rounded overflow-hidden">
              <div className="h-full bg-violet-500/40" style={{ width: `${(r.count / max) * 100}%` }} />
            </div>
            <span className="text-[11px] font-semibold text-foreground tabular-nums w-7 text-right">{r.count}</span>
          </div>
        ))}
        {rows.length === 0 && <p className="text-[11px] text-muted">No deals in this status group.</p>}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function DesignEngineeringFunnelPage() {
  const [months, setMonths] = useState(6);
  const [scope, setScope] = useState<"active" | "cohort">("active");
  const [locations, setLocations] = useState<string[]>([]);
  const [leads, setLeads] = useState<string[]>([]);
  const [pms, setPms] = useState<string[]>([]);

  const { data, isLoading, error, dataUpdatedAt, refetch } = useQuery<DesignFunnelResponse>({
    queryKey: queryKeys.funnel.designFunnel(months, locations, scope, leads, pms),
    queryFn: async () => {
      const params = new URLSearchParams({ months: String(months), scope });
      if (locations.length > 0) params.set("locations", locations.join(","));
      if (leads.length > 0) params.set("leads", leads.join(","));
      if (pms.length > 0) params.set("pms", pms.join(","));
      const res = await fetch(`/api/deals/design-funnel?${params}`);
      if (!res.ok) throw new Error("Failed to fetch design funnel data");
      return res.json();
    },
    refetchInterval: 5 * 60 * 1000,
  });

  useSSE(() => refetch(), { cacheKeyFilter: "funnel" });

  const locationOptions = useMemo(
    () => CANONICAL_LOCATIONS.map((loc) => ({ value: loc, label: loc })),
    []
  );
  const leadOptions = useMemo(
    () => (data?.filterOptions.designLeads || []).map((v) => ({ value: v, label: v })),
    [data]
  );
  const pmOptions = useMemo(
    () => (data?.filterOptions.projectManagers || []).map((v) => ({ value: v, label: v })),
    [data]
  );

  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : null;

  return (
    <DashboardShell title="Design & Engineering Funnel" accentColor="purple" lastUpdated={lastUpdated} fullWidth>
      <div className="space-y-5">
        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-lg border border-t-border overflow-hidden">
            {(["active", "cohort"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  scope === s ? "bg-purple-500/20 text-foreground" : "text-muted hover:text-foreground"
                }`}
              >
                {s === "active" ? "Active Pipeline" : "By Cohort"}
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
          <MultiSelectFilter label="Design Lead" options={leadOptions} selected={leads} onChange={setLeads} />
          <MultiSelectFilter label="Project Mgr" options={pmOptions} selected={pms} onChange={setPms} />
        </div>

        {error ? (
          <ErrorState message="Failed to load the design funnel." onRetry={() => refetch()} />
        ) : isLoading || !data ? (
          <div className="py-20 flex justify-center"><LoadingSpinner /></div>
        ) : (
          <>
            {/* Chain */}
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">
                Design production chain
                {scope === "active" ? " — live pipeline" : ` — closed last ${months} mo`}
              </h2>
              <FunnelChain summary={data.summary} />
            </section>

            {/* Revision loops */}
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Revision loops</h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <RevisionLoopPanel
                  title="DA Revision Loop"
                  gate="Bouncing between DA Sent and DA Approved"
                  accent="text-amber-400"
                  loop={data.daLoop}
                  showCounter
                />
                <RevisionLoopPanel
                  title="Design Revision Loop"
                  gate="Rejected / clarification / IDR revisions before Design Complete"
                  accent="text-rose-400"
                  loop={data.designLoop}
                  showCounter={false}
                />
              </div>
            </section>

            {/* Velocity */}
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Median time in stage</h2>
              <VelocityStrip medianDays={data.medianDays} />
            </section>

            {/* Backlog */}
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Backlog by gate</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <BacklogBucket
                  label="Awaiting DA Send"
                  hint="In design, no DA sent yet"
                  deals={data.drillDown.awaitingDaSend}
                  showRevisions
                />
                <BacklogBucket
                  label="Awaiting DA Approval"
                  hint="DA sent, waiting on customer approval"
                  deals={data.drillDown.awaitingDaApproval}
                  showRevisions
                />
                <BacklogBucket
                  label="Awaiting Design Draft"
                  hint="DA approved, permit-set not drafted"
                  deals={data.drillDown.awaitingDesignDraft}
                  showRevisions={false}
                />
                <BacklogBucket
                  label="Awaiting Design Complete"
                  hint="Drafted, in review / stamping"
                  deals={data.drillDown.awaitingDesignComplete}
                  showRevisions={false}
                />
              </div>
            </section>

            {/* Status depth */}
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">
                Status depth — in-design deals
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <StatusDepth title="By design status" rows={data.designStatusDepth} />
                <StatusDepth title="By DA / layout status" rows={data.layoutStatusDepth} />
              </div>
            </section>
          </>
        )}
      </div>
    </DashboardShell>
  );
}
