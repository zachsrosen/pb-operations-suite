"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import DashboardShell from "@/components/DashboardShell";
import { useExecutiveData } from "@/hooks/useExecutiveData";
import { prefetchDashboard } from "@/lib/prefetch";
import {
  type ExecProject,
  formatDays,
  formatCurrencyExec,
  getDaysClass,
} from "@/lib/executive-shared";

// ---- Sub-components ----

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
    default: "border-t-border bg-surface",
  };
  const cls = variantClasses[variant || "default"];
  const style = borderColor && !variant ? { borderColor } : undefined;

  return (
    <div className={`rounded-xl border p-4 ${cls}`} style={style}>
      <div className="text-3xl font-bold font-mono">{value}</div>
      <div className="text-[0.7rem] text-muted mt-1">{label}</div>
      {sub && <div className="text-[0.65rem] text-muted mt-0.5">{sub}</div>}
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
            : "bg-background border-t-border text-foreground/80 hover:border-orange-500 hover:text-orange-500"
        }`}
    >
      {children}
    </button>
  );
}

// ---- Filters type ----

interface Filters {
  location: string;
  pe: string;
  status: string;
  search: string;
}

// ---- Main component ----

export default function PipelinePage() {
  const { projects, loading, error, lastUpdated, fetchData, accessChecked } =
    useExecutiveData("pipeline");

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

  if (!accessChecked) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted text-lg">Checking access...</div>
      </div>
    );
  }

  return (
    <DashboardShell
      title="Pipeline Overview"
      subtitle={`${projects.length} active projects`}
      accentColor="orange"
      lastUpdated={lastUpdated}
      fullWidth
    >
      {loading && projects.length === 0 ? (
        <div className="bg-surface border border-t-border rounded-xl p-8 text-center">
          <div className="text-lg text-muted">Loading pipeline data...</div>
        </div>
      ) : error && projects.length === 0 ? (
        <div className="bg-surface border border-red-500 rounded-xl p-8 text-center">
          <div className="text-lg">Error loading data</div>
          <div className="text-sm text-muted mt-2">{error}</div>
          <button
            onClick={fetchData}
            className="mt-4 px-4 py-2 bg-orange-500 border-none rounded-md cursor-pointer text-black font-semibold"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
            <StatCard
              value={projects.length}
              label="Total Projects"
              sub={`${formatCurrencyExec(totalValue, "M")} pipeline`}
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
          <div className="flex flex-wrap gap-4 items-center bg-surface border border-t-border rounded-xl p-4 mb-6">
            <div className="flex items-center gap-2">
              <span className="text-[0.7rem] text-muted">Location:</span>
              <select
                className="bg-background border border-t-border text-foreground/80 px-3 py-2 rounded-md text-xs focus:outline-none focus:border-orange-500"
                value={filters.location}
                onChange={(e) => updateFilter("location", e.target.value)}
              >
                <option value="all">All Locations</option>
                {locations.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[0.7rem] text-muted">Type:</span>
              <FilterBtn active={filters.pe === "all"} onClick={() => updateFilter("pe", "all")}>All</FilterBtn>
              <FilterBtn active={filters.pe === "pe"} onClick={() => updateFilter("pe", "pe")} peStyle>PE Only</FilterBtn>
              <FilterBtn active={filters.pe === "non-pe"} onClick={() => updateFilter("pe", "non-pe")}>Non-PE</FilterBtn>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[0.7rem] text-muted">Status:</span>
              <FilterBtn active={filters.status === "all"} onClick={() => updateFilter("status", "all")}>All</FilterBtn>
              <FilterBtn active={filters.status === "overdue"} onClick={() => updateFilter("status", "overdue")}>Overdue</FilterBtn>
              <FilterBtn active={filters.status === "rtb"} onClick={() => updateFilter("status", "rtb")}>RTB</FilterBtn>
            </div>
            <div className="flex-1">
              <input
                type="text"
                placeholder="Search projects..."
                className="bg-background border border-t-border text-foreground/80 px-3 py-2 rounded-md text-xs w-52 focus:outline-none focus:border-orange-500"
                value={filters.search}
                onChange={(e) => updateFilter("search", e.target.value)}
              />
            </div>
          </div>

          {/* Table */}
          <div className="bg-surface border border-t-border rounded-xl overflow-hidden">
            <div className="hidden lg:grid grid-cols-[50px_2fr_1fr_100px_100px_100px_100px_80px_120px] gap-2 px-4 py-3 bg-background border-b border-t-border text-[0.7rem] font-semibold text-muted">
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
                    className={`grid grid-cols-1 lg:grid-cols-[50px_2fr_1fr_100px_100px_100px_100px_80px_120px] gap-2 px-4 py-3 border-b border-t-border text-[0.75rem] items-center transition-colors hover:bg-surface-elevated ${
                      p.is_participate_energy ? "border-l-[3px] border-l-emerald-500" : ""
                    } ${isOverdue ? "bg-red-500/5" : ""}`}
                  >
                    <div className="text-muted">{i + 1}</div>
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {p.is_participate_energy && (
                          <span className="text-[0.6rem] px-2 py-0.5 rounded-full font-semibold bg-emerald-500/15 text-emerald-500 border border-emerald-500">PE</span>
                        )}
                        {p.is_rtb && (
                          <span className="text-[0.6rem] px-2 py-0.5 rounded-full font-semibold bg-emerald-500/20 text-emerald-500">RTB</span>
                        )}
                        <a href={p.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-500 hover:underline">
                          {p.name.split("|")[0].trim()}
                        </a>
                      </div>
                      <div className="text-[0.65rem] text-muted">{p.stage}</div>
                    </div>
                    <div>
                      <div>{p.pb_location}</div>
                      <div className="text-[0.65rem] text-muted">{p.ahj || "-"}</div>
                    </div>
                    <div className="font-mono font-semibold text-orange-500">{formatCurrencyExec(p.amount)}</div>
                    <div className={`font-mono font-semibold text-[0.75rem] ${getDaysClass(p.days_to_install, p.construction_complete)}`}>
                      {formatDays(p.days_to_install, p.construction_complete)}
                    </div>
                    <div className={`font-mono font-semibold text-[0.75rem] ${getDaysClass(p.days_to_inspection, p.inspection_pass)}`}>
                      {formatDays(p.days_to_inspection, p.inspection_pass)}
                    </div>
                    <div className={`font-mono font-semibold text-[0.75rem] ${getDaysClass(p.days_to_pto, p.pto_granted, 30)}`}>
                      {formatDays(p.days_to_pto, p.pto_granted)}
                    </div>
                    <div>
                      <div className="w-full h-1.5 bg-surface-2 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${priorityPct}%`, background: priorityColor }} />
                      </div>
                      <div className="text-[0.6rem] text-muted mt-0.5">{p.priority_score.toFixed(0)}</div>
                    </div>
                    <div>
                      {p.is_schedulable && (
                        <Link
                          href="/dashboards/scheduler"
                          className="text-[0.65rem] px-2 py-1 rounded-md border border-t-border text-foreground/80 hover:border-orange-500 hover:text-orange-500 transition-all"
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
                <div className="p-8 text-center text-muted text-sm">No projects match the current filters.</div>
              )}
            </div>
          </div>
        </>
      )}
    </DashboardShell>
  );
}
