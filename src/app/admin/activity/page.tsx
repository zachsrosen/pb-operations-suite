"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";

interface ActivityLog {
  id: string;
  type: string;
  description: string;
  userId: string | null;
  userEmail: string | null;
  entityType: string | null;
  entityId: string | null;
  entityName: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  user: {
    name: string | null;
    email: string;
    image: string | null;
  } | null;
}

const ACTIVITY_TYPES: Record<string, { color: string; icon: string }> = {
  LOGIN: { color: "text-green-400", icon: "M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" },
  LOGOUT: { color: "text-muted", icon: "M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" },
  USER_CREATED: { color: "text-blue-400", icon: "M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" },
  USER_ROLE_CHANGED: { color: "text-purple-400", icon: "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" },
  USER_UPDATED: { color: "text-cyan-400", icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" },
  USER_DELETED: { color: "text-red-400", icon: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" },
  SURVEY_SCHEDULED: { color: "text-emerald-400", icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
  SURVEY_RESCHEDULED: { color: "text-yellow-400", icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
  INSTALL_SCHEDULED: { color: "text-emerald-400", icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
  ZUPER_JOB_CREATED: { color: "text-orange-400", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" },
  DASHBOARD_VIEWED: { color: "text-blue-400", icon: "M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" },
  SETTINGS_CHANGED: { color: "text-muted", icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" },
  ERROR_OCCURRED: { color: "text-red-400", icon: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" },
  INVENTORY_RECEIVED: { color: "text-emerald-400", icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" },
  INVENTORY_ADJUSTED: { color: "text-amber-400", icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" },
  INVENTORY_ALLOCATED: { color: "text-orange-400", icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" },
};

const DEFAULT_ACTIVITY = { color: "text-muted", icon: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" };

const PAGE_SIZE = 100;

export default function AdminActivityPage() {
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [dateRange, setDateRange] = useState<"today" | "7d" | "30d" | "all">("all");
  const [searchEmail, setSearchEmail] = useState<string>("");
  const [debouncedEmail, setDebouncedEmail] = useState<string>("");
  const [autoRefresh, setAutoRefresh] = useState<boolean>(false);
  const [allTypes, setAllTypes] = useState<string[]>([]);

  // Debounce email search
  const emailTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    emailTimer.current = setTimeout(() => {
      setDebouncedEmail(searchEmail);
    }, 400);
    return () => clearTimeout(emailTimer.current);
  }, [searchEmail]);

  // Fetch distinct activity types on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/activity?meta=types");
        if (res.ok) {
          const data = await res.json();
          setAllTypes(data.types || []);
        }
      } catch {
        /* ignore */
      }
    })();
  }, []);

  // Build the "since" date from dateRange
  const sinceDate = useMemo(() => {
    const now = new Date();
    switch (dateRange) {
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
  }, [dateRange]);

  const fetchActivities = useCallback(
    async (appendMode = false, customOffset?: number) => {
      try {
        if (appendMode) {
          setLoadingMore(true);
        } else {
          setLoading(true);
        }

        const params = new URLSearchParams({
          limit: PAGE_SIZE.toString(),
          offset: (customOffset ?? (appendMode ? offset : 0)).toString(),
        });

        if (typeFilter !== "all") params.set("type", typeFilter);
        if (sinceDate) params.set("since", sinceDate);
        if (debouncedEmail.trim()) params.set("email", debouncedEmail.trim());

        const response = await fetch(`/api/admin/activity?${params}`);
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Failed to fetch activities");
        }

        const data = await response.json();

        if (appendMode) {
          setActivities((prev) => [...prev, ...data.activities]);
        } else {
          setActivities(data.activities);
          setOffset(0);
        }

        setTotal(data.total);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [typeFilter, sinceDate, debouncedEmail, offset]
  );

  // Re-fetch from start when filters change
  useEffect(() => {
    setOffset(0);
    fetchActivities(false, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, sinceDate, debouncedEmail]);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => fetchActivities(false, 0), 30000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchActivities]);

  // Load more handler
  const handleLoadMore = () => {
    const nextOffset = offset + PAGE_SIZE;
    setOffset(nextOffset);
    fetchActivities(true, nextOffset);
  };

  const formatDate = (dateString: string) => {
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
  };

  const formatMetadata = (type: string, metadata: Record<string, unknown> | null): string => {
    if (!metadata) return "";

    switch (type) {
      case "DASHBOARD_VIEWED":
        return `Viewed ${metadata.dashboard || "dashboard"}`;
      case "SURVEY_SCHEDULED":
      case "INSTALL_SCHEDULED":
      case "INSPECTION_SCHEDULED":
        return `Scheduled for ${metadata.date || "unknown date"}`;
      case "SEARCH":
        return `Searched '${metadata.query || ""}' - ${metadata.resultCount || 0} results`;
      case "FILTER":
        return `Filter: ${metadata.name || "unknown"} = ${metadata.values || ""}`;
      default:
        return "";
    }
  };

  // Summary counts from loaded activities
  const activityTypeCounts = useMemo(() => {
    return {
      logins: activities.filter(a => a.type === "LOGIN").length,
      dashboardViews: activities.filter(a => a.type === "DASHBOARD_VIEWED").length,
      schedules: activities.filter(
        a => a.type.includes("SCHEDULED") || a.type.includes("RESCHEDULED")
      ).length,
      exports: activities.filter(a => a.type.includes("EXPORT") || a.type.includes("DOWNLOADED")).length,
      inventory: activities.filter(a => a.type.startsWith("INVENTORY_")).length,
    };
  }, [activities]);

  const exportToCSV = () => {
    if (activities.length === 0) {
      alert("No activities to export");
      return;
    }

    const headers = ["Timestamp", "User", "Type", "Details", "IP"];
    const rows = activities.map(activity => [
      new Date(activity.createdAt).toLocaleString(),
      activity.user?.email || activity.userEmail || "System",
      activity.type,
      activity.description,
      activity.ipAddress || "N/A",
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `activity-log-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
  };

  const getActivityStyle = (type: string) => {
    return ACTIVITY_TYPES[type] || DEFAULT_ACTIVITY;
  };

  const hasMore = activities.length < total;

  if (error) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 text-xl mb-2">Error</p>
          <p className="text-muted text-sm mb-4">{error}</p>
          <Link href="/" className="px-4 py-2 bg-surface-2 rounded-lg hover:bg-zinc-600">
            Go Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-t-border">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/" className="text-muted hover:text-foreground">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </Link>
              <h1 className="text-xl font-bold">Activity Log</h1>
              <span className="text-xs text-muted bg-surface-2 px-2 py-1 rounded">
                {total.toLocaleString()} total
              </span>
            </div>

            {/* Navigation */}
            <div className="flex items-center gap-2">
              <Link
                href="/admin/users"
                className="text-xs text-muted hover:text-foreground px-3 py-1.5 rounded-lg hover:bg-surface-2 transition-colors"
              >
                Users
              </Link>
              <span className="text-xs text-white px-3 py-1.5 rounded-lg bg-surface-2">
                Activity
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Stats Summary */}
        <div className="mb-6 grid grid-cols-5 gap-3">
          <div className="bg-surface rounded-lg border border-t-border p-3">
            <div className="text-xs text-muted mb-1">Logins</div>
            <div className="text-2xl font-bold text-green-400">{activityTypeCounts.logins}</div>
          </div>
          <div className="bg-surface rounded-lg border border-t-border p-3">
            <div className="text-xs text-muted mb-1">Dashboard Views</div>
            <div className="text-2xl font-bold text-blue-400">{activityTypeCounts.dashboardViews}</div>
          </div>
          <div className="bg-surface rounded-lg border border-t-border p-3">
            <div className="text-xs text-muted mb-1">Schedules</div>
            <div className="text-2xl font-bold text-emerald-400">{activityTypeCounts.schedules}</div>
          </div>
          <div className="bg-surface rounded-lg border border-t-border p-3">
            <div className="text-xs text-muted mb-1">Exports</div>
            <div className="text-2xl font-bold text-orange-400">{activityTypeCounts.exports}</div>
          </div>
          <div className="bg-surface rounded-lg border border-t-border p-3">
            <div className="text-xs text-muted mb-1">Inventory</div>
            <div className="text-2xl font-bold text-cyan-400">{activityTypeCounts.inventory}</div>
          </div>
        </div>

        {/* Filter and Controls */}
        <div className="mb-6 space-y-4">
          {/* Date Range Filter */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted">Date Range:</span>
            <div className="flex gap-2">
              {(["today", "7d", "30d", "all"] as const).map(range => (
                <button
                  key={range}
                  onClick={() => setDateRange(range)}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                    dateRange === range
                      ? "bg-cyan-600 text-white"
                      : "bg-surface-2 text-muted hover:text-foreground hover:bg-surface-2"
                  }`}
                >
                  {range === "today" && "Today"}
                  {range === "7d" && "Last 7 Days"}
                  {range === "30d" && "Last 30 Days"}
                  {range === "all" && "All Time"}
                </button>
              ))}
            </div>
          </div>

          {/* Type Filter and Search */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="flex items-center gap-3 flex-1">
              <span className="text-sm text-muted">Type:</span>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="bg-surface-2 border border-t-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
              >
                <option value="all">All Activities</option>
                {allTypes.map(type => (
                  <option key={type} value={type}>{type.replace(/_/g, " ")}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-3 flex-1">
              <span className="text-sm text-muted">Search:</span>
              <input
                type="email"
                placeholder="Filter by email..."
                value={searchEmail}
                onChange={(e) => setSearchEmail(e.target.value)}
                className="bg-surface-2 border border-t-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 flex-1"
              />
            </div>

            {/* Control Buttons */}
            <div className="flex gap-2">
              <button
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={`p-1.5 rounded-lg transition-colors ${
                  autoRefresh
                    ? "bg-green-600/20 text-green-400 border border-green-600/50"
                    : "text-muted hover:text-foreground hover:bg-surface-2"
                }`}
                title={autoRefresh ? "Disable auto-refresh" : "Enable auto-refresh (every 30s)"}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </button>
              <button
                onClick={() => fetchActivities(false, 0)}
                className="text-muted hover:text-foreground p-1.5 rounded-lg hover:bg-surface-2 transition-colors"
                title="Refresh"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
              <button
                onClick={exportToCSV}
                className="text-muted hover:text-foreground px-3 py-1.5 rounded-lg hover:bg-surface-2 transition-colors text-sm"
                title="Export to CSV"
              >
                <svg className="w-4 h-4 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                CSV
              </button>
            </div>
          </div>
        </div>

        {/* Activity List */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-500" />
          </div>
        ) : activities.length === 0 ? (
          <div className="text-center py-12 text-muted">
            <svg className="w-12 h-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p>No activities match your filters</p>
            <p className="text-sm mt-1">Try adjusting your search criteria or date range</p>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {activities.map(activity => {
                const style = getActivityStyle(activity.type);
                const metadataDisplay = formatMetadata(activity.type, activity.metadata);
                return (
                  <div
                    key={activity.id}
                    className="bg-surface rounded-xl border border-t-border p-4 hover:border-t-border transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      {/* Icon */}
                      <div className={`p-2 rounded-lg bg-surface-2 ${style.color}`}>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={style.icon} />
                        </svg>
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white">{activity.description}</p>
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted flex-wrap">
                          {activity.user ? (
                            <span>{activity.user.name || activity.user.email}</span>
                          ) : activity.userEmail ? (
                            <span>{activity.userEmail}</span>
                          ) : (
                            <span>System</span>
                          )}
                          <span>•</span>
                          <span>{formatDate(activity.createdAt)}</span>
                          {activity.ipAddress && (
                            <>
                              <span>•</span>
                              <span className="font-mono">{activity.ipAddress}</span>
                            </>
                          )}
                        </div>

                        {/* Formatted Metadata */}
                        {metadataDisplay && (
                          <p className="mt-2 text-xs text-muted italic">{metadataDisplay}</p>
                        )}

                        {/* Raw Metadata Details */}
                        {activity.metadata && Object.keys(activity.metadata).length > 0 && !metadataDisplay && (
                          <details className="mt-2">
                            <summary className="text-xs text-muted cursor-pointer hover:text-muted">
                              Details
                            </summary>
                            <pre className="mt-2 p-2 bg-surface-2 rounded text-xs overflow-x-auto text-muted">
                              {JSON.stringify(activity.metadata, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>

                      {/* Type Badge */}
                      <span className={`text-xs px-2 py-1 rounded-full bg-surface-2 ${style.color} whitespace-nowrap`}>
                        {activity.type.replace(/_/g, " ")}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Load More Button */}
            {hasMore && (
              <div className="mt-6 flex justify-center">
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="px-4 py-2 bg-surface-2 hover:bg-surface-elevated text-white rounded-lg transition-colors text-sm disabled:opacity-50 flex items-center gap-2"
                >
                  {loadingMore ? (
                    <>
                      <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                      Loading...
                    </>
                  ) : (
                    `Load More (${activities.length.toLocaleString()} of ${total.toLocaleString()})`
                  )}
                </button>
              </div>
            )}

            {/* Results Summary */}
            <div className="mt-4 text-center text-xs text-muted">
              Showing {activities.length.toLocaleString()} of {total.toLocaleString()} activities
            </div>
          </>
        )}
      </div>
    </div>
  );
}
