"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
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
interface DirectoryUser {
  email: string;
  name: string;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const clock = (min: number | null) => {
  if (min == null) return "—";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};
const h1 = (n: number) => n.toFixed(1);
const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

const VERDICT_STYLE: Record<Verdict, string> = {
  marathon: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  "full-day": "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  "full-day / light-app": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  light: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
};

const HEADERS = [
  "Person",
  "Active days",
  "Active/day",
  "Span/day",
  "Interactions/day",
  "Talk (min)",
  "Google span",
  "Start",
  "End",
  "Verdict",
];

/** Shared summary table with expandable per-person daily detail. */
function ActivityTable({
  summaries,
  personDays,
  expanded,
  onToggle,
  onRemove,
  emptyText,
}: {
  summaries: SummaryRow[];
  personDays: DayRow[];
  expanded: string | null;
  onToggle: (email: string) => void;
  onRemove?: (email: string) => void;
  emptyText: string;
}) {
  return (
    <div className="bg-surface border border-t-border rounded-lg overflow-x-auto">
      <table className="w-full text-sm min-w-[860px]">
        <thead>
          <tr className="text-left text-xs text-muted border-b border-t-border">
            {HEADERS.map((h, i) => (
              <th key={h} className={`px-3 py-2 font-medium ${i >= 1 && i <= 8 ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {summaries.map((s) => {
            const open = expanded === s.email;
            const days = personDays.filter((d) => d.email === s.email).sort((a, b) => b.day.localeCompare(a.day));
            return (
              <Fragment key={s.email}>
                <tr
                  onClick={() => onToggle(s.email)}
                  className="border-b border-t-border/50 hover:bg-surface-2 cursor-pointer"
                >
                  <td className="px-3 py-2 font-medium text-foreground">
                    <span className="text-muted mr-1">{open ? "▾" : "▸"}</span>
                    {s.name}
                    {onRemove && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemove(s.email);
                        }}
                        className="ml-2 text-muted hover:text-red-400 text-xs"
                        title="Remove"
                      >
                        ✕
                      </button>
                    )}
                    <span className="block text-[10px] text-muted font-normal">{s.email}</span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {s.weekdayActiveDays}
                    {s.weekendActiveDays > 0 && <span className="text-muted"> +{s.weekendActiveDays}w</span>}
                  </td>
                  <td className="px-3 py-2 text-right">{h1(s.avgActiveHours)}h</td>
                  <td className="px-3 py-2 text-right text-muted">{h1(s.avgSpanHours)}h</td>
                  <td className="px-3 py-2 text-right">{s.avgInteractions.toFixed(0)}</td>
                  <td className="px-3 py-2 text-right">{s.totalTalkMinutes || "—"}</td>
                  <td className="px-3 py-2 text-right text-muted">
                    {s.avgGoogleSpanHours ? `${h1(s.avgGoogleSpanHours)}h` : "—"}
                  </td>
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
                              {["Day", "Events", "Interactions", "Span", "Active", "Talk", "First", "Last", "Sources"].map((h, i) => (
                                <th key={h} className={`px-2 py-1 font-medium ${i >= 1 && i <= 7 ? "text-right" : ""}`}>
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {days.map((d) => (
                              <tr key={d.day} className={d.weekday ? "" : "text-muted"}>
                                <td className="px-2 py-1">
                                  {d.day}
                                  {d.weekday ? "" : " (wknd)"}
                                </td>
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
          {summaries.length === 0 && (
            <tr>
              <td colSpan={10} className="px-3 py-6 text-center text-muted">
                {emptyText}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

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
    if (fromInput === applied.from && toInput === applied.to) refetch();
  };

  // --- Look up anyone (ad-hoc) ---
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<DirectoryUser[]>([]);
  const [extras, setExtras] = useState<{ summary: SummaryRow; days: DayRow[] }[]>([]);
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  // Debounced directory typeahead.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/team-activity/users?q=${encodeURIComponent(q)}`);
        if (!res.ok) return;
        const json = (await res.json()) as { users: DirectoryUser[] };
        if (!cancelled) setMatches(json.users);
      } catch {
        /* ignore */
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  const addPerson = async (email: string) => {
    const e = email.trim().toLowerCase();
    if (!e) return;
    setQuery("");
    setMatches([]);
    if (extras.some((x) => x.summary.email === e)) return; // already added
    setLookingUp(true);
    setLookupError(null);
    try {
      const res = await fetch(`/api/admin/team-activity?from=${applied.from}&to=${applied.to}&emails=${encodeURIComponent(e)}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
      const json = (await res.json()) as ApiResponse;
      const summary = json.summaries[0];
      if (!summary) {
        setLookupError(`No activity found for ${e} in this range.`);
        return;
      }
      setExtras((prev) => [...prev, { summary, days: json.personDays }]);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : String(err));
    } finally {
      setLookingUp(false);
    }
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

      <ActivityTable
        summaries={data?.summaries ?? []}
        personDays={data?.personDays ?? []}
        expanded={expanded}
        onToggle={(email) => setExpanded((cur) => (cur === email ? null : email))}
        emptyText={isFetching ? "Running…" : "No activity in this range."}
      />

      {/* Look up anyone */}
      <div className="mt-8">
        <h3 className="text-sm font-semibold text-foreground mb-1">Look up anyone</h3>
        <p className="text-xs text-muted mb-3">
          Search the directory (or paste an @photonbrothers.com email) to pull anyone&rsquo;s activity for the current date
          range. Added people accumulate below so you can compare.
        </p>
        <div className="relative max-w-md">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && looksLikeEmail(query)) addPerson(query);
            }}
            placeholder="Name or email…"
            className="w-full bg-surface border border-t-border rounded-md px-3 py-2 text-sm text-foreground"
          />
          {matches.length > 0 && (
            <div className="absolute z-10 mt-1 w-full bg-surface-elevated border border-t-border rounded-md shadow-card max-h-72 overflow-y-auto">
              {matches.map((m) => (
                <button
                  key={m.email}
                  onClick={() => addPerson(m.email)}
                  className="block w-full text-left px-3 py-2 text-sm hover:bg-surface-2"
                >
                  <span className="text-foreground">{m.name}</span>
                  <span className="block text-[10px] text-muted">{m.email}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {lookingUp && <p className="text-xs text-muted mt-2">Looking up…</p>}
        {lookupError && <p className="text-xs text-amber-400 mt-2">{lookupError}</p>}

        {extras.length > 0 && (
          <div className="mt-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted">{extras.length} looked up</span>
              <button onClick={() => setExtras([])} className="text-xs text-muted hover:text-red-400">
                Clear all
              </button>
            </div>
            <ActivityTable
              summaries={extras.map((x) => x.summary)}
              personDays={extras.flatMap((x) => x.days)}
              expanded={expanded}
              onToggle={(email) => setExpanded((cur) => (cur === email ? null : email))}
              onRemove={(email) => setExtras((prev) => prev.filter((x) => x.summary.email !== email))}
              emptyText="No one looked up yet."
            />
          </div>
        )}
      </div>

      <p className="text-xs text-muted mt-6">
        Active-hours cap idle gaps at 60 min; interactions dedup repeat touches of the same record within 10 min. Times are
        America/Denver. &ldquo;Verdict&rdquo; is a convenience label, not a judgment — the numbers are the source of truth, and
        activity outside these systems (email/docs, meetings, PTO) is not captured.
      </p>
    </DashboardShell>
  );
}
