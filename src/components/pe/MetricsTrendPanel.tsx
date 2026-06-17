"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

interface Snap {
  date: string;
  peDeals: number;
  actionable: number;
  inReview: number;
  allDocsApproved: number;
  approvalRate: number | null;
  approved: number;
  notUploaded: number;
  actionRequired: number;
  recordedAt: string;
}

// Value cell with an optional day-over-day delta. `invert` = lower is better
// (so a decrease shows green): actionable / not-uploaded / action-required.
function Cell({ v, delta, invert }: { v: number; delta?: number | null; invert?: boolean }) {
  let cls = "text-muted";
  if (delta != null && delta !== 0) {
    const good = invert ? delta < 0 : delta > 0;
    cls = good ? "text-green-400" : "text-red-400";
  }
  return (
    <td className="px-2 py-1.5 text-right tabular-nums">
      <span className="text-foreground">{v}</span>
      {delta != null && delta !== 0 && (
        <span className={`ml-1 text-[10px] ${cls}`}>{delta > 0 ? `+${delta}` : delta}</span>
      )}
    </td>
  );
}

/** Collapsible daily-snapshot history for the PE Document Tracker cards. */
export default function MetricsTrendPanel() {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery<{ snapshots: Snap[] }>({
    queryKey: ["pe-metrics-snapshots"],
    queryFn: () => fetch("/api/accounting/pe-metrics-snapshot").then((r) => r.json()),
    enabled: open,
    staleTime: 60_000,
  });
  // newest first
  const snaps = [...(data?.snapshots ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  const delta = (cur: number, prev?: number) => (prev == null ? null : cur - prev);

  return (
    <div className="mb-6">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs text-muted hover:text-foreground flex items-center gap-1.5 transition-colors"
      >
        <svg className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-90" : ""}`}
          fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
        </svg>
        Daily trend{snaps.length > 0 ? ` · ${snaps.length} day${snaps.length === 1 ? "" : "s"} recorded` : ""}
      </button>
      {open && (
        <div className="mt-2 rounded-lg border border-t-border bg-surface/30 overflow-x-auto">
          {isLoading ? (
            <div className="p-4 text-xs text-muted">Loading…</div>
          ) : snaps.length === 0 ? (
            <div className="p-4 text-xs text-muted">
              No snapshots yet — recording starts today (one per day, whenever this page is opened). Check back tomorrow to compare.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-muted border-b border-t-border/60">
                  <th className="text-left px-3 py-2 font-medium">Date</th>
                  <th className="text-right px-2 font-medium">PE Deals</th>
                  <th className="text-right px-2 font-medium">Actionable</th>
                  <th className="text-right px-2 font-medium">In Review</th>
                  <th className="text-right px-2 font-medium">Approved</th>
                  <th className="text-right px-2 font-medium">Not Uploaded</th>
                  <th className="text-right px-2 font-medium">Action Req.</th>
                  <th className="text-right px-3 font-medium">Appr. Rate</th>
                </tr>
              </thead>
              <tbody>
                {snaps.map((s, i) => {
                  const prev = snaps[i + 1]; // the older row
                  return (
                    <tr key={s.date} className="border-t border-t-border/30 hover:bg-surface/40">
                      <td className="px-3 py-1.5 text-foreground whitespace-nowrap">{s.date}</td>
                      <Cell v={s.peDeals} />
                      <Cell v={s.actionable} delta={delta(s.actionable, prev?.actionable)} invert />
                      <Cell v={s.inReview} />
                      <Cell v={s.approved} delta={delta(s.approved, prev?.approved)} />
                      <Cell v={s.notUploaded} delta={delta(s.notUploaded, prev?.notUploaded)} invert />
                      <Cell v={s.actionRequired} delta={delta(s.actionRequired, prev?.actionRequired)} invert />
                      <td className="px-3 py-1.5 text-right tabular-nums text-muted">{s.approvalRate == null ? "—" : `${s.approvalRate}%`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
