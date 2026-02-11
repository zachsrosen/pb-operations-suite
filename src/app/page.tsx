"use client";

import Link from "next/link";
import { useEffect, useState, useCallback, useMemo, memo, useRef } from "react";
import { useSSE } from "@/hooks/useSSE";
import { useFavorites } from "@/hooks/useFavorites";
import { formatMoney } from "@/lib/format";
import { STAGE_COLORS } from "@/lib/constants";
import { StatCard, MiniStat } from "@/components/ui/MetricCard";
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
  blockedCount: number;
  blockedValue: number;
  constructionCount: number;
  constructionValue: number;
  inspectionBacklog: number;
  inspectionValue: number;
  ptoBacklog: number;
  ptoValue: number;
  locationCounts: Record<string, number>;
  locationValues: Record<string, number>;
  stageCounts: Record<string, number>;
  stageValues: Record<string, number>;
  totalSystemSizeKw: number;
  totalBatteryKwh: number;
  lastUpdated: string;
}

// ---- Dashboard link data ----

interface DashboardLinkData {
  href: string;
  title: string;
  description: string;
  tag: string;
  tagColor: string;
  section: string;
}

const ALL_DASHBOARDS: DashboardLinkData[] = [
  { href: "/dashboards/scheduler", title: "Master Schedule", description: "Drag-and-drop scheduling calendar with crew management", tag: "SCHEDULING", tagColor: "blue", section: "Operations Dashboards" },
  { href: "/dashboards/site-survey-scheduler", title: "Site Survey Scheduler", description: "Dedicated calendar for scheduling site surveys with Zuper integration", tag: "SCHEDULING", tagColor: "cyan", section: "Operations Dashboards" },
  { href: "/dashboards/construction-scheduler", title: "Construction Scheduler", description: "Dedicated calendar for scheduling construction installs with Zuper integration", tag: "SCHEDULING", tagColor: "emerald", section: "Operations Dashboards" },
  { href: "/dashboards/inspection-scheduler", title: "Inspection Scheduler", description: "Dedicated calendar for scheduling inspections with Zuper integration", tag: "SCHEDULING", tagColor: "purple", section: "Operations Dashboards" },
  { href: "/dashboards/at-risk", title: "At-Risk Projects", description: "Critical alerts for overdue projects by severity and revenue impact", tag: "ALERTS", tagColor: "red", section: "Participate Energy & Leadership" },
  { href: "/dashboards/locations", title: "Location Comparison", description: "Performance metrics and project distribution across all locations", tag: "ANALYTICS", tagColor: "purple", section: "Operations Dashboards" },
  { href: "/dashboards/timeline", title: "Timeline View", description: "Gantt-style timeline showing project progression and milestones", tag: "PLANNING", tagColor: "blue", section: "Operations Dashboards" },
  { href: "/dashboards/equipment-backlog", title: "Equipment Backlog", description: "Equipment forecasting by brand, model, and stage with location filtering", tag: "EQUIPMENT", tagColor: "cyan", section: "Operations Dashboards" },
  { href: "/dashboards/site-survey", title: "Site Survey", description: "Site survey scheduling, status tracking, and completion monitoring", tag: "SURVEY", tagColor: "blue", section: "Department Dashboards" },
  { href: "/dashboards/design", title: "Design & Engineering", description: "Track design progress, engineering approvals, and plan sets", tag: "DESIGN", tagColor: "indigo", section: "Department Dashboards" },
  { href: "/dashboards/permitting", title: "Permitting", description: "Permit status tracking, submission dates, and approval monitoring", tag: "PERMITTING", tagColor: "yellow", section: "Department Dashboards" },
  { href: "/dashboards/inspections", title: "Inspections", description: "Inspection scheduling, status tracking, pass rates, and AHJ analysis", tag: "INSPECTIONS", tagColor: "orange", section: "Department Dashboards" },
  { href: "/dashboards/interconnection", title: "Interconnection", description: "Utility interconnection applications, approvals, and meter installations", tag: "UTILITY", tagColor: "cyan", section: "Department Dashboards" },
  { href: "/dashboards/construction", title: "Construction", description: "Construction status, scheduling, and progress tracking", tag: "CONSTRUCTION", tagColor: "orange", section: "Department Dashboards" },
  { href: "/dashboards/incentives", title: "Incentives", description: "Rebate and incentive program tracking and application status", tag: "INCENTIVES", tagColor: "green", section: "Department Dashboards" },
  { href: "/dashboards/sales", title: "Sales Pipeline", description: "Active deals, funnel visualization, and proposal tracking", tag: "SALES", tagColor: "green", section: "Other Pipelines" },
  { href: "/dashboards/service", title: "Service Pipeline", description: "Service jobs, scheduling, and work in progress tracking", tag: "SERVICE", tagColor: "cyan", section: "Other Pipelines" },
  { href: "/dashboards/dnr", title: "D&R Pipeline", description: "Detach & Reset projects with phase tracking", tag: "D&R", tagColor: "purple", section: "Other Pipelines" },
  { href: "/dashboards/command-center", title: "Executive Suite", description: "Pipeline, revenue milestones, capacity, PE tracking, and executive dashboards", tag: "EXECUTIVE", tagColor: "amber", section: "Participate Energy & Leadership" },
  { href: "/dashboards/optimizer", title: "Pipeline Optimizer", description: "AI-powered scheduling optimization and bottleneck detection", tag: "ANALYTICS", tagColor: "purple", section: "Participate Energy & Leadership" },
  { href: "/dashboards/pe", title: "PE Dashboard", description: "Dedicated PE tracking with milestone status and compliance monitoring", tag: "PE", tagColor: "emerald", section: "Participate Energy & Leadership" },
  { href: "/dashboards/executive", title: "Executive Summary", description: "High-level KPIs, charts, and trends for leadership review", tag: "LEADERSHIP", tagColor: "purple", section: "Participate Energy & Leadership" },
  { href: "/dashboards/mobile", title: "Mobile Dashboard", description: "Touch-optimized view for field teams with quick project lookup", tag: "MOBILE", tagColor: "blue", section: "Participate Energy & Leadership" },
  { href: "/handbook", title: "Handbook", description: "Comprehensive guide to all dashboards, features, and workflows", tag: "GUIDE", tagColor: "zinc", section: "Participate Energy & Leadership" },
];

// ---- Main page ----

// Lightweight project shape for client-side stats
interface ProjectRecord {
  stage: string;
  amount: number;
  pbLocation: string;
  isParticipateEnergy: boolean;
  isRtb: boolean;
  isBlocked: boolean;
}

function computeStats(projects: ProjectRecord[]): Stats {
  const totalValue = projects.reduce((s, p) => s + p.amount, 0);
  const pe = projects.filter((p) => p.isParticipateEnergy);
  const rtb = projects.filter((p) => p.isRtb);
  const blocked = projects.filter((p) => p.isBlocked);
  const construction = projects.filter((p) => p.stage === "Construction");
  const inspection = projects.filter((p) => p.stage === "Inspection");
  const pto = projects.filter((p) => p.stage === "Permission To Operate");

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
    blockedCount: blocked.length,
    blockedValue: blocked.reduce((s, p) => s + p.amount, 0),
    constructionCount: construction.length,
    constructionValue: construction.reduce((s, p) => s + p.amount, 0),
    inspectionBacklog: inspection.length,
    inspectionValue: inspection.reduce((s, p) => s + p.amount, 0),
    ptoBacklog: pto.length,
    ptoValue: pto.reduce((s, p) => s + p.amount, 0),
    locationCounts,
    locationValues,
    stageCounts,
    stageValues,
    totalSystemSizeKw: 0,
    totalBatteryKwh: 0,
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
  const { favorites, toggleFavorite, isFavorite } = useFavorites();
  const isMac = useIsMac();
  const modKey = isMac ? "\u2318" : "Ctrl";

  // Fetch raw projects once — only request the fields we need for stats
  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch(
        "/api/projects?context=executive&limit=0&fields=stage,amount,pbLocation,isParticipateEnergy,isRtb,isBlocked"
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
          isBlocked: !!p.isBlocked,
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
              isBlocked: stage === "RTB - Blocked",
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

  const favoriteDashboards = ALL_DASHBOARDS.filter((d) =>
    favorites.includes(d.href)
  );
  const sections = [
    "Operations Dashboards",
    "Department Dashboards",
    "Other Pipelines",
    "Participate Energy & Leadership",
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white dashboard-bg">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4 dashboard-header">
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
              className="hidden sm:flex items-center gap-2 text-xs text-zinc-500 border border-zinc-800 rounded-lg px-3 py-1.5 hover:border-zinc-600 hover:text-zinc-400 transition-colors"
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
              <kbd className="text-[10px] border border-zinc-700 rounded px-1 py-0.5 font-mono">
                {modKey}+K
              </kbd>
            </button>

            <Link
              href="/updates"
              className="hidden sm:flex items-center gap-2 text-xs text-zinc-500 border border-zinc-800 rounded-lg px-3 py-1.5 hover:border-emerald-500/50 hover:text-emerald-400 transition-colors"
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
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
                />
              </svg>
              Updates
            </Link>

            <Link
              href="/roadmap"
              className="hidden sm:flex items-center gap-2 text-xs text-zinc-500 border border-zinc-800 rounded-lg px-3 py-1.5 hover:border-purple-500/50 hover:text-purple-400 transition-colors"
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
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
                />
              </svg>
              Roadmap
            </Link>

            <Link
              href="/guide"
              className="hidden sm:flex items-center gap-2 text-xs text-zinc-500 border border-zinc-800 rounded-lg px-3 py-1.5 hover:border-orange-500/50 hover:text-orange-400 transition-colors"
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
                  d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                />
              </svg>
              Guide
            </Link>

            <LiveIndicator connected={connected} reconnecting={reconnecting} />

            {isStale && (
              <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                Refreshing...
              </span>
            )}
            <span className="text-sm text-zinc-500 hidden md:inline">
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
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

        {/* Secondary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <MiniStat
            label="Construction"
            value={loading ? null : stats?.constructionCount ?? null}
            subtitle={
              !loading && stats?.constructionValue
                ? formatMoney(stats.constructionValue)
                : null
            }
          />
          <MiniStat
            label="Inspection Backlog"
            value={loading ? null : stats?.inspectionBacklog ?? null}
            subtitle={
              !loading && stats?.inspectionValue
                ? formatMoney(stats.inspectionValue)
                : null
            }
            alert={!loading && (stats?.inspectionBacklog ?? 0) > 50}
          />
          <MiniStat
            label="PTO Backlog"
            value={loading ? null : stats?.ptoBacklog ?? null}
            subtitle={
              !loading && stats?.ptoValue ? formatMoney(stats.ptoValue) : null
            }
            alert={!loading && (stats?.ptoBacklog ?? 0) > 50}
          />
          <MiniStat
            label="Blocked"
            value={loading ? null : stats?.blockedCount ?? null}
            subtitle={
              !loading && stats?.blockedValue
                ? formatMoney(stats.blockedValue)
                : null
            }
            alert={!loading && (stats?.blockedCount ?? 0) > 20}
          />
        </div>

        {/* Stage Breakdown */}
        {loading ? (
          <SkeletonSection />
        ) : (
          stats?.stageCounts && (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-8 animate-fadeIn">
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

        {/* Location Breakdown - always shows unfiltered counts, click to filter */}
        {loading ? (
          <SkeletonSection rows={2} />
        ) : (
          allLocations.length > 0 && (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-8 animate-fadeIn">
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
                    className="text-xs text-zinc-500 hover:text-zinc-300 underline transition-colors"
                  >
                    Clear filter
                  </button>
                )}
              </div>
              <p className="text-xs text-zinc-500 mb-3">Click a location to filter all data above</p>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
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
                            ? "bg-zinc-800/30 border-transparent hover:bg-zinc-800/50 opacity-60 hover:opacity-100"
                            : "bg-zinc-800/50 border-transparent hover:bg-zinc-800/70"
                      }`}
                    >
                      <div className={`text-2xl font-bold ${isSelected ? "text-orange-400" : "text-white"}`}>
                        {count}
                      </div>
                      <div className={`text-sm ${isSelected ? "text-orange-300" : "text-zinc-400"}`}>{location}</div>
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

        {/* Favorited Dashboards */}
        {favoriteDashboards.length > 0 && (
          <>
            <h2 className="text-lg font-semibold text-zinc-300 mb-4 mt-8 flex items-center gap-2">
              <span className="text-yellow-400">&#9733;</span> Favorites
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              {favoriteDashboards.map((d) => (
                <DashboardLink
                  key={d.href}
                  {...d}
                  isFavorite={true}
                  onToggleFavorite={() => toggleFavorite(d.href)}
                />
              ))}
            </div>
          </>
        )}

        {/* Dashboard sections */}
        {sections.map((section) => {
          const dashboards = ALL_DASHBOARDS.filter(
            (d) => d.section === section
          );
          return (
            <div key={section}>
              <h2 className="text-lg font-semibold text-zinc-300 mb-4 mt-8">
                {section}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                {dashboards.map((d) => (
                  <DashboardLink
                    key={d.href}
                    {...d}
                    isFavorite={isFavorite(d.href)}
                    onToggleFavorite={() => toggleFavorite(d.href)}
                  />
                ))}
              </div>
            </div>
          );
        })}

        {/* API Endpoints */}
        <h2 className="text-lg font-semibold text-zinc-300 mb-4">
          API Endpoints
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <a
            href="/api/projects?stats=true"
            target="_blank"
            className="block bg-zinc-900/50 border border-zinc-800 rounded-xl p-5 hover:border-green-500/50 transition-all"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-green-500 font-mono text-sm">GET</span>
              <span className="font-semibold text-white">Projects + Stats</span>
            </div>
            <p className="text-sm text-zinc-500">
              Full project data with statistics
            </p>
          </a>
          <a
            href="/api/projects?context=pe"
            target="_blank"
            className="block bg-zinc-900/50 border border-zinc-800 rounded-xl p-5 hover:border-green-500/50 transition-all"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-green-500 font-mono text-sm">GET</span>
              <span className="font-semibold text-white">PE Projects</span>
            </div>
            <p className="text-sm text-zinc-500">
              Participate Energy project data
            </p>
          </a>
          <a
            href="/api/projects?context=scheduling"
            target="_blank"
            className="block bg-zinc-900/50 border border-zinc-800 rounded-xl p-5 hover:border-green-500/50 transition-all"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-green-500 font-mono text-sm">GET</span>
              <span className="font-semibold text-white">Scheduling</span>
            </div>
            <p className="text-sm text-zinc-500">
              RTB and schedulable projects
            </p>
          </a>
        </div>
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

  const _formatValue = (v: number) => {
    if (v >= 1000000) return `$${(v / 1000000).toFixed(1)}M`;
    if (v >= 1000) return `$${(v / 1000).toFixed(0)}k`;
    return `$${v}`;
  };

  return (
    <div className="flex items-center gap-4">
      <div className="w-40 text-sm text-zinc-400 truncate" title={stage}>
        {stage}
      </div>
      <div className="flex-1 bg-zinc-800 rounded-full h-6 overflow-hidden">
        <div
          className={`h-full ${colorClass} flex items-center justify-end pr-2 transition-all duration-500`}
          style={{ width: `${Math.max(percentage, 5)}%` }}
        >
          <span className="text-xs font-medium text-white">{count}</span>
        </div>
      </div>
      {value !== undefined && (
        <div className="w-16 text-right text-sm text-zinc-400 font-medium">
          {formatMoney(value)}
        </div>
      )}
      <div className="w-12 text-right text-sm text-zinc-500">
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
  isFavorite,
  onToggleFavorite,
}: DashboardLinkData & {
  isFavorite: boolean;
  onToggleFavorite: () => void;
}) {
  const tagColors: Record<string, string> = {
    orange: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    purple: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    blue: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    red: "bg-red-500/20 text-red-400 border-red-500/30",
    emerald: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    green: "bg-green-500/20 text-green-400 border-green-500/30",
    cyan: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  };

  // Extract dashboard name from href for prefetching
  const dashboardName = href.replace("/dashboards/", "");

  // Prefetch data on hover for faster navigation
  const handleMouseEnter = useCallback(() => {
    prefetchDashboard(dashboardName);
  }, [dashboardName]);

  return (
    <div className="relative group" onMouseEnter={handleMouseEnter}>
      <Link
        href={href}
        className="block bg-zinc-900/50 border border-zinc-800 rounded-xl p-5 hover:border-orange-500/50 hover:bg-zinc-900 transition-all"
      >
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold text-white group-hover:text-orange-400 transition-colors">
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
        <p className="text-sm text-zinc-500">{description}</p>
      </Link>
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggleFavorite();
        }}
        className={`absolute top-3 right-14 p-1 rounded transition-all ${
          isFavorite
            ? "text-yellow-400 opacity-100"
            : "text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-yellow-400"
        }`}
        title={isFavorite ? "Remove from favorites" : "Add to favorites"}
      >
        {isFavorite ? "\u2605" : "\u2606"}
      </button>
    </div>
  );
});
