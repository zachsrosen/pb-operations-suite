"use client";

import React, { useState, useEffect, useCallback } from "react";
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
  LOGOUT: { color: "text-zinc-400", icon: "M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" },
  USER_CREATED: { color: "text-blue-400", icon: "M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" },
  USER_ROLE_CHANGED: { color: "text-purple-400", icon: "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" },
  USER_UPDATED: { color: "text-cyan-400", icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" },
  USER_DELETED: { color: "text-red-400", icon: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" },
  SURVEY_SCHEDULED: { color: "text-emerald-400", icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
  SURVEY_RESCHEDULED: { color: "text-yellow-400", icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
  INSTALL_SCHEDULED: { color: "text-emerald-400", icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
  ZUPER_JOB_CREATED: { color: "text-orange-400", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" },
  SETTINGS_CHANGED: { color: "text-zinc-400", icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" },
  ERROR_OCCURRED: { color: "text-red-400", icon: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" },
};

const DEFAULT_ACTIVITY = { color: "text-zinc-400", icon: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" };

export default function AdminActivityPage() {
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");

  const fetchActivities = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ limit: "100" });
      if (filter !== "all") {
        params.set("type", filter);
      }
      const response = await fetch(`/api/admin/activity?${params}`);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to fetch activities");
      }
      const data = await response.json();
      setActivities(data.activities);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

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

  const getActivityStyle = (type: string) => {
    return ACTIVITY_TYPES[type] || DEFAULT_ACTIVITY;
  };

  const uniqueTypes = [...new Set(activities.map(a => a.type))];

  if (error) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 text-xl mb-2">Error</p>
          <p className="text-zinc-500 text-sm mb-4">{error}</p>
          <Link href="/" className="px-4 py-2 bg-zinc-700 rounded-lg hover:bg-zinc-600">
            Go Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-[#0a0a0f]/95 backdrop-blur border-b border-zinc-800">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/" className="text-zinc-500 hover:text-white">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </Link>
              <h1 className="text-xl font-bold">Activity Log</h1>
              <span className="text-xs text-zinc-500 bg-zinc-800 px-2 py-1 rounded">
                {activities.length} events
              </span>
            </div>

            {/* Navigation */}
            <div className="flex items-center gap-2">
              <Link
                href="/admin/users"
                className="text-xs text-zinc-400 hover:text-white px-3 py-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
              >
                Users
              </Link>
              <span className="text-xs text-white px-3 py-1.5 rounded-lg bg-zinc-800">
                Activity
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Filter */}
        <div className="mb-6 flex items-center gap-3">
          <span className="text-sm text-zinc-400">Filter:</span>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
          >
            <option value="all">All Activities</option>
            {uniqueTypes.map(type => (
              <option key={type} value={type}>{type.replace(/_/g, " ")}</option>
            ))}
          </select>
          <button
            onClick={fetchActivities}
            className="text-zinc-400 hover:text-white p-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
            title="Refresh"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>

        {/* Activity List */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-500" />
          </div>
        ) : activities.length === 0 ? (
          <div className="text-center py-12 text-zinc-500">
            <svg className="w-12 h-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p>No activity yet</p>
            <p className="text-sm mt-1">Activities will appear here as users interact with the system</p>
          </div>
        ) : (
          <div className="space-y-2">
            {activities.map(activity => {
              const style = getActivityStyle(activity.type);
              return (
                <div
                  key={activity.id}
                  className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 hover:border-zinc-700 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    {/* Icon */}
                    <div className={`p-2 rounded-lg bg-zinc-800 ${style.color}`}>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={style.icon} />
                      </svg>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white">{activity.description}</p>
                      <div className="flex items-center gap-2 mt-1 text-xs text-zinc-500">
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

                      {/* Metadata */}
                      {activity.metadata && Object.keys(activity.metadata).length > 0 && (
                        <details className="mt-2">
                          <summary className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-400">
                            Details
                          </summary>
                          <pre className="mt-2 p-2 bg-zinc-800 rounded text-xs overflow-x-auto text-zinc-400">
                            {JSON.stringify(activity.metadata, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>

                    {/* Type Badge */}
                    <span className={`text-xs px-2 py-1 rounded-full bg-zinc-800 ${style.color}`}>
                      {activity.type.replace(/_/g, " ")}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
