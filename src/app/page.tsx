"use client";

import Link from "next/link";
import { useEffect, useState, useCallback, useMemo, memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSSE } from "@/hooks/useSSE";
import { queryKeys } from "@/lib/query-keys";

import { formatMoney } from "@/lib/format";
import { STAGE_COLORS } from "@/lib/constants";
import { StatCard } from "@/components/ui/MetricCard";
import { SkeletonSection } from "@/components/ui/Skeleton";
import { LiveIndicator } from "@/components/ui/LiveIndicator";
import { UserMenu } from "@/components/UserMenu";
import { ThemeToggle } from "@/components/ThemeToggle";
import { prefetchDashboard } from "@/lib/prefetch";
import { NLSearchBar } from "@/components/ui/NLSearchBar";
import { AnomalyInsights } from "@/components/ui/AnomalyInsights";
import type { ProjectFilterSpec } from "@/lib/ai";

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
    href: "/suites/testing",
    title: "Testing Suite",
    description: "Experimental dashboards and prototype workflows for admins and executives.",
    tag: "TESTING",
    tagColor: "purple",
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
    href: "/suites/service",
    title: "Service Suite",
    description: "Service pipeline scheduling, equipment tracking, and deal management.",
    tag: "SERVICE",
    tagColor: "purple",
    visibility: "all",
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

type PipelineFilter = "all" | "pe" | "rtb";

function applyAISpecToProjects(projects: ProjectRecord[], spec: ProjectFilterSpec | null): ProjectRecord[] {
  if (!spec) return projects;

  let result = [...projects];

  if (spec.locations?.length) {
    const locationSet = new Set(spec.locations.map((location) => location.toLowerCase()));
    result = result.filter((project) => locationSet.has(project.pbLocation.toLowerCase()));
  }

  if (spec.stages?.length) {
    const stageSet = new Set(spec.stages.map((stage) => stage.toLowerCase()));
    result = result.filter((project) => stageSet.has(project.stage.toLowerCase()));
  }

  if (spec.is_pe !== undefined) {
    result = result.filter((project) => project.isParticipateEnergy === spec.is_pe);
  }

  if (spec.is_rtb !== undefined) {
    result = result.filter((project) => project.isRtb === spec.is_rtb);
  }

  if (typeof spec.min_amount === "number") {
    result = result.filter((project) => project.amount >= spec.min_amount);
  }

  if (typeof spec.max_amount === "number") {
    result = result.filter((project) => project.amount <= spec.max_amount);
  }

  return result;
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
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [pipelineFilter, setPipelineFilter] = useState<PipelineFilter>("all");
  const [aiQuery, setAiQuery] = useState("");
  const [aiSpec, setAiSpec] = useState<ProjectFilterSpec | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);

  const isMac = useIsMac();
  const modKey = isMac ? "\u2318" : "Ctrl";

  // Fetch raw projects with fallback to /api/stats
  const projectsQuery = useQuery({
    queryKey: queryKeys.projects.list({ context: "home" }),
    queryFn: async () => {
      try {
        const res = await fetch(
          "/api/projects?context=executive&limit=0&fields=stage,amount,pbLocation,isParticipateEnergy,isRtb"
        );
        if (!res.ok) throw new Error("Primary failed");
        const data = await res.json();
        return {
          projects: (data.projects || []).map((p: Record<string, unknown>) => ({
            stage: p.stage || "",
            amount: p.amount || 0,
            pbLocation: p.pbLocation || "Unknown",
            isParticipateEnergy: !!p.isParticipateEnergy,
            isRtb: !!p.isRtb,
          })) as ProjectRecord[],
          stale: data.stale || false,
          lastUpdated: data.lastUpdated || null,
        };
      } catch {
        // Fallback to /api/stats if projects endpoint fails
        const res = await fetch("/api/stats");
        if (!res.ok) throw new Error("Stats fallback failed");
        const data = await res.json();
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
        return {
          projects: fallbackProjects,
          stale: data.stale || false,
          lastUpdated: data.lastUpdated || null,
        };
      }
    },
    refetchInterval: 5 * 60 * 1000,
  });

  const rawProjects = useMemo(
    () => projectsQuery.data?.projects ?? [],
    [projectsQuery.data?.projects]
  );
  const loading = projectsQuery.isLoading;
  const error = projectsQuery.error ? "Failed to load data" : null;
  const isStale = projectsQuery.data?.stale ?? false;
  const lastUpdated = projectsQuery.data?.lastUpdated ?? null;

  useEffect(() => {
    fetch("/api/auth/sync", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.role) setUserRole(data.role);
      })
      .catch(() => {});
  }, []);

  const redirectTarget = useMemo(() => {
    if (!userRole) return null;
    if (userRole === "VIEWER") return "/unassigned";
    if (userRole === "SALES") return "/dashboards/site-survey-scheduler";
    if (userRole === "OPERATIONS" || userRole === "OPERATIONS_MANAGER") return "/suites/operations";
    if (userRole === "TECH_OPS") return "/suites/department";
    return null;
  }, [userRole]);

  useEffect(() => {
    if (!redirectTarget) return;
    window.location.replace(redirectTarget);
  }, [redirectTarget]);

  const { connected, reconnecting } = useSSE(null, { cacheKeyFilter: "projects" });

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
  const filteredProjects = useMemo(() => {
    let filtered = rawProjects;

    if (selectedLocations.length > 0) {
      const locSet = new Set(selectedLocations);
      filtered = filtered.filter((p) => locSet.has(p.pbLocation));
    }

    if (pipelineFilter === "pe") {
      filtered = filtered.filter((p) => p.isParticipateEnergy);
    } else if (pipelineFilter === "rtb") {
      filtered = filtered.filter((p) => p.isRtb);
    }

    filtered = applyAISpecToProjects(filtered, aiSpec);

    return filtered;
  }, [rawProjects, selectedLocations, pipelineFilter, aiSpec]);

  const stats = useMemo(() => computeStats(filteredProjects), [filteredProjects]);

  const toggleLocation = useCallback((loc: string) => {
    setSelectedLocations((prev) =>
      prev.includes(loc) ? prev.filter((l) => l !== loc) : [...prev, loc]
    );
  }, []);

  const clearLocations = useCallback(() => {
    setSelectedLocations([]);
  }, []);

  const clearAllFilters = useCallback(() => {
    setSelectedLocations([]);
    setPipelineFilter("all");
    setAiQuery("");
    setAiSpec(null);
  }, []);

  const locationLookup = useMemo(() => {
    const map = new Map<string, string>();
    allLocations.forEach((location) => {
      map.set(location.toLowerCase(), location);
    });
    return map;
  }, [allLocations]);

  const handleAIFilterSpec = useCallback(
    (spec: ProjectFilterSpec | null, rawQuery: string) => {
      setAiSpec(spec);

      if (!rawQuery.trim()) {
        return;
      }

      if (!spec) {
        return;
      }

      if (spec.locations?.length) {
        const matchedLocations = Array.from(
          new Set(
            spec.locations
              .map((location) => locationLookup.get(location.toLowerCase()))
              .filter((location): location is string => Boolean(location))
          )
        );
        if (matchedLocations.length > 0) {
          setSelectedLocations(matchedLocations);
        }
      }

      if (spec.is_pe === true && spec.is_rtb !== true) {
        setPipelineFilter("pe");
      } else if (spec.is_rtb === true && spec.is_pe !== true) {
        setPipelineFilter("rtb");
      } else if (spec.is_pe === false || spec.is_rtb === false) {
        setPipelineFilter("all");
      }
    },
    [locationLookup]
  );

  const aiSummaryChips = useMemo(() => {
    if (!aiSpec) return [];

    const chips: string[] = [];
    if (aiSpec.is_pe) chips.push("PE only");
    if (aiSpec.is_rtb) chips.push("RTB only");
    if (aiSpec.locations?.length) chips.push(`Locations: ${aiSpec.locations.join(", ")}`);
    if (aiSpec.stages?.length) chips.push(`Stages: ${aiSpec.stages.join(", ")}`);
    if (aiSpec.is_overdue) chips.push("Overdue projects");
    return chips;
  }, [aiSpec]);

  const visibleSuites = useMemo(() => {
    if (!userRole) return []; // Still loading
    if (userRole === "VIEWER") return [];
    if (userRole === "SALES") return [];
    if (userRole === "OPERATIONS" || userRole === "OPERATIONS_MANAGER") return [];
    if (userRole === "TECH_OPS") return [];
    if (userRole === "PROJECT_MANAGER") {
      return SUITE_LINKS.filter((suite) =>
        suite.href === "/suites/operations" || suite.href === "/suites/department" || suite.href === "/suites/service"
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

  const canUseAI = userRole === "ADMIN" || userRole === "OWNER";

  if (!userRole || redirectTarget) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-6">
        <div className="text-sm text-muted">Loading workspace...</div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen text-foreground"
      style={{
        background:
          "radial-gradient(circle at 12% -6%, rgba(6, 182, 212, 0.14), transparent 32%), radial-gradient(circle at 88% 2%, rgba(59, 130, 246, 0.1), transparent 36%), var(--background)",
      }}
    >
      {/* Header */}
      <header className="border-b border-t-border/80 bg-surface-elevated/75 backdrop-blur-sm px-6 py-4">
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
        {/* Active Filter Banner */}
        {(selectedLocations.length > 0 || pipelineFilter !== "all") && (
          <div className="mb-4 flex items-center gap-2 px-3 py-2 bg-orange-500/10 border border-orange-500/30 rounded-lg animate-fadeIn">
            <svg className="w-4 h-4 text-orange-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            <span className="text-sm text-orange-400 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>Filtered:</span>
              {pipelineFilter !== "all" && (
                <span className="font-medium">
                  {pipelineFilter === "pe" ? "PE only" : "RTB only"}
                </span>
              )}
              {selectedLocations.length > 0 && (
                <span className="font-medium">{selectedLocations.join(", ")}</span>
              )}
            </span>
            <button
              onClick={clearAllFilters}
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

        {/* Zach's Bot (AI) */}
        <div className="bg-gradient-to-br from-surface-elevated/85 via-surface/70 to-surface-2/55 border border-t-border/80 rounded-xl p-6 mb-8 animate-fadeIn shadow-card backdrop-blur-sm">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Zach&apos;s Bot</h2>
              <p className="text-xs text-muted">
                AI-assisted filters and anomaly analysis on top of your current homepage.
              </p>
            </div>
            <button
              onClick={clearAllFilters}
              className="text-xs text-muted hover:text-foreground underline transition-colors self-start md:self-auto"
            >
              Clear all filters
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">Pipeline:</span>
            {[
              { value: "all", label: "All" },
              { value: "pe", label: "PE Only" },
              { value: "rtb", label: "RTB Only" },
            ].map((option) => (
              <button
                key={option.value}
                onClick={() => setPipelineFilter(option.value as PipelineFilter)}
                className={`px-3 py-1.5 rounded-md text-xs border transition-colors ${
                  pipelineFilter === option.value
                    ? "bg-orange-500/20 text-orange-400 border-orange-500/40"
                    : "bg-background text-muted border-t-border hover:text-foreground hover:border-orange-500/40"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="mt-4">
            {canUseAI ? (
              <>
                <NLSearchBar
                  value={aiQuery}
                  onChange={setAiQuery}
                  onFilterSpec={handleAIFilterSpec}
                  disabled={loading}
                />
                {aiSpec?.interpreted_as && (
                  <p className="mt-3 text-xs text-muted">
                    Zach&apos;s Bot: {aiSpec.interpreted_as}
                  </p>
                )}
                {aiSummaryChips.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {aiSummaryChips.map((chip) => (
                      <span key={chip} className="text-xs px-2 py-1 rounded border border-orange-500/30 bg-orange-500/10 text-orange-400">
                        {chip}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-4">
                  <AnomalyInsights />
                </div>
              </>
            ) : (
              <p className="text-sm text-muted">
                AI tools are available for Owner/Admin roles.
              </p>
            )}
          </div>
        </div>

        {/* Location Filter - click to filter all data */}
        {loading ? (
          <SkeletonSection rows={2} />
        ) : (
          allLocations.length > 0 && (
            <div className="bg-gradient-to-br from-surface-elevated/85 via-surface/70 to-surface-2/55 border border-t-border/80 rounded-xl p-6 mb-8 animate-fadeIn shadow-card backdrop-blur-sm">
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
            <div className="bg-gradient-to-br from-surface-elevated/85 via-surface/70 to-surface-2/55 border border-t-border/80 rounded-xl p-6 mb-8 animate-fadeIn shadow-card backdrop-blur-sm">
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
      className="group block rounded-xl border border-t-border/80 bg-gradient-to-br from-surface-elevated/80 via-surface/70 to-surface-2/50 p-5 shadow-card backdrop-blur-sm transition-all hover:border-orange-500/50 hover:bg-surface"
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
