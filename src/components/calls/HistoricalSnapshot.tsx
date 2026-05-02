"use client";

import { useQuery } from "@tanstack/react-query";

import { formatPercent } from "./formatters";

interface SnapshotRow {
  userAircallId: string;
  userName: string | null;
  ringTotal: number;
  ringPickedUp: number;
  ringNotPickedUp: number;
  answerRate: number;
}

interface SnapshotResponse {
  snapshot: {
    periodStart: string;
    periodEnd: string;
    importedAt: string;
    importedBy: string | null;
    rows: SnapshotRow[];
  } | null;
}

function formatPeriod(start: string, end: string): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  return `${fmt(start)} → ${fmt(end)}`;
}

export function HistoricalSnapshot() {
  const q = useQuery<SnapshotResponse>({
    queryKey: ["aircall:analytics-summary"],
    queryFn: async () => {
      const res = await fetch("/api/aircall/analytics-summary");
      if (!res.ok) throw new Error("Failed to load analytics summary");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  if (q.isLoading) {
    return <div className="h-32 bg-skeleton rounded animate-pulse" />;
  }
  if (!q.data?.snapshot) {
    return (
      <div className="text-sm text-muted py-6 text-center">
        No imported snapshot yet. Export <code className="font-mono">ringing_attempts_per_user.csv</code> from Aircall Analytics+ → User Activity+ and POST it to{" "}
        <code className="font-mono">/api/admin/aircall/analytics-import</code>.
      </div>
    );
  }
  const snap = q.data.snapshot;
  const totals = snap.rows.reduce(
    (acc, r) => ({ total: acc.total + r.ringTotal, picked: acc.picked + r.ringPickedUp, missed: acc.missed + r.ringNotPickedUp }),
    { total: 0, picked: 0, missed: 0 },
  );
  const teamRate = totals.total > 0 ? totals.picked / totals.total : 0;

  return (
    <div>
      <div className="text-xs text-muted mb-3">
        Imported snapshot for {formatPeriod(snap.periodStart, snap.periodEnd)}
        {" · "}
        last refreshed {new Date(snap.importedAt).toLocaleString()}
        {snap.importedBy ? ` by ${snap.importedBy}` : ""}
        {" · "}
        team answer rate <span className="text-foreground tabular-nums">{formatPercent(teamRate)}</span>{" "}
        ({totals.picked.toLocaleString()} / {totals.total.toLocaleString()})
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-t-border text-xs uppercase text-muted">
              <th className="py-2 px-2 text-left">User</th>
              <th className="py-2 px-2 text-right">Rings</th>
              <th className="py-2 px-2 text-right">Picked Up</th>
              <th className="py-2 px-2 text-right">Missed</th>
              <th className="py-2 px-2 text-right">Answer Rate</th>
            </tr>
          </thead>
          <tbody>
            {snap.rows.map((r) => (
              <tr key={r.userAircallId} className="border-b border-t-border/40 hover:bg-surface-2/50">
                <td className="py-2 px-2 text-foreground">{r.userName ?? r.userAircallId}</td>
                <td className="py-2 px-2 text-right tabular-nums">{r.ringTotal.toLocaleString()}</td>
                <td className="py-2 px-2 text-right tabular-nums">{r.ringPickedUp.toLocaleString()}</td>
                <td className="py-2 px-2 text-right tabular-nums">{r.ringNotPickedUp.toLocaleString()}</td>
                <td className="py-2 px-2 text-right tabular-nums">{formatPercent(r.answerRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
