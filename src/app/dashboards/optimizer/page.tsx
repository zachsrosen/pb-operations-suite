"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import DashboardShell from "@/components/DashboardShell";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { formatCurrencyCompact } from "@/lib/format";

// ============================================================
// TypeScript Interfaces
// ============================================================

interface Project {
  id: string;
  name: string;
  stage: string;
  amount: number | null;
  pbLocation: string | null;
  isParticipateEnergy: boolean;
  isBlocked: boolean;
  daysToInstall: number | null;
  daysToInspection: number | null;
  daysToPto: number | null;
  daysSinceClose: number | null;
  daysForInstallers: number | null;
  url: string;
}

interface ScoredProject extends Project {
  score: number;
}

interface Bottleneck {
  type: string;
  severity: "high" | "medium";
  title: string;
  description: string;
  impact: string;
  recommendation: string;
}

interface LocationEfficiency {
  avg_cycle_days: number;
  overdue_pct: number;
  score: number;
  project_count: number;
  total_value: number;
}

interface ScheduleEntry {
  project: ScoredProject;
  crew: string;
  startDate: string;
  days: number;
}

interface StageCount {
  stage: string;
  count: number;
}

interface LocationCount {
  location: string;
  count: number;
}

// ============================================================
// Business Day Utilities
// ============================================================

function getNextBusinessDay(date: Date): Date {
  const d = new Date(date);
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

function addBusinessDays(date: Date, days: number): Date {
  const d = new Date(date);
  let remaining = days;
  while (remaining > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) {
      remaining--;
    }
  }
  return d;
}

function getRecommendedDate(index: number): string {
  const today = new Date();
  let startDate = getNextBusinessDay(
    new Date(today.getTime() + 24 * 60 * 60 * 1000)
  );
  const daysToAdd = Math.floor(index / 2);
  if (daysToAdd > 0) {
    startDate = addBusinessDays(startDate, daysToAdd);
  }
  return startDate.toISOString().split("T")[0];
}

// ============================================================
// Priority Score Calculation
// ============================================================

function calculatePriorityScore(project: Project): number {
  let score = 0;

  // Base score from revenue (normalize to 0-100)
  const amount = project.amount || 0;
  score += Math.min(100, amount / 1000);

  // PE bonus (higher priority)
  if (project.isParticipateEnergy) {
    score += 50;
  }

  // Urgency from days overdue
  const daysToInstall = project.daysToInstall;
  if (daysToInstall !== null && daysToInstall !== undefined) {
    if (daysToInstall < 0) {
      score += Math.min(200, Math.abs(daysToInstall) * 2);
    } else if (daysToInstall <= 14) {
      score += (14 - daysToInstall) * 3;
    }
  }

  // RTB ready bonus
  if (project.stage === "Ready To Build") {
    score += 30;
  }

  // Blocked penalty
  if (project.stage === "RTB - Blocked") {
    score -= 20;
  }

  return Math.max(0, score);
}

// ============================================================
// Bottleneck Detection
// ============================================================

function detectBottlenecks(projects: Project[]): Bottleneck[] {
  const bottlenecks: Bottleneck[] = [];

  // Group by stage
  const stageGroups: Record<string, Project[]> = {};
  projects.forEach((p) => {
    if (!stageGroups[p.stage]) stageGroups[p.stage] = [];
    stageGroups[p.stage].push(p);
  });

  // Check for stage accumulation
  Object.entries(stageGroups).forEach(([stage, stageProjects]) => {
    if (stageProjects.length > 20) {
      const totalValue = stageProjects.reduce(
        (sum, p) => sum + (p.amount || 0),
        0
      );
      bottlenecks.push({
        type: "stage_accumulation",
        severity: stageProjects.length > 50 ? "high" : "medium",
        title: `${stage} Backlog`,
        description: `${stageProjects.length} projects stuck in ${stage} stage`,
        impact: `${formatCurrencyCompact(totalValue)} pipeline value affected`,
        recommendation: `Review ${stage} process - consider adding resources or expediting`,
      });
    }
  });

  // Check PE milestone risk
  const peProjects = projects.filter((p) => p.isParticipateEnergy);
  const peAtRisk = peProjects.filter(
    (p) =>
      (p.daysToInstall !== null && p.daysToInstall < 0) ||
      (p.daysToInspection !== null && p.daysToInspection < 0) ||
      (p.daysToPto !== null && p.daysToPto < 0)
  );

  if (peAtRisk.length > 0) {
    const peValue = peAtRisk.reduce((sum, p) => sum + (p.amount || 0), 0);
    bottlenecks.push({
      type: "pe_milestone_risk",
      severity: "high",
      title: "Participate Energy Milestone Risk",
      description: `${peAtRisk.length} PE projects with overdue milestones`,
      impact: `${formatCurrencyCompact(peValue)} in PE revenue at risk`,
      recommendation:
        "Prioritize PE projects in scheduling queue to meet bonus deadlines",
    });
  }

  // Check for blocked projects
  const blockedProjects = projects.filter(
    (p) => p.stage === "RTB - Blocked" || p.isBlocked
  );
  if (blockedProjects.length > 10) {
    const blockedValue = blockedProjects.reduce(
      (sum, p) => sum + (p.amount || 0),
      0
    );
    bottlenecks.push({
      type: "blocked_accumulation",
      severity: blockedProjects.length > 25 ? "high" : "medium",
      title: "Blocked Projects Accumulation",
      description: `${blockedProjects.length} projects are blocked and waiting`,
      impact: `${formatCurrencyCompact(blockedValue)} delayed until blockers resolved`,
      recommendation:
        "Review blocked projects weekly to identify resolution paths",
    });
  }

  return bottlenecks;
}

// ============================================================
// Location Efficiency Calculation
// ============================================================

function calculateLocationEfficiency(
  projects: Project[]
): Record<string, LocationEfficiency> {
  const locations: Record<
    string,
    {
      projects: Project[];
      totalValue: number;
      overdueCount: number;
      totalDays: number;
    }
  > = {};

  projects.forEach((p) => {
    const loc = p.pbLocation || "Unknown";
    if (!locations[loc]) {
      locations[loc] = {
        projects: [],
        totalValue: 0,
        overdueCount: 0,
        totalDays: 0,
      };
    }
    locations[loc].projects.push(p);
    locations[loc].totalValue += p.amount || 0;

    if (p.daysToInstall !== null && p.daysToInstall < 0) {
      locations[loc].overdueCount++;
    }

    locations[loc].totalDays += p.daysSinceClose || 0;
  });

  const efficiency: Record<string, LocationEfficiency> = {};
  Object.entries(locations).forEach(([loc, data]) => {
    const count = data.projects.length;
    const avgDays = count > 0 ? data.totalDays / count : 0;
    const overduePct = count > 0 ? (data.overdueCount / count) * 100 : 0;

    const score = 50 - avgDays / 5 - overduePct * 0.5;

    efficiency[loc] = {
      avg_cycle_days: avgDays,
      overdue_pct: overduePct,
      score: Math.max(-100, Math.min(100, score)),
      project_count: count,
      total_value: data.totalValue,
    };
  });

  return efficiency;
}

// ============================================================
// Display Helpers
// ============================================================

function formatDaysToInstall(days: number | null): string {
  if (days === null || days === undefined) return "N/A";
  if (days === 0) return "due today";
  if (days < 0) return `${Math.abs(days)}d overdue`;
  return `in ${days}d`;
}

function getProjectDisplayName(project: Project): string {
  return project.name?.split("|")[1]?.trim() || project.name || "Unknown";
}

// ============================================================
// CSS Bar Chart Component (replaces Chart.js)
// ============================================================

function HorizontalBarChart({
  data,
  maxValue,
}: {
  data: { label: string; value: number }[];
  maxValue?: number;
}) {
  const max = maxValue || Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="space-y-2">
      {data.map((item) => {
        const pct = Math.max(0, (item.value / max) * 100);
        const color =
          item.value > 50
            ? "bg-red-500"
            : item.value > 20
              ? "bg-amber-500"
              : "bg-emerald-500";
        return (
          <div key={item.label} className="flex items-center gap-3">
            <span className="w-36 text-xs text-zinc-300 truncate shrink-0">
              {item.label}
            </span>
            <div className="flex-1 h-6 bg-zinc-800 rounded overflow-hidden">
              <div
                className={`h-full ${color} rounded transition-all duration-500`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="w-10 text-right text-xs font-semibold text-zinc-300">
              {item.value}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function LocationDistributionChart({
  data,
}: {
  data: { label: string; value: number }[];
}) {
  const total = data.reduce((sum, d) => sum + d.value, 0) || 1;
  const colors = [
    "bg-blue-500",
    "bg-emerald-500",
    "bg-amber-500",
    "bg-purple-500",
    "bg-pink-500",
    "bg-cyan-500",
    "bg-indigo-500",
    "bg-rose-500",
  ];
  const dotColors = [
    "bg-blue-400",
    "bg-emerald-400",
    "bg-amber-400",
    "bg-purple-400",
    "bg-pink-400",
    "bg-cyan-400",
    "bg-indigo-400",
    "bg-rose-400",
  ];
  return (
    <div>
      {/* Stacked bar */}
      <div className="h-8 flex rounded overflow-hidden mb-4">
        {data.map((item, i) => (
          <div
            key={item.label}
            className={`${colors[i % colors.length]} transition-all duration-500`}
            style={{ width: `${(item.value / total) * 100}%` }}
            title={`${item.label}: ${item.value}`}
          />
        ))}
      </div>
      {/* Legend */}
      <div className="grid grid-cols-2 gap-2">
        {data.map((item, i) => (
          <div key={item.label} className="flex items-center gap-2 text-xs">
            <span
              className={`w-3 h-3 rounded-full ${dotColors[i % dotColors.length]} shrink-0`}
            />
            <span className="text-zinc-300 truncate">{item.label}</span>
            <span className="text-zinc-500 ml-auto">
              {item.value} ({((item.value / total) * 100).toFixed(0)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Main Page Component
// ============================================================

export default function OptimizerDashboard() {
  /* ---- activity tracking ---- */
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // Optimization state
  const [optimizing, setOptimizing] = useState(false);
  const [optimizedSchedule, setOptimizedSchedule] = useState<
    ScheduleEntry[] | null
  >(null);
  const [showOptimizeResults, setShowOptimizeResults] = useState(false);

  // Zuper integration state
  const [zuperConfigured, setZuperConfigured] = useState(false);
  const [showZuperConfirmModal, setShowZuperConfirmModal] = useState(false);
  const [zuperConfirmText, setZuperConfirmText] = useState("");
  const [syncingToZuper, setSyncingToZuper] = useState(false);
  const [zuperSyncProgress, setZuperSyncProgress] = useState<{
    total: number;
    completed: number;
    failed: number;
    current: string;
  } | null>(null);

  // Toast state
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // ---- Toast ----
  const showToast = useCallback(
    (message: string, type: "success" | "error" = "success") => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      setToast({ message, type });
      toastTimeoutRef.current = setTimeout(() => setToast(null), 3000);
    },
    []
  );

  // ---- Fetch projects ----
  const fetchProjects = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/projects?context=scheduling");
      if (!response.ok) throw new Error("Failed to fetch projects");
      const data = await response.json();
      setProjects(data.projects || []);
      setLastUpdated(
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("Error fetching projects:", err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
    const interval = setInterval(fetchProjects, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchProjects]);

  /* ---- Track dashboard view on load ---- */
  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("optimizer", {
        projectCount: projects.length,
      });
    }
  }, [loading, projects.length, trackDashboardView]);

  // Check Zuper configuration status
  useEffect(() => {
    async function checkZuper() {
      try {
        const response = await fetch("/api/zuper/status");
        const data = await response.json();
        setZuperConfigured(data.configured === true);
      } catch {
        setZuperConfigured(false);
      }
    }
    checkZuper();
  }, []);

  // ---- Zuper Sync Function ----
  const syncScheduleToZuper = useCallback(async () => {
    if (!optimizedSchedule || optimizedSchedule.length === 0) return;

    setSyncingToZuper(true);
    setZuperSyncProgress({
      total: optimizedSchedule.length,
      completed: 0,
      failed: 0,
      current: "",
    });

    let completed = 0;
    let failed = 0;

    for (const entry of optimizedSchedule) {
      const projectName =
        entry.project.name?.split("|")[1]?.trim() || entry.project.name;
      setZuperSyncProgress((prev) =>
        prev ? { ...prev, current: projectName } : null
      );

      try {
        const response = await fetch("/api/zuper/jobs/schedule", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project: {
              id: entry.project.id,
              name: entry.project.name,
              address: "",
              city: "",
              state: "",
              systemSizeKw: null,
              batteryCount: null,
              projectType: null,
            },
            schedule: {
              type: "installation",
              date: entry.startDate,
              days: entry.days,
              crew: entry.crew,
              notes: "Scheduled via Pipeline Optimizer",
            },
          }),
        });

        if (response.ok) {
          completed++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }

      setZuperSyncProgress((prev) =>
        prev ? { ...prev, completed, failed } : null
      );

      // Small delay between requests to avoid overwhelming the API
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    setSyncingToZuper(false);
    setShowZuperConfirmModal(false);
    setZuperConfirmText("");
    setZuperSyncProgress(null);

    if (failed === 0) {
      showToast(
        `Successfully synced ${completed} projects to Zuper - customers notified`
      );
    } else {
      showToast(
        `Synced ${completed} projects, ${failed} failed`,
        failed > completed / 2 ? "error" : "success"
      );
    }
  }, [optimizedSchedule, showToast]);

  // ---- Derived data ----
  const schedulableStages = [
    "Ready To Build",
    "RTB - Blocked",
    "Construction",
    "Install Scheduled",
    "Install In Progress",
  ];

  const schedulableProjects = projects.filter((p) =>
    schedulableStages.includes(p.stage)
  );

  const scoredProjects: ScoredProject[] = schedulableProjects
    .map((p) => ({ ...p, score: calculatePriorityScore(p) }))
    .sort((a, b) => b.score - a.score);

  const rtbCount = schedulableProjects.filter(
    (p) => p.stage === "Ready To Build"
  ).length;
  const bottlenecks = detectBottlenecks(projects);
  const peCount = projects.filter((p) => p.isParticipateEnergy).length;
  const efficiency = calculateLocationEfficiency(projects);

  // Stage chart data
  const stageGroups: Record<string, number> = {};
  projects.forEach((p) => {
    const stage = p.stage || "Unknown";
    stageGroups[stage] = (stageGroups[stage] || 0) + 1;
  });
  const stageChartData: StageCount[] = Object.entries(stageGroups)
    .map(([stage, count]) => ({ stage, count }))
    .sort((a, b) => b.count - a.count);

  // Location distribution data
  const locationGroups: Record<string, number> = {};
  schedulableProjects.forEach((p) => {
    const loc = p.pbLocation || "Unknown";
    locationGroups[loc] = (locationGroups[loc] || 0) + 1;
  });
  const locationChartData: LocationCount[] = Object.entries(locationGroups)
    .map(([location, count]) => ({ location, count }))
    .sort((a, b) => b.count - a.count);

  // Efficiency sorted
  const efficiencySorted = Object.entries(efficiency).sort(
    ([, a], [, b]) => b.score - a.score
  );

  // ---- Optimization ----
  const runOptimization = useCallback(() => {
    setOptimizing(true);

    try {
      const rtbProjects: ScoredProject[] = projects
        .filter((p) => p.stage === "Ready To Build")
        .map((p) => ({ ...p, score: calculatePriorityScore(p) }))
        .sort((a, b) => b.score - a.score);

      if (rtbProjects.length === 0) {
        showToast("No RTB projects to optimize", "error");
        setOptimizing(false);
        return;
      }

      // Crew availability simulation
      const crews: Record<string, string[]> = {
        Westminster: ["WESTY Alpha", "WESTY Bravo"],
        Centennial: ["DTC Alpha", "DTC Bravo"],
        "Colorado Springs": ["COSP Alpha"],
        "San Luis Obispo": ["SLO Solar"],
        Camarillo: ["CAM Crew"],
      };

      const schedule: ScheduleEntry[] = [];
      const crewNextDate: Record<string, string> = {};
      const today = new Date();
      const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
      const firstBusinessDay = getNextBusinessDay(tomorrow);

      // Initialize crew dates
      Object.values(crews)
        .flat()
        .forEach((crew) => {
          crewNextDate[crew] = firstBusinessDay.toISOString().split("T")[0];
        });

      rtbProjects.forEach((p) => {
        const locationCrews = crews[p.pbLocation || ""] || ["Unassigned"];
        const crew = locationCrews[0];
        const startDate =
          crewNextDate[crew] || firstBusinessDay.toISOString().split("T")[0];
        const days = p.daysForInstallers || 2;

        schedule.push({ project: p, crew, startDate, days });

        if (crew !== "Unassigned") {
          const nextAvailable = addBusinessDays(new Date(startDate), days);
          crewNextDate[crew] = nextAvailable.toISOString().split("T")[0];
        }
      });

      setOptimizedSchedule(schedule);
      setShowOptimizeResults(true);
      showToast(`Optimized schedule generated for ${schedule.length} projects`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("Optimization error:", err);
      showToast("Optimization failed: " + message, "error");
    } finally {
      setOptimizing(false);
    }
  }, [projects, showToast]);

  // ---- CSV Export ----
  const exportOptimizedSchedule = useCallback(() => {
    if (!optimizedSchedule) {
      showToast("No schedule to export", "error");
      return;
    }

    const headers = [
      "Project ID",
      "Customer",
      "Location",
      "Amount",
      "Crew",
      "Start Date",
      "Days",
      "PE",
    ];
    let csv = headers.join(",") + "\n";

    optimizedSchedule.forEach((s) => {
      const projectId = s.project.name?.split("|")[0]?.trim() || s.project.id;
      const name = getProjectDisplayName(s.project);
      csv +=
        [
          projectId,
          `"${name}"`,
          s.project.pbLocation || "Unknown",
          s.project.amount || 0,
          s.crew,
          s.startDate,
          s.days,
          s.project.isParticipateEnergy ? "Yes" : "No",
        ].join(",") + "\n";
    });

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `optimized-schedule-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("CSV exported");
  }, [optimizedSchedule, showToast]);

  // ---- Render helpers ----
  const getDaysClass = (days: number | null): string => {
    if (days !== null && days < 0) return "bg-red-500/20 text-red-300";
    if (days !== null && days <= 7) return "bg-amber-500/20 text-amber-300";
    return "bg-emerald-500/20 text-emerald-300";
  };

  // ---- Optimization results derived values ----
  const optimizationTotalValue = optimizedSchedule
    ? optimizedSchedule.reduce(
        (sum, s) => sum + (s.project.amount || 0),
        0
      )
    : 0;
  const optimizationPeCount = optimizedSchedule
    ? optimizedSchedule.filter((s) => s.project.isParticipateEnergy).length
    : 0;

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <DashboardShell
      title="Pipeline Optimizer"
      subtitle="AI-powered scheduling optimization and bottleneck detection"
      accentColor="orange"
      lastUpdated={lastUpdated}
      headerRight={
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              fetchProjects();
              showToast("Data refreshed");
            }}
            className="px-3 py-1.5 text-xs bg-zinc-800 border border-zinc-700 rounded-md text-zinc-300 hover:bg-zinc-700 transition-colors"
          >
            Refresh Data
          </button>
          <Link
            href="/dashboards/timeline"
            className="px-3 py-1.5 text-xs bg-zinc-800 border border-zinc-700 rounded-md text-zinc-300 hover:bg-zinc-700 transition-colors no-underline"
          >
            Open Scheduler
          </Link>
        </div>
      }
    >
      {/* Error State */}
      {error && (
        <div className="bg-red-500/10 border border-red-500 rounded-lg p-4 text-red-400 mb-6">
          <strong>Error:</strong> {error}
          <button
            onClick={fetchProjects}
            className="ml-4 px-3 py-1 bg-orange-500 border-none rounded text-white text-sm cursor-pointer hover:bg-orange-600 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* Header Stats */}
      {!loading && !error && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <div className="bg-[#12121a] border border-zinc-800 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-white">
              {projects.length}
            </div>
            <div className="text-xs text-zinc-500">Active Projects</div>
          </div>
          <div className="bg-[#12121a] border border-zinc-800 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-orange-400">{rtbCount}</div>
            <div className="text-xs text-zinc-500">Ready to Schedule</div>
          </div>
          <div className="bg-[#12121a] border border-zinc-800 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-amber-400">
              {bottlenecks.length}
            </div>
            <div className="text-xs text-zinc-500">Bottlenecks</div>
          </div>
          <div className="bg-[#12121a] border border-zinc-800 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-emerald-400">{peCount}</div>
            <div className="text-xs text-zinc-500">PE Projects</div>
          </div>
        </div>
      )}

      {/* Auto-Optimize Section */}
      <div className="bg-gradient-to-r from-orange-500/15 to-orange-500/5 border border-orange-500 rounded-xl p-6 mb-6">
        <h3 className="text-orange-400 font-semibold text-lg mb-1">
          Auto-Optimize Schedule
        </h3>
        <p className="text-zinc-400 text-sm mb-4">
          Automatically generate an optimized installation schedule based on
          revenue priority, crew availability, and PE milestone deadlines.
        </p>
        <button
          onClick={runOptimization}
          disabled={optimizing || loading}
          className="px-6 py-2.5 bg-gradient-to-r from-orange-500 to-orange-400 border-none rounded-lg text-white font-semibold cursor-pointer hover:shadow-lg hover:shadow-orange-500/40 hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
        >
          {optimizing ? "Optimizing..." : "Generate Optimized Schedule"}
        </button>

        {/* Optimization Results */}
        {showOptimizeResults && optimizedSchedule && (
          <div className="mt-4 p-4 bg-[#12121a] rounded-lg">
            <h4 className="text-emerald-400 font-semibold mb-1">
              Optimization Complete
            </h4>
            <p className="text-zinc-400 text-sm mb-4">
              {optimizedSchedule.length} projects scheduled over the next{" "}
              {Math.ceil(optimizedSchedule.length / 5)} weeks
            </p>

            {/* Summary Stats */}
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="bg-zinc-800/50 p-4 rounded-lg text-center">
                <div className="text-2xl font-bold text-emerald-400">
                  {optimizedSchedule.length}
                </div>
                <div className="text-xs text-zinc-500">Projects</div>
              </div>
              <div className="bg-zinc-800/50 p-4 rounded-lg text-center">
                <div className="text-2xl font-bold text-blue-400">
                  {formatCurrencyCompact(optimizationTotalValue)}
                </div>
                <div className="text-xs text-zinc-500">Revenue</div>
              </div>
              <div className="bg-zinc-800/50 p-4 rounded-lg text-center">
                <div className="text-2xl font-bold text-green-400">
                  {optimizationPeCount}
                </div>
                <div className="text-xs text-zinc-500">PE Projects</div>
              </div>
            </div>

            {/* Schedule Table */}
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-700">
                    <th className="py-2 px-3 text-left text-xs text-zinc-400 font-semibold">
                      Project
                    </th>
                    <th className="py-2 px-3 text-center text-xs text-zinc-400 font-semibold">
                      Crew
                    </th>
                    <th className="py-2 px-3 text-center text-xs text-zinc-400 font-semibold">
                      Date
                    </th>
                    <th className="py-2 px-3 text-center text-xs text-zinc-400 font-semibold">
                      Days
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {optimizedSchedule.slice(0, 20).map((s, i) => (
                    <tr
                      key={`opt-${i}`}
                      className="border-b border-zinc-800 hover:bg-zinc-800/50"
                    >
                      <td className="py-2 px-3 text-zinc-200">
                        {getProjectDisplayName(s.project)}
                        {s.project.isParticipateEnergy && (
                          <span className="ml-2 bg-emerald-500 text-white text-[0.6rem] font-semibold px-1.5 py-0.5 rounded">
                            PE
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-center text-zinc-400">
                        {s.crew}
                      </td>
                      <td className="py-2 px-3 text-center text-zinc-400">
                        {s.startDate}
                      </td>
                      <td className="py-2 px-3 text-center text-zinc-400">
                        {s.days}
                      </td>
                    </tr>
                  ))}
                  {optimizedSchedule.length > 20 && (
                    <tr>
                      <td
                        colSpan={4}
                        className="py-2 px-3 text-center text-zinc-500 text-sm"
                      >
                        ... and {optimizedSchedule.length - 20} more
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Actions */}
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href="/dashboards/timeline"
                className="px-4 py-2 bg-orange-500 rounded-lg text-white text-sm font-semibold no-underline hover:bg-orange-600 transition-colors"
              >
                Open in Scheduler
              </Link>
              <button
                onClick={exportOptimizedSchedule}
                className="px-4 py-2 bg-zinc-700 border border-zinc-600 rounded-lg text-zinc-300 text-sm cursor-pointer hover:bg-zinc-600 transition-colors"
              >
                Export CSV
              </button>
              {zuperConfigured && (
                <button
                  onClick={() => setShowZuperConfirmModal(true)}
                  className="px-4 py-2 bg-blue-600 border border-blue-500 rounded-lg text-white text-sm font-semibold cursor-pointer hover:bg-blue-500 transition-colors"
                >
                  Apply to Zuper
                </button>
              )}
            </div>

            {/* Zuper Warning */}
            {zuperConfigured && (
              <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                <div className="text-amber-400 text-xs flex items-start gap-2">
                  <span className="text-base">⚠️</span>
                  <div>
                    <strong>Customer Notification Warning:</strong> Applying this
                    schedule to Zuper will send EMAIL and SMS notifications to{" "}
                    {optimizedSchedule.length} customers with their scheduled
                    appointment details.
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main loading state */}
      {loading && (
        <div className="text-center py-12 text-zinc-500">
          <div className="inline-block w-6 h-6 border-2 border-zinc-700 border-t-orange-500 rounded-full animate-spin mb-3" />
          <div>Loading projects...</div>
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Bottlenecks + Priority Queue */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* Bottleneck Detection */}
            <div className="bg-[#12121a] border border-zinc-800 rounded-xl p-5">
              <h3 className="text-base font-semibold mb-4 text-zinc-200">
                Bottleneck Detection
              </h3>
              {bottlenecks.length === 0 ? (
                <div className="text-center py-8 text-emerald-400">
                  No bottlenecks detected
                </div>
              ) : (
                <div className="space-y-3">
                  {bottlenecks.map((b, i) => (
                    <div
                      key={i}
                      className={`rounded-lg p-4 border-l-4 ${
                        b.severity === "high"
                          ? "border-l-red-500 bg-red-500/10"
                          : "border-l-amber-500 bg-amber-500/10"
                      }`}
                    >
                      <div className="flex items-center gap-2 font-semibold mb-1">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[0.65rem] font-bold ${
                            b.severity === "high"
                              ? "bg-red-500 text-white"
                              : "bg-amber-500 text-black"
                          }`}
                        >
                          {b.severity.toUpperCase()}
                        </span>
                        <span className="text-zinc-200">{b.title}</span>
                      </div>
                      <div className="text-sm text-zinc-400 mb-1">
                        {b.description}
                      </div>
                      <div className="text-sm text-amber-400 mb-2">
                        {b.impact}
                      </div>
                      <div className="text-sm bg-zinc-800/50 p-2 rounded">
                        <strong className="text-zinc-300">
                          Recommendation:
                        </strong>{" "}
                        <span className="text-zinc-400">
                          {b.recommendation}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Priority Queue (Top 10) */}
            <div className="bg-[#12121a] border border-zinc-800 rounded-xl p-5">
              <h3 className="text-base font-semibold mb-4 text-zinc-200">
                Optimized Priority Queue
              </h3>
              <div className="space-y-2">
                {scoredProjects.slice(0, 10).map((p, i) => (
                  <a
                    key={p.id || i}
                    href={p.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 py-2.5 px-3 bg-zinc-800/50 rounded-lg hover:bg-zinc-700/50 transition-all hover:translate-x-1 cursor-pointer no-underline group"
                  >
                    <div
                      className={`w-8 h-8 flex items-center justify-center rounded-full font-bold text-sm shrink-0 ${
                        i === 0
                          ? "bg-amber-400 text-black"
                          : i === 1
                            ? "bg-zinc-400 text-black"
                            : i === 2
                              ? "bg-amber-700 text-white"
                              : "bg-orange-500 text-white"
                      }`}
                    >
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-zinc-200 truncate group-hover:text-white">
                        {getProjectDisplayName(p)}
                        {p.isParticipateEnergy && (
                          <span className="ml-2 bg-emerald-500 text-white text-[0.6rem] font-semibold px-1.5 py-0.5 rounded">
                            PE
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-zinc-500">
                        {p.pbLocation || "Unknown"} |{" "}
                        {formatDaysToInstall(p.daysToInstall)} |{" "}
                        {formatCurrencyCompact(p.amount || 0)}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-lg font-bold text-orange-400">
                        {p.score.toFixed(0)}
                      </div>
                      <div className="text-[0.6rem] text-zinc-500">score</div>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          </div>

          {/* Location Efficiency */}
          <div className="bg-[#12121a] border border-zinc-800 rounded-xl p-5 mb-6">
            <h3 className="text-base font-semibold mb-4 text-zinc-200">
              Location Efficiency Scores
            </h3>
            <div className="space-y-2">
              {efficiencySorted.map(([loc, stats]) => {
                const normalizedScore = Math.max(0, 50 + stats.score);
                const color =
                  normalizedScore > 60
                    ? "bg-emerald-500"
                    : normalizedScore > 30
                      ? "bg-amber-500"
                      : "bg-red-500";
                const textColor =
                  normalizedScore > 60
                    ? "text-emerald-400"
                    : normalizedScore > 30
                      ? "text-amber-400"
                      : "text-red-400";
                return (
                  <div key={loc} className="flex items-center gap-3 py-1">
                    <span className="w-36 font-medium text-sm text-zinc-300 truncate shrink-0">
                      {loc}
                    </span>
                    <div className="flex-1 h-6 bg-zinc-800 rounded overflow-hidden">
                      <div
                        className={`h-full ${color} rounded transition-all duration-500`}
                        style={{ width: `${normalizedScore}%` }}
                      />
                    </div>
                    <span
                      className={`w-14 text-right font-semibold text-sm ${textColor}`}
                    >
                      {stats.score.toFixed(0)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Charts: Stage Distribution + Location Distribution */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <div className="bg-[#12121a] border border-zinc-800 rounded-xl p-5">
              <h3 className="text-base font-semibold mb-4 text-zinc-200">
                Projects by Stage
              </h3>
              <HorizontalBarChart
                data={stageChartData.map((s) => ({
                  label: s.stage,
                  value: s.count,
                }))}
              />
            </div>
            <div className="bg-[#12121a] border border-zinc-800 rounded-xl p-5">
              <h3 className="text-base font-semibold mb-4 text-zinc-200">
                Schedule Distribution by Location
              </h3>
              <LocationDistributionChart
                data={locationChartData.map((l) => ({
                  label: l.location,
                  value: l.count,
                }))}
              />
            </div>
          </div>

          {/* Full Priority Table */}
          <h2 className="text-lg font-semibold mb-4 text-zinc-200">
            Complete Optimized Schedule Queue
          </h2>
          <div className="bg-[#12121a] border border-zinc-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-zinc-700">
                    <th className="py-3 px-4 text-left text-xs font-semibold text-zinc-500 bg-zinc-800/50">
                      #
                    </th>
                    <th className="py-3 px-4 text-left text-xs font-semibold text-zinc-500 bg-zinc-800/50">
                      Project
                    </th>
                    <th className="py-3 px-4 text-left text-xs font-semibold text-zinc-500 bg-zinc-800/50">
                      Location
                    </th>
                    <th className="py-3 px-4 text-left text-xs font-semibold text-zinc-500 bg-zinc-800/50">
                      Stage
                    </th>
                    <th className="py-3 px-4 text-left text-xs font-semibold text-zinc-500 bg-zinc-800/50">
                      Install Timeline
                    </th>
                    <th className="py-3 px-4 text-left text-xs font-semibold text-zinc-500 bg-zinc-800/50">
                      Value
                    </th>
                    <th className="py-3 px-4 text-left text-xs font-semibold text-zinc-500 bg-zinc-800/50">
                      Score
                    </th>
                    <th className="py-3 px-4 text-left text-xs font-semibold text-zinc-500 bg-zinc-800/50">
                      Rec. Date
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {scoredProjects.map((p, i) => {
                    const recommendedDate = getRecommendedDate(i);
                    return (
                      <tr
                        key={p.id || i}
                        className="border-b border-zinc-800 hover:bg-zinc-800/50 transition-colors"
                      >
                        <td className="py-3 px-4 text-sm text-zinc-400">
                          {i + 1}
                        </td>
                        <td className="py-3 px-4 text-sm">
                          <a
                            href={p.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-orange-400 hover:underline"
                          >
                            {getProjectDisplayName(p)}
                          </a>
                          {p.isParticipateEnergy && (
                            <span className="ml-2 bg-emerald-500 text-white text-[0.6rem] font-semibold px-1.5 py-0.5 rounded">
                              PE
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-sm text-zinc-400">
                          {p.pbLocation || "Unknown"}
                        </td>
                        <td className="py-3 px-4 text-sm text-zinc-400">
                          {p.stage}
                        </td>
                        <td className="py-3 px-4 text-sm">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${getDaysClass(p.daysToInstall)}`}
                          >
                            {formatDaysToInstall(p.daysToInstall)}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-sm text-zinc-300">
                          {formatCurrencyCompact(p.amount || 0)}
                        </td>
                        <td className="py-3 px-4 text-sm font-bold text-zinc-200">
                          {p.score.toFixed(0)}
                        </td>
                        <td className="py-3 px-4 text-sm text-zinc-400">
                          {p.stage === "Ready To Build"
                            ? recommendedDate
                            : "-"}
                        </td>
                      </tr>
                    );
                  })}
                  {scoredProjects.length === 0 && (
                    <tr>
                      <td
                        colSpan={8}
                        className="py-8 text-center text-zinc-500"
                      >
                        No schedulable projects found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Zuper Confirmation Modal */}
      {showZuperConfirmModal && optimizedSchedule && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1a24] border border-zinc-700 rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-zinc-700">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <span className="text-2xl">⚠️</span>
                Confirm Zuper Sync
              </h3>
            </div>

            <div className="p-6 space-y-4">
              {/* Warning */}
              <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
                <div className="text-red-400 font-semibold mb-2">
                  Customer Notification Alert
                </div>
                <div className="text-red-300 text-sm">
                  This action will send <strong>EMAIL and SMS notifications</strong> to{" "}
                  <strong>{optimizedSchedule.length} customers</strong> with their
                  scheduled appointment details.
                </div>
              </div>

              {/* Summary */}
              <div className="p-4 bg-zinc-800/50 rounded-lg">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-zinc-500">Total Projects</span>
                    <div className="text-white font-semibold">
                      {optimizedSchedule.length}
                    </div>
                  </div>
                  <div>
                    <span className="text-zinc-500">PE Projects</span>
                    <div className="text-emerald-400 font-semibold">
                      {optimizedSchedule.filter((s) => s.project.isParticipateEnergy).length}
                    </div>
                  </div>
                  <div>
                    <span className="text-zinc-500">Total Revenue</span>
                    <div className="text-white font-semibold">
                      {formatCurrencyCompact(optimizedSchedule.reduce((sum, s) => sum + (s.project.amount || 0), 0))}
                    </div>
                  </div>
                  <div>
                    <span className="text-zinc-500">Date Range</span>
                    <div className="text-white font-semibold">
                      {optimizedSchedule[0]?.startDate} -{" "}
                      {optimizedSchedule[optimizedSchedule.length - 1]?.startDate}
                    </div>
                  </div>
                </div>
              </div>

              {/* Confirmation Input */}
              <div>
                <label className="block text-zinc-400 text-sm mb-2">
                  Type <strong className="text-white">CONFIRM</strong> to proceed:
                </label>
                <input
                  type="text"
                  value={zuperConfirmText}
                  onChange={(e) => setZuperConfirmText(e.target.value)}
                  placeholder="Type CONFIRM"
                  disabled={syncingToZuper}
                  className="w-full px-4 py-3 bg-zinc-800 border border-zinc-600 rounded-lg text-white text-center font-mono text-lg focus:outline-none focus:border-orange-500 disabled:opacity-50"
                />
              </div>

              {/* Progress */}
              {syncingToZuper && zuperSyncProgress && (
                <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-blue-400">Syncing to Zuper...</span>
                    <span className="text-white">
                      {zuperSyncProgress.completed + zuperSyncProgress.failed} /{" "}
                      {zuperSyncProgress.total}
                    </span>
                  </div>
                  <div className="h-2 bg-zinc-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all duration-200"
                      style={{
                        width: `${((zuperSyncProgress.completed + zuperSyncProgress.failed) / zuperSyncProgress.total) * 100}%`,
                      }}
                    />
                  </div>
                  <div className="text-xs text-zinc-500 mt-2 truncate">
                    Current: {zuperSyncProgress.current}
                  </div>
                  {zuperSyncProgress.failed > 0 && (
                    <div className="text-xs text-red-400 mt-1">
                      {zuperSyncProgress.failed} failed
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="p-6 border-t border-zinc-700 flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowZuperConfirmModal(false);
                  setZuperConfirmText("");
                }}
                disabled={syncingToZuper}
                className="px-4 py-2 bg-zinc-700 border border-zinc-600 rounded-lg text-zinc-300 text-sm cursor-pointer hover:bg-zinc-600 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={syncScheduleToZuper}
                disabled={zuperConfirmText !== "CONFIRM" || syncingToZuper}
                className="px-6 py-2 bg-red-600 border border-red-500 rounded-lg text-white text-sm font-semibold cursor-pointer hover:bg-red-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {syncingToZuper ? "Syncing..." : "Send Notifications & Sync"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      <div
        className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-6 py-3 rounded-lg font-medium text-white z-50 transition-all duration-300 ${
          toast
            ? "translate-y-0 opacity-100"
            : "translate-y-24 opacity-0 pointer-events-none"
        } ${toast?.type === "error" ? "bg-red-500" : "bg-emerald-500"}`}
      >
        {toast?.message}
      </div>
    </DashboardShell>
  );
}
