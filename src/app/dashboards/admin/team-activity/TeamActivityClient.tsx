"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import DashboardShell from "@/components/DashboardShell";
import type { PersonSummary, PersonDayMetric, Verdict, ActivitySource } from "@/lib/team-activity/metrics";

const ALL_SOURCES: ActivitySource[] = ["pbops", "aircall", "zuper", "hubspot", "google", "pe"];
const SOURCE_LABEL: Record<ActivitySource, string> = {
  pbops: "PB Tech Ops",
  aircall: "Aircall",
  zuper: "Zuper",
  hubspot: "HubSpot",
  google: "Google",
  pe: "Participate",
};
// Status chips can also carry the PTO feed, which is not an event source.
const CHIP_LABEL: Record<string, string> = { ...SOURCE_LABEL, pto: "PTO (calendar OOO)" };

interface SummaryRow extends PersonSummary {
  name: string;
}
interface DayRow extends PersonDayMetric {
  name: string;
}
interface ApiResponse {
  range: { from: string; to: string };
  sources: { ran: { source: string; events: number; warning?: string }[]; skipped: { source: string; reason: string }[] };
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
  "Deals/day",
  "Talk (min)",
  "Google span",
  "Start",
  "End",
  "Verdict",
];

interface DrillEvent {
  ts: string;
  source: ActivitySource;
  kind: string | null;
  objectKey: string | null;
  label: string | null;
}
const drillTimeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/Denver",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Shared summary table with expandable per-person daily detail + per-day drilldown. */
function ActivityTable({
  summaries,
  personDays,
  onRemove,
  emptyText,
  only,
}: {
  summaries: SummaryRow[];
  personDays: DayRow[];
  onRemove?: (email: string) => void;
  emptyText: string;
  only: string;
}) {
  // Expand state is per-table so a person present in both the roster and the
  // lookup tables expands independently (was shared, which cross-opened rows).
  const [expanded, setExpanded] = useState<string | null>(null);
  const [drill, setDrill] = useState<{ key: string; loading: boolean; error: string | null; events: DrillEvent[] } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);

  const copyEvents = async (title: string, events: DrillEvent[]) => {
    const lines = [
      title,
      ...events.map((ev) =>
        [drillTimeFmt.format(new Date(ev.ts)), SOURCE_LABEL[ev.source], ev.kind ?? "", ev.label ?? ev.objectKey ?? ""]
          .join("\t")
          .replace(/\t+$/, ""),
      ),
    ];
    const text = lines.join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* no-op */
      }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const openDrill = async (email: string, day: string) => {
    const key = `${email}|${day}`;
    if (drill?.key === key) {
      setDrill(null);
      return;
    }
    setDrill({ key, loading: true, error: null, events: [] });
    try {
      const res = await fetch(
        `/api/admin/team-activity/events?email=${encodeURIComponent(email)}&day=${day}&only=${only}`,
      );
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
      const json = (await res.json()) as { events: DrillEvent[] };
      setDrill({ key, loading: false, error: null, events: json.events });
    } catch (err) {
      setDrill({ key, loading: false, error: err instanceof Error ? err.message : String(err), events: [] });
    }
  };

  return (
    <div className="bg-surface border border-t-border rounded-lg overflow-x-auto">
      <table className="w-full text-sm min-w-[860px]">
        <thead>
          <tr className="text-left text-xs text-muted border-b border-t-border">
            {HEADERS.map((h, i) => (
              <th key={h} className={`px-3 py-2 font-medium ${i >= 1 && i <= 9 ? "text-right" : ""}`}>
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
                  onClick={() => setExpanded((cur) => (cur === s.email ? null : s.email))}
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
                    {s.ptoDays > 0 && <span className="text-cyan-400/80" title="Weekday PTO days (calendar out-of-office), excluded from averages"> · {s.ptoDays} PTO</span>}
                  </td>
                  <td className="px-3 py-2 text-right">{h1(s.avgActiveHours)}h</td>
                  <td className="px-3 py-2 text-right text-muted">{h1(s.avgSpanHours)}h</td>
                  <td className="px-3 py-2 text-right">{s.avgInteractions.toFixed(0)}</td>
                  <td className="px-3 py-2 text-right">{s.avgDealsTouched ? h1(s.avgDealsTouched) : "\u2014"}</td>
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
                    <td colSpan={11} className="px-3 py-3">
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs min-w-[720px]">
                          <thead>
                            <tr className="text-left text-muted">
                              {["Day", "Events", "Interactions", "Deals", "Span", "Active", "Talk", "First", "Last", "Sources"].map((h, i) => (
                                <th key={h} className={`px-2 py-1 font-medium ${i >= 1 && i <= 8 ? "text-right" : ""}`}>
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {days.map((d) => {
                              const drillKey = `${s.email}|${d.day}`;
                              const drilled = drill?.key === drillKey;
                              return (
                                <Fragment key={d.day}>
                                  <tr
                                    onClick={() => openDrill(s.email, d.day)}
                                    className={`cursor-pointer hover:bg-surface-2 ${d.weekday && !d.pto ? "" : "text-muted"}`}
                                  >
                                    <td className="px-2 py-1">
                                      <span className="text-muted mr-1">{drilled ? "▾" : "▸"}</span>
                                      {d.day}
                                      {d.weekday ? "" : " (wknd)"}
                                      {d.pto && <span className="text-cyan-400/80"> (PTO)</span>}
                                    </td>
                                    <td className="px-2 py-1 text-right">{d.eventCount}</td>
                                    <td className="px-2 py-1 text-right">{d.interactions}</td>
                                    <td className="px-2 py-1 text-right">
                                      {d.dealsTouched}
                                      {d.dealsTouchedAll !== d.dealsTouched && (
                                        <span className="text-muted"> ({d.dealsTouchedAll})</span>
                                      )}
                                    </td>
                                    <td className="px-2 py-1 text-right">{h1(d.spanHours)}h</td>
                                    <td className="px-2 py-1 text-right">{h1(d.activeHours)}h</td>
                                    <td className="px-2 py-1 text-right">{d.talkMinutes || "—"}</td>
                                    <td className="px-2 py-1 text-right">{clock(d.firstMinute)}</td>
                                    <td className="px-2 py-1 text-right">{clock(d.lastMinute)}</td>
                                    <td className="px-2 py-1">
                                      {ALL_SOURCES.filter((k) => d.perSource[k] > 0)
                                        .map((k) => `${SOURCE_LABEL[k]}:${d.perSource[k]}`)
                                        .join("  ") || "—"}
                                    </td>
                                  </tr>
                                  {drilled && (
                                    <tr>
                                      <td colSpan={10} className="px-2 pb-2">
                                        {drill.loading && <div className="text-muted py-1">Loading events…</div>}
                                        {drill.error && <div className="text-amber-400 py-1">{drill.error}</div>}
                                        {!drill.loading && !drill.error && (
                                          <>
                                            <div className="flex items-center justify-between mb-1">
                                              <span className="text-muted">{drill.events.length} events</span>
                                              <button
                                                onClick={() => copyEvents(`${s.name} — ${d.day}`, drill.events)}
                                                className="text-purple-300 hover:text-purple-200"
                                              >
                                                {copied ? "Copied!" : "Copy"}
                                              </button>
                                            </div>
                                          <div className="max-h-64 overflow-y-auto rounded border border-t-border bg-surface">
                                            {drill.events.length === 0 && (
                                              <div className="text-muted px-2 py-2">No individual events.</div>
                                            )}
                                            {drill.events.map((ev, i) => (
                                              <div
                                                key={i}
                                                className="flex items-baseline gap-2 px-2 py-0.5 border-b border-t-border/40 last:border-0"
                                              >
                                                <span className="font-mono text-muted w-10 shrink-0">
                                                  {drillTimeFmt.format(new Date(ev.ts))}
                                                </span>
                                                <span className="text-purple-300 w-14 shrink-0">{SOURCE_LABEL[ev.source]}</span>
                                                <span className="text-foreground">{ev.kind ?? "event"}</span>
                                                {(ev.label ?? ev.objectKey) && (
                                                  <span className="text-muted">· {ev.label ?? ev.objectKey}</span>
                                                )}
                                              </div>
                                            ))}
                                          </div>
                                          </>
                                        )}
                                      </td>
                                    </tr>
                                  )}
                                </Fragment>
                              );
                            })}
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
              <td colSpan={11} className="px-3 py-6 text-center text-muted">
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
  const [sources, setSources] = useState<ActivitySource[]>(ALL_SOURCES);
  const [applied, setApplied] = useState({ from: isoDay(defaultFrom), to: isoDay(today), sources: ALL_SOURCES });

  const onlyParam = `&only=${applied.sources.join(",")}`;

  const { data, isFetching, error, refetch } = useQuery<ApiResponse>({
    queryKey: ["team-activity", applied.from, applied.to, applied.sources.join(",")],
    enabled: applied.sources.length > 0,
    queryFn: async () => {
      const res = await fetch(`/api/admin/team-activity?from=${applied.from}&to=${applied.to}${onlyParam}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
      return res.json();
    },
  });

  const toggleSource = (s: ActivitySource) =>
    setSources((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  const run = () => {
    const nextSources = sources.length ? sources : ALL_SOURCES;
    const changed = fromInput !== applied.from || toInput !== applied.to || nextSources.join(",") !== applied.sources.join(",");
    setApplied({ from: fromInput, to: toInput, sources: nextSources });
    if (!changed) refetch();
  };

  // --- Look up anyone (ad-hoc) ---
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<DirectoryUser[]>([]);
  const [extraEmails, setExtraEmails] = useState<string[]>([]);
  const [extraData, setExtraData] = useState<Record<string, { key: string; summary: SummaryRow | null; days: DayRow[] }>>(
    {},
  );
  const [lookupError, setLookupError] = useState<string | null>(null);

  const dataKey = `${applied.from}|${applied.to}|${applied.sources.join(",")}`;

  // Fetch each looked-up person, and re-fetch when the range/sources change.
  useEffect(() => {
    const stale = extraEmails.filter((e) => extraData[e]?.key !== dataKey);
    if (!stale.length) return;
    let cancelled = false;
    (async () => {
      for (const email of stale) {
        try {
          const res = await fetch(
            `/api/admin/team-activity?from=${applied.from}&to=${applied.to}${onlyParam}&emails=${encodeURIComponent(email)}`,
          );
          if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
          const json = (await res.json()) as ApiResponse;
          if (cancelled) return;
          setExtraData((prev) => ({ ...prev, [email]: { key: dataKey, summary: json.summaries[0] ?? null, days: json.personDays } }));
        } catch (err) {
          if (cancelled) return;
          setExtraData((prev) => ({ ...prev, [email]: { key: dataKey, summary: null, days: [] } }));
          setLookupError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // extraData intentionally omitted: it's read via closure and changes on each
    // fetch; the stale-filter prevents re-fetch loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey, extraEmails, applied.from, applied.to, onlyParam]);

  const removeExtra = (email: string) => {
    setExtraEmails((prev) => prev.filter((e) => e !== email));
    setExtraData((prev) => {
      const next = { ...prev };
      delete next[email];
      return next;
    });
  };

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

  const addPerson = (email: string) => {
    const e = email.trim().toLowerCase();
    if (!e) return;
    setQuery("");
    setMatches([]);
    setLookupError(null);
    setExtraEmails((prev) => (prev.includes(e) ? prev : [...prev, e])); // effect fetches it
  };

  const extraSummaries = extraEmails.map((e) => extraData[e]?.summary).filter((s): s is SummaryRow => !!s);
  const extraDays = extraEmails.flatMap((e) => extraData[e]?.days ?? []);
  const extraPending = extraEmails.filter((e) => extraData[e]?.key !== dataKey);
  const extraNoActivity = extraEmails.filter((e) => extraData[e]?.key === dataKey && !extraData[e].summary);

  const exportRows = (data?.summaries ?? []).map((s) => ({
    name: s.name,
    email: s.email,
    activeWeekdays: s.weekdayActiveDays,
    ptoDays: s.ptoDays,
    avgActiveHours: h1(s.avgActiveHours),
    avgSpanHours: h1(s.avgSpanHours),
    avgInteractions: s.avgInteractions.toFixed(0),
    avgDealsTouched: h1(s.avgDealsTouched),
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

      {/* Source toggles */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-xs text-muted mr-1">Sources:</span>
        {ALL_SOURCES.map((s) => {
          const on = sources.includes(s);
          return (
            <button
              key={s}
              onClick={() => toggleSource(s)}
              className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                on
                  ? "bg-purple-500/15 text-purple-300 border-purple-500/40"
                  : "bg-surface text-muted border-t-border hover:text-foreground"
              }`}
            >
              {on ? "✓ " : ""}
              {SOURCE_LABEL[s]}
            </button>
          );
        })}
        {sources.join(",") !== applied.sources.join(",") && (
          <span className="text-xs text-amber-400 self-center">— hit Run to apply</span>
        )}
      </div>

      {/* Source status */}
      {data && (
        <div className="flex flex-wrap gap-2 mb-4">
          {data.sources.ran.map((s) => (
            <span
              key={s.source}
              title={s.warning}
              className={`text-xs px-2 py-1 rounded-md border ${
                s.warning
                  ? "bg-amber-500/10 text-amber-300 border-amber-500/30 cursor-help"
                  : "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
              }`}
            >
              {CHIP_LABEL[s.source] ?? s.source} · {s.events.toLocaleString()} events
              {s.warning ? " \u26a0" : ""}
            </span>
          ))}
          {data.sources.skipped.map((s) => (
            <span
              key={s.source}
              title={s.reason}
              className="text-xs px-2 py-1 rounded-md border bg-amber-500/10 text-amber-300 border-amber-500/30 cursor-help"
            >
              {CHIP_LABEL[s.source] ?? s.source} skipped ⓘ
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
        emptyText={isFetching ? "Running…" : "No activity in this range."}
        only={applied.sources.join(",")}
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
        {extraPending.length > 0 && <p className="text-xs text-muted mt-2">Looking up…</p>}
        {lookupError && <p className="text-xs text-amber-400 mt-2">{lookupError}</p>}
        {extraNoActivity.length > 0 && (
          <p className="text-xs text-muted mt-2">No activity in this range: {extraNoActivity.join(", ")}</p>
        )}

        {extraEmails.length > 0 && (
          <div className="mt-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted">{extraEmails.length} looked up</span>
              <button
                onClick={() => {
                  setExtraEmails([]);
                  setExtraData({});
                }}
                className="text-xs text-muted hover:text-red-400"
              >
                Clear all
              </button>
            </div>
            <ActivityTable
              summaries={extraSummaries}
              personDays={extraDays}
              onRemove={removeExtra}
              emptyText={extraPending.length ? "Loading…" : "No activity for the looked-up people in this range."}
              only={applied.sources.join(",")}
            />
          </div>
        )}
      </div>

      <p className="text-xs text-muted mt-6">
        Active-hours cap idle gaps at 60 min; interactions dedup repeat touches of the same record within 10 min. &ldquo;Deals/day&rdquo; counts distinct deals a person worked that day: HubSpot activity or edits while the deal was active (3-day grace after completion), plus PE document submissions (counted regardless of stage); the grey parenthetical in the detail includes completed/old deals. Times are
        America/Denver. Days covered by a PTO-calendar or out-of-office block (≥6h of the day) count as PTO and are excluded
        from the averages. &ldquo;Verdict&rdquo; is a convenience label, not a judgment — the numbers are the source of truth,
        and activity outside these systems (email/docs, meetings) is not captured.
      </p>
    </DashboardShell>
  );
}
