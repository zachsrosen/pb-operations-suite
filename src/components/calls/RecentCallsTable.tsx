"use client";

import { formatDateTime, formatSeconds } from "./formatters";

interface Row {
  id: string;
  direction: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationSec: number;
  talkTimeSec: number;
  timeToAnswerSec: number | null;
  userAircallId: string | null;
  userName: string | null;
  customerNumber: string | null;
}

const STATUS_PILL: Record<string, string> = {
  answered: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  missed: "bg-red-500/15 text-red-300 border-red-500/30",
  voicemail: "bg-amber-500/15 text-amber-300 border-amber-500/30",
};

const DIRECTION_PILL: Record<string, string> = {
  inbound: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  outbound: "bg-blue-500/15 text-blue-300 border-blue-500/30",
};

export function RecentCallsTable({
  rows,
  loading,
  page,
  pageSize,
  total,
  onPageChange,
}: {
  rows: Row[];
  loading?: boolean;
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (p: number) => void;
}) {
  if (loading && rows.length === 0) {
    return <div className="h-48 bg-skeleton rounded animate-pulse" />;
  }
  if (rows.length === 0) {
    return <div className="text-sm text-muted py-6 text-center">No calls match these filters.</div>;
  }

  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-t-border text-xs uppercase text-muted">
              <th className="py-2 px-2 text-left">Time</th>
              <th className="py-2 px-2 text-left">Direction</th>
              <th className="py-2 px-2 text-left">Status</th>
              <th className="py-2 px-2 text-left">User</th>
              <th className="py-2 px-2 text-left">Customer</th>
              <th className="py-2 px-2 text-right">Time-to-Answer</th>
              <th className="py-2 px-2 text-right">Duration</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-t-border/40 hover:bg-surface-2/50">
                <td className="py-2 px-2 whitespace-nowrap tabular-nums">{formatDateTime(r.startedAt)}</td>
                <td className="py-2 px-2">
                  <span className={`text-xs px-2 py-0.5 rounded border ${DIRECTION_PILL[r.direction] ?? ""}`}>{r.direction}</span>
                </td>
                <td className="py-2 px-2">
                  <span className={`text-xs px-2 py-0.5 rounded border ${STATUS_PILL[r.status] ?? ""}`}>{r.status}</span>
                </td>
                <td className="py-2 px-2 text-foreground">{r.userName ?? "—"}</td>
                <td className="py-2 px-2 text-muted tabular-nums">{r.customerNumber ?? "—"}</td>
                <td className="py-2 px-2 text-right tabular-nums">{formatSeconds(r.timeToAnswerSec)}</td>
                <td className="py-2 px-2 text-right tabular-nums">{formatSeconds(r.durationSec)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between mt-3 text-xs text-muted">
        <div>
          Page {page} of {lastPage}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            className="px-3 py-1 rounded-md border border-t-border bg-surface-2 disabled:opacity-40 hover:text-foreground"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={page >= lastPage}
            onClick={() => onPageChange(page + 1)}
            className="px-3 py-1 rounded-md border border-t-border bg-surface-2 disabled:opacity-40 hover:text-foreground"
          >
            Next
          </button>
        </div>
      </div>
    </>
  );
}
