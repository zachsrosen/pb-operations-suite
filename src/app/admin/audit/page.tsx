"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { MetricCard } from "@/components/ui/MetricCard";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import { AdminPageHeader } from "@/components/admin-shell/AdminPageHeader";
import { AdminEmpty } from "@/components/admin-shell/AdminEmpty";
import { AdminError } from "@/components/admin-shell/AdminError";
import { AdminTable, type AdminTableColumn } from "@/components/admin-shell/AdminTable";
import { AdminFilterBar, DateRangeChip, FilterSearch } from "@/components/admin-shell/AdminFilterBar";
import { AdminDetailDrawer } from "@/components/admin-shell/AdminDetailDrawer";
import { AdminDetailHeader } from "@/components/admin-shell/AdminDetailHeader";
import { AdminKeyValueGrid } from "@/components/admin-shell/AdminKeyValueGrid";

// ── Types ─────────────────────────────────────────────────────────────────

interface AuditSessionSummary {
  id: string;
  userEmail: string | null;
  userName: string | null;
  clientType: string;
  environment: string;
  ipAddress: string;
  riskScore: number;
  riskLevel: string;
  startedAt: string;
  lastActiveAt: string;
  endedAt: string | null;
  anomalyReasons: string[];
  _count: { activities: number; anomalyEvents: number };
  userId?: string | null;
}

interface ActivityLog {
  id: string;
  type: string;
  description: string;
  createdAt: string;
  metadata: Record<string, unknown> | null;
}

interface AnomalyEvent {
  id: string;
  rule: string;
  riskScore: number;
  evidence: Record<string, unknown>;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  acknowledgeNote: string | null;
  createdAt: string;
  sessionId: string;
}

interface SessionDetail {
  id: string;
  userEmail: string | null;
  userName: string | null;
  clientType: string;
  environment: string;
  ipAddress: string;
  userAgent?: string | null;
  riskScore: number;
  riskLevel: string;
  startedAt: string;
  endedAt: string | null;
  anomalyReasons: string[];
  activities: ActivityLog[];
  anomalyEvents: AnomalyEvent[];
  userId?: string | null;
}

interface Stats {
  totalToday: number;
  anomalyCount: number;
  activeSessions: number;
  envBreakdown: { environment: string; count: number }[];
}

type DateRange = "today" | "7d" | "30d" | "all";

// ── Constants ─────────────────────────────────────────────────────────────

const CLIENT_TYPE_LABELS: Record<string, string> = {
  BROWSER: "Browser",
  CLAUDE_CODE: "Claude Code",
  CODEX: "Codex",
  API_CLIENT: "API",
  UNKNOWN: "Unknown",
};

const CLIENT_TYPE_COLORS: Record<string, string> = {
  BROWSER: "bg-blue-500/20 text-blue-400",
  CLAUDE_CODE: "bg-purple-500/20 text-purple-400",
  CODEX: "bg-orange-500/20 text-orange-400",
  API_CLIENT: "bg-zinc-500/20 text-zinc-400",
  UNKNOWN: "bg-red-500/20 text-red-400",
};

const RISK_LEVEL_COLORS: Record<string, string> = {
  LOW: "bg-green-500/20 text-green-400",
  MEDIUM: "bg-yellow-500/20 text-yellow-400",
  HIGH: "bg-orange-500/20 text-orange-400",
  CRITICAL: "bg-red-500/20 text-red-400",
};

const RISK_SCORE_COLORS: Record<number, string> = {
  1: "bg-green-500/20 text-green-400",
  2: "bg-yellow-500/20 text-yellow-400",
  3: "bg-orange-500/20 text-orange-400",
  4: "bg-red-500/20 text-red-400",
};

const RISK_SCORE_LABELS: Record<number, string> = {
  1: "Low",
  2: "Medium",
  3: "High",
  4: "Critical",
};

const DATE_OPTS = [
  { value: "today" as const, label: "Today" },
  { value: "7d" as const, label: "7d" },
  { value: "30d" as const, label: "30d" },
  { value: "all" as const, label: "All" },
] satisfies { value: DateRange; label: string }[];

const CLIENT_TYPE_OPTIONS = Object.entries(CLIENT_TYPE_LABELS).map(([v, label]) => ({
  value: v,
  label,
}));

const ENV_OPTIONS = [
  { value: "LOCAL", label: "Local" },
  { value: "PREVIEW", label: "Preview" },
  { value: "PRODUCTION", label: "Production" },
];

const RISK_LEVEL_OPTIONS = [
  { value: "1", label: "1 — Low" },
  { value: "2", label: "2 — Medium" },
  { value: "3", label: "3 — High" },
  { value: "4", label: "4 — Critical" },
];

const PAGE_SIZE = 20;

// ── Helpers ───────────────────────────────────────────────────────────────

function maskIp(ip: string): string {
  if (!ip) return "N/A";
  const parts = ip.split(".");
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.*.*`;
  if (ip.length > 10) return ip.slice(0, 10) + "...";
  return ip;
}

function fmtRelative(ds: string): string {
  const diff = Date.now() - new Date(ds).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 7) return `${d}d ago`;
  return new Date(ds).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function sinceFrom(dr: DateRange): string | null {
  const now = new Date();
  if (dr === "today") {
    const t = new Date(now);
    t.setHours(0, 0, 0, 0);
    return t.toISOString();
  }
  if (dr === "7d") return new Date(now.getTime() - 7 * 864e5).toISOString();
  if (dr === "30d") return new Date(now.getTime() - 30 * 864e5).toISOString();
  return null;
}

function RiskPill({ score, level }: { score?: number; level?: string }) {
  if (level) {
    const cls = RISK_LEVEL_COLORS[level] ?? "bg-zinc-500/20 text-zinc-400";
    return (
      <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${cls}`}>
        {level}
      </span>
    );
  }
  if (score !== undefined) {
    const cls = RISK_SCORE_COLORS[score] ?? "bg-zinc-500/20 text-zinc-400";
    const lbl = RISK_SCORE_LABELS[score] ?? String(score);
    return (
      <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${cls}`}>
        {lbl}
      </span>
    );
  }
  return <span className="text-xs text-muted">—</span>;
}

function ClientBadge({ clientType }: { clientType: string }) {
  const label = CLIENT_TYPE_LABELS[clientType] ?? clientType;
  const cls = CLIENT_TYPE_COLORS[clientType] ?? "bg-zinc-500/20 text-zinc-400";
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${cls}`}>{label}</span>
  );
}

// ── Anomaly nested table ──────────────────────────────────────────────────

const ANOMALY_COLUMNS: AdminTableColumn<AnomalyEvent>[] = [
  {
    key: "createdAt",
    label: "Time",
    width: "w-24",
    render: (r) => (
      <span className="text-xs text-muted whitespace-nowrap">{fmtRelative(r.createdAt)}</span>
    ),
  },
  {
    key: "rule",
    label: "Type",
    render: (r) => <span className="text-xs font-medium text-foreground">{r.rule}</span>,
  },
  {
    key: "evidence",
    label: "Description",
    render: (r) => (
      <span className="text-xs text-muted truncate block max-w-[200px]">
        {Object.entries(r.evidence)
          .slice(0, 2)
          .map(([k, v]) => `${k}: ${String(v)}`)
          .join("; ") || "—"}
      </span>
    ),
  },
  {
    key: "riskScore",
    label: "Severity",
    align: "center",
    render: (r) => <RiskPill score={r.riskScore} />,
  },
];

// ── Session drawer body ───────────────────────────────────────────────────

function SessionDrawerBody({
  session,
  detail,
  loading,
}: {
  session: AuditSessionSummary;
  detail: SessionDetail | null;
  loading: boolean;
}) {
  const userLink =
    detail?.userId ? `/admin/users?userId=${encodeURIComponent(detail.userId)}` : null;

  return (
    <div className="space-y-5">
      <AdminDetailHeader
        title={`Session ${session.id.slice(0, 8)}…`}
        subtitle={`Started ${fmtRelative(session.startedAt)}`}
        actions={
          userLink ? (
            <Link
              href={userLink}
              className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:underline"
            >
              View user
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                className="h-3 w-3"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          ) : undefined
        }
      />

      <AdminKeyValueGrid
        items={[
          { label: "Email", value: session.userEmail || "Unknown" },
          { label: "Client", value: <ClientBadge clientType={session.clientType} /> },
          { label: "Env", value: session.environment },
          {
            label: "IP",
            value: detail?.ipAddress ?? session.ipAddress,
            mono: true,
          },
          {
            label: "UA",
            value: detail?.userAgent ? (
              <span
                className="truncate block max-w-[280px]"
                title={detail.userAgent}
              >
                {detail.userAgent}
              </span>
            ) : (
              "—"
            ),
          },
          {
            label: "Started",
            value: new Date(session.startedAt).toLocaleString(),
          },
          {
            label: "Ended",
            value: session.endedAt
              ? new Date(session.endedAt).toLocaleString()
              : "Active",
          },
          {
            label: "Risk score",
            value: String(session.riskScore),
          },
          {
            label: "Risk level",
            value: <RiskPill level={session.riskLevel} />,
          },
        ]}
      />

      {/* Anomaly events — nested AdminTable */}
      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
          Anomaly Events ({loading ? "…" : (detail?.anomalyEvents.length ?? 0)})
        </p>
        <AdminTable<AnomalyEvent>
          caption="Anomaly events for this session"
          rows={loading ? [] : (detail?.anomalyEvents ?? [])}
          rowKey={(r) => r.id}
          columns={ANOMALY_COLUMNS}
          loading={loading}
          empty={
            <AdminEmpty
              label="No anomaly events"
              description="This session has no detected anomalies"
            />
          }
        />
      </div>

      {/* Activities list */}
      {!loading && detail && detail.activities.length > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
            Activities ({detail.activities.length})
          </p>
          <div className="max-h-64 overflow-y-auto space-y-1 rounded-md border border-t-border/40 bg-surface-2 p-2">
            {detail.activities.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-2 py-1 border-b border-t-border/30 last:border-0 text-xs"
              >
                <span className="text-muted font-mono w-16 shrink-0 text-[10px]">
                  {new Date(a.createdAt).toLocaleTimeString()}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-surface text-muted">
                  {a.type.replace(/_/g, " ")}
                </span>
                <span className="text-foreground truncate">{a.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Anomaly reasons tags */}
      {session.anomalyReasons.length > 0 && (
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
            Anomaly Reasons
          </p>
          <div className="flex flex-wrap gap-1">
            {session.anomalyReasons.map((reason, i) => (
              <span
                key={i}
                className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400"
              >
                {reason}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main table columns ────────────────────────────────────────────────────

const SESSION_COLUMNS: AdminTableColumn<AuditSessionSummary>[] = [
  {
    key: "startedAt",
    label: "Started",
    width: "w-28",
    render: (r) => (
      <span className="text-xs text-muted whitespace-nowrap">{fmtRelative(r.startedAt)}</span>
    ),
  },
  {
    key: "actor",
    label: "Actor",
    render: (r) => (
      <span className="text-xs truncate block max-w-[180px] text-foreground">
        {r.userEmail || "Unknown"}
      </span>
    ),
  },
  {
    key: "clientType",
    label: "Client",
    width: "w-32",
    render: (r) => <ClientBadge clientType={r.clientType} />,
  },
  {
    key: "environment",
    label: "Env",
    width: "w-24",
    render: (r) => (
      <span className="text-xs text-muted bg-surface-2 px-2 py-0.5 rounded">
        {r.environment}
      </span>
    ),
  },
  {
    key: "riskLevel",
    label: "Risk",
    width: "w-24",
    align: "center",
    render: (r) => <RiskPill level={r.riskLevel} />,
  },
  {
    key: "anomalies",
    label: "Anomalies",
    width: "w-24",
    align: "right",
    render: (r) =>
      r._count.anomalyEvents > 0 ? (
        <span className="text-xs text-red-400 font-medium">{r._count.anomalyEvents}</span>
      ) : (
        <span className="text-xs text-muted">0</span>
      ),
  },
];

// ── Page ──────────────────────────────────────────────────────────────────

export default function AuditDashboardPage() {
  // Stats
  const [stats, setStats] = useState<Stats | null>(null);

  // Sessions list
  const [sessions, setSessions] = useState<AuditSessionSummary[]>([]);
  const [sessionsTotal, setSessionsTotal] = useState(0);
  const [sessionsOffset, setSessionsOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Session drawer
  const [selected, setSelected] = useState<AuditSessionSummary | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Filters
  const [dateRange, setDateRange] = useState<DateRange>("today");
  const [clientTypes, setClientTypes] = useState<string[]>([]);
  const [environments, setEnvironments] = useState<string[]>([]);
  const [minRisk, setMinRisk] = useState<string[]>([]);
  const [emailQuery, setEmailQuery] = useState("");
  const [debouncedEmail, setDebouncedEmail] = useState("");

  // Debounce email
  const emailTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    emailTimer.current = setTimeout(() => setDebouncedEmail(emailQuery), 400);
    return () => clearTimeout(emailTimer.current);
  }, [emailQuery]);

  // Derive sinceDate
  const sinceDate = useMemo(() => sinceFrom(dateRange), [dateRange]);

  // ── Stats ──────────────────────────────────────────────────────────────

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/audit?meta=stats");
      if (res.ok) setStats(await res.json());
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // ── Build fetch params ─────────────────────────────────────────────────

  const buildParams = useCallback(
    (off: number) => {
      const p = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(off) });
      if (environments.length === 1) p.set("environment", environments[0]);
      if (clientTypes.length === 1) p.set("clientType", clientTypes[0]);
      if (minRisk.length === 1) p.set("minRisk", minRisk[0]);
      if (debouncedEmail.trim()) p.set("email", debouncedEmail.trim());
      if (sinceDate) p.set("since", sinceDate);
      return p;
    },
    [environments, clientTypes, minRisk, debouncedEmail, sinceDate]
  );

  // ── Fetch sessions ─────────────────────────────────────────────────────

  const fetchSessions = useCallback(
    async (append = false, off = 0) => {
      try {
        append ? setLoadingMore(true) : setLoading(true);
        const res = await fetch(`/api/admin/audit?${buildParams(off)}`);
        if (!res.ok) throw new Error("Failed to fetch sessions");
        const data = await res.json();
        setSessions((prev) =>
          append ? [...prev, ...data.sessions] : data.sessions
        );
        setSessionsTotal(data.total);
        if (!append) setSessionsOffset(0);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [buildParams]
  );

  // Re-fetch when filters change
  useEffect(() => {
    setSessionsOffset(0);
    fetchSessions(false, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange, clientTypes, environments, minRisk, debouncedEmail]);

  // Auto-refresh every 60s
  useEffect(() => {
    const id = setInterval(() => {
      fetchSessions(false, 0);
      fetchStats();
    }, 60_000);
    return () => clearInterval(id);
  }, [fetchSessions, fetchStats]);

  // ── Load session detail on row click ──────────────────────────────────

  const handleRowClick = useCallback(async (row: AuditSessionSummary) => {
    setSelected(row);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/admin/audit/sessions?id=${row.id}`);
      if (res.ok) {
        const data = await res.json();
        setDetail(data.session);
      }
    } catch {
      /* ignore */
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // ── Derived ────────────────────────────────────────────────────────────

  const hasMore = sessions.length < sessionsTotal;
  const hasActiveFilters =
    dateRange !== "today" ||
    clientTypes.length > 0 ||
    environments.length > 0 ||
    minRisk.length > 0 ||
    !!emailQuery;

  const clearAll = () => {
    setDateRange("today");
    setClientTypes([]);
    setEnvironments([]);
    setMinRisk([]);
    setEmailQuery("");
  };

  const envBreakdownStr = useMemo(() => {
    if (!stats?.envBreakdown?.length) return "No data";
    return stats.envBreakdown.map((e) => `${e.environment}: ${e.count}`).join(", ");
  }, [stats]);

  const handleLoadMore = () => {
    const next = sessionsOffset + PAGE_SIZE;
    setSessionsOffset(next);
    fetchSessions(true, next);
  };

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div>
      <AdminPageHeader
        title="Audit Sessions"
        breadcrumb={["Admin", "Audit", "Audit sessions"]}
        subtitle={`${sessionsTotal.toLocaleString()} sessions`}
        actions={
          <button
            type="button"
            onClick={() => { fetchSessions(false, 0); fetchStats(); }}
            aria-label="Refresh"
            title="Refresh"
            className="rounded p-1.5 text-muted hover:text-foreground hover:bg-surface-2 transition-colors"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        }
      />

      {/* Metric cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <MetricCard
          label="Sessions Today"
          value={stats ? stats.totalToday.toLocaleString() : "--"}
          border="border-l-4 border-l-blue-500"
          valueColor="text-blue-400"
        />
        <MetricCard
          label="Anomalies Today"
          value={stats ? stats.anomalyCount.toLocaleString() : "--"}
          border="border-l-4 border-l-red-500"
          valueColor={stats && stats.anomalyCount > 0 ? "text-red-400" : "text-foreground"}
        />
        <MetricCard
          label="Active Sessions"
          value={stats ? stats.activeSessions.toLocaleString() : "--"}
          border="border-l-4 border-l-green-500"
          valueColor="text-green-400"
        />
        <MetricCard
          label="Env Breakdown"
          value={stats ? stats.envBreakdown.length.toString() : "--"}
          sub={envBreakdownStr}
          border="border-l-4 border-l-purple-500"
          valueColor="text-purple-400"
        />
      </div>

      {/* Filter bar */}
      <div className="mb-4">
        <AdminFilterBar hasActiveFilters={hasActiveFilters} onClearAll={clearAll}>
          <DateRangeChip
            label="Range"
            selected={dateRange}
            options={DATE_OPTS}
            onChange={setDateRange}
          />
          <MultiSelectFilter
            label="Client"
            options={CLIENT_TYPE_OPTIONS}
            selected={clientTypes}
            onChange={setClientTypes}
            placeholder="All Clients"
            accentColor="purple"
          />
          <MultiSelectFilter
            label="Env"
            options={ENV_OPTIONS}
            selected={environments}
            onChange={setEnvironments}
            placeholder="All Envs"
            accentColor="blue"
          />
          <MultiSelectFilter
            label="Min Risk"
            options={RISK_LEVEL_OPTIONS}
            selected={minRisk}
            onChange={setMinRisk}
            placeholder="Any Risk"
            accentColor="red"
          />
          <FilterSearch
            value={emailQuery}
            onChange={setEmailQuery}
            placeholder="Filter by email…"
            widthClass="w-48"
          />
        </AdminFilterBar>
      </div>

      {/* Sessions table */}
      <AdminTable<AuditSessionSummary>
        caption="Audit sessions"
        rows={sessions}
        rowKey={(r) => r.id}
        columns={SESSION_COLUMNS}
        loading={loading}
        error={
          error ? (
            <AdminError error={error} onRetry={() => fetchSessions(false, 0)} />
          ) : undefined
        }
        empty={
          <AdminEmpty
            label="No sessions match your filters"
            description="Try adjusting your search criteria or date range"
          />
        }
        onRowClick={handleRowClick}
      />

      {/* Load more */}
      {!loading && !error && hasMore && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="flex items-center gap-2 rounded-lg bg-surface-2 px-4 py-2 text-sm text-foreground transition-colors hover:bg-surface-elevated disabled:opacity-50"
          >
            {loadingMore ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-b-2 border-foreground" />
                Loading…
              </>
            ) : (
              `Load more (${sessions.length.toLocaleString()} of ${sessionsTotal.toLocaleString()})`
            )}
          </button>
        </div>
      )}

      {!loading && !error && sessions.length > 0 && (
        <p className="mt-3 text-center text-xs text-muted">
          Showing {sessions.length.toLocaleString()} of {sessionsTotal.toLocaleString()} sessions
        </p>
      )}

      {/* Session detail drawer */}
      <AdminDetailDrawer
        open={selected !== null}
        onClose={() => { setSelected(null); setDetail(null); }}
        wide
        title={selected ? `Session — ${selected.userEmail ?? "Unknown"}` : ""}
      >
        {selected && (
          <SessionDrawerBody
            session={selected}
            detail={detail}
            loading={detailLoading}
          />
        )}
      </AdminDetailDrawer>
    </div>
  );
}
