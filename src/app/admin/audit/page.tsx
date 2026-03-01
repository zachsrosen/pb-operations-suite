"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import DashboardShell from "@/components/DashboardShell";
import { MetricCard } from "@/components/ui/MetricCard";

// ── Types ────────────────────────────────────────────────────────────────

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
  session?: {
    id: string;
    userEmail: string | null;
    clientType: string;
    environment: string;
    ipAddress: string;
    riskScore: number;
  };
}

interface Stats {
  totalToday: number;
  anomalyCount: number;
  activeSessions: number;
  envBreakdown: { environment: string; count: number }[];
}

interface SessionDetail {
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
  activities: ActivityLog[];
  anomalyEvents: AnomalyEvent[];
}

// ── Constants ────────────────────────────────────────────────────────────

type TabId = "timeline" | "alerts" | "sessions";

const TABS: { id: TabId; label: string }[] = [
  { id: "timeline", label: "Timeline" },
  { id: "alerts", label: "Alerts" },
  { id: "sessions", label: "Sessions" },
];

const CLIENT_TYPE_BADGES: Record<string, { label: string; color: string }> = {
  BROWSER: { label: "Browser", color: "bg-blue-500/20 text-blue-400" },
  CLAUDE_CODE: { label: "Claude Code", color: "bg-purple-500/20 text-purple-400" },
  CODEX: { label: "Codex", color: "bg-orange-500/20 text-orange-400" },
  API_CLIENT: { label: "API", color: "bg-zinc-500/20 text-zinc-400" },
  UNKNOWN: { label: "Unknown", color: "bg-red-500/20 text-red-400" },
};

const RISK_COLORS: Record<number, string> = {
  1: "bg-green-500",
  2: "bg-yellow-500",
  3: "bg-orange-500",
  4: "bg-red-500",
};

const RISK_LABELS: Record<number, string> = {
  1: "Low",
  2: "Medium",
  3: "High",
  4: "Critical",
};

const ENVIRONMENTS = ["LOCAL", "PREVIEW", "PRODUCTION"];
const CLIENT_TYPES = ["BROWSER", "CLAUDE_CODE", "CODEX", "API_CLIENT", "UNKNOWN"];
const PAGE_SIZE = 20;

// ── Helpers ──────────────────────────────────────────────────────────────

function maskIp(ip: string): string {
  if (!ip) return "N/A";
  const parts = ip.split(".");
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.*.*`;
  // IPv6 or other
  if (ip.length > 10) return ip.slice(0, 10) + "...";
  return ip;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDuration(startedAt: string, endedAt: string | null): string {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const seconds = Math.floor((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMin = minutes % 60;
  return `${hours}h ${remainingMin}m`;
}

// ── Component ────────────────────────────────────────────────────────────

export default function AuditDashboardPage() {
  // Tab state
  const [activeTab, setActiveTab] = useState<TabId>("timeline");

  // Stats
  const [stats, setStats] = useState<Stats | null>(null);

  // Timeline state
  const [sessions, setSessions] = useState<AuditSessionSummary[]>([]);
  const [sessionsTotal, setSessionsTotal] = useState(0);
  const [sessionsOffset, setSessionsOffset] = useState(0);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsLoadingMore, setSessionsLoadingMore] = useState(false);

  // Session detail expand
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Alerts state
  const [alerts, setAlerts] = useState<AnomalyEvent[]>([]);
  const [alertsTotal, setAlertsTotal] = useState(0);
  const [alertsOffset, setAlertsOffset] = useState(0);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [acknowledging, setAcknowledging] = useState<string | null>(null);

  // Filters
  const [filterEnv, setFilterEnv] = useState("");
  const [filterClient, setFilterClient] = useState("");
  const [filterMinRisk, setFilterMinRisk] = useState(0);
  const [filterEmail, setFilterEmail] = useState("");
  const [debouncedEmail, setDebouncedEmail] = useState("");
  const [filterDateRange, setFilterDateRange] = useState<"today" | "7d" | "30d" | "all">("today");

  // Debounce email input
  const emailTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    emailTimer.current = setTimeout(() => {
      setDebouncedEmail(filterEmail);
    }, 400);
    return () => clearTimeout(emailTimer.current);
  }, [filterEmail]);

  // Compute since date from date range
  const sinceDate = useMemo(() => {
    const now = new Date();
    switch (filterDateRange) {
      case "today": {
        const today = new Date(now);
        today.setHours(0, 0, 0, 0);
        return today.toISOString();
      }
      case "7d":
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      case "30d":
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      default:
        return null;
    }
  }, [filterDateRange]);

  // ── Fetch stats ──────────────────────────────────────────────────────

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/audit?meta=stats");
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // ── Build filter params ──────────────────────────────────────────────

  const buildFilterParams = useCallback(() => {
    const params = new URLSearchParams();
    if (filterEnv) params.set("environment", filterEnv);
    if (filterClient) params.set("clientType", filterClient);
    if (filterMinRisk > 0) params.set("minRisk", filterMinRisk.toString());
    if (debouncedEmail.trim()) params.set("email", debouncedEmail.trim());
    if (sinceDate) params.set("since", sinceDate);
    return params;
  }, [filterEnv, filterClient, filterMinRisk, debouncedEmail, sinceDate]);

  // ── Fetch sessions (Timeline tab) ────────────────────────────────────

  const fetchSessions = useCallback(
    async (appendMode = false, customOffset?: number) => {
      try {
        if (appendMode) {
          setSessionsLoadingMore(true);
        } else {
          setSessionsLoading(true);
        }

        const params = buildFilterParams();
        params.set("limit", PAGE_SIZE.toString());
        params.set("offset", (customOffset ?? (appendMode ? sessionsOffset : 0)).toString());

        const res = await fetch(`/api/admin/audit?${params}`);
        if (!res.ok) return;
        const data = await res.json();

        if (appendMode) {
          setSessions((prev) => [...prev, ...data.sessions]);
        } else {
          setSessions(data.sessions);
          setSessionsOffset(0);
        }
        setSessionsTotal(data.total);
      } catch {
        /* ignore */
      } finally {
        setSessionsLoading(false);
        setSessionsLoadingMore(false);
      }
    },
    [buildFilterParams, sessionsOffset]
  );

  // ── Fetch alerts ─────────────────────────────────────────────────────

  const fetchAlerts = useCallback(
    async (appendMode = false, customOffset?: number) => {
      try {
        setAlertsLoading(true);
        const params = new URLSearchParams();
        params.set("limit", "50");
        params.set("offset", (customOffset ?? (appendMode ? alertsOffset : 0)).toString());

        const res = await fetch(`/api/admin/audit/alerts?${params}`);
        if (!res.ok) return;
        const data = await res.json();

        if (appendMode) {
          setAlerts((prev) => [...prev, ...data.alerts]);
        } else {
          setAlerts(data.alerts);
          setAlertsOffset(0);
        }
        setAlertsTotal(data.total);
      } catch {
        /* ignore */
      } finally {
        setAlertsLoading(false);
      }
    },
    [alertsOffset]
  );

  // Re-fetch when filters change (timeline)
  useEffect(() => {
    setSessionsOffset(0);
    fetchSessions(false, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterEnv, filterClient, filterMinRisk, debouncedEmail, sinceDate]);

  // Fetch alerts on tab switch
  useEffect(() => {
    if (activeTab === "alerts") {
      fetchAlerts(false, 0);
    }
  }, [activeTab, fetchAlerts]);

  // ── Expand session detail ────────────────────────────────────────────

  const toggleSessionDetail = useCallback(
    async (sessionId: string) => {
      if (expandedSessionId === sessionId) {
        setExpandedSessionId(null);
        setSessionDetail(null);
        return;
      }

      setExpandedSessionId(sessionId);
      setDetailLoading(true);
      try {
        const res = await fetch(`/api/admin/audit/sessions?id=${sessionId}`);
        if (res.ok) {
          const data = await res.json();
          setSessionDetail(data.session);
        }
      } catch {
        /* ignore */
      } finally {
        setDetailLoading(false);
      }
    },
    [expandedSessionId]
  );

  // ── Acknowledge alert ────────────────────────────────────────────────

  const acknowledgeAlert = useCallback(async (alertId: string) => {
    setAcknowledging(alertId);
    try {
      const res = await fetch("/api/admin/audit/alerts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alertId }),
      });
      if (res.ok) {
        setAlerts((prev) =>
          prev.map((a) =>
            a.id === alertId
              ? { ...a, acknowledgedAt: new Date().toISOString() }
              : a
          )
        );
      }
    } catch {
      /* ignore */
    } finally {
      setAcknowledging(null);
    }
  }, []);

  // ── Load more handlers ───────────────────────────────────────────────

  const handleLoadMoreSessions = () => {
    const nextOffset = sessionsOffset + PAGE_SIZE;
    setSessionsOffset(nextOffset);
    fetchSessions(true, nextOffset);
  };

  const hasMoreSessions = sessions.length < sessionsTotal;
  const hasMoreAlerts = alerts.length < alertsTotal;

  // ── Env breakdown string ─────────────────────────────────────────────

  const envBreakdownStr = useMemo(() => {
    if (!stats?.envBreakdown || stats.envBreakdown.length === 0) return "No data";
    return stats.envBreakdown.map((e) => `${e.environment}: ${e.count}`).join(", ");
  }, [stats]);

  // ── Render helpers ───────────────────────────────────────────────────

  const renderClientBadge = (clientType: string) => {
    const badge = CLIENT_TYPE_BADGES[clientType] || CLIENT_TYPE_BADGES.UNKNOWN;
    return (
      <span className={`text-xs px-2 py-0.5 rounded-full ${badge.color}`}>
        {badge.label}
      </span>
    );
  };

  const renderRiskDot = (riskScore: number) => {
    const color = RISK_COLORS[riskScore] || RISK_COLORS[1];
    const label = RISK_LABELS[riskScore] || "Unknown";
    return (
      <span className="flex items-center gap-1.5" title={`Risk: ${label}`}>
        <span className={`w-2 h-2 rounded-full ${color}`} />
        <span className="text-xs text-muted">{label}</span>
      </span>
    );
  };

  // ── Session row (Timeline) ───────────────────────────────────────────

  const renderSessionRow = (s: AuditSessionSummary) => {
    const isExpanded = expandedSessionId === s.id;

    return (
      <div key={s.id} className="bg-surface rounded-xl border border-t-border shadow-card overflow-hidden">
        {/* Row header */}
        <button
          onClick={() => toggleSessionDetail(s.id)}
          className="w-full text-left p-4 hover:bg-surface-2/50 transition-colors"
        >
          <div className="flex items-center gap-3 flex-wrap">
            {/* User email */}
            <span className="text-sm text-foreground font-medium truncate max-w-[200px]">
              {s.userEmail || "Unknown user"}
            </span>

            {/* Client type badge */}
            {renderClientBadge(s.clientType)}

            {/* Environment */}
            <span className="text-xs text-muted bg-surface-2 px-2 py-0.5 rounded">
              {s.environment}
            </span>

            {/* Risk dot */}
            {renderRiskDot(s.riskScore)}

            {/* Counts */}
            <span className="text-xs text-muted">
              {s._count.activities} activit{s._count.activities === 1 ? "y" : "ies"}
            </span>
            {s._count.anomalyEvents > 0 && (
              <span className="text-xs text-red-400">
                {s._count.anomalyEvents} anomal{s._count.anomalyEvents === 1 ? "y" : "ies"}
              </span>
            )}

            {/* Spacer */}
            <span className="flex-1" />

            {/* Time info */}
            <span className="text-xs text-muted">{formatDate(s.startedAt)}</span>
            <span className="text-xs text-muted">({formatDuration(s.startedAt, s.endedAt)})</span>

            {/* Masked IP */}
            <span className="text-xs text-muted font-mono">{maskIp(s.ipAddress)}</span>

            {/* Expand chevron */}
            <svg
              className={`w-4 h-4 text-muted transition-transform ${isExpanded ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </button>

        {/* Expanded detail */}
        {isExpanded && (
          <div className="border-t border-t-border p-4 bg-surface-2/30">
            {detailLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-red-500" />
              </div>
            ) : sessionDetail ? (
              <div className="space-y-4">
                {/* Session meta */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div>
                    <span className="text-muted text-xs block">Full IP</span>
                    <span className="font-mono text-foreground">{sessionDetail.ipAddress}</span>
                  </div>
                  <div>
                    <span className="text-muted text-xs block">Risk Level</span>
                    <span className="text-foreground">{sessionDetail.riskLevel}</span>
                  </div>
                  <div>
                    <span className="text-muted text-xs block">Started</span>
                    <span className="text-foreground">{new Date(sessionDetail.startedAt).toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-muted text-xs block">Ended</span>
                    <span className="text-foreground">
                      {sessionDetail.endedAt ? new Date(sessionDetail.endedAt).toLocaleString() : "Active"}
                    </span>
                  </div>
                </div>

                {/* Anomaly reasons */}
                {sessionDetail.anomalyReasons.length > 0 && (
                  <div>
                    <span className="text-xs text-muted block mb-1">Anomaly Reasons</span>
                    <div className="flex flex-wrap gap-1">
                      {sessionDetail.anomalyReasons.map((reason, i) => (
                        <span key={i} className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400">
                          {reason}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Activities timeline */}
                {sessionDetail.activities.length > 0 && (
                  <div>
                    <span className="text-xs text-muted block mb-2">
                      Activities ({sessionDetail.activities.length})
                    </span>
                    <div className="space-y-1 max-h-64 overflow-y-auto">
                      {sessionDetail.activities.map((a) => (
                        <div key={a.id} className="flex items-center gap-2 text-sm py-1 border-b border-t-border/50 last:border-0">
                          <span className="text-xs text-muted font-mono w-16 shrink-0">
                            {new Date(a.createdAt).toLocaleTimeString()}
                          </span>
                          <span className="text-xs px-1.5 py-0.5 rounded bg-surface-2 text-muted">
                            {a.type.replace(/_/g, " ")}
                          </span>
                          <span className="text-foreground text-xs truncate">{a.description}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Anomaly events */}
                {sessionDetail.anomalyEvents.length > 0 && (
                  <div>
                    <span className="text-xs text-muted block mb-2">
                      Anomaly Events ({sessionDetail.anomalyEvents.length})
                    </span>
                    <div className="space-y-2">
                      {sessionDetail.anomalyEvents.map((ae) => (
                        <div key={ae.id} className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium text-red-400">{ae.rule}</span>
                            {renderRiskDot(ae.riskScore)}
                            <span className="text-xs text-muted">{formatDate(ae.createdAt)}</span>
                          </div>
                          <details className="text-xs">
                            <summary className="text-muted cursor-pointer hover:text-foreground">Evidence</summary>
                            <pre className="mt-1 p-2 bg-surface-2 rounded text-xs overflow-x-auto text-muted">
                              {JSON.stringify(ae.evidence, null, 2)}
                            </pre>
                          </details>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-muted text-sm text-center py-4">Failed to load session details.</p>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── Alerts tab ───────────────────────────────────────────────────────

  const renderAlertsTab = () => {
    if (alertsLoading && alerts.length === 0) {
      return (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-red-500" />
        </div>
      );
    }

    if (alerts.length === 0) {
      return (
        <div className="text-center py-12 text-muted">
          <svg className="w-12 h-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p>No anomaly alerts</p>
        </div>
      );
    }

    return (
      <div className="space-y-2">
        {alerts.map((alert) => (
          <div
            key={alert.id}
            className={`bg-surface rounded-xl border shadow-card p-4 ${
              alert.acknowledgedAt ? "border-t-border opacity-60" : "border-red-500/30"
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-foreground">{alert.rule}</span>
                  {renderRiskDot(alert.riskScore)}
                  {alert.session && renderClientBadge(alert.session.clientType)}
                  {alert.session && (
                    <span className="text-xs text-muted bg-surface-2 px-2 py-0.5 rounded">
                      {alert.session.environment}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 mt-1 text-xs text-muted">
                  <span>{alert.session?.userEmail || "Unknown"}</span>
                  <span>--</span>
                  <span>{formatDate(alert.createdAt)}</span>
                  {alert.session && (
                    <>
                      <span>--</span>
                      <span className="font-mono">{maskIp(alert.session.ipAddress)}</span>
                    </>
                  )}
                </div>

                {alert.acknowledgedAt && (
                  <div className="mt-1 text-xs text-green-400">
                    Acknowledged {formatDate(alert.acknowledgedAt)}
                    {alert.acknowledgeNote && (
                      <span className="text-muted ml-1">-- {alert.acknowledgeNote}</span>
                    )}
                  </div>
                )}

                <details className="mt-2 text-xs">
                  <summary className="text-muted cursor-pointer hover:text-foreground">Evidence</summary>
                  <pre className="mt-1 p-2 bg-surface-2 rounded text-xs overflow-x-auto text-muted">
                    {JSON.stringify(alert.evidence, null, 2)}
                  </pre>
                </details>
              </div>

              {!alert.acknowledgedAt && (
                <button
                  onClick={() => acknowledgeAlert(alert.id)}
                  disabled={acknowledging === alert.id}
                  className="px-3 py-1.5 text-xs rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50 shrink-0"
                >
                  {acknowledging === alert.id ? "..." : "Acknowledge"}
                </button>
              )}
            </div>
          </div>
        ))}

        {hasMoreAlerts && (
          <div className="mt-4 flex justify-center">
            <button
              onClick={() => {
                const nextOffset = alertsOffset + 50;
                setAlertsOffset(nextOffset);
                fetchAlerts(true, nextOffset);
              }}
              className="px-4 py-2 bg-surface-2 hover:bg-surface-elevated text-foreground rounded-lg transition-colors text-sm"
            >
              Load More ({alerts.length} of {alertsTotal})
            </button>
          </div>
        )}
      </div>
    );
  };

  // ── Sessions tab (table view) ────────────────────────────────────────

  const renderSessionsTab = () => {
    if (sessionsLoading) {
      return (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-red-500" />
        </div>
      );
    }

    if (sessions.length === 0) {
      return (
        <div className="text-center py-12 text-muted">
          <p>No sessions match your filters</p>
        </div>
      );
    }

    return (
      <div className="bg-surface rounded-xl border border-t-border shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-t-border bg-surface-2/50">
                <th className="text-left text-xs text-muted font-medium px-4 py-3">User</th>
                <th className="text-left text-xs text-muted font-medium px-4 py-3">Client</th>
                <th className="text-left text-xs text-muted font-medium px-4 py-3">Env</th>
                <th className="text-left text-xs text-muted font-medium px-4 py-3">Risk</th>
                <th className="text-right text-xs text-muted font-medium px-4 py-3">Activities</th>
                <th className="text-right text-xs text-muted font-medium px-4 py-3">Anomalies</th>
                <th className="text-left text-xs text-muted font-medium px-4 py-3">IP</th>
                <th className="text-left text-xs text-muted font-medium px-4 py-3">Started</th>
                <th className="text-left text-xs text-muted font-medium px-4 py-3">Duration</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr
                  key={s.id}
                  className="border-b border-t-border/50 hover:bg-surface-2/30 transition-colors cursor-pointer"
                  onClick={() => toggleSessionDetail(s.id)}
                >
                  <td className="px-4 py-3 text-foreground truncate max-w-[180px]">
                    {s.userEmail || "Unknown"}
                  </td>
                  <td className="px-4 py-3">{renderClientBadge(s.clientType)}</td>
                  <td className="px-4 py-3 text-muted">{s.environment}</td>
                  <td className="px-4 py-3">{renderRiskDot(s.riskScore)}</td>
                  <td className="px-4 py-3 text-right text-muted">{s._count.activities}</td>
                  <td className="px-4 py-3 text-right">
                    {s._count.anomalyEvents > 0 ? (
                      <span className="text-red-400">{s._count.anomalyEvents}</span>
                    ) : (
                      <span className="text-muted">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted font-mono text-xs">{maskIp(s.ipAddress)}</td>
                  <td className="px-4 py-3 text-muted text-xs">{formatDate(s.startedAt)}</td>
                  <td className="px-4 py-3 text-muted text-xs">{formatDuration(s.startedAt, s.endedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Expanded session detail panel below table */}
        {expandedSessionId && sessionDetail && (
          <div className="border-t border-t-border p-4 bg-surface-2/30">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-foreground">
                Session: {sessionDetail.userEmail || "Unknown"}
              </span>
              <button
                onClick={() => { setExpandedSessionId(null); setSessionDetail(null); }}
                className="text-muted hover:text-foreground text-xs"
              >
                Close
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-3">
              <div>
                <span className="text-muted text-xs block">Full IP</span>
                <span className="font-mono text-foreground">{sessionDetail.ipAddress}</span>
              </div>
              <div>
                <span className="text-muted text-xs block">Risk Level</span>
                <span className="text-foreground">{sessionDetail.riskLevel}</span>
              </div>
              <div>
                <span className="text-muted text-xs block">Activities</span>
                <span className="text-foreground">{sessionDetail.activities.length}</span>
              </div>
              <div>
                <span className="text-muted text-xs block">Anomalies</span>
                <span className={sessionDetail.anomalyEvents.length > 0 ? "text-red-400" : "text-foreground"}>
                  {sessionDetail.anomalyEvents.length}
                </span>
              </div>
            </div>

            {sessionDetail.activities.length > 0 && (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {sessionDetail.activities.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 text-xs py-1 border-b border-t-border/50 last:border-0">
                    <span className="text-muted font-mono w-16 shrink-0">
                      {new Date(a.createdAt).toLocaleTimeString()}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-surface-2 text-muted">
                      {a.type.replace(/_/g, " ")}
                    </span>
                    <span className="text-foreground truncate">{a.description}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── Main render ──────────────────────────────────────────────────────

  return (
    <DashboardShell
      title="Audit Dashboard"
      accentColor="red"
      breadcrumbs={[{ label: "Admin", href: "/admin/users" }, { label: "Audit" }]}
    >
      {/* Metric Cards Row */}
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

      {/* Filter Bar */}
      <div className="mb-6 bg-surface rounded-xl border border-t-border p-4 shadow-card space-y-3">
        {/* Date range */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-muted">Date Range:</span>
          {(["today", "7d", "30d", "all"] as const).map((range) => (
            <button
              key={range}
              onClick={() => setFilterDateRange(range)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                filterDateRange === range
                  ? "bg-red-600 text-white"
                  : "bg-surface-2 text-muted hover:text-foreground"
              }`}
            >
              {range === "today" && "Today"}
              {range === "7d" && "Last 7 Days"}
              {range === "30d" && "Last 30 Days"}
              {range === "all" && "All Time"}
            </button>
          ))}
        </div>

        {/* Dropdowns and search */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Environment */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">Environment:</span>
            <select
              value={filterEnv}
              onChange={(e) => setFilterEnv(e.target.value)}
              className="bg-surface-2 border border-t-border rounded-lg px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              <option value="">All</option>
              {ENVIRONMENTS.map((env) => (
                <option key={env} value={env}>{env}</option>
              ))}
            </select>
          </div>

          {/* Client Type */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">Client:</span>
            <select
              value={filterClient}
              onChange={(e) => setFilterClient(e.target.value)}
              className="bg-surface-2 border border-t-border rounded-lg px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              <option value="">All</option>
              {CLIENT_TYPES.map((ct) => (
                <option key={ct} value={ct}>
                  {CLIENT_TYPE_BADGES[ct]?.label || ct}
                </option>
              ))}
            </select>
          </div>

          {/* Min Risk */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">Min Risk:</span>
            <select
              value={filterMinRisk}
              onChange={(e) => setFilterMinRisk(parseInt(e.target.value))}
              className="bg-surface-2 border border-t-border rounded-lg px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              <option value={0}>Any</option>
              <option value={1}>1 - Low</option>
              <option value={2}>2 - Medium</option>
              <option value={3}>3 - High</option>
              <option value={4}>4 - Critical</option>
            </select>
          </div>

          {/* Email search */}
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <span className="text-xs text-muted">Email:</span>
            <input
              type="text"
              placeholder="Filter by email..."
              value={filterEmail}
              onChange={(e) => setFilterEmail(e.target.value)}
              className="bg-surface-2 border border-t-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-red-500 flex-1"
            />
          </div>

          {/* Refresh */}
          <button
            onClick={() => {
              fetchSessions(false, 0);
              fetchStats();
              if (activeTab === "alerts") fetchAlerts(false, 0);
            }}
            className="text-muted hover:text-foreground p-1.5 rounded-lg hover:bg-surface-2 transition-colors"
            title="Refresh"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-surface-2/50 p-1 rounded-lg w-fit">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm rounded-md transition-colors ${
              activeTab === tab.id
                ? "bg-surface text-foreground shadow-card font-medium"
                : "text-muted hover:text-foreground"
            }`}
          >
            {tab.label}
            {tab.id === "alerts" && stats && stats.anomalyCount > 0 && (
              <span className="ml-1.5 text-xs bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full">
                {stats.anomalyCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "timeline" && (
        <>
          {sessionsLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-red-500" />
            </div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-12 text-muted">
              <svg className="w-12 h-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p>No audit sessions match your filters</p>
              <p className="text-sm mt-1">Try adjusting your search criteria or date range</p>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                {sessions.map(renderSessionRow)}
              </div>

              {hasMoreSessions && (
                <div className="mt-6 flex justify-center">
                  <button
                    onClick={handleLoadMoreSessions}
                    disabled={sessionsLoadingMore}
                    className="px-4 py-2 bg-surface-2 hover:bg-surface-elevated text-foreground rounded-lg transition-colors text-sm disabled:opacity-50 flex items-center gap-2"
                  >
                    {sessionsLoadingMore ? (
                      <>
                        <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-foreground" />
                        Loading...
                      </>
                    ) : (
                      `Load More (${sessions.length} of ${sessionsTotal})`
                    )}
                  </button>
                </div>
              )}

              <div className="mt-4 text-center text-xs text-muted">
                Showing {sessions.length.toLocaleString()} of {sessionsTotal.toLocaleString()} sessions
              </div>
            </>
          )}
        </>
      )}

      {activeTab === "alerts" && renderAlertsTab()}
      {activeTab === "sessions" && renderSessionsTab()}
    </DashboardShell>
  );
}
