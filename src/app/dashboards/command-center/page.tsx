"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { prefetchDashboard } from "@/lib/prefetch";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  generateMonthlyPeriods,
  generateWeeklyPeriods,
  formatRevenueShort,
  type MilestoneConfig,
} from "@/lib/revenue-utils";

// ============================================================
// TypeScript Interfaces
// ============================================================

interface Crew {
  name: string;
  roofers: number;
  electricians: number;
  color: string;
  dailyCapacity: number;
}

interface CrewConfig {
  crews: Crew[];
  monthly_capacity: number;
}

interface ApiProject {
  id: string;
  name?: string;
  pbLocation?: string;
  ahj?: string;
  utility?: string;
  stage?: string;
  amount?: number;
  url?: string;
  closeDate?: string;
  forecastedInstallDate?: string;
  constructionScheduleDate?: string;
  forecastedInspectionDate?: string;
  inspectionScheduleDate?: string;
  forecastedPtoDate?: string;
  daysToInstall?: number | null;
  daysToInspection?: number | null;
  daysToPto?: number | null;
  daysSinceClose?: number;
  isParticipateEnergy?: boolean;
  priorityScore?: number;
  daysForInstallers?: number;
  designApprovalDate?: string | null;
  constructionCompleteDate?: string | null;
  inspectionPassDate?: string | null;
  ptoGrantedDate?: string | null;
}

interface Project {
  id: string;
  name: string;
  pb_location: string;
  ahj: string;
  utility: string;
  stage: string;
  amount: number;
  url: string;
  close_date?: string;
  forecast_install?: string;
  forecast_inspection?: string;
  forecast_pto?: string;
  days_to_install: number | null;
  days_to_inspection: number | null;
  days_to_pto: number | null;
  days_since_close: number;
  is_participate_energy: boolean;
  is_rtb: boolean;
  is_schedulable: boolean;
  priority_score: number;
  estimated_install_days: number;
  default_crew: string;
  design_approval: string | null;
  construction_complete: string | null;
  inspection_pass: string | null;
  pto_granted: string | null;
}

interface MonthlyForecastEntry {
  count: number;
  days_needed: number;
  value: number;
}

interface CapacityAnalysis {
  crews: Crew[];
  monthly_capacity: number;
  monthly_forecast: Record<string, MonthlyForecastEntry>;
  total_projects: number;
  rtb_count: number;
  pe_count: number;
}

interface Alert {
  type: "danger" | "warning";
  title: string;
  message: string;
  project?: Project;
}

interface Filters {
  location: string;
  pe: string;
  status: string;
  search: string;
}

interface BacklogPeriod {
  key: string;
  label: string;
  count: number;
  value: number;
  byLocation: Record<string, number>;
  byStage: Record<string, number>;
}

interface TimelinePeriod {
  label: string;
  start: Date;
  end: Date;
  total: number;
  count: number;
  byLocation: Record<string, { value: number; count: number }>;
}

type ViewType = "pipeline" | "revenue" | "capacity" | "pe" | "alerts" | "executive" | "at-risk" | "optimizer" | "locations";

// ============================================================
// Constants
// ============================================================

const CREWS_CONFIG: Record<string, CrewConfig> = {
  Westminster: {
    crews: [
      { name: "WM Crew 1", roofers: 2, electricians: 1, color: "#3b82f6", dailyCapacity: 1 },
      { name: "WM Crew 2", roofers: 2, electricians: 1, color: "#8b5cf6", dailyCapacity: 1 },
    ],
    monthly_capacity: 44,
  },
  Centennial: {
    crews: [
      { name: "CENT Crew", roofers: 2, electricians: 1, color: "#22c55e", dailyCapacity: 1 },
    ],
    monthly_capacity: 22,
  },
  "Colorado Springs": {
    crews: [
      { name: "COS Crew", roofers: 2, electricians: 1, color: "#eab308", dailyCapacity: 1 },
    ],
    monthly_capacity: 22,
  },
  "San Luis Obispo": {
    crews: [
      { name: "SLO Solar", roofers: 2, electricians: 1, color: "#06b6d4", dailyCapacity: 1 },
      { name: "SLO Electrical 1", roofers: 0, electricians: 2, color: "#a855f7", dailyCapacity: 1 },
      { name: "SLO Electrical 2", roofers: 0, electricians: 2, color: "#14b8a6", dailyCapacity: 1 },
    ],
    monthly_capacity: 66,
  },
  Camarillo: {
    crews: [
      { name: "CAM Crew", roofers: 2, electricians: 1, color: "#f43f5e", dailyCapacity: 1 },
    ],
    monthly_capacity: 22,
  },
};

const STAGE_ORDER = [
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

const STAGE_COLORS: Record<string, string> = {
  "Site Survey": "#3b82f6",
  "Design & Engineering": "#8b5cf6",
  "Permitting & Interconnection": "#ec4899",
  "RTB - Blocked": "#ef4444",
  "Ready To Build": "#10b981",
  Construction: "#f97316",
  Inspection: "#eab308",
  "Permission To Operate": "#06b6d4",
  "Close Out": "#22c55e",
};

const BACKLOG_STAGES = [
  "Site Survey",
  "Design & Engineering",
  "Permitting & Interconnection",
  "RTB - Blocked",
  "Ready To Build",
];

// ============================================================
// Helper Functions
// ============================================================

function formatDays(days: number | null, completedDate?: string | null): string {
  if (completedDate) return "Done";
  if (days === null || days === undefined) return "N/A";
  if (days === 0) return "today";
  if (days < 0) return `${Math.abs(days)}d over`;
  return `in ${days}d`;
}

function formatCurrency(value: number, unit: "k" | "M" = "k"): string {
  if (unit === "M") {
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
    if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
    return `$${value.toFixed(0)}`;
  }
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1000).toFixed(0)}k`;
  return `$${value.toFixed(0)}`;
}

function getDaysClass(
  days: number | null,
  completedDate: string | null,
  warningThreshold: number = 14
): string {
  if (completedDate) return "text-emerald-500";
  if (days !== null && days < 0) return "text-red-500";
  if (days !== null && days <= warningThreshold) return "text-yellow-500";
  return "text-emerald-500";
}

function transformProject(p: ApiProject): Project {
  const isRtb = p.stage === "Ready To Build" || p.stage === "RTB - Blocked";
  const isSchedulable = isRtb || p.stage === "Construction";

  return {
    id: p.id,
    name: p.name || `Project ${p.id}`,
    pb_location: p.pbLocation || "Unknown",
    ahj: p.ahj || "",
    utility: p.utility || "",
    stage: p.stage || "Unknown",
    amount: p.amount || 0,
    url: p.url || `https://app.hubspot.com/contacts/21710069/record/0-3/${p.id}`,
    close_date: p.closeDate,
    forecast_install: p.forecastedInstallDate || p.constructionScheduleDate,
    forecast_inspection: p.forecastedInspectionDate || p.inspectionScheduleDate,
    forecast_pto: p.forecastedPtoDate,
    days_to_install: p.daysToInstall ?? null,
    days_to_inspection: p.daysToInspection ?? null,
    days_to_pto: p.daysToPto ?? null,
    days_since_close: p.daysSinceClose || 0,
    is_participate_energy: p.isParticipateEnergy || false,
    is_rtb: isRtb,
    is_schedulable: isSchedulable,
    priority_score: p.priorityScore || 0,
    estimated_install_days: p.daysForInstallers || 2,
    default_crew: CREWS_CONFIG[p.pbLocation || ""]?.crews[0]?.name || "Unassigned",
    design_approval: p.designApprovalDate || null,
    construction_complete: p.constructionCompleteDate || null,
    inspection_pass: p.inspectionPassDate || null,
    pto_granted: p.ptoGrantedDate || null,
  };
}

function calculateCapacityAnalysis(
  projectList: Project[]
): Record<string, CapacityAnalysis> {
  const analysis: Record<string, CapacityAnalysis> = {};
  Object.keys(CREWS_CONFIG).forEach((location) => {
    const config = CREWS_CONFIG[location];
    const locProjects = projectList.filter((p) => p.pb_location === location);
    const monthlyForecast: Record<string, MonthlyForecastEntry> = {};

    locProjects.forEach((p) => {
      if (p.forecast_install) {
        const month = p.forecast_install.substring(0, 7);
        if (!monthlyForecast[month])
          monthlyForecast[month] = { count: 0, days_needed: 0, value: 0 };
        monthlyForecast[month].count++;
        monthlyForecast[month].days_needed += p.estimated_install_days || 2;
        monthlyForecast[month].value += p.amount || 0;
      }
    });

    analysis[location] = {
      crews: config.crews,
      monthly_capacity: config.monthly_capacity,
      monthly_forecast: monthlyForecast,
      total_projects: locProjects.length,
      rtb_count: locProjects.filter((p) => p.is_rtb).length,
      pe_count: locProjects.filter((p) => p.is_participate_energy).length,
    };
  });
  return analysis;
}

function calculateAlerts(
  projectList: Project[],
  capacityAnalysis: Record<string, CapacityAnalysis>
): Alert[] {
  const alerts: Alert[] = [];

  projectList
    .filter(
      (p) =>
        p.days_to_install !== null &&
        p.days_to_install < -7 &&
        !p.construction_complete
    )
    .forEach((p) => {
      alerts.push({
        type: "danger",
        title: "Install Significantly Overdue",
        message: `${p.name.split("|")[1]?.trim() || p.name} is ${Math.abs(p.days_to_install!)} days past forecast`,
        project: p,
      });
    });

  projectList
    .filter(
      (p) =>
        p.is_participate_energy &&
        p.days_to_pto !== null &&
        p.days_to_pto < 0 &&
        !p.pto_granted
    )
    .forEach((p) => {
      alerts.push({
        type: "danger",
        title: "PE PTO Overdue",
        message: `${p.name.split("|")[1]?.trim() || p.name} PE milestone at risk`,
        project: p,
      });
    });

  Object.entries(capacityAnalysis).forEach(([loc, cap]) => {
    Object.entries(cap.monthly_forecast).forEach(([month, data]) => {
      if (data.days_needed > cap.monthly_capacity * 1.2) {
        alerts.push({
          type: "warning",
          title: "Capacity Overload",
          message: `${loc} forecasted ${data.days_needed} days in ${month}, capacity is ${cap.monthly_capacity}`,
        });
      }
    });
  });

  return alerts;
}

// ============================================================
// Sub-Components
// ============================================================

function StatCard({
  value,
  label,
  sub,
  variant,
  borderColor,
}: {
  value: string | number;
  label: string;
  sub?: string;
  variant?: "accent" | "pe" | "danger" | "default";
  borderColor?: string;
}) {
  const variantClasses: Record<string, string> = {
    accent: "border-orange-500 bg-orange-500/10",
    pe: "border-emerald-500 bg-emerald-500/10",
    danger: "border-red-500 bg-red-500/10",
    default: "border-zinc-800 bg-[#12121a]",
  };
  const cls = variantClasses[variant || "default"];
  const style = borderColor && !variant ? { borderColor } : undefined;

  return (
    <div
      className={`rounded-xl border p-4 ${cls}`}
      style={style}
    >
      <div className="text-3xl font-bold font-mono">{value}</div>
      <div className="text-[0.7rem] text-zinc-500 mt-1">{label}</div>
      {sub && <div className="text-[0.65rem] text-zinc-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function FilterBtn({
  active,
  onClick,
  children,
  peStyle,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  peStyle?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-md text-xs font-medium cursor-pointer border transition-all
        ${
          active
            ? peStyle
              ? "bg-emerald-500 border-emerald-500 text-black"
              : "bg-orange-500 border-orange-500 text-black"
            : "bg-[#0a0a0f] border-zinc-800 text-zinc-300 hover:border-orange-500 hover:text-orange-500"
        }`}
    >
      {children}
    </button>
  );
}

// ============================================================
// Pipeline View
// ============================================================

function PipelineView({ projects }: { projects: Project[] }) {
  const [filters, setFilters] = useState<Filters>({
    location: "all",
    pe: "all",
    status: "all",
    search: "",
  });

  const overdueInstall = projects.filter(
    (p) => p.days_to_install !== null && p.days_to_install < 0 && !p.construction_complete
  ).length;
  const overdueInspection = projects.filter(
    (p) => p.days_to_inspection !== null && p.days_to_inspection < 0 && !p.inspection_pass
  ).length;
  const overduePto = projects.filter(
    (p) => p.days_to_pto !== null && p.days_to_pto < 0 && !p.pto_granted
  ).length;
  const rtbCount = projects.filter((p) => p.is_rtb).length;
  const peCount = projects.filter((p) => p.is_participate_energy).length;
  const totalValue = projects.reduce((s, p) => s + p.amount, 0);

  const locations = useMemo(
    () =>
      [...new Set(projects.map((p) => p.pb_location))]
        .filter((l) => l !== "Unknown")
        .sort(),
    [projects]
  );

  const filtered = useMemo(() => {
    let result = [...projects];
    if (filters.location !== "all")
      result = result.filter((p) => p.pb_location === filters.location);
    if (filters.pe === "pe")
      result = result.filter((p) => p.is_participate_energy);
    else if (filters.pe === "non-pe")
      result = result.filter((p) => !p.is_participate_energy);
    if (filters.status === "overdue")
      result = result.filter(
        (p) =>
          (p.days_to_install !== null && p.days_to_install < 0 && !p.construction_complete) ||
          (p.days_to_pto !== null && p.days_to_pto < 0 && !p.pto_granted)
      );
    else if (filters.status === "rtb") result = result.filter((p) => p.is_rtb);
    if (filters.search) {
      const s = filters.search.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(s) ||
          (p.ahj || "").toLowerCase().includes(s)
      );
    }
    result.sort((a, b) => b.priority_score - a.priority_score);
    return result.slice(0, 100);
  }, [projects, filters]);

  const updateFilter = (key: keyof Filters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div>
      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        <StatCard
          value={projects.length}
          label="Total Projects"
          sub={`${formatCurrency(totalValue, "M")} pipeline`}
        />
        <StatCard
          value={rtbCount}
          label="Ready to Build"
          sub="Available to schedule"
          variant="accent"
        />
        <StatCard
          value={peCount}
          label="Participate Energy"
          sub="Milestone tracking"
          variant="pe"
        />
        <StatCard
          value={overdueInstall}
          label="Install Overdue"
          sub="Past forecast date"
          variant="danger"
        />
        <StatCard
          value={overdueInspection}
          label="Inspection Overdue"
          borderColor="#eab308"
        />
        <StatCard
          value={overduePto}
          label="PTO Overdue"
          borderColor="#8b5cf6"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 items-center bg-[#12121a] border border-zinc-800 rounded-xl p-4 mb-6">
        <div className="flex items-center gap-2">
          <span className="text-[0.7rem] text-zinc-500">Location:</span>
          <select
            className="bg-[#0a0a0f] border border-zinc-800 text-zinc-300 px-3 py-2 rounded-md text-xs focus:outline-none focus:border-orange-500"
            value={filters.location}
            onChange={(e) => updateFilter("location", e.target.value)}
          >
            <option value="all">All Locations</option>
            {locations.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[0.7rem] text-zinc-500">Type:</span>
          <FilterBtn
            active={filters.pe === "all"}
            onClick={() => updateFilter("pe", "all")}
          >
            All
          </FilterBtn>
          <FilterBtn
            active={filters.pe === "pe"}
            onClick={() => updateFilter("pe", "pe")}
            peStyle
          >
            PE Only
          </FilterBtn>
          <FilterBtn
            active={filters.pe === "non-pe"}
            onClick={() => updateFilter("pe", "non-pe")}
          >
            Non-PE
          </FilterBtn>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[0.7rem] text-zinc-500">Status:</span>
          <FilterBtn
            active={filters.status === "all"}
            onClick={() => updateFilter("status", "all")}
          >
            All
          </FilterBtn>
          <FilterBtn
            active={filters.status === "overdue"}
            onClick={() => updateFilter("status", "overdue")}
          >
            Overdue
          </FilterBtn>
          <FilterBtn
            active={filters.status === "rtb"}
            onClick={() => updateFilter("status", "rtb")}
          >
            RTB
          </FilterBtn>
        </div>
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search projects..."
            className="bg-[#0a0a0f] border border-zinc-800 text-zinc-300 px-3 py-2 rounded-md text-xs w-52 focus:outline-none focus:border-orange-500"
            value={filters.search}
            onChange={(e) => updateFilter("search", e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-[#12121a] border border-zinc-800 rounded-xl overflow-hidden">
        {/* Header */}
        <div className="hidden lg:grid grid-cols-[50px_2fr_1fr_100px_100px_100px_100px_80px_120px] gap-2 px-4 py-3 bg-[#0a0a0f] border-b border-zinc-800 text-[0.7rem] font-semibold text-zinc-500">
          <div>#</div>
          <div>Project</div>
          <div>Location / AHJ</div>
          <div>Value</div>
          <div>Install</div>
          <div>Inspection</div>
          <div>PTO</div>
          <div>Priority</div>
          <div>Actions</div>
        </div>
        {/* Body */}
        <div className="max-h-[500px] overflow-y-auto">
          {filtered.map((p, i) => {
            const priorityPct = Math.min(100, (p.priority_score / 150) * 100);
            const priorityColor =
              p.priority_score > 100
                ? "#ef4444"
                : p.priority_score > 50
                  ? "#eab308"
                  : "#10b981";
            const isOverdue =
              p.days_to_install !== null &&
              p.days_to_install < 0 &&
              !p.construction_complete;

            return (
              <div
                key={p.id}
                className={`grid grid-cols-1 lg:grid-cols-[50px_2fr_1fr_100px_100px_100px_100px_80px_120px] gap-2 px-4 py-3 border-b border-zinc-800 text-[0.75rem] items-center transition-colors hover:bg-[#1a1a24] ${
                  p.is_participate_energy ? "border-l-[3px] border-l-emerald-500" : ""
                } ${isOverdue ? "bg-red-500/5" : ""}`}
              >
                <div className="text-zinc-500">{i + 1}</div>
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {p.is_participate_energy && (
                      <span className="text-[0.6rem] px-2 py-0.5 rounded-full font-semibold bg-emerald-500/15 text-emerald-500 border border-emerald-500">
                        PE
                      </span>
                    )}
                    {p.is_rtb && (
                      <span className="text-[0.6rem] px-2 py-0.5 rounded-full font-semibold bg-emerald-500/20 text-emerald-500">
                        RTB
                      </span>
                    )}
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-blue-500 hover:underline"
                    >
                      {p.name.split("|")[0].trim()}
                    </a>
                  </div>
                  <div className="text-[0.65rem] text-zinc-500">{p.stage}</div>
                </div>
                <div>
                  <div>{p.pb_location}</div>
                  <div className="text-[0.65rem] text-zinc-500">
                    {p.ahj || "-"}
                  </div>
                </div>
                <div className="font-mono font-semibold text-orange-500">
                  {formatCurrency(p.amount)}
                </div>
                <div
                  className={`font-mono font-semibold text-[0.75rem] ${getDaysClass(p.days_to_install, p.construction_complete)}`}
                >
                  {formatDays(p.days_to_install, p.construction_complete)}
                </div>
                <div
                  className={`font-mono font-semibold text-[0.75rem] ${getDaysClass(p.days_to_inspection, p.inspection_pass)}`}
                >
                  {formatDays(p.days_to_inspection, p.inspection_pass)}
                </div>
                <div
                  className={`font-mono font-semibold text-[0.75rem] ${getDaysClass(p.days_to_pto, p.pto_granted, 30)}`}
                >
                  {formatDays(p.days_to_pto, p.pto_granted)}
                </div>
                <div>
                  <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${priorityPct}%`,
                        background: priorityColor,
                      }}
                    />
                  </div>
                  <div className="text-[0.6rem] text-zinc-500 mt-0.5">
                    {p.priority_score.toFixed(0)}
                  </div>
                </div>
                <div>
                  {p.is_schedulable && (
                    <Link
                      href="/dashboards/scheduler"
                      className="text-[0.65rem] px-2 py-1 rounded-md border border-zinc-800 text-zinc-300 hover:border-orange-500 hover:text-orange-500 transition-all"
                      onMouseEnter={() => prefetchDashboard("scheduler")}
                    >
                      Schedule
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="p-8 text-center text-zinc-500 text-sm">
              No projects match the current filters.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Revenue View
// ============================================================

function RevenueView({ projects }: { projects: Project[] }) {
  const [revenueViewMode, setRevenueViewMode] = useState<"weekly" | "monthly">("weekly");
  const [expandedBacklog, setExpandedBacklog] = useState<Record<string, boolean>>({});
  const [expandedTimeline, setExpandedTimeline] = useState<Record<string, boolean>>({});

  const totalValue = projects.reduce((s, p) => s + p.amount, 0);
  const scheduledValue = projects
    .filter((p) => p.forecast_install && !p.construction_complete)
    .reduce((s, p) => s + p.amount, 0);
  const rtbValue = projects
    .filter((p) => p.is_rtb)
    .reduce((s, p) => s + p.amount, 0);
  const peValue = projects
    .filter((p) => p.is_participate_energy)
    .reduce((s, p) => s + p.amount, 0);

  // Stage Revenue
  const stageData = useMemo(() => {
    const data: Record<string, { count: number; value: number }> = {};
    let maxVal = 0;
    projects.forEach((p) => {
      if (!data[p.stage]) data[p.stage] = { count: 0, value: 0 };
      data[p.stage].count++;
      data[p.stage].value += p.amount;
      if (data[p.stage].value > maxVal) maxVal = data[p.stage].value;
    });
    const sorted = Object.keys(data).sort((a, b) => {
      const ai = STAGE_ORDER.indexOf(a);
      const bi = STAGE_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
    return { data, sorted, maxVal };
  }, [projects]);

  // Backlog Revenue
  const backlogData = useMemo(() => {
    const backlogProjects = projects.filter((p) => BACKLOG_STAGES.includes(p.stage));
    const now = new Date();
    const monthlyData: Record<
      string,
      { label: string; count: number; value: number; byLocation: Record<string, number>; byStage: Record<string, number> }
    > = {};

    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const key = d.toISOString().substring(0, 7);
      const label = d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
      monthlyData[key] = { label, count: 0, value: 0, byLocation: {}, byStage: {} };
    }
    monthlyData["overdue"] = { label: "Overdue", count: 0, value: 0, byLocation: {}, byStage: {} };

    backlogProjects.forEach((p) => {
      if (!p.forecast_install) return;
      const installDate = new Date(p.forecast_install);
      const monthKey = installDate.toISOString().substring(0, 7);
      const location = p.pb_location || "Unknown";
      const stage = p.stage;

      let bucket;
      if (installDate < now) {
        bucket = monthlyData["overdue"];
      } else if (monthlyData[monthKey]) {
        bucket = monthlyData[monthKey];
      } else {
        return;
      }

      bucket.count++;
      bucket.value += p.amount;
      bucket.byLocation[location] = (bucket.byLocation[location] || 0) + p.amount;
      bucket.byStage[stage] = (bucket.byStage[stage] || 0) + p.amount;
    });

    const sortedPeriods: BacklogPeriod[] = Object.entries(monthlyData)
      .filter(([k, data]) => data.count > 0 || k !== "overdue")
      .sort((a, b) => {
        if (a[0] === "overdue") return -1;
        if (b[0] === "overdue") return 1;
        return a[0].localeCompare(b[0]);
      })
      .map(([key, data]) => ({ key, ...data }));

    const totalBacklogValue = backlogProjects.reduce((s, p) => s + p.amount, 0);
    const totalBacklogCount = backlogProjects.length;
    const overdueValue = monthlyData["overdue"]?.value || 0;

    return { sortedPeriods, totalBacklogValue, totalBacklogCount, overdueValue };
  }, [projects]);

  // Location Revenue
  const locationData = useMemo(() => {
    const data: Record<string, { count: number; value: number; rtbValue: number; scheduledValue: number }> = {};
    projects.forEach((p) => {
      const loc = p.pb_location || "Unknown";
      if (!data[loc]) data[loc] = { count: 0, value: 0, rtbValue: 0, scheduledValue: 0 };
      data[loc].count++;
      data[loc].value += p.amount;
      if (p.is_rtb) data[loc].rtbValue += p.amount;
      if (p.forecast_install && !p.construction_complete) data[loc].scheduledValue += p.amount;
    });
    const sorted = Object.keys(data).sort((a, b) => data[b].value - data[a].value);
    return { data, sorted };
  }, [projects]);

  // Timeline
  const timelineData = useMemo(() => {
    const now = new Date();
    const periods: { label: string; start: Date; end: Date }[] = [];

    if (revenueViewMode === "weekly") {
      for (let i = 0; i < 8; i++) {
        const weekStart = new Date(now);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay() + i * 7);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        periods.push({
          label:
            weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
            " - " +
            weekEnd.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          start: weekStart,
          end: weekEnd,
        });
      }
    } else {
      for (let i = 0; i < 6; i++) {
        const monthStart = new Date(now.getFullYear(), now.getMonth() + i, 1);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + i + 1, 0);
        periods.push({
          label: monthStart.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
          start: monthStart,
          end: monthEnd,
        });
      }
    }

    const locations = [...new Set(projects.map((p) => p.pb_location))]
      .filter((l) => l !== "Unknown")
      .sort();

    const periodData: TimelinePeriod[] = periods.map((period) => {
      const data: TimelinePeriod = {
        label: period.label,
        start: period.start,
        end: period.end,
        total: 0,
        count: 0,
        byLocation: {},
      };
      locations.forEach((loc) => (data.byLocation[loc] = { value: 0, count: 0 }));

      projects.forEach((p) => {
        if (p.forecast_install) {
          const installDate = new Date(p.forecast_install);
          if (installDate >= period.start && installDate <= period.end) {
            data.total += p.amount;
            data.count++;
            if (data.byLocation[p.pb_location]) {
              data.byLocation[p.pb_location].value += p.amount;
              data.byLocation[p.pb_location].count++;
            }
          }
        }
      });
      return data;
    });

    return periodData;
  }, [projects, revenueViewMode]);

  return (
    <div>
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          value={formatCurrency(totalValue, "M")}
          label="Total Pipeline"
          sub={`${projects.length} projects`}
        />
        <StatCard
          value={formatCurrency(scheduledValue, "M")}
          label="Scheduled"
          sub="With install dates"
          variant="accent"
        />
        <StatCard
          value={formatCurrency(rtbValue, "M")}
          label="Ready to Build"
          sub={`${projects.filter((p) => p.is_rtb).length} projects`}
          borderColor="#10b981"
        />
        <StatCard
          value={formatCurrency(peValue, "M")}
          label="Participate Energy"
          sub={`${projects.filter((p) => p.is_participate_energy).length} projects`}
          variant="pe"
        />
      </div>

      {/* Revenue by Stage */}
      <div className="bg-[#12121a] border border-zinc-800 rounded-xl p-5 mt-6">
        <h3 className="text-base font-semibold mb-4 text-orange-500">
          Revenue by Deal Stage
        </h3>
        <div>
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr] py-3 border-b border-zinc-800 font-semibold text-[0.7rem] text-zinc-500 uppercase tracking-wider">
            <div>Stage</div>
            <div className="text-right">Projects</div>
            <div className="text-right">Value</div>
            <div>Distribution</div>
          </div>
          {stageData.sorted.map((stage) => {
            const data = stageData.data[stage];
            const pct = stageData.maxVal > 0 ? (data.value / stageData.maxVal) * 100 : 0;
            const color = STAGE_COLORS[stage] || "#f97316";
            return (
              <div
                key={stage}
                className="grid grid-cols-[2fr_1fr_1fr_1fr] py-3 border-b border-zinc-800 items-center text-sm"
              >
                <div className="font-medium">{stage}</div>
                <div className="text-right text-zinc-500 text-sm">{data.count}</div>
                <div className="text-right font-mono font-semibold text-orange-500">
                  {formatCurrency(data.value)}
                </div>
                <div>
                  <div className="h-2 bg-[#0a0a0f] rounded overflow-hidden">
                    <div
                      className="h-full rounded transition-all"
                      style={{ width: `${pct}%`, background: color }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr] py-3 font-bold bg-[#0a0a0f] rounded-lg mt-2 px-3">
            <div>Total</div>
            <div className="text-right">{projects.length}</div>
            <div className="text-right font-mono text-orange-500">
              {formatCurrency(totalValue, "M")}
            </div>
            <div />
          </div>
        </div>
      </div>

      {/* Backlog Forecasted Revenue */}
      <div className="bg-[#12121a] border border-emerald-500 rounded-xl p-5 mt-6">
        <h3 className="text-base font-semibold mb-1 text-emerald-500">
          Backlog Forecasted Revenue
        </h3>
        <p className="text-xs text-zinc-500 mb-4">
          Revenue from RTB, RTB-Blocked, and pre-construction stages based on forecasted install dates
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-[#0a0a0f] p-4 rounded-lg text-center">
            <div className="text-2xl font-bold font-mono text-emerald-500">
              {formatCurrency(backlogData.totalBacklogValue, "M")}
            </div>
            <div className="text-[0.7rem] text-zinc-500">Total Backlog Value</div>
          </div>
          <div className="bg-[#0a0a0f] p-4 rounded-lg text-center">
            <div className="text-2xl font-bold font-mono">
              {backlogData.totalBacklogCount}
            </div>
            <div className="text-[0.7rem] text-zinc-500">Backlog Projects</div>
          </div>
          <div className="bg-[#0a0a0f] p-4 rounded-lg text-center">
            <div className="text-2xl font-bold font-mono text-red-500">
              {formatCurrency(backlogData.overdueValue, "M")}
            </div>
            <div className="text-[0.7rem] text-zinc-500">Overdue (Past Forecast)</div>
          </div>
        </div>

        <div className="text-sm">
          <div className="grid grid-cols-[1.2fr_1fr_1fr_80px] py-3 border-b border-zinc-800 font-semibold text-[0.7rem] text-zinc-500">
            <div>Forecasted Month</div>
            <div className="text-right">Projects</div>
            <div className="text-right">Revenue</div>
            <div>Breakdown</div>
          </div>
          {backlogData.sortedPeriods.map((period) => {
            const isOverdue = period.key === "overdue";
            const stageBreakdown = Object.entries(period.byStage)
              .sort((a, b) => b[1] - a[1])
              .map(([stage, val]) => `${stage}: ${formatCurrency(val)}`)
              .join(" | ");
            const locationBreakdown = Object.entries(period.byLocation)
              .sort((a, b) => b[1] - a[1])
              .map(([loc, val]) => `${loc}: ${formatCurrency(val)}`)
              .join(", ");

            return (
              <div
                key={period.key}
                className={`grid grid-cols-[1.2fr_1fr_1fr_80px] py-3 border-b border-zinc-800 items-center text-sm ${
                  isOverdue ? "bg-red-500/10" : ""
                }`}
              >
                <div className={`font-medium ${isOverdue ? "text-red-500" : ""}`}>
                  {period.label}
                </div>
                <div className="text-right text-zinc-500">{period.count}</div>
                <div
                  className={`text-right font-mono font-semibold ${
                    isOverdue ? "text-red-500" : "text-emerald-500"
                  }`}
                >
                  {formatCurrency(period.value)}
                </div>
                <div>
                  <button
                    className="text-[0.6rem] px-1.5 py-0.5 rounded border border-zinc-800 text-zinc-300 hover:border-orange-500 hover:text-orange-500"
                    onClick={() =>
                      setExpandedBacklog((prev) => ({
                        ...prev,
                        [period.key]: !prev[period.key],
                      }))
                    }
                  >
                    {expandedBacklog[period.key] ? "-" : "+"}
                  </button>
                  {expandedBacklog[period.key] && (
                    <div className="text-[0.7rem] text-zinc-500 mt-1">
                      <div className="mb-1">
                        <strong>By Stage:</strong> {stageBreakdown || "N/A"}
                      </div>
                      <div>
                        <strong>By Location:</strong> {locationBreakdown || "N/A"}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Location Revenue + Timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        {/* By Location */}
        <div className="bg-[#12121a] border border-zinc-800 rounded-xl p-5">
          <h3 className="text-base font-semibold mb-4 text-orange-500">
            Scheduled Revenue by Location
          </h3>
          <div className="text-sm">
            <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr] py-2 font-semibold text-[0.7rem] text-zinc-500 uppercase border-b border-zinc-800">
              <div>Location</div>
              <div className="text-right">Projects</div>
              <div className="text-right">Total</div>
              <div className="text-right">RTB</div>
              <div className="text-right">Scheduled</div>
            </div>
            {locationData.sorted.map((loc) => {
              const data = locationData.data[loc];
              return (
                <div
                  key={loc}
                  className="grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr] py-2.5 border-b border-zinc-800 text-sm"
                >
                  <div className="font-medium">{loc}</div>
                  <div className="text-right text-zinc-500">{data.count}</div>
                  <div className="text-right font-mono font-semibold text-orange-500">
                    {formatCurrency(data.value)}
                  </div>
                  <div className="text-right font-mono font-semibold text-emerald-500">
                    {formatCurrency(data.rtbValue)}
                  </div>
                  <div className="text-right font-mono font-semibold text-blue-500">
                    {formatCurrency(data.scheduledValue)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Timeline */}
        <div className="bg-[#12121a] border border-zinc-800 rounded-xl p-5">
          <h3 className="text-base font-semibold mb-4 text-orange-500">
            Scheduled Revenue Timeline
          </h3>
          <div className="flex gap-2 mb-4">
            <FilterBtn
              active={revenueViewMode === "weekly"}
              onClick={() => setRevenueViewMode("weekly")}
            >
              Weekly
            </FilterBtn>
            <FilterBtn
              active={revenueViewMode === "monthly"}
              onClick={() => setRevenueViewMode("monthly")}
            >
              Monthly
            </FilterBtn>
          </div>
          <div className="text-sm max-h-[400px] overflow-y-auto">
            <div className="grid grid-cols-[1.2fr_1fr_1fr_80px] py-3 font-semibold text-[0.7rem] text-zinc-500 border-b border-zinc-800">
              <div>Period</div>
              <div className="text-right">Projects</div>
              <div className="text-right">Revenue</div>
              <div>Details</div>
            </div>
            {timelineData.map((period, idx) => {
              const locationBreakdown = Object.entries(period.byLocation)
                .filter(([, d]) => d.count > 0)
                .map(([loc, d]) => `${loc}: ${formatCurrency(d.value)} (${d.count})`)
                .join(", ");

              return (
                <div
                  key={idx}
                  className="grid grid-cols-[1.2fr_1fr_1fr_80px] py-3 border-b border-zinc-800 items-center text-sm"
                >
                  <div className="font-medium">{period.label}</div>
                  <div className="text-right text-zinc-500">{period.count}</div>
                  <div className="text-right font-mono font-semibold text-orange-500">
                    {formatCurrency(period.total)}
                  </div>
                  <div>
                    <button
                      className="text-[0.6rem] px-1.5 py-0.5 rounded border border-zinc-800 text-zinc-300 hover:border-orange-500 hover:text-orange-500"
                      onClick={() =>
                        setExpandedTimeline((prev) => ({
                          ...prev,
                          [idx]: !prev[idx],
                        }))
                      }
                    >
                      {expandedTimeline[idx] ? "-" : "+"}
                    </button>
                    {expandedTimeline[idx] && (
                      <div className="text-[0.7rem] text-zinc-500 mt-1">
                        {locationBreakdown || "No scheduled installs"}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <div className="grid grid-cols-[1.2fr_1fr_1fr_80px] py-3 font-bold bg-[#0a0a0f] rounded-lg mt-2 px-3">
              <div>Total</div>
              <div className="text-right">
                {timelineData.reduce((s, p) => s + p.count, 0)}
              </div>
              <div className="text-right font-mono text-orange-500">
                {formatCurrency(
                  timelineData.reduce((s, p) => s + p.total, 0),
                  "M"
                )}
              </div>
              <div />
            </div>
          </div>
        </div>
      </div>

      {/* ---- Milestone Revenue Tables ---- */}
      <MilestoneRevenueSection projects={projects} revenueViewMode={revenueViewMode} setRevenueViewMode={setRevenueViewMode} />
    </div>
  );
}

// ============================================================
// Milestone Revenue Section (replicates PE pattern for all deals)
// ============================================================

const DEAL_MILESTONES: MilestoneConfig[] = [
  {
    title: "Design Approvals",
    dateField: "design_approval",
    forecastField: "design_approval",
    borderColor: "border-l-purple-500",
    barColor: "bg-purple-500",
    headerBg: "bg-purple-500/10",
  },
  {
    title: "Construction Completes",
    dateField: "construction_complete",
    forecastField: "forecast_install",
    borderColor: "border-l-blue-500",
    barColor: "bg-blue-500",
    headerBg: "bg-blue-500/10",
  },
  {
    title: "Inspections Passed",
    dateField: "inspection_pass",
    forecastField: "forecast_inspection",
    borderColor: "border-l-emerald-500",
    barColor: "bg-emerald-500",
    headerBg: "bg-emerald-500/10",
  },
  {
    title: "PTO Granted",
    dateField: "pto_granted",
    forecastField: "forecast_pto",
    borderColor: "border-l-amber-500",
    barColor: "bg-amber-500",
    headerBg: "bg-amber-500/10",
  },
];

function MilestoneRevenueSection({
  projects,
  revenueViewMode,
  setRevenueViewMode,
}: {
  projects: Project[];
  revenueViewMode: "weekly" | "monthly";
  setRevenueViewMode: (mode: "weekly" | "monthly") => void;
}) {
  const periods = useMemo(
    () => (revenueViewMode === "monthly" ? generateMonthlyPeriods() : generateWeeklyPeriods()),
    [revenueViewMode]
  );

  // Pipeline Strength
  const pipelineStrength = useMemo(() => {
    const rtb = projects.filter((p) => p.is_rtb);
    const designApproved = projects.filter(
      (p) => p.design_approval && !p.construction_complete
    );
    const scheduledConstruction = projects.filter(
      (p) => p.forecast_install && !p.construction_complete
    );
    const pendingInspection = projects.filter(
      (p) => p.construction_complete && !p.inspection_pass
    );
    const awaitingPto = projects.filter(
      (p) => p.inspection_pass && !p.pto_granted
    );
    return [
      { label: "RTB Projects", count: rtb.length, value: rtb.reduce((s, p) => s + p.amount, 0), color: "emerald" },
      { label: "Design Approved", count: designApproved.length, value: designApproved.reduce((s, p) => s + p.amount, 0), color: "purple" },
      { label: "Scheduled Construction", count: scheduledConstruction.length, value: scheduledConstruction.reduce((s, p) => s + p.amount, 0), color: "blue" },
      { label: "Pending Inspection", count: pendingInspection.length, value: pendingInspection.reduce((s, p) => s + p.amount, 0), color: "violet" },
      { label: "Awaiting PTO", count: awaitingPto.length, value: awaitingPto.reduce((s, p) => s + p.amount, 0), color: "amber" },
    ];
  }, [projects]);

  // Milestone data for each config
  const milestoneData = useMemo(() => {
    return DEAL_MILESTONES.map((config) => {
      const periodData = periods.map((period) => {
        const matching = projects.filter((p) => {
          const dateStr =
            (p[config.dateField as keyof Project] as string | null) ||
            (config.dateField !== config.forecastField
              ? (p[config.forecastField as keyof Project] as string | null)
              : null);
          if (!dateStr) return false;
          const d = new Date(dateStr);
          return d >= period.start && d <= period.end;
        });
        return {
          count: matching.length,
          revenue: matching.reduce((s, p) => s + p.amount, 0),
        };
      });
      const maxRevenue = Math.max(...periodData.map((d) => d.revenue), 1);
      return { config, periodData, maxRevenue };
    });
  }, [projects, periods]);

  const colorMap: Record<string, string> = {
    emerald: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    purple: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    blue: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    violet: "bg-violet-500/20 text-violet-400 border-violet-500/30",
    amber: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  };

  return (
    <div className="space-y-6 mt-6">
      {/* Header with toggle */}
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold">Milestone Revenue Breakdown</h3>
        <div className="flex gap-1 bg-zinc-800 rounded-lg p-0.5">
          <button
            onClick={() => setRevenueViewMode("weekly")}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${
              revenueViewMode === "weekly"
                ? "bg-orange-500 text-white"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Weekly
          </button>
          <button
            onClick={() => setRevenueViewMode("monthly")}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${
              revenueViewMode === "monthly"
                ? "bg-orange-500 text-white"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Monthly
          </button>
        </div>
      </div>

      {/* Pipeline Strength Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {pipelineStrength.map((item) => (
          <div
            key={item.label}
            className={`rounded-lg border p-3 ${colorMap[item.color] || "bg-zinc-800 border-zinc-700"}`}
          >
            <div className="text-[0.65rem] font-medium opacity-80">{item.label}</div>
            <div className="text-xl font-bold mt-1">{item.count}</div>
            <div className="text-[0.7rem] font-mono mt-0.5">{formatRevenueShort(item.value)}</div>
          </div>
        ))}
      </div>

      {/* Milestone Tables */}
      {milestoneData.map(({ config, periodData, maxRevenue }) => (
        <div
          key={config.title}
          className={`bg-[#12121a] rounded-lg border border-zinc-800 ${config.borderColor} border-l-4 overflow-hidden`}
        >
          {/* Table Header */}
          <div className={`${config.headerBg} px-4 py-2.5 flex items-center justify-between`}>
            <span className="text-sm font-bold">{config.title}</span>
            <span className="text-xs text-zinc-400">
              {periodData.reduce((s, d) => s + d.count, 0)} total &middot;{" "}
              {formatRevenueShort(periodData.reduce((s, d) => s + d.revenue, 0))}
            </span>
          </div>

          {/* Period Grid */}
          <div className="overflow-x-auto">
            <div className="min-w-[600px]">
              {/* Period labels */}
              <div className="grid gap-px px-4 py-2 border-b border-zinc-800" style={{ gridTemplateColumns: `repeat(${periods.length}, 1fr)` }}>
                {periods.map((p, i) => (
                  <div
                    key={i}
                    className={`text-[0.6rem] text-center ${
                      p.isCurrent ? "text-orange-400 font-bold" : p.isPast ? "text-zinc-600" : "text-zinc-400"
                    }`}
                  >
                    {p.label}
                  </div>
                ))}
              </div>

              {/* Count row */}
              <div className="grid gap-px px-4 py-1.5" style={{ gridTemplateColumns: `repeat(${periods.length}, 1fr)` }}>
                {periodData.map((d, i) => (
                  <div
                    key={i}
                    className={`text-center text-sm font-bold ${
                      periods[i].isCurrent ? "text-orange-400" : periods[i].isPast ? "text-zinc-600" : "text-zinc-200"
                    }`}
                  >
                    {d.count || "—"}
                  </div>
                ))}
              </div>

              {/* Revenue row */}
              <div className="grid gap-px px-4 py-1" style={{ gridTemplateColumns: `repeat(${periods.length}, 1fr)` }}>
                {periodData.map((d, i) => (
                  <div
                    key={i}
                    className={`text-center text-[0.6rem] font-mono ${
                      periods[i].isPast ? "text-zinc-600" : "text-zinc-400"
                    }`}
                  >
                    {d.revenue > 0 ? formatRevenueShort(d.revenue) : "—"}
                  </div>
                ))}
              </div>

              {/* Bar chart row */}
              <div className="grid gap-px px-4 py-2 pb-3" style={{ gridTemplateColumns: `repeat(${periods.length}, 1fr)` }}>
                {periodData.map((d, i) => (
                  <div key={i} className="flex justify-center">
                    <div className="w-full max-w-[40px] h-6 bg-zinc-800 rounded-sm overflow-hidden relative">
                      <div
                        className={`absolute bottom-0 w-full rounded-sm transition-all ${config.barColor} ${
                          periods[i].isPast ? "opacity-40" : ""
                        }`}
                        style={{ height: `${maxRevenue > 0 ? (d.revenue / maxRevenue) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Capacity View
// ============================================================

function CapacityView({
  capacityAnalysis,
}: {
  capacityAnalysis: Record<string, CapacityAnalysis>;
}) {
  const [optStats, setOptStats] = useState<{
    totalGap: number;
    overCapacity: number;
    underCapacity: number;
    locationCount: number;
  } | null>(null);

  const runOptimization = () => {
    let totalGap = 0;
    let overCapacity = 0;
    let underCapacity = 0;
    Object.values(capacityAnalysis).forEach((cap) => {
      Object.values(cap.monthly_forecast).forEach((m) => {
        const gap = m.days_needed - cap.monthly_capacity;
        if (gap > 0) {
          totalGap += gap;
          overCapacity++;
        } else {
          underCapacity++;
        }
      });
    });
    setOptStats({
      totalGap,
      overCapacity,
      underCapacity,
      locationCount: Object.keys(capacityAnalysis).length,
    });
  };

  return (
    <div>
      {/* Optimizer Panel */}
      <div className="bg-gradient-to-br from-[#12121a] to-[#1a1a28] border border-orange-500 rounded-xl p-5 mb-6">
        <div className="text-base font-semibold text-orange-500 mb-3">
          AI Capacity Optimizer
        </div>
        <p className="text-xs text-zinc-500 mb-4">
          Analyze forecasted installs vs. available crew capacity across all locations
        </p>
        <button
          onClick={runOptimization}
          className="px-6 py-3 bg-gradient-to-br from-orange-500 to-orange-400 border-none text-black font-bold rounded-lg cursor-pointer text-sm transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_20px_rgba(249,115,22,0.4)]"
        >
          Analyze Capacity Gaps
        </button>
        {optStats && (
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold font-mono text-red-500">
                {optStats.totalGap}
              </div>
              <div className="text-[0.65rem] text-zinc-500">Days Over Capacity</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold font-mono text-yellow-500">
                {optStats.overCapacity}
              </div>
              <div className="text-[0.65rem] text-zinc-500">Months Overloaded</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold font-mono text-emerald-500">
                {optStats.underCapacity}
              </div>
              <div className="text-[0.65rem] text-zinc-500">Months OK</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold font-mono">
                {optStats.locationCount}
              </div>
              <div className="text-[0.65rem] text-zinc-500">Locations</div>
            </div>
          </div>
        )}
      </div>

      {/* Capacity Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {Object.entries(capacityAnalysis).map(([location, cap]) => {
          const monthKeys = Object.keys(cap.monthly_forecast).sort().slice(0, 6);
          const maxDays = Math.max(
            cap.monthly_capacity,
            ...monthKeys.map((k) => cap.monthly_forecast[k]?.days_needed || 0)
          );

          return (
            <div
              key={location}
              className="bg-[#12121a] border border-zinc-800 rounded-xl p-5"
            >
              <div className="flex justify-between items-center mb-4">
                <div className="text-base font-semibold">{location}</div>
                <div className="text-[0.7rem] text-zinc-500">
                  {cap.crews.length} crew(s) - {cap.monthly_capacity} days/mo
                </div>
              </div>

              {/* CSS Bar Chart */}
              <div className="h-48 mb-4 flex items-end gap-1.5">
                {monthKeys.length > 0 ? (
                  monthKeys.map((k) => {
                    const forecast = cap.monthly_forecast[k]?.days_needed || 0;
                    const forecastPct = maxDays > 0 ? (forecast / maxDays) * 100 : 0;
                    const capacityPct =
                      maxDays > 0 ? (cap.monthly_capacity / maxDays) * 100 : 0;
                    const isOver = forecast > cap.monthly_capacity;
                    return (
                      <div
                        key={k}
                        className="flex-1 flex flex-col items-center justify-end h-full relative"
                      >
                        {/* Capacity line */}
                        <div
                          className="absolute left-0 right-0 border-t-2 border-dashed border-emerald-500/60"
                          style={{ bottom: `${capacityPct}%` }}
                        />
                        {/* Bar */}
                        <div
                          className={`w-full rounded-t transition-all ${
                            isOver ? "bg-red-500/70" : "bg-blue-500/70"
                          }`}
                          style={{ height: `${forecastPct}%`, minHeight: forecast > 0 ? "4px" : "0" }}
                          title={`${forecast} days forecasted`}
                        />
                        <div className="text-[0.6rem] text-zinc-500 mt-1">
                          {k.substring(5)}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="flex-1 flex items-center justify-center text-zinc-600 text-xs">
                    No forecast data
                  </div>
                )}
              </div>

              {/* Legend */}
              <div className="flex gap-4 justify-center mb-4 text-[0.6rem] text-zinc-500">
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-sm bg-blue-500/70" />
                  Forecasted
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-0.5 border-t-2 border-dashed border-emerald-500/60" style={{ width: 12 }} />
                  Capacity
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-2">
                <div className="text-center p-2 bg-[#0a0a0f] rounded-md">
                  <div className="text-xl font-bold font-mono">{cap.total_projects}</div>
                  <div className="text-[0.6rem] text-zinc-500">Projects</div>
                </div>
                <div className="text-center p-2 bg-[#0a0a0f] rounded-md">
                  <div className="text-xl font-bold font-mono text-emerald-500">
                    {cap.rtb_count}
                  </div>
                  <div className="text-[0.6rem] text-zinc-500">RTB</div>
                </div>
                <div className="text-center p-2 bg-[#0a0a0f] rounded-md">
                  <div className="text-xl font-bold font-mono text-emerald-500">
                    {cap.pe_count}
                  </div>
                  <div className="text-[0.6rem] text-zinc-500">PE Projects</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// PE View
// ============================================================

function PEView({ projects }: { projects: Project[] }) {
  const peProjects = useMemo(
    () => projects.filter((p) => p.is_participate_energy),
    [projects]
  );

  const overdueInsp = peProjects.filter(
    (p) => p.days_to_inspection !== null && p.days_to_inspection < 0 && !p.inspection_pass
  ).length;
  const overduePto = peProjects.filter(
    (p) => p.days_to_pto !== null && p.days_to_pto < 0 && !p.pto_granted
  ).length;
  const soonInsp = peProjects.filter(
    (p) =>
      !p.inspection_pass &&
      p.days_to_inspection !== null &&
      p.days_to_inspection >= 0 &&
      p.days_to_inspection <= 14
  ).length;
  const soonPto = peProjects.filter(
    (p) =>
      !p.pto_granted &&
      p.days_to_pto !== null &&
      p.days_to_pto >= 0 &&
      p.days_to_pto <= 30
  ).length;
  const totalValue = peProjects.reduce((s, p) => s + p.amount, 0);

  const inspProjects = peProjects
    .filter(
      (p) =>
        !p.inspection_pass &&
        p.days_to_inspection !== null &&
        p.days_to_inspection <= 30
    )
    .sort((a, b) => (a.days_to_inspection ?? 0) - (b.days_to_inspection ?? 0))
    .slice(0, 15);

  const ptoProjects = peProjects
    .filter(
      (p) =>
        !p.pto_granted &&
        p.days_to_pto !== null &&
        p.days_to_pto <= 45
    )
    .sort((a, b) => (a.days_to_pto ?? 0) - (b.days_to_pto ?? 0))
    .slice(0, 15);

  const exportPEReport = (format: "excel" | "csv" | "clipboard") => {
    if (format === "clipboard") {
      const headers = [
        "Project ID",
        "Name",
        "Location",
        "Forecast Install",
        "Forecast Inspection",
        "Forecast PTO",
        "Days to PTO",
      ];
      const rows = peProjects.map((p) =>
        [
          p.id,
          p.name,
          p.pb_location,
          p.forecast_install,
          p.forecast_inspection,
          p.forecast_pto,
          p.days_to_pto,
        ].join("\t")
      );
      navigator.clipboard.writeText(headers.join("\t") + "\n" + rows.join("\n"));
      alert(`Copied ${peProjects.length} PE projects to clipboard!`);
    } else {
      alert("Excel/CSV export: Use the dedicated PE dashboard for full export functionality");
    }
  };

  return (
    <div>
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
        <StatCard
          value={peProjects.length}
          label="PE Projects"
          sub={`${formatCurrency(totalValue, "M")} value`}
          variant="pe"
        />
        <StatCard value={overdueInsp} label="Inspection Overdue" variant="danger" />
        <StatCard
          value={soonInsp}
          label="Inspection in 14d"
          borderColor="#eab308"
        />
        <StatCard value={overduePto} label="PTO Overdue" variant="danger" />
        <StatCard
          value={soonPto}
          label="PTO in 30d"
          borderColor="#eab308"
        />
      </div>

      {/* Dashboard Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Inspection Milestones */}
        <div className="bg-[#12121a] border border-emerald-500 rounded-xl p-5">
          <div className="text-sm font-semibold text-emerald-500 mb-4 flex items-center gap-2">
            Inspection Complete (Milestone 1)
          </div>
          <div className="max-h-[300px] overflow-y-auto">
            {inspProjects.length > 0 ? (
              inspProjects.map((p) => (
                <div
                  key={p.id}
                  className="flex justify-between items-center p-2.5 bg-[#0a0a0f] rounded-md mb-1.5"
                >
                  <div>
                    <div className="font-semibold text-[0.8rem]">
                      {p.name.split("|")[1]?.trim() || p.name}
                    </div>
                    <div className="text-[0.65rem] text-zinc-500">
                      {p.pb_location} - {p.forecast_inspection || "No date"}
                    </div>
                  </div>
                  <div
                    className={`font-mono font-semibold text-[0.75rem] ${getDaysClass(p.days_to_inspection, null)}`}
                  >
                    {formatDays(p.days_to_inspection)}
                  </div>
                </div>
              ))
            ) : (
              <div className="text-zinc-500 text-xs">No upcoming inspections</div>
            )}
          </div>
        </div>

        {/* PTO Milestones */}
        <div className="bg-[#12121a] border border-emerald-500 rounded-xl p-5">
          <div className="text-sm font-semibold text-emerald-500 mb-4 flex items-center gap-2">
            Project Complete / PTO (Milestone 2)
          </div>
          <div className="max-h-[300px] overflow-y-auto">
            {ptoProjects.length > 0 ? (
              ptoProjects.map((p) => (
                <div
                  key={p.id}
                  className="flex justify-between items-center p-2.5 bg-[#0a0a0f] rounded-md mb-1.5"
                >
                  <div>
                    <div className="font-semibold text-[0.8rem]">
                      {p.name.split("|")[1]?.trim() || p.name}
                    </div>
                    <div className="text-[0.65rem] text-zinc-500">
                      {p.pb_location} - {p.forecast_pto || "No date"}
                    </div>
                  </div>
                  <div
                    className={`font-mono font-semibold text-[0.75rem] ${getDaysClass(p.days_to_pto, null, 30)}`}
                  >
                    {formatDays(p.days_to_pto)}
                  </div>
                </div>
              ))
            ) : (
              <div className="text-zinc-500 text-xs">No upcoming PTO</div>
            )}
          </div>
        </div>

        {/* Export */}
        <div className="bg-[#12121a] border border-emerald-500 rounded-xl p-5 lg:col-span-2">
          <div className="text-sm font-semibold text-emerald-500 mb-4 flex items-center gap-2">
            Export for Participate Energy
          </div>
          <p className="text-xs text-zinc-500 mb-4">
            Generate reports with forecasted and scheduled dates for PE submission
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <button
              onClick={() => exportPEReport("excel")}
              className="w-full py-3 bg-emerald-500 border-none text-white font-semibold rounded-lg cursor-pointer text-sm hover:bg-emerald-600 transition-colors"
            >
              Download Excel
            </button>
            <button
              onClick={() => exportPEReport("csv")}
              className="w-full py-3 bg-emerald-500 border-none text-white font-semibold rounded-lg cursor-pointer text-sm hover:bg-emerald-600 transition-colors"
            >
              Download CSV
            </button>
            <button
              onClick={() => exportPEReport("clipboard")}
              className="w-full py-3 bg-emerald-500 border-none text-white font-semibold rounded-lg cursor-pointer text-sm hover:bg-emerald-600 transition-colors"
            >
              Copy to Clipboard
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Alerts View
// ============================================================

function AlertsView({ alerts }: { alerts: Alert[] }) {
  const dangerCount = alerts.filter((a) => a.type === "danger").length;
  const warningCount = alerts.filter((a) => a.type === "warning").length;
  const peRelated = alerts.filter((a) => a.title.includes("PE")).length;

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard value={dangerCount} label="Critical Alerts" variant="danger" />
        <StatCard
          value={warningCount}
          label="Warnings"
          borderColor="#eab308"
        />
        <StatCard value={alerts.length} label="Total Alerts" />
        <StatCard value={peRelated} label="PE Related" variant="pe" />
      </div>

      <div className="grid gap-4 mt-4">
        {alerts.slice(0, 20).map((a, i) => (
          <div
            key={i}
            className={`bg-[#12121a] border rounded-lg p-4 ${
              a.type === "danger" ? "border-red-500" : "border-yellow-500"
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <span
                className={`text-xl ${
                  a.type === "danger" ? "text-red-500" : "text-yellow-500"
                }`}
              >
                {a.type === "danger" ? "X" : "!"}
              </span>
              <span className="font-semibold">{a.title}</span>
            </div>
            <div className="text-sm text-zinc-500">{a.message}</div>
            {a.project && (
              <a
                href={a.project.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[0.7rem] text-blue-500 hover:underline mt-2 inline-block"
              >
                View in HubSpot
              </a>
            )}
          </div>
        ))}
        {alerts.length === 0 && (
          <div className="text-center text-zinc-500 text-sm py-8">
            No alerts at this time.
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Main Page Component
// ============================================================

export default function CommandCenterPage() {
  const router = useRouter();
  /* ---- activity tracking ---- */
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  /* ---- Executive access guard (ADMIN / EXECUTIVE only) ---- */
  const [accessChecked, setAccessChecked] = useState(false);
  useEffect(() => {
    fetch("/api/auth/sync")
      .then(r => r.json())
      .then(data => {
        const role = data.role || "TECH_OPS";
        setAccessChecked(true);
        if (role !== "ADMIN" && role !== "OWNER") {
          router.push("/");
        }
      })
      .catch(() => {
        setAccessChecked(true);
        router.push("/");
      });
  }, [router]);

  const [currentView, setCurrentView] = useState<ViewType>("pipeline");
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>("");

  const capacityAnalysis = useMemo(
    () => calculateCapacityAnalysis(projects),
    [projects]
  );

  const alerts = useMemo(
    () => calculateAlerts(projects, capacityAnalysis),
    [projects, capacityAnalysis]
  );

  const summary = useMemo(() => {
    return {
      total_projects: projects.length,
      total_value: projects.reduce((s, p) => s + p.amount, 0),
      pe_projects: projects.filter((p) => p.is_participate_energy).length,
    };
  }, [projects]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/projects?context=executive");
      if (!response.ok) throw new Error("Failed to fetch data");
      const data = await response.json();
      const transformed = data.projects.map(transformProject);
      setProjects(transformed);
      setLastUpdated(new Date().toLocaleString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchData]);

  /* ---- Track dashboard view on load ---- */
  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("command-center", {
        projectCount: projects.length,
      });
    }
  }, [loading, projects.length, trackDashboardView]);

  const tabs: { key: ViewType; label: string; badge?: number; badgeStyle?: string; href?: string }[] = [
    { key: "pipeline", label: "Pipeline Overview" },
    { key: "revenue", label: "Revenue" },
    { key: "capacity", label: "Capacity Planning" },
    { key: "pe", label: "Participate Energy", badge: summary.pe_projects, badgeStyle: "bg-emerald-500" },
    {
      key: "alerts",
      label: "Alerts",
      badge: alerts.filter((a) => a.type === "danger").length,
      badgeStyle: "bg-red-500",
    },
    { key: "executive", label: "Executive Summary", href: "/dashboards/executive" },
    { key: "at-risk", label: "At-Risk Projects", href: "/dashboards/at-risk" },
    { key: "optimizer", label: "Pipeline Optimizer", href: "/dashboards/optimizer" },
    { key: "locations", label: "Location Comparison", href: "/dashboards/locations" },
  ];

  // Wait for access check before rendering
  if (!accessChecked) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="text-zinc-400 text-lg">Checking access...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-zinc-200 dashboard-bg">
      {/* Navigation */}
      <nav className="bg-gradient-to-br from-[#12121a] to-[#1a1a28] border-b border-[#1e1e2e] sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex justify-between items-center gap-4">
            <div className="flex items-center gap-3 sm:gap-4 min-w-0">
              <Link
                href="/"
                className="text-zinc-500 hover:text-zinc-300 transition-colors text-sm shrink-0"
              >
                &larr; Back
              </Link>
              <div className="min-w-0">
                <div className="text-lg sm:text-xl font-bold bg-gradient-to-br from-amber-500 to-orange-400 bg-clip-text text-transparent">
                  Executive Suite
                </div>
                <div className="text-[0.65rem] text-zinc-500 truncate">
                  Pipeline, Revenue &amp; Executive Dashboards - Live Data
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <ThemeToggle />
              <div className="text-right text-[0.7rem] text-zinc-500 shrink-0 hidden sm:block">
                <div>{lastUpdated && `Updated: ${lastUpdated}`}</div>
                <div>
                  {summary.total_value > 0 &&
                    `Pipeline: ${formatCurrency(summary.total_value, "M")}`}
                </div>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-4 overflow-x-auto pb-px -mb-px">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => {
                  if (tab.href) {
                    router.push(tab.href);
                  } else {
                    setCurrentView(tab.key);
                  }
                }}
                className={`px-4 sm:px-5 py-2 sm:py-2.5 text-[0.75rem] sm:text-[0.8rem] font-semibold rounded-t-lg cursor-pointer border border-b-0 transition-all whitespace-nowrap ${
                  currentView === tab.key
                    ? "bg-[#12121a] text-orange-500 border-orange-500"
                    : tab.href
                      ? "bg-[#0a0a0f] text-zinc-600 border-[#1e1e2e] hover:text-zinc-400 italic"
                      : "bg-[#0a0a0f] text-zinc-500 border-[#1e1e2e] hover:text-zinc-300"
                }`}
              >
                {tab.label}
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span
                    className={`${tab.badgeStyle} text-white text-[0.6rem] px-1.5 py-0.5 rounded-full ml-1.5 font-semibold`}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
            <Link
              href="/dashboards/scheduler"
              className="px-4 sm:px-5 py-2 sm:py-2.5 text-[0.75rem] sm:text-[0.8rem] font-semibold rounded-t-lg cursor-pointer border border-b-0 bg-[#0a0a0f] text-zinc-500 border-[#1e1e2e] hover:text-zinc-300 transition-all no-underline whitespace-nowrap"
              onMouseEnter={() => prefetchDashboard("scheduler")}
            >
              Scheduler &rarr;
            </Link>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {loading && projects.length === 0 ? (
          <div className="bg-[#12121a] border border-zinc-800 rounded-xl p-8 text-center">
            <div className="text-lg text-zinc-500">Loading live data from HubSpot...</div>
          </div>
        ) : error && projects.length === 0 ? (
          <div className="bg-[#12121a] border border-red-500 rounded-xl p-8 text-center">
            <div className="text-lg">Error loading data</div>
            <div className="text-sm text-zinc-500 mt-2">{error}</div>
            <button
              onClick={fetchData}
              className="mt-4 px-4 py-2 bg-orange-500 border-none rounded-md cursor-pointer text-black font-semibold"
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            {currentView === "pipeline" && <PipelineView projects={projects} />}
            {currentView === "revenue" && <RevenueView projects={projects} />}
            {currentView === "capacity" && (
              <CapacityView capacityAnalysis={capacityAnalysis} />
            )}
            {currentView === "pe" && <PEView projects={projects} />}
            {currentView === "alerts" && <AlertsView alerts={alerts} />}
          </>
        )}
      </main>
    </div>
  );
}
