"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import DashboardShell from "@/components/DashboardShell";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PEProject {
  id: string;
  name: string;
  pb_location: string;
  ahj: string;
  utility: string;
  project_type: string;
  stage: string;
  amount: number;
  url: string;
  close_date: string | null;
  install_scheduled: string | null;
  construction_complete: string | null;
  inspection_scheduled: string | null;
  inspection_complete: string | null;
  pto_granted: string | null;
  forecast_install: string | null;
  install_basis: string;
  days_to_install: number | null;
  forecast_inspection: string | null;
  inspection_basis: string;
  days_to_inspection: number | null;
  forecast_pto: string | null;
  pto_basis: string;
  days_to_pto: number | null;
  days_since_close: number | null;
}

interface APIProject {
  id: string;
  name: string;
  pbLocation: string;
  ahj: string;
  utility: string;
  projectType: string;
  stage: string;
  amount: number;
  url: string;
  closeDate: string | null;
  constructionScheduleDate: string | null;
  constructionCompleteDate: string | null;
  inspectionScheduleDate: string | null;
  inspectionPassDate: string | null;
  ptoGrantedDate: string | null;
  forecastedInstallDate: string | null;
  forecastedInspectionDate: string | null;
  forecastedPtoDate: string | null;
  daysToInstall: number | null;
  daysToInspection: number | null;
  daysToPto: number | null;
  daysSinceClose: number | null;
}

interface APIResponse {
  projects: APIProject[];
}

interface MilestoneStats {
  overdue: number;
  soon: number;
  onTrack: number;
}

interface Stats {
  total: number;
  totalValue: number;
  install: MilestoneStats;
  inspection: MilestoneStats;
  pto: MilestoneStats;
}

interface ForecastMonth {
  label: string;
  installs: number;
  inspections: number;
  ptos: number;
}

type ViewType = "overview" | "projects" | "milestones";
type SortKey = "pto" | "inspection" | "install" | "amount";
type FilterStatus = "all" | "overdue" | "soon" | "ontrack";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function displayName(name: string): string {
  return name.split("|")[0].trim();
}

function transformProject(p: APIProject): PEProject {
  return {
    id: p.id,
    name: p.name,
    pb_location: p.pbLocation,
    ahj: p.ahj,
    utility: p.utility,
    project_type: p.projectType,
    stage: p.stage,
    amount: p.amount,
    url: p.url,
    close_date: p.closeDate,
    install_scheduled: p.constructionScheduleDate,
    construction_complete: p.constructionCompleteDate,
    inspection_scheduled: p.inspectionScheduleDate,
    inspection_complete: p.inspectionPassDate,
    pto_granted: p.ptoGrantedDate,
    forecast_install: p.forecastedInstallDate || p.constructionScheduleDate,
    install_basis: p.constructionScheduleDate ? "Scheduled" : "Forecast",
    days_to_install: p.daysToInstall,
    forecast_inspection:
      p.forecastedInspectionDate || p.inspectionScheduleDate,
    inspection_basis: p.inspectionScheduleDate ? "Scheduled" : "Forecast",
    days_to_inspection: p.daysToInspection,
    forecast_pto: p.forecastedPtoDate,
    pto_basis: p.ptoGrantedDate ? "Completed" : "Forecast",
    days_to_pto: p.daysToPto,
    days_since_close: p.daysSinceClose,
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({
  days,
  threshold = 14,
}: {
  days: number | null | undefined;
  threshold?: number;
}) {
  if (days === null || days === undefined) {
    return (
      <span className="px-2 py-1 rounded-full text-xs font-medium bg-zinc-800 text-zinc-400">
        N/A
      </span>
    );
  }
  if (days < 0) {
    return (
      <span className="px-2 py-1 rounded-full text-xs font-medium bg-red-500/20 text-red-400">
        {Math.abs(days)}d overdue
      </span>
    );
  }
  if (days === 0) {
    return (
      <span className="px-2 py-1 rounded-full text-xs font-medium bg-yellow-500/20 text-yellow-400">
        due today
      </span>
    );
  }
  if (days <= threshold) {
    return (
      <span className="px-2 py-1 rounded-full text-xs font-medium bg-yellow-500/20 text-yellow-400">
        in {days}d
      </span>
    );
  }
  return (
    <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-500/20 text-green-400">
      in {days}d
    </span>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent: "blue" | "red" | "yellow" | "green";
}) {
  const borderColors: Record<string, string> = {
    blue: "border-blue-500",
    red: "border-red-500",
    yellow: "border-yellow-500",
    green: "border-green-500",
  };
  const textColors: Record<string, string> = {
    blue: "text-blue-400",
    red: "text-red-400",
    yellow: "text-yellow-400",
    green: "text-green-400",
  };

  return (
    <div
      className={`bg-[#12121a] border border-zinc-800 rounded-lg p-4 border-l-4 ${borderColors[accent]}`}
    >
      <div className="text-sm text-zinc-400">{label}</div>
      <div className={`text-2xl font-bold ${textColors[accent]}`}>{value}</div>
    </div>
  );
}

function MilestoneSummaryCard({
  title,
  dotColor,
  stats,
  soonLabel,
}: {
  title: string;
  dotColor: string;
  stats: MilestoneStats;
  soonLabel: string;
}) {
  const total = stats.overdue + stats.soon + stats.onTrack;
  const overduePercent = total > 0 ? (stats.overdue / total) * 100 : 0;
  const soonPercent = total > 0 ? (stats.soon / total) * 100 : 0;
  const onTrackPercent = total > 0 ? (stats.onTrack / total) * 100 : 0;

  return (
    <div className="bg-[#12121a] border border-zinc-800 rounded-lg p-4">
      <h3 className="font-semibold text-zinc-200 mb-3 flex items-center gap-2">
        <span className={`w-3 h-3 rounded-full ${dotColor}`} />
        {title}
      </h3>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-red-400">Overdue:</span>
          <strong className="text-zinc-200">{stats.overdue}</strong>
        </div>
        <div className="flex justify-between">
          <span className="text-yellow-400">{soonLabel}:</span>
          <strong className="text-zinc-200">{stats.soon}</strong>
        </div>
        <div className="flex justify-between">
          <span className="text-green-400">On Track:</span>
          <strong className="text-zinc-200">{stats.onTrack}</strong>
        </div>
      </div>
      {/* Progress bar */}
      <div className="mt-3 h-2 rounded-full bg-zinc-800 flex overflow-hidden">
        {overduePercent > 0 && (
          <div
            className="bg-red-500 h-full"
            style={{ width: `${overduePercent}%` }}
          />
        )}
        {soonPercent > 0 && (
          <div
            className="bg-yellow-500 h-full"
            style={{ width: `${soonPercent}%` }}
          />
        )}
        {onTrackPercent > 0 && (
          <div
            className="bg-green-500 h-full"
            style={{ width: `${onTrackPercent}%` }}
          />
        )}
      </div>
    </div>
  );
}

function CSSBarChart({ data }: { data: ForecastMonth[] }) {
  const maxValue = Math.max(
    ...data.flatMap((m) => [m.installs, m.inspections, m.ptos]),
    1
  );

  return (
    <div className="bg-[#12121a] border border-zinc-800 rounded-lg p-4">
      <h3 className="font-semibold text-zinc-200 mb-4">
        6-Month Milestone Forecast
      </h3>
      <div className="flex items-end gap-2 h-52">
        {data.map((month) => (
          <div key={month.label} className="flex-1 flex flex-col items-center">
            <div className="flex items-end gap-[2px] h-44 w-full justify-center">
              {/* Install bar */}
              <div className="flex flex-col items-center flex-1 max-w-6 h-full justify-end">
                {month.installs > 0 && (
                  <span className="text-[10px] text-zinc-400 mb-1">
                    {month.installs}
                  </span>
                )}
                <div
                  className="w-full bg-blue-500 rounded-t transition-all duration-500"
                  style={{
                    height: `${(month.installs / maxValue) * 100}%`,
                    minHeight: month.installs > 0 ? "4px" : "0px",
                  }}
                />
              </div>
              {/* Inspection bar */}
              <div className="flex flex-col items-center flex-1 max-w-6 h-full justify-end">
                {month.inspections > 0 && (
                  <span className="text-[10px] text-zinc-400 mb-1">
                    {month.inspections}
                  </span>
                )}
                <div
                  className="w-full bg-yellow-500 rounded-t transition-all duration-500"
                  style={{
                    height: `${(month.inspections / maxValue) * 100}%`,
                    minHeight: month.inspections > 0 ? "4px" : "0px",
                  }}
                />
              </div>
              {/* PTO bar */}
              <div className="flex flex-col items-center flex-1 max-w-6 h-full justify-end">
                {month.ptos > 0 && (
                  <span className="text-[10px] text-zinc-400 mb-1">
                    {month.ptos}
                  </span>
                )}
                <div
                  className="w-full bg-green-500 rounded-t transition-all duration-500"
                  style={{
                    height: `${(month.ptos / maxValue) * 100}%`,
                    minHeight: month.ptos > 0 ? "4px" : "0px",
                  }}
                />
              </div>
            </div>
            <div className="text-xs text-zinc-500 mt-2">{month.label}</div>
          </div>
        ))}
      </div>
      {/* Legend */}
      <div className="flex justify-center gap-6 mt-4 text-xs text-zinc-400">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-blue-500" />
          Installations
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-yellow-500" />
          Inspections
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-green-500" />
          PTO
        </div>
      </div>
    </div>
  );
}

function MilestoneGroup({
  title,
  description,
  accentBg,
  accentTitle,
  accentDesc,
  projects,
  dateField,
  daysField,
  threshold,
}: {
  title: string;
  description: string;
  accentBg: string;
  accentTitle: string;
  accentDesc: string;
  projects: PEProject[];
  dateField: keyof PEProject;
  daysField: keyof PEProject;
  threshold: number;
}) {
  return (
    <div className="bg-[#12121a] border border-zinc-800 rounded-lg overflow-hidden">
      <div className={`p-4 border-b border-zinc-800 ${accentBg}`}>
        <h3 className={`font-semibold text-lg ${accentTitle}`}>{title}</h3>
        <p className={`text-sm ${accentDesc}`}>{description}</p>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {projects.length === 0 && (
          <div className="p-6 text-center text-zinc-500">
            No projects in this category
          </div>
        )}
        {projects.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between p-3 border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors"
          >
            <div>
              <a
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-green-400 hover:text-green-300 hover:underline"
              >
                {displayName(p.name)}
              </a>
              <div className="text-xs text-zinc-500">
                {p.pb_location} | {p.ahj}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-zinc-500 mb-1">Forecasted</div>
              <div className="text-sm text-zinc-300">
                {p[dateField] as string}
              </div>
              <StatusBadge
                days={p[daysField] as number | null}
                threshold={threshold}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

export default function PEDashboardPage() {
  const [projects, setProjects] = useState<PEProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewType>("overview");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [filterMilestone, setFilterMilestone] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortKey>("pto");
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch data
  useEffect(() => {
    async function fetchData() {
      try {
        const response = await fetch("/api/projects?context=pe");
        if (!response.ok) throw new Error("Failed to fetch");
        const data: APIResponse = await response.json();
        const transformed = data.projects.map(transformProject);
        setProjects(transformed);
        setError(null);
      } catch (err) {
        console.error("Failed to fetch PE projects:", err);
        setError("Failed to load data. Please refresh.");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Compute stats
  const stats: Stats = useMemo(() => {
    let installOverdue = 0,
      installSoon = 0,
      installOnTrack = 0;
    let inspectionOverdue = 0,
      inspectionSoon = 0,
      inspectionOnTrack = 0;
    let ptoOverdue = 0,
      ptoSoon = 0,
      ptoOnTrack = 0;
    let totalValue = 0;

    projects.forEach((p) => {
      totalValue += p.amount || 0;

      // Install stats - only if construction not complete
      if (!p.construction_complete) {
        if (p.days_to_install !== null && p.days_to_install < 0)
          installOverdue++;
        else if (p.days_to_install !== null && p.days_to_install <= 14)
          installSoon++;
        else installOnTrack++;
      }

      // Inspection stats - only if inspection not complete
      if (!p.inspection_complete) {
        if (p.days_to_inspection !== null && p.days_to_inspection < 0)
          inspectionOverdue++;
        else if (p.days_to_inspection !== null && p.days_to_inspection <= 14)
          inspectionSoon++;
        else inspectionOnTrack++;
      }

      // PTO stats - only if PTO not granted
      if (!p.pto_granted) {
        if (p.days_to_pto !== null && p.days_to_pto < 0) ptoOverdue++;
        else if (p.days_to_pto !== null && p.days_to_pto <= 30) ptoSoon++;
        else ptoOnTrack++;
      }
    });

    return {
      total: projects.length,
      totalValue,
      install: {
        overdue: installOverdue,
        soon: installSoon,
        onTrack: installOnTrack,
      },
      inspection: {
        overdue: inspectionOverdue,
        soon: inspectionSoon,
        onTrack: inspectionOnTrack,
      },
      pto: { overdue: ptoOverdue, soon: ptoSoon, onTrack: ptoOnTrack },
    };
  }, [projects]);

  // Filter and sort projects
  const filteredProjects = useMemo(() => {
    let filtered = [...projects];

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.pb_location.toLowerCase().includes(q) ||
          p.ahj.toLowerCase().includes(q) ||
          p.stage.toLowerCase().includes(q)
      );
    }

    // Status filter
    if (filterStatus !== "all") {
      filtered = filtered.filter((p) => {
        const days =
          filterMilestone === "install"
            ? p.days_to_install
            : filterMilestone === "inspection"
              ? p.days_to_inspection
              : p.days_to_pto;
        if (days === null) return false;
        if (filterStatus === "overdue") return days < 0;
        if (filterStatus === "soon")
          return days >= 0 && days <= (filterMilestone === "pto" ? 30 : 14);
        return days > (filterMilestone === "pto" ? 30 : 14);
      });
    }

    // Sort
    filtered.sort((a, b) => {
      if (sortBy === "install")
        return (a.days_to_install ?? 999) - (b.days_to_install ?? 999);
      if (sortBy === "inspection")
        return (
          (a.days_to_inspection ?? 999) - (b.days_to_inspection ?? 999)
        );
      if (sortBy === "pto")
        return (a.days_to_pto ?? 999) - (b.days_to_pto ?? 999);
      if (sortBy === "amount") return (b.amount || 0) - (a.amount || 0);
      return 0;
    });

    return filtered;
  }, [projects, filterMilestone, filterStatus, sortBy, searchQuery]);

  // 6-month forecast data
  const forecastData: ForecastMonth[] = useMemo(() => {
    const today = new Date();
    const months: ForecastMonth[] = [];

    for (let i = 0; i < 6; i++) {
      const d = new Date(today);
      d.setMonth(d.getMonth() + i);
      const label = d.toLocaleDateString("en-US", {
        month: "short",
        year: "2-digit",
      });

      let installs = 0,
        inspections = 0,
        ptos = 0;
      projects.forEach((p) => {
        if (p.forecast_install) {
          const fd = new Date(p.forecast_install);
          if (
            fd.getMonth() === d.getMonth() &&
            fd.getFullYear() === d.getFullYear()
          )
            installs++;
        }
        if (p.forecast_inspection) {
          const fd = new Date(p.forecast_inspection);
          if (
            fd.getMonth() === d.getMonth() &&
            fd.getFullYear() === d.getFullYear()
          )
            inspections++;
        }
        if (p.forecast_pto) {
          const fd = new Date(p.forecast_pto);
          if (
            fd.getMonth() === d.getMonth() &&
            fd.getFullYear() === d.getFullYear()
          )
            ptos++;
        }
      });

      months.push({ label, installs, inspections, ptos });
    }

    return months;
  }, [projects]);

  // Milestone view data
  const inspectionMilestones = useMemo(
    () =>
      projects
        .filter(
          (p) =>
            p.days_to_inspection !== null && p.days_to_inspection <= 30
        )
        .sort(
          (a, b) => (a.days_to_inspection ?? 999) - (b.days_to_inspection ?? 999)
        )
        .slice(0, 20),
    [projects]
  );

  const ptoMilestones = useMemo(
    () =>
      projects
        .filter((p) => p.days_to_pto !== null && p.days_to_pto <= 45)
        .sort((a, b) => (a.days_to_pto ?? 999) - (b.days_to_pto ?? 999))
        .slice(0, 20),
    [projects]
  );

  // Export to clipboard
  const handleExport = useCallback(() => {
    const headers = [
      "Project",
      "Location",
      "Stage",
      "Value",
      "Forecast Install",
      "Days to Install",
      "Forecast Inspection",
      "Days to Inspection",
      "Forecast PTO",
      "Days to PTO",
    ];
    const rows = filteredProjects.map((p) =>
      [
        displayName(p.name),
        p.pb_location,
        p.stage,
        p.amount || 0,
        p.forecast_install || "",
        p.days_to_install ?? "",
        p.forecast_inspection || "",
        p.days_to_inspection ?? "",
        p.forecast_pto || "",
        p.days_to_pto ?? "",
      ].join("\t")
    );
    const csv = [headers.join("\t"), ...rows].join("\n");
    navigator.clipboard.writeText(csv);
  }, [filteredProjects]);

  // Loading
  if (loading) {
    return (
      <DashboardShell
        title="Participate Energy"
        subtitle="Project Milestone Tracker"
        accentColor="green"
      >
        <div className="flex items-center justify-center py-32">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500 mx-auto mb-4" />
            <p className="text-zinc-400">
              Loading Participate Energy data...
            </p>
          </div>
        </div>
      </DashboardShell>
    );
  }

  // Error
  if (error) {
    return (
      <DashboardShell
        title="Participate Energy"
        subtitle="Project Milestone Tracker"
        accentColor="green"
      >
        <div className="flex items-center justify-center py-32">
          <div className="text-center">
            <p className="text-xl text-red-400 mb-2">Error</p>
            <p className="text-zinc-400">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      </DashboardShell>
    );
  }

  const today = new Date();

  return (
    <DashboardShell
      title="Participate Energy"
      subtitle="Project Milestone Tracker"
      accentColor="green"
      lastUpdated={today.toLocaleDateString()}
      headerRight={
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-green-400">
            {stats.total} Projects
          </span>
          <button
            onClick={handleExport}
            className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded border border-zinc-700 transition-colors"
          >
            Export CSV
          </button>
        </div>
      }
    >
      {/* Tab Navigation */}
      <div className="flex gap-1 mb-6 bg-[#12121a] border border-zinc-800 rounded-lg p-1 w-fit">
        {(["overview", "projects", "milestones"] as ViewType[]).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              view === v
                ? "bg-green-600 text-white"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
            }`}
          >
            {v.charAt(0).toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>

      {/* ================================================================ */}
      {/* OVERVIEW VIEW                                                    */}
      {/* ================================================================ */}
      {view === "overview" && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <StatCard
              label="Total Pipeline Value"
              value={`$${(stats.totalValue / 1_000_000).toFixed(2)}M`}
              accent="blue"
            />
            <StatCard
              label="Overdue (PTO)"
              value={stats.pto.overdue}
              accent="red"
            />
            <StatCard
              label="PTO Next 30 Days"
              value={stats.pto.soon}
              accent="yellow"
            />
            <StatCard
              label="On Track"
              value={stats.pto.onTrack}
              accent="green"
            />
          </div>

          {/* Milestone Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <MilestoneSummaryCard
              title="Forecasted Installation"
              dotColor="bg-blue-500"
              stats={stats.install}
              soonLabel="Next 14d"
            />
            <MilestoneSummaryCard
              title="Forecasted Inspection"
              dotColor="bg-yellow-500"
              stats={stats.inspection}
              soonLabel="Next 14d"
            />
            <MilestoneSummaryCard
              title="Forecasted PTO"
              dotColor="bg-green-500"
              stats={stats.pto}
              soonLabel="Next 30d"
            />
          </div>

          {/* CSS Bar Chart */}
          <CSSBarChart data={forecastData} />
        </>
      )}

      {/* ================================================================ */}
      {/* PROJECTS VIEW                                                    */}
      {/* ================================================================ */}
      {view === "projects" && (
        <>
          {/* Filters */}
          <div className="bg-[#12121a] border border-zinc-800 rounded-lg p-4 mb-4 flex flex-wrap gap-4 items-center">
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-400">Search:</span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Project name, location..."
                className="bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-green-600 w-56"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-400">Sort by:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortKey)}
                className="bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200"
              >
                <option value="pto">Days to PTO</option>
                <option value="inspection">Days to Inspection</option>
                <option value="install">Days to Install</option>
                <option value="amount">Deal Value</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-400">Milestone:</span>
              <select
                value={filterMilestone}
                onChange={(e) => setFilterMilestone(e.target.value)}
                className="bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200"
              >
                <option value="all">All</option>
                <option value="install">Install</option>
                <option value="inspection">Inspection</option>
                <option value="pto">PTO</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-400">Status:</span>
              <select
                value={filterStatus}
                onChange={(e) =>
                  setFilterStatus(e.target.value as FilterStatus)
                }
                className="bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200"
              >
                <option value="all">All</option>
                <option value="overdue">Overdue</option>
                <option value="soon">Due Soon</option>
                <option value="ontrack">On Track</option>
              </select>
            </div>
            <div className="ml-auto text-xs text-zinc-500">
              {filteredProjects.length} projects
            </div>
          </div>

          {/* Project Table */}
          <div className="bg-[#12121a] border border-zinc-800 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-900/50">
                    <th className="text-left p-3 text-sm font-medium text-zinc-400">
                      Project
                    </th>
                    <th className="text-left p-3 text-sm font-medium text-zinc-400">
                      Location
                    </th>
                    <th className="text-right p-3 text-sm font-medium text-zinc-400">
                      Value
                    </th>
                    <th className="text-center p-3 text-sm font-medium text-zinc-400">
                      Forecasted Install
                    </th>
                    <th className="text-center p-3 text-sm font-medium text-zinc-400">
                      Forecasted Inspection
                    </th>
                    <th className="text-center p-3 text-sm font-medium text-zinc-400">
                      Forecasted PTO
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProjects.slice(0, 50).map((p, idx) => (
                    <tr
                      key={p.id}
                      className={`border-b border-zinc-800/50 transition-colors hover:bg-zinc-800/30 ${
                        idx % 2 === 0 ? "" : "bg-zinc-900/30"
                      }`}
                    >
                      <td className="p-3">
                        <a
                          href={p.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-green-400 hover:text-green-300 hover:underline font-medium"
                        >
                          {displayName(p.name)}
                        </a>
                        <div className="text-xs text-zinc-500">{p.stage}</div>
                      </td>
                      <td className="p-3 text-sm text-zinc-400">
                        {p.pb_location}
                      </td>
                      <td className="p-3 text-right font-medium text-zinc-200">
                        ${((p.amount || 0) / 1000).toFixed(0)}k
                      </td>
                      <td className="p-3 text-center">
                        <div className="text-xs text-zinc-500 mb-1">
                          {p.forecast_install}
                        </div>
                        <StatusBadge days={p.days_to_install} />
                      </td>
                      <td className="p-3 text-center">
                        <div className="text-xs text-zinc-500 mb-1">
                          {p.forecast_inspection}
                        </div>
                        <StatusBadge days={p.days_to_inspection} />
                      </td>
                      <td className="p-3 text-center">
                        <div className="text-xs text-zinc-500 mb-1">
                          {p.forecast_pto}
                        </div>
                        <StatusBadge days={p.days_to_pto} threshold={30} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredProjects.length > 50 && (
              <div className="p-3 text-center text-sm text-zinc-500 border-t border-zinc-800">
                Showing 50 of {filteredProjects.length} projects
              </div>
            )}
            {filteredProjects.length === 0 && (
              <div className="p-8 text-center text-zinc-500">
                No projects match the current filters
              </div>
            )}
          </div>
        </>
      )}

      {/* ================================================================ */}
      {/* MILESTONES VIEW                                                  */}
      {/* ================================================================ */}
      {view === "milestones" && (
        <div className="space-y-6">
          <MilestoneGroup
            title="Forecasted Inspection Complete (Milestone 1)"
            description="Projects with forecasted inspection dates requiring completion reporting"
            accentBg="bg-yellow-500/10"
            accentTitle="text-yellow-400"
            accentDesc="text-yellow-500/70"
            projects={inspectionMilestones}
            dateField="forecast_inspection"
            daysField="days_to_inspection"
            threshold={14}
          />

          <MilestoneGroup
            title="Forecasted PTO (Milestone 2)"
            description="Projects with forecasted PTO dates requiring completion reporting"
            accentBg="bg-green-500/10"
            accentTitle="text-green-400"
            accentDesc="text-green-500/70"
            projects={ptoMilestones}
            dateField="forecast_pto"
            daysField="days_to_pto"
            threshold={30}
          />
        </div>
      )}
    </DashboardShell>
  );
}
