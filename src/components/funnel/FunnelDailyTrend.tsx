"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type { ProjectFunnelResponse, ProjectMonthlyActivity } from "@/lib/project-funnel-aggregation";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (d: string) => {
  const [, m, day] = d.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${day}`;
};

// Daily milestone throughput columns (events that happened that day).
const THROUGHPUT_COLS: { key: keyof ProjectMonthlyActivity; label: string }[] = [
  { key: "salesClosed", label: "Sold" },
  { key: "surveysCompleted", label: "Survey" },
  { key: "dasSent", label: "DA Sent" },
  { key: "dasApproved", label: "DA Appr" },
  { key: "designsCompleted", label: "Design" },
  { key: "permitsSubmitted", label: "Permit Sub" },
  { key: "permitsIssued", label: "Permit Iss" },
  { key: "constructionsScheduled", label: "Const Sched" },
  { key: "constructionsComplete", label: "Const Done" },
  { key: "inspectionsPassed", label: "Inspect" },
  { key: "ptosGranted", label: "PTO" },
  { key: "closedOut", label: "Closed" },
];

// Recorded point-in-time backlog columns, keyed by drill-down bucket.
const BUCKET_COLS: { key: string; label: string }[] = [
  { key: "awaitingSurveySchedule", label: "Survey Sched" },
  { key: "awaitingSurvey", label: "Survey Done" },
  { key: "awaitingDaSend", label: "DA Send" },
  { key: "awaitingApproval", label: "DA Appr" },
  { key: "awaitingDesignComplete", label: "Design" },
  { key: "awaitingPermitSubmit", label: "Permit Sub" },
  { key: "awaitingPermitIssue", label: "Permit Iss" },
  { key: "awaitingReadyToBuild", label: "Ready to Build" },
  { key: "awaitingConstructionSchedule", label: "Const Sched" },
  { key: "awaitingConstructionComplete", label: "Const Done" },
  { key: "awaitingInspection", label: "Inspect" },
  { key: "awaitingPto", label: "PTO" },
  { key: "awaitingCloseOut", label: "Close Out" },
];

interface Snap {
  date: string;
  counts: Record<string, number>;
  recordedAt: string;
}

/** Daily trend for the project pipeline funnel: instant event throughput (from
 * milestone dates) + recorded point-in-time backlog state (accrues forward). */
export default function FunnelDailyTrend() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"throughput" | "recorded">("throughput");
  const postedRef = useRef(false);

  // Active-scope funnel: trailing-90d dailyActivity + current backlog counts.
  const { data } = useQuery<ProjectFunnelResponse>({
    queryKey: [...queryKeys.funnel.root, "daily-trend-active"],
    queryFn: async () => {
      const res = await fetch("/api/deals/project-funnel?scope=active");
      if (!res.ok) throw new Error("Failed to fetch funnel data");
      return res.json();
    },
    refetchInterval: 10 * 60 * 1000,
  });

  // Record today's point-in-time backlog snapshot once we have data (idempotent
  // per day server-side), so the recorded-state trend builds going forward.
  useEffect(() => {
    if (!data?.drillDown || postedRef.current) return;
    postedRef.current = true;
    const dd = data.drillDown as unknown as Record<string, unknown[]>;
    const counts: Record<string, number> = {};
    for (const { key } of BUCKET_COLS) counts[key] = Array.isArray(dd[key]) ? dd[key].length : 0;
    const date = new Date().toISOString().slice(0, 10);
    fetch("/api/deals/funnel-metrics-snapshot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, counts }),
    }).catch(() => {});
  }, [data]);

  const { data: snapData, isLoading: snapsLoading } = useQuery<{ snapshots: Snap[] }>({
    queryKey: ["funnel-metrics-snapshots"],
    queryFn: () => fetch("/api/deals/funnel-metrics-snapshot").then((r) => r.json()),
    enabled: open && view === "recorded",
    staleTime: 60_000,
  });

  // dailyActivity comes newest-first from the API; show the most recent 45 days.
  const days = useMemo(() => (data?.dailyActivity ?? []).slice(0, 45), [data]);
  const snaps = useMemo(
    () => [...(snapData?.snapshots ?? [])].sort((a, b) => b.date.localeCompare(a.date)),
    [snapData]
  );

  return (
    <div className="bg-surface rounded-xl border border-t-border p-5 mb-6">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-sm font-semibold text-foreground/80 hover:text-foreground flex items-center gap-1.5 transition-colors"
      >
        <span className={`text-[11px] text-muted transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
        Daily Trend
      </button>
      <p className="text-[11px] text-muted mt-1">
        Milestone throughput per day (live history) and recorded pipeline backlog state (builds going forward).
      </p>

      {open && (
        <div className="mt-4">
          <div className="flex rounded-lg border border-t-border overflow-hidden text-xs w-fit mb-3">
            {(["throughput", "recorded"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`px-3 py-1.5 transition-colors ${view === v ? "bg-emerald-500 text-white" : "bg-surface text-muted hover:text-foreground"}`}
              >
                {v === "throughput" ? "Throughput / day" : "Recorded state"}
              </button>
            ))}
          </div>

          {view === "throughput" ? (
            days.length === 0 ? (
              <p className="text-xs text-muted/60 italic">No milestone activity in the last 90 days.</p>
            ) : (
              <div className="overflow-x-auto max-h-[28rem]">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-surface">
                    <tr className="text-muted border-b border-t-border">
                      <th className="text-left font-medium py-1.5 pr-3 sticky left-0 bg-surface">Day</th>
                      {THROUGHPUT_COLS.map((c) => (
                        <th key={c.key} className="text-right font-medium py-1.5 px-2 whitespace-nowrap">{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {days.map((row) => (
                      <tr key={row.month} className="border-b border-t-border/40 hover:bg-surface-2/40">
                        <td className="py-1 pr-3 text-foreground/80 whitespace-nowrap sticky left-0 bg-surface">{dayLabel(row.month)}</td>
                        {THROUGHPUT_COLS.map((c) => {
                          const v = row[c.key] as number;
                          return (
                            <td key={c.key} className={`py-1 px-2 text-right tabular-nums ${v > 0 ? "text-foreground" : "text-muted/30"}`}>
                              {v > 0 ? v : "·"}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : snapsLoading ? (
            <p className="text-xs text-muted/60 italic">Loading…</p>
          ) : snaps.length === 0 ? (
            <p className="text-xs text-muted">
              No snapshots yet — recording starts today (one per day, whenever this page is opened). Check back tomorrow to compare.
            </p>
          ) : (
            <div className="overflow-x-auto max-h-[28rem]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-surface">
                  <tr className="text-muted border-b border-t-border">
                    <th className="text-left font-medium py-1.5 pr-3 sticky left-0 bg-surface">Day</th>
                    {BUCKET_COLS.map((c) => (
                      <th key={c.key} className="text-right font-medium py-1.5 px-2 whitespace-nowrap">{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {snaps.map((s, i) => {
                    const prev = snaps[i + 1]; // older day
                    return (
                      <tr key={s.date} className="border-b border-t-border/40 hover:bg-surface-2/40">
                        <td className="py-1 pr-3 text-foreground/80 whitespace-nowrap sticky left-0 bg-surface">{dayLabel(s.date)}</td>
                        {BUCKET_COLS.map((c) => {
                          const v = s.counts[c.key] ?? 0;
                          const d = prev ? v - (prev.counts[c.key] ?? 0) : null;
                          return (
                            <td key={c.key} className="py-1 px-2 text-right tabular-nums">
                              <span className={v > 0 ? "text-foreground" : "text-muted/30"}>{v > 0 ? v : "·"}</span>
                              {d != null && d !== 0 && (
                                <span className={`ml-1 text-[10px] ${d > 0 ? "text-red-400" : "text-green-400"}`}>
                                  {d > 0 ? `+${d}` : d}
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
          )}
        </div>
      )}
    </div>
  );
}
