"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import DashboardShell from "@/components/DashboardShell";
import { StatCard } from "@/components/ui/MetricCard";
import { MultiSelectFilter, type FilterOption } from "@/components/ui/MultiSelectFilter";
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
  ownerId?: string | null;
  serviceType?: string | null;
}

interface PriorityScore {
  item: QueueItem;
  score: number;
  tier: PriorityTier;
  reasons: string[];
  overridden?: boolean;
  reasonCategories?: string[];
  serviceType?: string | null;
  lastContactSource?: string | null;
}

interface QueueStats {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  stuckInStage: number;
}

interface PriorityQueueResponse {
  queue: PriorityScore[];
  stats: QueueStats;
  locations: string[];
  owners: Array<{ id: string; name: string }>;
  reasonCategories?: string[];
  scheduledToday: number;
  lastUpdated: string;
}

interface SalesDeal {
  id: string;
  name: string;
  stage: string;
  amount: number | null;
  ownerId: string | null;
  ownerName: string | null;
  closeDate: string | null;
  lastModified: string;
  url: string;
}

interface SalesPipelineResponse {
  deals: SalesDeal[];
  summary: {
    totalDeals: number;
    totalValue: number;
    byOwner: Array<{ ownerId: string; ownerName: string; deals: number; value: number }>;
  };
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
// Main component
// ---------------------------------------------------------------------------

export default function ServiceOverviewPage() {
  const [data, setData] = useState<PriorityQueueResponse | null>(null);
  const [salesData, setSalesData] = useState<SalesPipelineResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterLocations, setFilterLocations] = useState<string[]>([]);
  const [filterOwners, setFilterOwners] = useState<string[]>([]);
  const [filterTiers, setFilterTiers] = useState<PriorityTier[]>([]);
  const [filterReasons, setFilterReasons] = useState<string[]>([]);
  const [filterTypes, setFilterTypes] = useState<Array<"deal" | "ticket">>([]);
  const [overridingId, setOverridingId] = useState<string | null>(null);
  const [overrideLoading, setOverrideLoading] = useState(false);

  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  // ---- Data fetching --------------------------------------------------------

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/service/priority-queue");
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
  }, []);

  // Sales pipeline load is independent — failure here shouldn't block the queue.
  const fetchSalesPipeline = useCallback(async () => {
    try {
      const res = await fetch("/api/service/sales-pipeline");
      if (!res.ok) return;
      const json: SalesPipelineResponse = await res.json();
      setSalesData(json);
    } catch (err) {
      console.warn("[ServiceOverview] Sales pipeline fetch failed:", err);
    }
  }, []);

  // Initial load
  useEffect(() => {
    setLoading(true);
    fetchData();
    fetchSalesPipeline();
  }, [fetchData, fetchSalesPipeline]);

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

  // Pre-tier filter (location + owner + type) — used for accurate tier badge counts
  const preTierFiltered = useMemo(() => {
    if (!data?.queue) return [];
    return data.queue.filter((entry) => {
      if (filterTypes.length > 0 && !filterTypes.includes(entry.item.type)) return false;
      if (filterLocations.length > 0 && (!entry.item.location || !filterLocations.includes(entry.item.location))) return false;
      if (filterOwners.length > 0) {
        if (filterOwners.includes("__unassigned__") && !entry.item.ownerId) return true;
        if (entry.item.ownerId && filterOwners.includes(entry.item.ownerId)) return true;
        return false;
      }
      return true;
    });
  }, [data?.queue, filterLocations, filterOwners, filterTypes]);

  // Full filter (location + owner + tier)
  const filteredQueue = useMemo(() => {
    if (filterTiers.length === 0) return preTierFiltered;
    return preTierFiltered.filter(entry => filterTiers.includes(entry.tier));
  }, [preTierFiltered, filterTiers]);

  // Reason category filter (applied AFTER tier, does NOT affect tier badge counts)
  const reasonFiltered = useMemo(() => {
    if (filterReasons.length === 0) return filteredQueue;
    return filteredQueue.filter(entry =>
      entry.reasonCategories?.some((r: string) => filterReasons.includes(r))
    );
  }, [filteredQueue, filterReasons]);

  // Tier counts from pre-tier-filtered subset (accurate to location + owner + type selection)
  const tierCounts = useMemo(() => ({
    total: preTierFiltered.length,
    critical: preTierFiltered.filter(i => i.tier === "critical").length,
    high: preTierFiltered.filter(i => i.tier === "high").length,
    medium: preTierFiltered.filter(i => i.tier === "medium").length,
    low: preTierFiltered.filter(i => i.tier === "low").length,
  }), [preTierFiltered]);

  // Type counts — computed from the location+owner subset so counts reflect the
  // other filters but NOT the type filter itself (stable toggle badges).
  const typeCounts = useMemo(() => {
    const base = (data?.queue ?? []).filter((entry) => {
      if (filterLocations.length > 0 && (!entry.item.location || !filterLocations.includes(entry.item.location))) return false;
      if (filterOwners.length > 0) {
        if (filterOwners.includes("__unassigned__") && !entry.item.ownerId) return true;
        if (entry.item.ownerId && filterOwners.includes(entry.item.ownerId)) return true;
        return false;
      }
      return true;
    });
    return {
      deal: base.filter((e) => e.item.type === "deal").length,
      ticket: base.filter((e) => e.item.type === "ticket").length,
    };
  }, [data?.queue, filterLocations, filterOwners]);

  // Build filter options
  const locationOptions: FilterOption[] = useMemo(
    () => (data?.locations ?? []).map(l => ({ value: l, label: l })),
    [data?.locations]
  );
  const ownerOptions: FilterOption[] = useMemo(
    () => [
      { value: "__unassigned__", label: "Unassigned" },
      ...(data?.owners ?? []).map(o => ({ value: o.id, label: o.name })),
    ],
    [data?.owners]
  );

  // Stuck in stage: items flagged by the scoring engine as stuck (>3 days in same stage)
  const stuckCount = data?.stats.stuckInStage ?? 0;
  // Scheduled today: Zuper service jobs with scheduledStart = today
  const scheduledToday = data?.scheduledToday ?? 0;

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
    <div className="flex items-center gap-3">
      <MultiSelectFilter
        label="Location"
        options={locationOptions}
        selected={filterLocations}
        onChange={setFilterLocations}
        accentColor="cyan"
      />
      <MultiSelectFilter
        label="Owner"
        options={ownerOptions}
        selected={filterOwners}
        onChange={setFilterOwners}
        accentColor="cyan"
      />
      <MultiSelectFilter
        label="Reason"
        options={(data?.reasonCategories || []).map((r: string) => ({
          value: r,
          label: r.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
        }))}
        selected={filterReasons}
        onChange={setFilterReasons}
        accentColor="cyan"
      />
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
        <button
          type="button"
          onClick={() => {
            setFilterTypes((prev) =>
              prev.length === 1 && prev[0] === "deal" ? [] : ["deal"]
            );
          }}
          className={`text-left rounded-xl transition-all ${
            filterTypes.length === 1 && filterTypes[0] === "deal"
              ? "ring-2 ring-purple-400/60 ring-offset-2 ring-offset-background"
              : "hover:brightness-110"
          }`}
          aria-pressed={filterTypes.length === 1 && filterTypes[0] === "deal"}
          title="Click to filter queue to Deals only"
        >
          <StatCard
            label="Service Deals"
            value={data?.queue.filter(i => i.item.type === "deal").length ?? 0}
            color="purple"
          />
        </button>
        <button
          type="button"
          onClick={() => {
            setFilterTypes((prev) =>
              prev.length === 1 && prev[0] === "ticket" ? [] : ["ticket"]
            );
          }}
          className={`text-left rounded-xl transition-all ${
            filterTypes.length === 1 && filterTypes[0] === "ticket"
              ? "ring-2 ring-cyan-400/60 ring-offset-2 ring-offset-background"
              : "hover:brightness-110"
          }`}
          aria-pressed={filterTypes.length === 1 && filterTypes[0] === "ticket"}
          title="Click to filter queue to Tickets only"
        >
          <StatCard
            label="Open Tickets"
            value={data?.queue.filter(i => i.item.type === "ticket").length ?? 0}
            color="cyan"
          />
        </button>
        <StatCard
          label="Stuck in Stage"
          value={stuckCount}
          color="red"
        />
        <StatCard
          label="Scheduled Today"
          value={scheduledToday}
          color="green"
        />
      </div>

      {/* Service Team Sales Pipeline */}
      {salesData && salesData.summary.totalDeals > 0 && (
        <SalesPipelineCard data={salesData} />
      )}

      {/* Priority Queue */}
      <div className="bg-surface rounded-xl border border-t-border overflow-hidden mb-6">
        {/* Queue header + tier filter */}
        <div className="p-4 border-b border-t-border">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-foreground">
              Priority Queue
              <span className="ml-2 text-sm font-normal text-muted">
                ({reasonFiltered.length} items)
              </span>
            </h2>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Type toggle buttons (deal / ticket) */}
              <div className="flex items-center gap-1 mr-1">
                <button
                  onClick={() => {
                    setFilterTypes((prev) =>
                      prev.includes("deal") ? prev.filter((t) => t !== "deal") : [...prev, "deal"]
                    );
                  }}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                    filterTypes.includes("deal")
                      ? "bg-purple-500/20 text-purple-300 border border-purple-500/40"
                      : "bg-surface-2 text-muted hover:text-foreground"
                  }`}
                  aria-pressed={filterTypes.includes("deal")}
                >
                  Deals
                  <span className="ml-1 opacity-70">({typeCounts.deal})</span>
                </button>
                <button
                  onClick={() => {
                    setFilterTypes((prev) =>
                      prev.includes("ticket") ? prev.filter((t) => t !== "ticket") : [...prev, "ticket"]
                    );
                  }}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                    filterTypes.includes("ticket")
                      ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                      : "bg-surface-2 text-muted hover:text-foreground"
                  }`}
                  aria-pressed={filterTypes.includes("ticket")}
                >
                  Tickets
                  <span className="ml-1 opacity-70">({typeCounts.ticket})</span>
                </button>
              </div>

              <span className="h-5 w-px bg-t-border/60 mr-1" aria-hidden="true" />

              {/* Tier multi-toggle buttons */}
              {ALL_TIERS.map((tier) => {
                const cfg = TIER_CONFIG[tier];
                const isActive = filterTiers.includes(tier);
                return (
                  <button
                    key={tier}
                    onClick={() => {
                      setFilterTiers(prev =>
                        prev.includes(tier) ? prev.filter(t => t !== tier) : [...prev, tier]
                      );
                    }}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                      isActive
                        ? `${cfg.bg} ${cfg.text}`
                        : "bg-surface-2 text-muted hover:text-foreground"
                    }`}
                  >
                    {cfg.label}
                    <span className="ml-1 opacity-70">
                      ({tierCounts[tier]})
                    </span>
                  </button>
                );
              })}
              {filterTiers.length > 0 && (
                <button
                  onClick={() => setFilterTiers([])}
                  className="px-2 py-1 text-xs text-muted hover:text-foreground"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Queue items */}
        <div className="divide-y divide-t-border">
          {reasonFiltered.length === 0 ? (
            <div className="px-4 py-12 text-center text-muted">
              {filterTiers.length > 0 || filterLocations.length > 0 || filterOwners.length > 0 || filterReasons.length > 0 || filterTypes.length > 0
                ? "No items match current filters"
                : "No items in priority queue"}
            </div>
          ) : (
            reasonFiltered.map((entry) => {
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

                      {/* Type badge — deal=purple, ticket=cyan (matches scheduler) */}
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[0.65rem] font-semibold uppercase tracking-wider border ${
                          item.type === "deal"
                            ? "bg-purple-500/20 text-purple-300 border-purple-500/40"
                            : "bg-cyan-500/20 text-cyan-300 border-cyan-500/40"
                        }`}
                      >
                        {item.type}
                      </span>

                      {/* Service type badge */}
                      {(entry.serviceType || entry.item.serviceType) && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-cyan-500/20 text-cyan-300">
                          {entry.serviceType || entry.item.serviceType}
                        </span>
                      )}

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

                    {/* Score reasons — explains why this item is ranked here */}
                    {reasons.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {reasons.map((reason, i) => (
                          <span
                            key={i}
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${cfg.bg} ${cfg.text}`}
                          >
                            {reason}
                          </span>
                        ))}
                      </div>
                    )}
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

                    {/* Score with breakdown tooltip */}
                    <span
                      className="text-xs text-muted cursor-help"
                      title={`Priority score: ${score}/100\n\nFactors:\n• Warranty expiry (up to 40 pts)\n• Last contact recency (up to 35 pts)\n• Stage duration (up to 20 pts)\n• Deal value (up to 10 pts)\n\nReasons: ${reasons.join(", ") || "None"}`}
                    >
                      Score: <span className={`font-medium ${cfg.text}`}>{score}</span>/100
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

    </DashboardShell>
  );
}

// ---------------------------------------------------------------------------
// SalesPipelineCard — sales-pipeline deals owned by service team
// ---------------------------------------------------------------------------

function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function formatShortDate(dateStr: string | null): string {
  if (!dateStr) return "\u2014";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "\u2014";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function SalesPipelineCard({ data }: { data: SalesPipelineResponse }) {
  const { deals, summary } = data;
  const ownersWithDeals = summary.byOwner.filter((o) => o.deals > 0);
  // Persist collapse preference across reloads. Default collapsed — the card
  // is a reference view, not an action surface, and the deal list takes a
  // lot of vertical space above the priority queue below it.
  const [expanded, setExpanded] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("service-overview:sales-pipeline-expanded") === "1";
  });
  const toggle = () => {
    setExpanded((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        window.localStorage.setItem("service-overview:sales-pipeline-expanded", next ? "1" : "0");
      }
      return next;
    });
  };

  return (
    <div className="bg-surface rounded-xl border border-t-border overflow-hidden mb-6">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        aria-controls="service-sales-pipeline-body"
        className="w-full text-left p-4 border-b border-t-border hover:bg-surface-2/40 transition-colors"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2">
            <span
              aria-hidden="true"
              className={`text-muted mt-1 transition-transform ${expanded ? "rotate-90" : ""}`}
            >
              ▸
            </span>
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                Service Team Sales Pipeline
                <span className="ml-2 text-sm font-normal text-muted">
                  ({summary.totalDeals} deal{summary.totalDeals !== 1 ? "s" : ""})
                </span>
              </h2>
              <p className="text-xs text-muted mt-0.5">
                Open sales-pipeline deals owned by Ted, Jake, Terrell, or Mike Wagner
              </p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted uppercase tracking-wider">Total Value</div>
            <div className="text-lg font-semibold text-cyan-400">
              {formatCurrency(summary.totalValue)}
            </div>
          </div>
        </div>

        {/* Per-owner summary chips — always visible so the collapsed state still communicates distribution */}
        {ownersWithDeals.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {ownersWithDeals.map((o) => (
              <span
                key={o.ownerId}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-cyan-500/10 text-xs text-cyan-300"
              >
                <span className="font-medium">{o.ownerName}</span>
                <span className="opacity-70">
                  {o.deals} · {formatCurrency(o.value)}
                </span>
              </span>
            ))}
          </div>
        )}
      </button>

      {/* Deal list — collapsible */}
      {expanded && (
        <div id="service-sales-pipeline-body" className="divide-y divide-t-border max-h-96 overflow-y-auto">
          {deals.map((d) => (
            <a
              key={d.id}
              href={d.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-4 px-4 py-3 hover:bg-surface-2/50 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{d.name}</p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted mt-0.5">
                  <span>{d.stage}</span>
                  {d.ownerName && (
                    <>
                      <span className="opacity-40">·</span>
                      <span>{d.ownerName}</span>
                    </>
                  )}
                  {d.closeDate && (
                    <>
                      <span className="opacity-40">·</span>
                      <span>Close {formatShortDate(d.closeDate)}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="shrink-0 text-sm font-medium text-cyan-400">
                {d.amount != null ? formatCurrency(d.amount) : "\u2014"}
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
