"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import DashboardShell from "@/components/DashboardShell";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorState } from "@/components/ui/ErrorState";
import { useSSE } from "@/hooks/useSSE";
import { useActivityTracking } from "@/hooks/useActivityTracking";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PriorityTier = "critical" | "high" | "medium" | "low";

interface QueueItem {
  id: string;
  type: "deal" | "ticket";
  title: string;
  stage: string;
  lastModified: string;
  lastContactDate?: string | null;
  createDate: string;
  amount?: number | null;
  location?: string | null;
  url?: string;
  warrantyExpiry?: string | null;
}

interface PriorityScore {
  item: QueueItem;
  score: number;
  tier: PriorityTier;
  reasons: string[];
  overridden?: boolean;
}

interface QueueStats {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
}

interface PriorityQueueResponse {
  queue: PriorityScore[];
  stats: QueueStats;
  locations: string[];
  lastUpdated: string;
}

// ---------------------------------------------------------------------------
// Tier config helpers
// ---------------------------------------------------------------------------

const TIER_CONFIG: Record<PriorityTier, {
  border: string;
  bg: string;
  text: string;
  badge: string;
  label: string;
}> = {
  critical: {
    border: "border-l-red-500",
    bg: "bg-red-500/20",
    text: "text-red-400",
    badge: "bg-red-500/20 text-red-400 border border-red-500/40",
    label: "Critical",
  },
  high: {
    border: "border-l-orange-500",
    bg: "bg-orange-500/20",
    text: "text-orange-400",
    badge: "bg-orange-500/20 text-orange-400 border border-orange-500/40",
    label: "High",
  },
  medium: {
    border: "border-l-yellow-500",
    bg: "bg-yellow-500/20",
    text: "text-yellow-400",
    badge: "bg-yellow-500/20 text-yellow-400 border border-yellow-500/40",
    label: "Medium",
  },
  low: {
    border: "border-l-zinc-500",
    bg: "bg-zinc-500/20",
    text: "text-zinc-400",
    badge: "bg-zinc-500/20 text-zinc-400 border border-zinc-500/40",
    label: "Low",
  },
};

const ALL_TIERS: PriorityTier[] = ["critical", "high", "medium", "low"];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <div className="bg-surface rounded-xl p-4 border border-t-border">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-sm text-muted">{label}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ServiceOverviewPage() {
  const [data, setData] = useState<PriorityQueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterLocation, setFilterLocation] = useState("all");
  const [filterTier, setFilterTier] = useState<PriorityTier | "all">("all");
  const [overridingId, setOverridingId] = useState<string | null>(null);
  const [overrideLoading, setOverrideLoading] = useState(false);

  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  // ---- Data fetching --------------------------------------------------------

  const fetchData = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterLocation !== "all") params.set("location", filterLocation);

      const res = await fetch(`/api/service/priority-queue?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json: PriorityQueueResponse = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load priority queue");
    } finally {
      setLoading(false);
    }
  }, [filterLocation]);

  // Initial load + refetch when location filter changes
  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]);

  // Real-time updates via SSE
  const { connected } = useSSE(fetchData, {
    url: "/api/stream",
    cacheKeyFilter: "service:priority-queue",
  });

  // Activity tracking — fire once after first load
  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("service-overview", {
        projectCount: data?.queue.length ?? 0,
      });
    }
  }, [loading, data?.queue.length, trackDashboardView]);

  // ---- Override handler -----------------------------------------------------

  const handleOverride = useCallback(
    async (item: QueueItem, priority: PriorityTier) => {
      setOverrideLoading(true);
      try {
        const res = await fetch("/api/service/priority-queue/overrides", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            itemId: item.id,
            itemType: item.type,
            priority,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        await fetchData();
      } catch (err) {
        console.error("[ServiceOverview] Override failed:", err);
      } finally {
        setOverrideLoading(false);
        setOverridingId(null);
      }
    },
    [fetchData]
  );

  // ---- Derived data ---------------------------------------------------------

  const filteredQueue = data?.queue.filter((entry) => {
    if (filterTier !== "all" && entry.tier !== filterTier) return false;
    return true;
  }) ?? [];

  // Scheduled today: items whose createDate is today (placeholder logic — API doesn't expose scheduled date yet)
  const scheduledToday = 0;
  // Overdue items: critical or high tier
  const overdueCount = (data?.stats.critical ?? 0) + (data?.stats.high ?? 0);

  // ---- Loading / error states -----------------------------------------------

  if (loading && !data) {
    return (
      <DashboardShell title="Service Overview" accentColor="cyan">
        <LoadingSpinner color="cyan" message="Loading priority queue..." />
      </DashboardShell>
    );
  }

  if (error && !data) {
    return (
      <DashboardShell title="Service Overview" accentColor="cyan">
        <ErrorState message={error} onRetry={fetchData} color="cyan" />
      </DashboardShell>
    );
  }

  // ---- Header controls ------------------------------------------------------

  const headerRight = (
    <div className="flex items-center gap-2">
      {/* SSE indicator */}
      <span
        className={`h-2 w-2 rounded-full ${connected ? "bg-green-400" : "bg-zinc-500"}`}
        title={connected ? "Live" : "Disconnected"}
      />
      <button
        onClick={() => {
          setLoading(true);
          fetchData();
        }}
        className="bg-cyan-600 hover:bg-cyan-700 px-4 py-2 rounded-lg text-sm font-medium text-white"
      >
        Refresh
      </button>
    </div>
  );

  // ---- Render ---------------------------------------------------------------

  return (
    <DashboardShell
      title="Service Overview"
      accentColor="cyan"
      lastUpdated={data?.lastUpdated ?? null}
      headerRight={headerRight}
    >
      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 stagger-grid">
        <StatCard
          label="Open Tickets"
          value={data?.stats.total ?? 0}
          color="text-cyan-400"
        />
        <StatCard
          label="Active Deals"
          value={data?.stats.total ?? 0}
          color="text-blue-400"
        />
        <StatCard
          label="Overdue Items"
          value={overdueCount}
          color="text-red-400"
        />
        <StatCard
          label="Scheduled Today"
          value={scheduledToday}
          color="text-green-400"
        />
      </div>

      {/* Priority Queue */}
      <div className="bg-surface rounded-xl border border-t-border overflow-hidden mb-6">
        {/* Queue header + tier filter */}
        <div className="p-4 border-b border-t-border">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-foreground">
              Priority Queue
              <span className="ml-2 text-sm font-normal text-muted">
                ({filteredQueue.length} items)
              </span>
            </h2>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Tier filter buttons */}
              <button
                onClick={() => setFilterTier("all")}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                  filterTier === "all"
                    ? "bg-cyan-600 text-white"
                    : "bg-surface-2 text-muted hover:text-foreground"
                }`}
              >
                All
              </button>
              {ALL_TIERS.map((tier) => {
                const cfg = TIER_CONFIG[tier];
                return (
                  <button
                    key={tier}
                    onClick={() => setFilterTier(tier)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                      filterTier === tier
                        ? `${cfg.bg} ${cfg.text}`
                        : "bg-surface-2 text-muted hover:text-foreground"
                    }`}
                  >
                    {cfg.label}
                    {data && (
                      <span className="ml-1 opacity-70">
                        ({data.stats[tier]})
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Queue items */}
        <div className="divide-y divide-t-border">
          {filteredQueue.length === 0 ? (
            <div className="px-4 py-12 text-center text-muted">
              {filterTier !== "all"
                ? `No ${filterTier} priority items`
                : "No items in priority queue"}
            </div>
          ) : (
            filteredQueue.map((entry) => {
              const { item, tier, score, reasons, overridden } = entry;
              const cfg = TIER_CONFIG[tier];

              return (
                <div
                  key={`${item.type}:${item.id}`}
                  className={`flex items-start gap-4 px-4 py-4 border-l-4 ${cfg.border} hover:bg-surface-2/50 transition-colors`}
                >
                  {/* Left: title + reasons */}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      {/* Title — linked if URL available */}
                      {item.url ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-foreground hover:text-cyan-400 truncate"
                        >
                          {item.title}
                        </a>
                      ) : (
                        <span className="font-medium text-foreground truncate">
                          {item.title}
                        </span>
                      )}

                      {/* Type badge */}
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-surface-2 text-muted capitalize">
                        {item.type}
                      </span>

                      {/* Override indicator */}
                      {overridden && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-violet-500/20 text-violet-400">
                          Overridden
                        </span>
                      )}
                    </div>

                    {/* Stage + location */}
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted mb-2">
                      <span>{item.stage}</span>
                      {item.location && (
                        <>
                          <span className="opacity-40">·</span>
                          <span>{item.location}</span>
                        </>
                      )}
                    </div>

                    {/* Score reasons */}
                    <div className="flex flex-wrap gap-1">
                      {reasons.map((reason, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-surface-2 text-muted"
                        >
                          {reason}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Right: tier badge + score + override */}
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    {/* Tier badge / override trigger */}
                    <div className="relative">
                      <button
                        onClick={() =>
                          setOverridingId(
                            overridingId === `${item.type}:${item.id}`
                              ? null
                              : `${item.type}:${item.id}`
                          )
                        }
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${cfg.badge} cursor-pointer hover:opacity-80 transition-opacity`}
                        title="Click to override priority"
                      >
                        {cfg.label}
                        <svg
                          className="w-3 h-3 opacity-60"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 9l-7 7-7-7"
                          />
                        </svg>
                      </button>

                      {/* Override dropdown */}
                      {overridingId === `${item.type}:${item.id}` && (
                        <div className="absolute right-0 top-full mt-1 bg-surface-elevated border border-t-border rounded-lg shadow-card z-10 min-w-[130px]">
                          <div className="p-1">
                            <p className="text-xs text-muted px-2 py-1 mb-1">
                              Set priority:
                            </p>
                            {ALL_TIERS.map((t) => {
                              const tcfg = TIER_CONFIG[t];
                              return (
                                <button
                                  key={t}
                                  disabled={overrideLoading}
                                  onClick={() => handleOverride(item, t)}
                                  className={`w-full text-left px-2 py-1.5 rounded text-xs font-medium hover:opacity-80 transition-opacity disabled:opacity-50 ${tcfg.bg} ${tcfg.text}`}
                                >
                                  {tcfg.label}
                                </button>
                              );
                            })}
                            <button
                              onClick={() => setOverridingId(null)}
                              className="w-full text-left px-2 py-1.5 rounded text-xs text-muted hover:text-foreground mt-1"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Score */}
                    <span className="text-xs text-muted">
                      Score: <span className={`font-medium ${cfg.text}`}>{score}</span>
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Bottom bar: location filter */}
      <div className="flex items-center justify-between gap-4 bg-surface rounded-xl border border-t-border p-4">
        <span className="text-sm text-muted">Filter by location:</span>
        <select
          value={filterLocation}
          onChange={(e) => setFilterLocation(e.target.value)}
          className="bg-surface-2 border border-t-border rounded-lg px-3 py-2 text-sm text-foreground"
        >
          <option value="all">All Locations</option>
          {(data?.locations ?? []).map((loc) => (
            <option key={loc} value={loc}>
              {loc}
            </option>
          ))}
        </select>
      </div>
    </DashboardShell>
  );
}
