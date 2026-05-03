"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { StatCard } from "@/components/ui/MetricCard";
import { useSSE } from "@/hooks/useSSE";
import { CallsPerDayChart } from "@/components/calls/CallsPerDayChart";
import { HistoricalSnapshot } from "@/components/calls/HistoricalSnapshot";
import { HourHeatmap } from "@/components/calls/HourHeatmap";
import { OnCallSummary } from "@/components/calls/OnCallSummary";
import { PerUserTable } from "@/components/calls/PerUserTable";
import { RecentCallsTable } from "@/components/calls/RecentCallsTable";
import {
  formatDelta,
  formatPercent,
  formatSeconds,
} from "@/components/calls/formatters";

interface UsersResponse {
  users: Array<{ aircallUserId: string; name: string; email: string | null; archived: boolean }>;
}

interface StatsResponse {
  kpis: {
    total: number;
    inbound: number;
    outbound: number;
    missed: number;
    missedRate: number;
    voicemailRate: number;
    avgTimeToAnswerSec: number | null;
    totalTalkTimeSec: number;
    answerRate: number;
    deltaVsPrior: { total: number; missedRate: number; avgTimeToAnswerSec: number };
  };
  perUser: Array<{
    aircallUserId: string;
    name: string;
    email: string | null;
    totalCalls: number;
    inbound: number;
    outbound: number;
    talkTimeSec: number;
    missed: number;
    rangCount: number | null;
    rangAnswered: number | null;
    answerRate: number | null;
    avgTimeToAnswerSec: number | null;
    avgDurationSec: number;
    lastActivityAt: string | null;
  }>;
  perDay: Array<{ date: string; inbound: number; outbound: number; missed: number }>;
  hourHeatmap: Array<{ dayOfWeek: number; hour: number; count: number }>;
}

interface CallsResponse {
  calls: Array<{
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
  }>;
  total: number;
  page: number;
  pageSize: number;
}

const PRESETS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

const DIRECTIONS: Array<{ value: "all" | "inbound" | "outbound"; label: string }> = [
  { value: "all", label: "All" },
  { value: "inbound", label: "Inbound" },
  { value: "outbound", label: "Outbound" },
];

const STATUSES: Array<{ value: "answered" | "missed" | "voicemail"; label: string }> = [
  { value: "answered", label: "Answered" },
  { value: "missed", label: "Missed" },
  { value: "voicemail", label: "Voicemail" },
];

export default function CallsClient() {
  const queryClient = useQueryClient();
  const [days, setDays] = useState(30);
  const [direction, setDirection] = useState<"all" | "inbound" | "outbound">("all");
  const [statuses, setStatuses] = useState<Set<"answered" | "missed" | "voicemail">>(new Set());
  const [userIds, setUserIds] = useState<string[]>([]);
  const [page, setPage] = useState(1);

  const range = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [days]);

  const queryParams = useMemo(() => {
    const sp = new URLSearchParams();
    sp.set("from", range.from);
    sp.set("to", range.to);
    if (direction !== "all") sp.set("direction", direction);
    if (statuses.size > 0) sp.set("status", Array.from(statuses).join(","));
    if (userIds.length > 0) sp.set("userId", userIds.join(","));
    return sp;
  }, [range, direction, statuses, userIds]);

  const usersQuery = useQuery<UsersResponse>({
    queryKey: ["aircall:users"],
    queryFn: async () => {
      const res = await fetch("/api/aircall/users");
      if (!res.ok) throw new Error("Failed to load users");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const statsQuery = useQuery<StatsResponse>({
    queryKey: ["aircall:stats", queryParams.toString()],
    queryFn: async () => {
      const res = await fetch(`/api/aircall/stats?${queryParams.toString()}`);
      if (!res.ok) throw new Error("Failed to load stats");
      return res.json();
    },
    staleTime: 60 * 1000,
  });

  const callsQuery = useQuery<CallsResponse>({
    queryKey: ["aircall:calls", queryParams.toString(), page],
    queryFn: async () => {
      const sp = new URLSearchParams(queryParams);
      sp.set("page", String(page));
      sp.set("pageSize", "50");
      const res = await fetch(`/api/aircall/calls?${sp.toString()}`);
      if (!res.ok) throw new Error("Failed to load calls");
      return res.json();
    },
    staleTime: 60 * 1000,
  });

  const sse = useSSE(
    () => {
      void queryClient.invalidateQueries({ queryKey: ["aircall:stats"] });
      void queryClient.invalidateQueries({ queryKey: ["aircall:calls"] });
    },
    { cacheKeyFilter: "aircall" },
  );

  const onDays = useCallback((d: number) => {
    setDays(d);
    setPage(1);
  }, []);
  const onDirection = useCallback((d: "all" | "inbound" | "outbound") => {
    setDirection(d);
    setPage(1);
  }, []);
  const onToggleStatus = useCallback((s: "answered" | "missed" | "voicemail") => {
    setStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
    setPage(1);
  }, []);
  const onUserIds = useCallback((ids: string[]) => {
    setUserIds(ids);
    setPage(1);
  }, []);

  const kpis = statsQuery.data?.kpis;
  const perUser = statsQuery.data?.perUser ?? [];
  const perDay = statsQuery.data?.perDay ?? [];
  const heatmap = statsQuery.data?.hourHeatmap ?? [];

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <div className="bg-surface border border-t-border rounded-lg p-4 flex flex-wrap items-center gap-3 sticky top-2 z-10 shadow-card">
        <div className="flex items-center gap-1">
          <span className="text-xs uppercase tracking-wide text-muted mr-2">Range</span>
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => onDays(p.days)}
              className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
                days === p.days
                  ? "bg-cyan-500/15 border-cyan-500/50 text-foreground"
                  : "bg-surface-2 border-t-border text-muted hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <span className="text-xs uppercase tracking-wide text-muted mr-2">Direction</span>
          {DIRECTIONS.map((d) => (
            <button
              key={d.value}
              type="button"
              onClick={() => onDirection(d.value)}
              className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
                direction === d.value
                  ? "bg-cyan-500/15 border-cyan-500/50 text-foreground"
                  : "bg-surface-2 border-t-border text-muted hover:text-foreground"
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <span className="text-xs uppercase tracking-wide text-muted mr-2">Status</span>
          {STATUSES.map((s) => {
            const active = statuses.has(s.value);
            return (
              <button
                key={s.value}
                type="button"
                onClick={() => onToggleStatus(s.value)}
                className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
                  active
                    ? "bg-cyan-500/15 border-cyan-500/50 text-foreground"
                    : "bg-surface-2 border-t-border text-muted hover:text-foreground"
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>

        {usersQuery.data && usersQuery.data.users.length > 0 ? (
          <select
            multiple
            value={userIds}
            onChange={(e) => onUserIds(Array.from(e.target.selectedOptions, (o) => o.value))}
            className="bg-surface-2 border border-t-border rounded-md text-sm px-2 py-1 min-w-[180px] max-h-[120px]"
            aria-label="Filter by user"
          >
            {usersQuery.data.users.map((u) => (
              <option key={u.aircallUserId} value={u.aircallUserId}>
                {u.name}
              </option>
            ))}
          </select>
        ) : null}

        <div className="ml-auto text-xs text-muted flex items-center gap-2">
          <span className={`inline-block w-2 h-2 rounded-full ${sse.connected ? "bg-emerald-500" : "bg-zinc-500"}`} />
          {sse.connected ? "Live" : "Offline"}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        <StatCard
          label="Total Calls"
          value={kpis ? kpis.total.toLocaleString() : null}
          subtitle={kpis ? `${kpis.inbound.toLocaleString()} in · ${kpis.outbound.toLocaleString()} out` : null}
          color="cyan"
        />
        <StatCard
          label="Missed Rate"
          value={kpis ? formatPercent(kpis.missedRate) : null}
          subtitle={kpis ? formatDelta(kpis.deltaVsPrior.missedRate, "pp", true) : null}
          color="red"
        />
        <StatCard
          label="Avg Time-to-Answer"
          value={kpis ? formatSeconds(kpis.avgTimeToAnswerSec) : null}
          subtitle={kpis ? formatDelta(kpis.deltaVsPrior.avgTimeToAnswerSec, "s", true) : null}
          color="blue"
        />
        <StatCard
          label="Voicemail Rate"
          value={kpis ? formatPercent(kpis.voicemailRate) : null}
          subtitle={kpis ? `${kpis.missed.toLocaleString()} missed total` : null}
          color="purple"
        />
        <StatCard
          label="Total Talk Time"
          value={kpis ? formatSeconds(kpis.totalTalkTimeSec, "long") : null}
          subtitle={kpis ? `${formatPercent(kpis.answerRate)} answer rate` : null}
          color="emerald"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 bg-surface border border-t-border rounded-lg p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Calls per Day</h3>
          <CallsPerDayChart data={perDay} loading={statsQuery.isLoading} />
        </div>
        <div className="bg-surface border border-t-border rounded-lg p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Hour-of-Day</h3>
          <HourHeatmap cells={heatmap} loading={statsQuery.isLoading} />
        </div>
      </div>

      {/* Per-user table */}
      <div className="bg-surface border border-t-border rounded-lg p-4">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">Per-User</h3>
          <p className="text-xs text-muted">
            Answer rate = answered / rang. Hover the cell to see ring counts. <span className="text-muted/80">Calls before ring tracking was enabled show "—".</span>
          </p>
        </div>
        <PerUserTable rows={perUser} loading={statsQuery.isLoading} />
      </div>

      {/* On-Call Calls — from PB Tech Ops on-call call log */}
      <div className="bg-surface border border-t-border rounded-lg p-4">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">On-Call Calls</h3>
          <p className="text-xs text-muted">Logged by the on-call electrician — covers Connect calls and any other after-hours calls.</p>
        </div>
        <OnCallSummary from={range.from} to={range.to} />
      </div>

      {/* Historical Snapshot — Aircall Analytics+ import */}
      <div className="bg-surface border border-t-border rounded-lg p-4">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">Historical Snapshot — Aircall Analytics+</h3>
          <p className="text-xs text-muted">
            Per-user ring counts including ring-group misses. Static — refreshes on import.
          </p>
        </div>
        <HistoricalSnapshot />
      </div>

      {/* Recent calls */}
      <div className="bg-surface border border-t-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">Recent Calls</h3>
          <div className="text-xs text-muted">
            {callsQuery.data ? `${callsQuery.data.total.toLocaleString()} total` : ""}
          </div>
        </div>
        <RecentCallsTable
          rows={callsQuery.data?.calls ?? []}
          loading={callsQuery.isLoading}
          page={page}
          pageSize={callsQuery.data?.pageSize ?? 50}
          total={callsQuery.data?.total ?? 0}
          onPageChange={setPage}
        />
      </div>
    </div>
  );
}
