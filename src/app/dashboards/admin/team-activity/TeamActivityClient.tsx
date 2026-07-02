"use client";

import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import DashboardShell from "@/components/DashboardShell";
import type { PersonSummary, PersonDayMetric, Verdict } from "@/lib/team-activity/metrics";

interface SummaryRow extends PersonSummary {
  name: string;
}
interface DayRow extends PersonDayMetric {
  name: string;
}
interface ApiResponse {
  range: { from: string; to: string };
  sources: { ran: { source: string; events: number }[]; skipped: { source: string; reason: string }[] };
  totalEvents: number;
  summaries: SummaryRow[];
  personDays: DayRow[];
  lastUpdated: string;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const clock = (min: number | null) => {
  if (min == null) return "—";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};
const h1 = (n: number) => n.toFixed(1);

const VERDICT_STYLE: Record<Verdict, string> = {
  marathon: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  "full-day": "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  "full-day / light-app": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  light: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
};

export default function TeamActivityClient() {
  const today = useMemo(() => new Date(), []);
  const defaultFrom = useMemo(() => new Date(today.getTime() - 14 * 86_400_000), [today]);

  const [fromInput, setFromInput] = useState(isoDay(defaultFrom));
  const [toInput, setToInput] = useState(isoDay(today));
  const [applied, setApplied] = useState({ from: isoDay(defaultFrom), to: isoDay(today) });
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isFetching, error, refetch } = useQuery<ApiResponse>({
    queryKey: ["team-activity", applied.from, applied.to],
    queryFn: async () => {
      const res = await fetch(`/api/admin/team-activity?from=${applied.from}&to=${applied.to}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
      return res.json();
    },
  });

  const run = () => {
    setApplied({ from: fromInput, to: toInput });
    setExpanded(null);
    // If the range didn't change, force a refetch anyway.
    if (fromInput === applied.from && toInput === applied.to) refetch();
  };

  const exportRows = (data?.summaries ?? []).map((s) => ({
    name: s.name,
    email: s.email,
    activeWeekdays: s.weekdayActiveDays,
    avgActiveHours: h1(s.avgActiveHours),
    avgSpanHours: h1(s.avgSpanHours),
    avgInteractions: s.avgInteractions.toFixed(0),
    avgEvents: s.avgEvents.toFixed(0),
    avgGoogleSpanHours: h1(s.avgGoogleSpanHours),
    totalTalkMinutes: s.totalTalkMinutes,
    totalCalls: s.totalCalls,
    avgStart: clock(s.avgStartMinute),
    avgEnd: clock(s.avgEndMinute),
    verdict: s.verdict,
  }));

  return (
    <DashboardShell
      title="Team Activity"
      accentColor="purple"
      lastUpdated={data?.lastUpdated}
      exportData={{ data: exportRows, filename: `team-activity-${applied.from}_${applied.to}.csv` }}
      fullWidth
    >
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <label className="flex flex-col text-xs text-muted gap-1">
          From
          <input
            type="date"
            value={fromInput}
            max={toInput}
            onChange={(e) => setFromInput(e.target.value)}
            className="bg-surface border border-t-border rounded-md px-2 py-1.5 text-sm text-foreground"
          />
        </label>
        <label className="flex flex-col text-xs text-muted gap-1">
          To
          <input
            type="date"
            value={toInput}
            min={fromInput}
            max={isoDay(today)}
            onChange={(e) => setToInput(e.target.value)}
            className="bg-surface border border-t-border rounded-md px-2 py-1.5 text-sm text-foreground"
          />
        </label>
        <button
          onClick={run}
          disabled={isFetching}
          className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-sm font-medium rounded-md px-4 py-2 transition-colors"
        >
          {isFetching ? "Running…" : "Run"}
        </button>
        {data && (
          <span className="text-xs text-muted self-center">
            {data.totalEvents.toLocaleString()} events · {data.summaries.length} people
          </span>
        )}
      </div>

      {/* Source status */}
      {data && (
        <div className="flex flex-wrap gap-2 mb-4">
          {data.sources.ran.map((s) => (
            <span
              key={s.source}
              className="text-xs px-2 py-1 rounded-md border bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
            >
              {s.source} · {s.events.toLocaleString()} events
            </span>
          ))}
          {data.sources.skipped.map((s) => (
            <span
              key={s.source}
              title={s.reason}
              className="text-xs px-2 py-1 rounded-md border bg-amber-500/10 text-amber-300 border-amber-500/30 cursor-help"
            >
              {s.source} skipped ⓘ
            </span>
          ))}
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg p-4 text-sm mb-4">
          {(error as Error).message}
        </div>
      )}

      {/* Summary table */}
      <div className="bg-surface border border-t-border rounded-lg overflow-x-auto">
        <table className="w-full text-sm min-w-[860px]">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-t-border">
              <th className="px-3 py-2 font-medium">Person</th>
              <th className="px-3 py-2 font-medium text-right">Active days</th>
              <th className="px-3 py-2 font-medium text-right">Active/day</th>
              <th className="px-3 py-2 font-medium text-right">Span/day</th>
              <th className="px-3 py-2 font-medium text-right">Interactions/day</th>
              <th className="px-3 py-2 font-medium text-right">Talk (min)</th>
              <th className="px-3 py-2 font-medium text-right">Google span</th>
              <th className="px-3 py-2 font-medium text-right">Start</th>
              <th className="px-3 py-2 font-medium text-right">End</th>
              <th className="px-3 py-2 font-medium">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {(data?.summaries ?? []).map((s) => {
              const open = expanded === s.email;
              const days = (data?.personDays ?? [])
                .filter((d) => d.email === s.email)
                .sort((a, b) => b.day.localeCompare(a.day));
              return (
                <Fragment key={s.email}>
                  <tr
                    onClick={() => setExpanded(open ? null : s.email)}
                    className="border-b border-t-border/50 hover:bg-surface-2 cursor-pointer"
                  >
                    <td className="px-3 py-2 font-medium text-foreground">
                      <span className="text-muted mr-1">{open ? "▾" : "▸"}</span>
                      {s.name}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {s.weekdayActiveDays}
                      {s.weekendActiveDays > 0 && <span className="text-muted"> +{s.weekendActiveDays}w</span>}
                    </td>
                    <td className="px-3 py-2 text-right">{h1(s.avgActiveHours)}h</td>
                    <td className="px-3 py-2 text-right text-muted">{h1(s.avgSpanHours)}h</td>
                    <td className="px-3 py-2 text-right">{s.avgInteractions.toFixed(0)}</td>
                    <td className="px-3 py-2 text-right">{s.totalTalkMinutes || "—"}</td>
                    <td className="px-3 py-2 text-right text-muted">{s.avgGoogleSpanHours ? `${h1(s.avgGoogleSpanHours)}h` : "—"}</td>
                    <td className="px-3 py-2 text-right text-muted">{clock(s.avgStartMinute)}</td>
                    <td className="px-3 py-2 text-right text-muted">{clock(s.avgEndMinute)}</td>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded border ${VERDICT_STYLE[s.verdict]}`}>{s.verdict}</span>
                    </td>
                  </tr>
                  {open && (
                    <tr className="bg-surface-2/50">
                      <td colSpan={10} className="px-3 py-3">
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs min-w-[720px]">
                            <thead>
                              <tr className="text-left text-muted">
                                <th className="px-2 py-1 font-medium">Day</th>
                                <th className="px-2 py-1 font-medium text-right">Events</th>
                                <th className="px-2 py-1 font-medium text-right">Interactions</th>
                                <th className="px-2 py-1 font-medium text-right">Span</th>
                                <th className="px-2 py-1 font-medium text-right">Active</th>
                                <th className="px-2 py-1 font-medium text-right">Talk</th>
                                <th className="px-2 py-1 font-medium text-right">First</th>
                                <th className="px-2 py-1 font-medium text-right">Last</th>
                                <th className="px-2 py-1 font-medium">Sources</th>
                              </tr>
                            </thead>
                            <tbody>
                              {days.map((d) => (
                                <tr key={d.day} className={d.weekday ? "" : "text-muted"}>
                                  <td className="px-2 py-1">{d.day}{d.weekday ? "" : " (wknd)"}</td>
                                  <td className="px-2 py-1 text-right">{d.eventCount}</td>
                                  <td className="px-2 py-1 text-right">{d.interactions}</td>
                                  <td className="px-2 py-1 text-right">{h1(d.spanHours)}h</td>
                                  <td className="px-2 py-1 text-right">{h1(d.activeHours)}h</td>
                                  <td className="px-2 py-1 text-right">{d.talkMinutes || "—"}</td>
                                  <td className="px-2 py-1 text-right">{clock(d.firstMinute)}</td>
                                  <td className="px-2 py-1 text-right">{clock(d.lastMinute)}</td>
                                  <td className="px-2 py-1">
                                    {(["pbops", "aircall", "zuper", "hubspot", "google"] as const)
                                      .filter((k) => d.perSource[k] > 0)
                                      .map((k) => `${k}:${d.perSource[k]}`)
                                      .join("  ") || "—"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {data && data.summaries.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-muted">
                  No activity in this range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted mt-3">
        Active-hours cap idle gaps at 60 min; interactions dedup repeat touches of the same record within 10 min. Times are
        America/Denver. &ldquo;Verdict&rdquo; is a convenience label, not a judgment — the numbers are the source of truth, and
        activity outside these systems (email/docs, meetings, PTO) is not captured.
      </p>
    </DashboardShell>
  );
}
