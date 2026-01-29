"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useProjects } from "@/hooks/useProjects";
import {
  Header,
  TabNav,
  StatCard,
  FilterBar,
  ProjectTable,
  type FilterState,
} from "@/components/ui";
import { CREWS_BY_LOCATION, type LocationKey } from "@/lib/config";
import { type Project } from "@/lib/hubspot";

type ViewTab = "pipeline" | "revenue" | "capacity" | "pe" | "alerts";

export default function CommandCenterPage() {
  const { projects, stats, loading, error, lastUpdated } = useProjects({
    context: "executive",
    includeStats: true,
  });

  const [activeTab, setActiveTab] = useState<ViewTab>("pipeline");
  const [filters, setFilters] = useState<FilterState>({
    location: "all",
    stage: "all",
    pe: "all",
    search: "",
  });

  // Calculate alert counts
  const alertCounts = useMemo(() => {
    const overdueInstall = projects.filter(
      (p) => p.daysToInstall !== null && p.daysToInstall < 0 && !p.constructionCompleteDate
    ).length;
    const overdueInspection = projects.filter(
      (p) => p.daysToInspection !== null && p.daysToInspection < 0 && !p.inspectionPassDate
    ).length;
    const overduePto = projects.filter(
      (p) => p.daysToPto !== null && p.daysToPto < 0 && !p.ptoGrantedDate
    ).length;
    const blocked = projects.filter((p) => p.isBlocked).length;
    return {
      total: overdueInstall + overdueInspection + overduePto + blocked,
      overdueInstall,
      overdueInspection,
      overduePto,
      blocked,
    };
  }, [projects]);

  // Filter projects
  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      if (filters.location !== "all" && p.pbLocation !== filters.location) return false;
      if (filters.stage !== "all" && p.stage !== filters.stage) return false;
      if (filters.pe === "pe" && !p.isParticipateEnergy) return false;
      if (filters.pe === "non-pe" && p.isParticipateEnergy) return false;
      if (filters.search && !p.name.toLowerCase().includes(filters.search.toLowerCase())) return false;
      return true;
    });
  }, [projects, filters]);

  const peProjects = useMemo(() => projects.filter((p) => p.isParticipateEnergy), [projects]);

  const tabs = [
    { id: "pipeline", label: "Pipeline Overview" },
    { id: "revenue", label: "Revenue" },
    { id: "capacity", label: "Capacity Planning" },
    { id: "pe", label: "Participate Energy", badge: peProjects.length, badgeColor: "pe" as const },
    { id: "alerts", label: "Alerts", badge: alertCounts.total, badgeColor: "danger" as const },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Header
        title="PB Command Center"
        subtitle="Unified Pipeline & Scheduling System - Live Data"
        lastUpdated={lastUpdated || undefined}
        loading={loading}
        error={error}
        showBackLink
        rightContent={
          <div className="text-sm text-zinc-400">
            ${((stats?.totalValue || 0) / 1000000).toFixed(2)}M Pipeline
          </div>
        }
      />

      <div className="max-w-7xl mx-auto px-6">
        <TabNav
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={(id) => setActiveTab(id as ViewTab)}
        />
      </div>

      <main className="max-w-7xl mx-auto px-6 py-6">
        {activeTab === "pipeline" && (
          <PipelineView
            projects={filteredProjects}
            stats={stats}
            loading={loading}
            filters={filters}
            onFilterChange={setFilters}
            alertCounts={alertCounts}
          />
        )}

        {activeTab === "revenue" && (
          <RevenueView projects={projects} stats={stats} loading={loading} />
        )}

        {activeTab === "capacity" && (
          <CapacityView projects={projects} loading={loading} />
        )}

        {activeTab === "pe" && (
          <PEView projects={peProjects} loading={loading} />
        )}

        {activeTab === "alerts" && (
          <AlertsView projects={projects} alertCounts={alertCounts} loading={loading} />
        )}
      </main>
    </div>
  );
}

// Pipeline View Component
interface PipelineViewProps {
  projects: Project[];
  stats: ReturnType<typeof useProjects>["stats"];
  loading: boolean;
  filters: FilterState;
  onFilterChange: (filters: FilterState) => void;
  alertCounts: { total: number; overdueInstall: number; overdueInspection: number; overduePto: number; blocked: number };
}

function PipelineView({ projects, stats, loading, filters, onFilterChange, alertCounts }: PipelineViewProps) {
  const rtbCount = projects.filter((p) => p.isRtb).length;
  const peCount = projects.filter((p) => p.isParticipateEnergy).length;

  return (
    <>
      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
        <StatCard
          label="Total Projects"
          value={stats?.totalProjects ?? "..."}
          subValue={`$${((stats?.totalValue || 0) / 1000000).toFixed(1)}M pipeline`}
          loading={loading}
        />
        <StatCard
          label="Ready to Build"
          value={rtbCount}
          subValue="Available to schedule"
          color="orange"
          loading={loading}
        />
        <StatCard
          label="PE Projects"
          value={peCount}
          subValue="Participate Energy"
          color="emerald"
          loading={loading}
        />
        <StatCard
          label="In Construction"
          value={stats?.constructionCount ?? "..."}
          subValue="Active builds"
          color="blue"
          loading={loading}
        />
        <StatCard
          label="Inspection Queue"
          value={stats?.inspectionBacklog ?? "..."}
          subValue="Awaiting inspection"
          loading={loading}
        />
        <StatCard
          label="Alerts"
          value={alertCounts.total}
          subValue={`${alertCounts.blocked} blocked`}
          color="red"
          alert={alertCounts.total > 10}
          loading={loading}
        />
      </div>

      {/* Filters */}
      <FilterBar filters={filters} onChange={onFilterChange} />

      {/* Project Table */}
      <ProjectTable projects={projects} loading={loading} />
    </>
  );
}

// Revenue View Component
interface RevenueViewProps {
  projects: Project[];
  stats: ReturnType<typeof useProjects>["stats"];
  loading: boolean;
}

function RevenueView({ projects, stats, loading }: RevenueViewProps) {
  // Calculate revenue by stage
  const revenueByStage = useMemo(() => {
    const stages: Record<string, { count: number; value: number }> = {};
    projects.forEach((p) => {
      if (!stages[p.stage]) {
        stages[p.stage] = { count: 0, value: 0 };
      }
      stages[p.stage].count++;
      stages[p.stage].value += p.amount || 0;
    });
    return Object.entries(stages)
      .map(([stage, data]) => ({ stage, ...data }))
      .sort((a, b) => b.value - a.value);
  }, [projects]);

  // Calculate revenue by location
  const revenueByLocation = useMemo(() => {
    const locations: Record<string, { count: number; value: number }> = {};
    projects.forEach((p) => {
      if (!locations[p.pbLocation]) {
        locations[p.pbLocation] = { count: 0, value: 0 };
      }
      locations[p.pbLocation].count++;
      locations[p.pbLocation].value += p.amount || 0;
    });
    return Object.entries(locations)
      .map(([location, data]) => ({ location, ...data }))
      .sort((a, b) => b.value - a.value);
  }, [projects]);

  // Calculate backlog revenue (RTB and pre-construction)
  const backlogRevenue = useMemo(() => {
    const backlogStages = ["Ready To Build", "RTB - Blocked", "Design & Engineering", "Permitting & Interconnection", "Site Survey"];
    return projects
      .filter((p) => backlogStages.includes(p.stage))
      .reduce((sum, p) => sum + (p.amount || 0), 0);
  }, [projects]);

  const maxStageValue = Math.max(...revenueByStage.map((s) => s.value), 1);

  return (
    <>
      {/* Revenue Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Total Pipeline Value"
          value={`$${((stats?.totalValue || 0) / 1000000).toFixed(2)}M`}
          color="orange"
          loading={loading}
        />
        <StatCard
          label="Backlog Revenue"
          value={`$${(backlogRevenue / 1000000).toFixed(2)}M`}
          subValue="RTB & pre-construction"
          color="green"
          loading={loading}
        />
        <StatCard
          label="PE Pipeline Value"
          value={`$${((stats?.peValue || 0) / 1000000).toFixed(2)}M`}
          color="emerald"
          loading={loading}
        />
        <StatCard
          label="Avg Deal Size"
          value={`$${((stats?.totalValue || 0) / (stats?.totalProjects || 1) / 1000).toFixed(0)}k`}
          loading={loading}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Revenue by Stage */}
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
          <h3 className="text-lg font-semibold mb-4 text-orange-400">Revenue by Deal Stage</h3>
          <div className="space-y-3">
            {revenueByStage.map((item) => (
              <div key={item.stage} className="flex items-center gap-4">
                <div className="w-32 text-sm text-zinc-400 truncate">{item.stage}</div>
                <div className="flex-1 bg-zinc-800 rounded-full h-4 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-orange-500 to-orange-400"
                    style={{ width: `${(item.value / maxStageValue) * 100}%` }}
                  />
                </div>
                <div className="w-20 text-right text-sm stat-number text-orange-400">
                  ${(item.value / 1000000).toFixed(2)}M
                </div>
                <div className="w-12 text-right text-xs text-zinc-500">{item.count}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Revenue by Location */}
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
          <h3 className="text-lg font-semibold mb-4 text-orange-400">Revenue by Location</h3>
          <div className="space-y-4">
            {revenueByLocation.map((item) => (
              <div key={item.location} className="flex items-center justify-between">
                <div className="text-sm text-white">{item.location}</div>
                <div className="flex items-center gap-4">
                  <span className="text-sm text-zinc-500">{item.count} projects</span>
                  <span className="stat-number text-orange-400">
                    ${(item.value / 1000000).toFixed(2)}M
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

// Capacity View Component
interface CapacityViewProps {
  projects: Project[];
  loading: boolean;
}

function CapacityView({ projects, loading }: CapacityViewProps) {
  // Calculate capacity analysis per location
  const capacityAnalysis = useMemo(() => {
    const analysis: Record<string, {
      totalProjects: number;
      rtbCount: number;
      peCount: number;
      monthlyCapacity: number;
      crews: typeof CREWS_BY_LOCATION[LocationKey]["crews"];
      forecastedThisMonth: number;
      forecastedNextMonth: number;
    }> = {};

    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const nextMonthStr = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}`;

    Object.keys(CREWS_BY_LOCATION).forEach((location) => {
      const loc = location as LocationKey;
      const config = CREWS_BY_LOCATION[loc];
      const locProjects = projects.filter((p) => p.pbLocation === location);

      const forecastedThisMonth = locProjects.filter(
        (p) => p.forecastedInstallDate?.startsWith(thisMonth)
      ).length;

      const forecastedNextMonth = locProjects.filter(
        (p) => p.forecastedInstallDate?.startsWith(nextMonthStr)
      ).length;

      analysis[location] = {
        totalProjects: locProjects.length,
        rtbCount: locProjects.filter((p) => p.isRtb).length,
        peCount: locProjects.filter((p) => p.isParticipateEnergy).length,
        monthlyCapacity: config.monthlyCapacity,
        crews: config.crews,
        forecastedThisMonth,
        forecastedNextMonth,
      };
    });

    return analysis;
  }, [projects]);

  const totalMonthlyCapacity = Object.values(capacityAnalysis).reduce(
    (sum, loc) => sum + loc.monthlyCapacity,
    0
  );

  const totalForecastedThisMonth = Object.values(capacityAnalysis).reduce(
    (sum, loc) => sum + loc.forecastedThisMonth,
    0
  );

  return (
    <>
      {/* Optimization Panel */}
      <div className="bg-surface-gradient border border-orange-500 rounded-xl p-6 mb-6">
        <h3 className="text-lg font-semibold text-orange-400 mb-2">AI Capacity Optimizer</h3>
        <p className="text-sm text-zinc-400 mb-4">
          Analyze forecasted installs vs. available crew capacity across all locations
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
          <div className="text-center">
            <div className="text-2xl font-bold stat-number text-white">{totalMonthlyCapacity}</div>
            <div className="text-xs text-zinc-500">Monthly Capacity</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold stat-number text-orange-400">{totalForecastedThisMonth}</div>
            <div className="text-xs text-zinc-500">Forecasted This Month</div>
          </div>
          <div className="text-center">
            <div className={`text-2xl font-bold stat-number ${totalForecastedThisMonth > totalMonthlyCapacity ? "text-red-400" : "text-green-400"}`}>
              {totalMonthlyCapacity - totalForecastedThisMonth}
            </div>
            <div className="text-xs text-zinc-500">Available Slots</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold stat-number text-blue-400">
              {Math.round((totalForecastedThisMonth / totalMonthlyCapacity) * 100)}%
            </div>
            <div className="text-xs text-zinc-500">Utilization</div>
          </div>
        </div>
      </div>

      {/* Location Capacity Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Object.entries(capacityAnalysis).map(([location, data]) => (
          <div key={location} className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5">
            <div className="flex justify-between items-start mb-4">
              <h4 className="font-semibold text-white">{location}</h4>
              <span className="text-xs text-zinc-500">{data.crews.length} crews</span>
            </div>

            <div className="grid grid-cols-3 gap-2 mb-4">
              <div className="text-center bg-zinc-800/50 rounded-lg p-3">
                <div className="text-xl font-bold stat-number text-white">{data.totalProjects}</div>
                <div className="text-[10px] text-zinc-500">Projects</div>
              </div>
              <div className="text-center bg-zinc-800/50 rounded-lg p-3">
                <div className="text-xl font-bold stat-number text-orange-400">{data.rtbCount}</div>
                <div className="text-[10px] text-zinc-500">RTB</div>
              </div>
              <div className="text-center bg-zinc-800/50 rounded-lg p-3">
                <div className="text-xl font-bold stat-number text-emerald-400">{data.peCount}</div>
                <div className="text-[10px] text-zinc-500">PE</div>
              </div>
            </div>

            {/* Capacity bar */}
            <div className="mb-2">
              <div className="flex justify-between text-xs text-zinc-500 mb-1">
                <span>This Month</span>
                <span>{data.forecastedThisMonth} / {data.monthlyCapacity}</span>
              </div>
              <div className="w-full bg-zinc-800 rounded-full h-3 overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    data.forecastedThisMonth > data.monthlyCapacity
                      ? "bg-red-500"
                      : data.forecastedThisMonth > data.monthlyCapacity * 0.8
                      ? "bg-yellow-500"
                      : "bg-green-500"
                  }`}
                  style={{ width: `${Math.min((data.forecastedThisMonth / data.monthlyCapacity) * 100, 100)}%` }}
                />
              </div>
            </div>

            {/* Crews */}
            <div className="flex flex-wrap gap-1 mt-3">
              {data.crews.map((crew) => (
                <span
                  key={crew.name}
                  className="text-[10px] px-2 py-1 rounded-full"
                  style={{ backgroundColor: crew.color + "30", color: crew.color }}
                >
                  {crew.name}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// PE View Component
interface PEViewProps {
  projects: Project[];
  loading: boolean;
}

function PEView({ projects, loading }: PEViewProps) {
  // Split by milestone status
  const inspectionComplete = projects.filter(
    (p) => p.inspectionPassDate || ["Permission To Operate", "Close Out", "Project Complete"].includes(p.stage)
  );
  const ptoComplete = projects.filter(
    (p) => p.ptoGrantedDate || ["Close Out", "Project Complete"].includes(p.stage)
  );
  const pendingInspection = projects.filter(
    (p) => !p.inspectionPassDate && !["Permission To Operate", "Close Out", "Project Complete"].includes(p.stage)
  );

  const totalValue = projects.reduce((sum, p) => sum + (p.amount || 0), 0);

  const exportPEReport = (format: "csv" | "excel" | "clipboard") => {
    const headers = ["Project Name", "Location", "Stage", "Value", "Forecasted Install", "Forecasted Inspection", "Forecasted PTO"];
    const rows = projects.map((p) => [
      p.name,
      p.pbLocation,
      p.stage,
      p.amount,
      p.forecastedInstallDate || "N/A",
      p.forecastedInspectionDate || "N/A",
      p.forecastedPtoDate || "N/A",
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");

    if (format === "clipboard") {
      navigator.clipboard.writeText(csvContent);
      alert("Copied to clipboard!");
    } else {
      const blob = new Blob([csvContent], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pe-report-${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
    }
  };

  return (
    <>
      {/* PE Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <StatCard label="Total PE Projects" value={projects.length} color="emerald" loading={loading} />
        <StatCard
          label="PE Pipeline Value"
          value={`$${(totalValue / 1000000).toFixed(2)}M`}
          color="green"
          loading={loading}
        />
        <StatCard
          label="Milestone 1 Complete"
          value={inspectionComplete.length}
          subValue="Inspection passed"
          loading={loading}
        />
        <StatCard
          label="Milestone 2 Complete"
          value={ptoComplete.length}
          subValue="PTO granted"
          loading={loading}
        />
        <StatCard
          label="Pending Inspection"
          value={pendingInspection.length}
          color="orange"
          loading={loading}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Milestone 1: Inspection Complete */}
        <div className="bg-zinc-900/50 border border-emerald-500/50 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-emerald-400 mb-4">
            Inspection Complete (Milestone 1)
          </h3>
          <div className="max-h-80 overflow-y-auto space-y-2">
            {inspectionComplete.length === 0 ? (
              <p className="text-sm text-zinc-500">No projects at this milestone</p>
            ) : (
              inspectionComplete.map((p) => (
                <div key={p.id} className="flex justify-between items-center bg-zinc-800/50 rounded-lg p-3">
                  <div>
                    <div className="text-sm text-white">{p.name}</div>
                    <div className="text-xs text-zinc-500">{p.pbLocation}</div>
                  </div>
                  <span className="badge badge-success">Passed</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Milestone 2: PTO Complete */}
        <div className="bg-zinc-900/50 border border-emerald-500/50 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-emerald-400 mb-4">
            Project Complete / PTO (Milestone 2)
          </h3>
          <div className="max-h-80 overflow-y-auto space-y-2">
            {ptoComplete.length === 0 ? (
              <p className="text-sm text-zinc-500">No projects at this milestone</p>
            ) : (
              ptoComplete.map((p) => (
                <div key={p.id} className="flex justify-between items-center bg-zinc-800/50 rounded-lg p-3">
                  <div>
                    <div className="text-sm text-white">{p.name}</div>
                    <div className="text-xs text-zinc-500">{p.pbLocation}</div>
                  </div>
                  <span className="badge badge-success">Complete</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Export Panel */}
      <div className="bg-zinc-900/50 border border-emerald-500/50 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-emerald-400 mb-2">Export for Participate Energy</h3>
        <p className="text-xs text-zinc-500 mb-4">
          Generate reports with forecasted and scheduled dates for PE submission
        </p>
        <div className="grid grid-cols-3 gap-4">
          <button
            onClick={() => exportPEReport("excel")}
            className="btn-accent py-3 rounded-lg text-sm bg-emerald-600 hover:bg-emerald-500"
          >
            Download Excel
          </button>
          <button
            onClick={() => exportPEReport("csv")}
            className="btn-accent py-3 rounded-lg text-sm bg-emerald-600 hover:bg-emerald-500"
          >
            Download CSV
          </button>
          <button
            onClick={() => exportPEReport("clipboard")}
            className="btn-accent py-3 rounded-lg text-sm bg-emerald-600 hover:bg-emerald-500"
          >
            Copy to Clipboard
          </button>
        </div>
      </div>
    </>
  );
}

// Alerts View Component
interface AlertsViewProps {
  projects: Project[];
  alertCounts: { total: number; overdueInstall: number; overdueInspection: number; overduePto: number; blocked: number };
  loading: boolean;
}

function AlertsView({ projects, alertCounts, loading }: AlertsViewProps) {
  // Get alert projects
  const overdueInstallProjects = projects.filter(
    (p) => p.daysToInstall !== null && p.daysToInstall < 0 && !p.constructionCompleteDate
  );
  const overdueInspectionProjects = projects.filter(
    (p) => p.daysToInspection !== null && p.daysToInspection < 0 && !p.inspectionPassDate
  );
  const overduePtoProjects = projects.filter(
    (p) => p.daysToPto !== null && p.daysToPto < 0 && !p.ptoGrantedDate
  );
  const blockedProjects = projects.filter((p) => p.isBlocked);

  return (
    <>
      {/* Alert Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Overdue Install"
          value={alertCounts.overdueInstall}
          color="red"
          alert={alertCounts.overdueInstall > 5}
          loading={loading}
        />
        <StatCard
          label="Overdue Inspection"
          value={alertCounts.overdueInspection}
          color="red"
          alert={alertCounts.overdueInspection > 5}
          loading={loading}
        />
        <StatCard
          label="Overdue PTO"
          value={alertCounts.overduePto}
          color="red"
          alert={alertCounts.overduePto > 5}
          loading={loading}
        />
        <StatCard
          label="Blocked"
          value={alertCounts.blocked}
          color="orange"
          alert={alertCounts.blocked > 10}
          loading={loading}
        />
      </div>

      {/* Alert Lists */}
      <div className="space-y-6">
        {/* Overdue Install */}
        {overdueInstallProjects.length > 0 && (
          <div className="bg-zinc-900/50 border border-red-500/50 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-red-400 mb-4">
              Overdue Install ({overdueInstallProjects.length})
            </h3>
            <div className="space-y-2">
              {overdueInstallProjects.slice(0, 10).map((p) => (
                <div key={p.id} className="flex justify-between items-center bg-zinc-800/50 rounded-lg p-3">
                  <div>
                    <div className="text-sm text-white">{p.name}</div>
                    <div className="text-xs text-zinc-500">{p.pbLocation} - {p.stage}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-red-400 stat-number">
                      {Math.abs(p.daysToInstall || 0)}d overdue
                    </div>
                    <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400">
                      View in HubSpot
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Blocked Projects */}
        {blockedProjects.length > 0 && (
          <div className="bg-zinc-900/50 border border-orange-500/50 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-orange-400 mb-4">
              Blocked Projects ({blockedProjects.length})
            </h3>
            <div className="space-y-2">
              {blockedProjects.slice(0, 10).map((p) => (
                <div key={p.id} className="flex justify-between items-center bg-zinc-800/50 rounded-lg p-3">
                  <div>
                    <div className="text-sm text-white">{p.name}</div>
                    <div className="text-xs text-zinc-500">{p.pbLocation}</div>
                  </div>
                  <div className="text-right">
                    <span className="badge badge-warning">{p.stage}</span>
                    <div className="mt-1">
                      <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400">
                        View in HubSpot
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {alertCounts.total === 0 && (
          <div className="text-center py-12 text-zinc-500">
            No alerts at this time.
          </div>
        )}
      </div>
    </>
  );
}
