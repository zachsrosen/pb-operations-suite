"use client";

import { useMemo, useState } from "react";

import { formatDateTime, formatPercent, formatSeconds } from "./formatters";

interface Row {
  aircallUserId: string;
  name: string;
  email: string | null;
  totalCalls: number;
  inbound: number;
  outbound: number;
  talkTimeSec: number;
  missed: number;
  answerRate: number;
  avgTimeToAnswerSec: number | null;
  avgDurationSec: number;
  lastActivityAt: string | null;
}

type SortKey =
  | "name"
  | "totalCalls"
  | "inbound"
  | "outbound"
  | "talkTimeSec"
  | "missed"
  | "answerRate"
  | "avgTimeToAnswerSec"
  | "avgDurationSec"
  | "lastActivityAt";

const COLUMNS: Array<{ key: SortKey; label: string; align?: "left" | "right" }> = [
  { key: "name", label: "User", align: "left" },
  { key: "totalCalls", label: "Total", align: "right" },
  { key: "inbound", label: "In", align: "right" },
  { key: "outbound", label: "Out", align: "right" },
  { key: "talkTimeSec", label: "Talk Time", align: "right" },
  { key: "missed", label: "Missed", align: "right" },
  { key: "answerRate", label: "Answer Rate", align: "right" },
  { key: "avgTimeToAnswerSec", label: "Avg Time-to-Answer", align: "right" },
  { key: "avgDurationSec", label: "Avg Duration", align: "right" },
  { key: "lastActivityAt", label: "Last Activity", align: "right" },
];

export function PerUserTable({ rows, loading }: { rows: Row[]; loading?: boolean }) {
  const [sortKey, setSortKey] = useState<SortKey>("totalCalls");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const an = typeof av === "number" ? av : av == null ? -1 : NaN;
      const bn = typeof bv === "number" ? bv : bv == null ? -1 : NaN;
      let cmp: number;
      if (Number.isNaN(an) || Number.isNaN(bn)) {
        cmp = String(av ?? "").localeCompare(String(bv ?? ""));
      } else {
        cmp = an - bn;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  if (loading && rows.length === 0) {
    return <div className="h-48 bg-skeleton rounded animate-pulse" />;
  }
  if (rows.length === 0) {
    return <div className="text-sm text-muted py-6 text-center">No calls in this range.</div>;
  }

  const onSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-t-border text-xs uppercase text-muted">
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                className={`py-2 px-2 cursor-pointer select-none whitespace-nowrap ${c.align === "right" ? "text-right" : "text-left"}`}
                onClick={() => onSort(c.key)}
              >
                {c.label}
                {sortKey === c.key ? <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.aircallUserId || r.name} className="border-b border-t-border/40 hover:bg-surface-2/50">
              <td className="py-2 px-2 text-foreground">
                <div className="font-medium">{r.name}</div>
                {r.email ? <div className="text-xs text-muted">{r.email}</div> : null}
              </td>
              <td className="py-2 px-2 text-right tabular-nums">{r.totalCalls.toLocaleString()}</td>
              <td className="py-2 px-2 text-right tabular-nums">{r.inbound.toLocaleString()}</td>
              <td className="py-2 px-2 text-right tabular-nums">{r.outbound.toLocaleString()}</td>
              <td className="py-2 px-2 text-right tabular-nums">{formatSeconds(r.talkTimeSec)}</td>
              <td className="py-2 px-2 text-right tabular-nums">{r.missed.toLocaleString()}</td>
              <td className="py-2 px-2 text-right tabular-nums">{formatPercent(r.answerRate)}</td>
              <td className="py-2 px-2 text-right tabular-nums">{formatSeconds(r.avgTimeToAnswerSec)}</td>
              <td className="py-2 px-2 text-right tabular-nums">{formatSeconds(r.avgDurationSec)}</td>
              <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">
                {r.lastActivityAt ? formatDateTime(r.lastActivityAt) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
