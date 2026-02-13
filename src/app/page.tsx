"use client";

import Link from "next/link";
import { useEffect, useState, useCallback, useMemo, memo } from "react";
import { useSSE } from "@/hooks/useSSE";

import { formatMoney } from "@/lib/format";
import { STAGE_COLORS } from "@/lib/constants";
import { StatCard } from "@/components/ui/MetricCard";
import { SkeletonSection } from "@/components/ui/Skeleton";
import { LiveIndicator } from "@/components/ui/LiveIndicator";
import { UserMenu } from "@/components/UserMenu";
import { ThemeToggle } from "@/components/ThemeToggle";
import { prefetchDashboard } from "@/lib/prefetch";

function useIsMac() {
  const [isMac] = useState(() => {
    if (typeof navigator === "undefined") return true;
    return /(Mac|iPhone|iPod|iPad)/i.test(navigator.userAgent);
  });
  return isMac;
}

interface Stats {
  totalProjects: number;
  totalValue: number;
  peCount: number;
  peValue: number;
  rtbCount: number;
  rtbValue: number;
  locationCounts: Record<string, number>;
  locationValues: Record<string, number>;
  stageCounts: Record<string, number>;
  stageValues: Record<string, number>;
  lastUpdated: string;
}

interface SuiteLinkData {
  href: string;
  title: string;
  description: string;
  tag: string;
  tagColor: string;
  visibility: "all" | "owner_admin" | "admin";
}

const SUITE_LINKS: SuiteLinkData[] = [
  {
    href: "/suites/operations",
    title: "Operations Suite",
    description: "Core operations dashboards and scheduling workspaces.",
    tag: "OPERATIONS",
    tagColor: "blue",
    visibility: "all",
  },
  {
    href: "/suites/department",
    title: "Department Suite",
    description: "Department-level dashboards for downstream execution teams.",
    tag: "DEPARTMENTS",
    tagColor: "green",
    visibility: "all",
  },
  {
    href: "/suites/executive",
    title: "Executive Suite",
    description: "Leadership and executive views grouped in one place.",
    tag: "EXECUTIVE",
    tagColor: "amber",
    visibility: "owner_admin",
  },
  {
    href: "/suites/admin",
    title: "Admin Suite",
    description: "In-progress and admin-only dashboards, tools, and security pages.",
    tag: "ADMIN",
    tagColor: "red",
    visibility: "admin",
  },
  {
    href: "/suites/additional-pipeline",
    title: "Additional Pipeline Suite",
    description: "Supplemental pipeline dashboards grouped outside the core flow.",
    tag: "PIPELINES",
    tagColor: "cyan",
    visibility: "all",
  },
];

// ---- Main page ----

// Lightweight project shape for client-side stats
interface ProjectRecord {
  stage: string;
  amount: number;
  pbLocation: string;
  isParticipateEnergy: boolean;
  isRtb: boolean;
}

function computeStats(projects: ProjectRecord[]): Stats {
  const totalValue = projects.reduce((s, p) => s + p.amount, 0);
  const pe = projects.filter((p) => p.isParticipateEnergy);
  const rtb = projects.filter((p) => p.isRtb);

  const locationCounts: Record<string, number> = {};
  const locationValues: Record<string, number> = {};
  const stageCounts: Record<string, number> = {};
  const stageValues: Record<string, number> = {};

  for (const p of projects) {
    locationCounts[p.pbLocation] = (locationCounts[p.pbLocation] || 0) + 1;
    locationValues[p.pbLocation] = (locationValues[p.pbLocation] || 0) + p.amount;
    stageCounts[p.stage] = (stageCounts[p.stage] || 0) + 1;
    stageValues[p.stage] = (stageValues[p.stage] || 0) + p.amount;
  }

  return {
    totalProjects: projects.length,
    totalValue,
    peCount: pe.length,
    peValue: pe.reduce((s, p) => s + p.amount, 0),
    rtbCount: rtb.length,
    rtbValue: rtb.reduce((s, p) => s + p.amount, 0),
    locationCounts,
    locationValues,
    stageCounts,
    stageValues,
    lastUpdated: new Date().toISOString(),
  };
}

export default function Home() {
  const [rawProjects, setRawProjects] = useState<ProjectRecord[]>([]);
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);

  const isMac = useIsMac();
  const modKey = isMac ? "\u2318" : "Ctrl";

  // Fetch raw projects once — only request the fields we need for stats
  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch(
        "/api/projects?context=executive&limit=0&fields=stage,amount,pbLocation,isParticipateEnergy,isRtb"
      );
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setRawProjects(
        (data.projects || []).map((p: Record<string, unknown>) => ({
          stage: p.stage || "",
          amount: p.amount || 0,
          pbLocation: p.pbLocation || "Unknown",
          isParticipateEnergy: !!p.isParticipateEnergy,
          isRtb: !!p.isRtb,
        }))
      );
      setIsStale(data.stale || false);
      setLastUpdated(data.lastUpdated || null);
      setError(null);
    } catch (err) {
      console.error("Primary fetch failed, trying fallback:", err);
      // Fallback to /api/stats if projects endpoint fails
      try {
        const res = await fetch("/api/stats");
        if (!res.ok) throw new Error("Stats fallback failed");
        const data = await res.json();
        // Build minimal location-aware data from stats
        const fallbackProjects: ProjectRecord[] = [];
        const stages = data.stageCounts || {};
        for (const [stage, count] of Object.entries(stages)) {
          const stageVal = data.stageValues?.[stage] || 0;
          const avg = (count as number) > 0 ? (stageVal as number) / (count as number) : 0;
          for (let i = 0; i < (count as number); i++) {
            fallbackProjects.push({
              stage,
              amount: avg,
              pbLocation: "Unknown",
              isParticipateEnergy: false,
              isRtb: stage === "Ready To Build",
            });
          }
        }
        setRawProjects(fallbackProjects);
        setIsStale(data.stale || false);
        setLastUpdated(data.lastUpdated || null);
        setError(null);
      } catch (fallbackErr) {
        setError("Failed to load data");
        console.error("Both fetches failed:", fallbackErr);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
    const interval = setInterval(loadProjects, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [loadProjects]);

  useEffect(() => {
    fetch("/api/auth/sync", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.role) setUserRole(data.role);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!userRole) return; // Wait for role to load before redirecting
    if (userRole === "VIEWER") {
      window.location.replace("/unassigned");
    }
    if (userRole === "SALES") {
      window.location.replace("/dashboards/site-survey-scheduler");
    }
    if (userRole === "OPERATIONS" || userRole === "OPERATIONS_MANAGER") {
      window.location.replace("/suites/operations");
    }
    if (userRole === "TECH_OPS") {
      window.location.replace("/suites/department");
    }
  }, [userRole]);

  const { connected, reconnecting } = useSSE(loadProjects);

  // All locations (from unfiltered data)
  const allLocations = useMemo(
    () =>
      [...new Set(rawProjects.map((p) => p.pbLocation))]
        .filter((l) => l && l !== "Unknown")
        .sort(),
    [rawProjects]
  );

  // Unfiltered stats for location cards (always show full counts)
  const unfilteredStats = useMemo(() => computeStats(rawProjects), [rawProjects]);

  // Filtered projects & stats — instant, no API call
  const stats = useMemo(() => {
    if (selectedLocations.length === 0) return unfilteredStats;
    const locSet = new Set(selectedLocations);
    const filtered = rawProjects.filter((p) => locSet.has(p.pbLocation));
    return computeStats(filtered);
  }, [rawProjects, selectedLocations, unfilteredStats]);

  const toggleLocation = useCallback((loc: string) => {
    setSelectedLocations((prev) =>
      prev.includes(loc) ? prev.filter((l) => l !== loc) : [...prev, loc]
    );
  }, []);

  const clearLocations = useCallback(() => {
    setSelectedLocations([]);
  }, []);

  const visibleSuites = useMemo(() => {
    if (!userRole) return []; // Still loading
    if (userRole === "VIEWER") return [];
    if (userRole === "SALES") return [];
    if (userRole === "OPERATIONS" || userRole === "OPERATIONS_MANAGER") return [];
    if (userRole === "TECH_OPS") return [];
    if (userRole === "PROJECT_MANAGER") {
      return SUITE_LINKS.filter((suite) =>
        suite.href === "/suites/operations" || suite.href === "/suites/department"
      );
    }
    const isAdmin = userRole === "ADMIN";
    const isOwnerOrAdmin = isAdmin || userRole === "OWNER";
    return SUITE_LINKS.filter((suite) => {
      if (suite.visibility === "all") return true;
      if (suite.visibility === "owner_admin") return isOwnerOrAdmin;
      return isAdmin;
    });
  }, [userRole]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-t-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold bg-gradient-to-r from-orange-500 to-orange-400 bg-clip-text text-transparent">
            PB Operations Suite
          </h1>
          <div className="flex items-center gap-3">
            {/* Search hint */}
            <button
              onClick={() => {
                window.dispatchEvent(
                  new KeyboardEvent("keydown", {
                    key: "k",
                    metaKey: isMac,
                    ctrlKey: !isMac,
                    bubbles: true,
                  })
                );
              }}
              className="hidden sm:flex items-center gap-2 text-xs text-muted border border-t-border rounded-lg px-3 py-1.5 hover:border-muted hover:text-muted transition-colors"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              Search
              <kbd className="text-[10px] border border-t-border rounded px-1 py-0.5 font-mono">
                {modKey}+K
              </kbd>
            </button>

            <LiveIndicator connected={connected} reconnecting={reconnecting} />

            {isStale && (
              <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                Refreshing...
              </span>
            )}
            <span className="text-sm text-muted hidden md:inline">
              {loading
                ? "Loading..."
                : error
                  ? error
                  : lastUpdated
                    ? `Last updated: ${new Date(lastUpdated).toLocaleString()}`
                    : ""}
            </span>

            <ThemeToggle />
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Active Location Filter Banner */}
        {selectedLocations.length > 0 && (
          <div className="mb-4 flex items-center gap-2 px-3 py-2 bg-orange-500/10 border border-orange-500/30 rounded-lg animate-fadeIn">
            <svg className="w-4 h-4 text-orange-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            <span className="text-sm text-orange-400">
              Filtered: <span className="font-medium">{selectedLocations.join(", ")}</span>
            </span>
            <button
              onClick={clearLocations}
              className="ml-auto text-xs text-orange-400/70 hover:text-orange-300 underline"
            >
              Clear
            </button>
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8 stagger-grid">
          <StatCard
            label="Active Projects"
            value={loading ? null : stats?.totalProjects ?? null}
            subtitle={
              !loading && stats?.totalValue
                ? `${formatMoney(stats.totalValue)} pipeline`
                : null
            }
            color="orange"
          />
          <StatCard
            label="Pipeline Value"
            value={
              loading
                ? null
                : stats?.totalValue
                  ? `$${(stats.totalValue / 1000000).toFixed(1)}M`
                  : null
            }
            color="green"
          />
          <StatCard
            label="PE Projects"
            value={loading ? null : stats?.peCount ?? null}
            subtitle={
              !loading && stats?.peValue ? formatMoney(stats.peValue) : null
            }
            color="emerald"
          />
          <StatCard
            label="Ready To Build"
            value={loading ? null : stats?.rtbCount ?? null}
            subtitle={
              !loading && stats?.rtbValue ? formatMoney(stats.rtbValue) : null
            }
            color="blue"
          />
        </div>

        {/* Location Filter - click to filter all data */}
        {loading ? (
          <SkeletonSection rows={2} />
        ) : (
          allLocations.length > 0 && (
            <div className="bg-surface/50 border border-t-border rounded-xl p-6 mb-8 animate-fadeIn">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">
                  Projects by Location
                  {selectedLocations.length > 0 && (
                    <span className="text-sm text-orange-400 font-normal ml-2">
                      ({selectedLocations.length} filtered)
                    </span>
                  )}
                </h2>
                {selectedLocations.length > 0 && (
                  <button
                    onClick={clearLocations}
                    className="text-xs text-muted hover:text-foreground underline transition-colors"
                  >
                    Clear filter
                  </button>
                )}
              </div>
              <p className="text-xs text-muted mb-3">Click a location to filter all data</p>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 stagger-grid">
                {allLocations.map((location) => {
                  const count = unfilteredStats.locationCounts[location] || 0;
                  const value = unfilteredStats.locationValues[location];
                  const isSelected = selectedLocations.includes(location);
                  return (
                    <button
                      key={location}
                      onClick={() => toggleLocation(location)}
                      className={`rounded-lg p-4 text-center transition-all cursor-pointer border ${
                        isSelected
                          ? "bg-orange-500/15 border-orange-500/50 ring-1 ring-orange-500/30 scale-[1.02]"
                          : selectedLocations.length > 0
                            ? "bg-surface-2/30 border-transparent hover:bg-skeleton opacity-60 hover:opacity-100"
                            : "bg-skeleton border-transparent hover:bg-surface-2/70"
                      }`}
                    >
                      <div className={`text-2xl font-bold ${isSelected ? "text-orange-400" : "text-foreground"}`}>
                        {count}
                      </div>
                      <div className={`text-sm ${isSelected ? "text-orange-300" : "text-muted"}`}>{location}</div>
                      {value != null && (
                        <div className="text-xs text-orange-400 mt-0.5">
                          {formatMoney(value)}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )
        )}

        {/* Pipeline by Stage */}
        {loading ? (
          <SkeletonSection />
        ) : (
          stats?.stageCounts && (
            <div className="bg-surface/50 border border-t-border rounded-xl p-6 mb-8 animate-fadeIn">
              <h2 className="text-lg font-semibold mb-4">Pipeline by Stage</h2>
              <div className="space-y-3">
                {(() => {
                  const stageOrder = [
                    "Close Out",
                    "Permission To Operate",
                    "Inspection",
                    "Construction",
                    "Ready To Build",
                    "RTB - Blocked",
                    "Permitting & Interconnection",
                    "Design & Engineering",
                    "Site Survey",
                    "Project Rejected",
                  ];
                  return Object.entries(stats.stageCounts)
                    .sort((a, b) => {
                      const aIdx = stageOrder.indexOf(a[0]);
                      const bIdx = stageOrder.indexOf(b[0]);
                      if (aIdx === -1 && bIdx === -1)
                        return a[0].localeCompare(b[0]);
                      if (aIdx === -1) return 1;
                      if (bIdx === -1) return -1;
                      return aIdx - bIdx;
                    })
                    .map(([stage, count]) => (
                      <StageBar
                        key={stage}
                        stage={stage}
                        count={count as number}
                        total={stats.totalProjects}
                        value={stats.stageValues?.[stage]}
                      />
                    ));
                })()}
              </div>
            </div>
          )
        )}

        {/* Suites */}
        {visibleSuites.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold text-foreground/80 mb-4 mt-8">Suites</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 stagger-grid">
              {visibleSuites.map((suite) => (
                <DashboardLink key={suite.href} {...suite} />
              ))}
            </div>
          </div>
        )}

      </main>
    </div>
  );
}

// ---- Sub-components ----

const StageBar = memo(function StageBar({
  stage,
  count,
  total,
  value,
}: {
  stage: string;
  count: number;
  total: number;
  value?: number;
}) {
  const percentage = (count / total) * 100;
  const colorClass = STAGE_COLORS[stage]?.tw || "bg-zinc-600";

  return (
    <div className="flex items-center gap-4">
      <div className="w-40 text-sm text-muted truncate" title={stage}>
        {stage}
      </div>
      <div className="flex-1 bg-surface-2 rounded-full h-6 overflow-hidden">
        <div
          className={`h-full ${colorClass} flex items-center justify-end pr-2 transition-all duration-500`}
          style={{ width: `${Math.max(percentage, 5)}%` }}
        >
          <span className="text-xs font-medium text-foreground">{count}</span>
        </div>
      </div>
      {value !== undefined && (
        <div className="w-16 text-right text-sm text-muted font-medium">
          {formatMoney(value)}
        </div>
      )}
      <div className="w-12 text-right text-sm text-muted">
        {percentage.toFixed(0)}%
      </div>
    </div>
  );
});

const DashboardLink = memo(function DashboardLink({
  href,
  title,
  description,
  tag,
  tagColor,
}: Pick<SuiteLinkData, "href" | "title" | "description" | "tag" | "tagColor">) {
  const tagColors: Record<string, string> = {
    orange: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    purple: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    blue: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    red: "bg-red-500/20 text-red-400 border-red-500/30",
    emerald: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    green: "bg-green-500/20 text-green-400 border-green-500/30",
    cyan: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
    amber: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    zinc: "bg-zinc-500/20 text-foreground/80 border-muted/30",
  };

  // Extract dashboard name from href for prefetching
  const dashboardName = href.replace("/dashboards/", "");

  // Prefetch data on hover for faster navigation
  const handleMouseEnter = useCallback(() => {
    prefetchDashboard(dashboardName);
  }, [dashboardName]);

  return (
    <Link
      href={href}
      onMouseEnter={handleMouseEnter}
      className="group block bg-surface/50 border border-t-border rounded-xl p-5 hover:border-orange-500/50 hover:bg-surface transition-all"
    >
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-semibold text-foreground group-hover:text-orange-400 transition-colors">
          {title}
        </h3>
        {tag && (
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded border ${tagColors[tagColor || "blue"]}`}
          >
            {tag}
          </span>
        )}
      </div>
      <p className="text-sm text-muted">{description}</p>
    </Link>
  );
});
