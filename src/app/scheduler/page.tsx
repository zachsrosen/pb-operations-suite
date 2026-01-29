"use client";

import { useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { useProjects } from "@/hooks/useProjects";
import { Header } from "@/components/ui";
import { CREWS_BY_LOCATION, LOCATIONS, type LocationKey, getStageColorClass } from "@/lib/config";
import { type Project } from "@/lib/hubspot";

type ViewMode = "month" | "week" | "gantt";
type StageFilter = "all" | "rtb" | "blocked" | "construction" | "survey" | "inspection";

export default function SchedulerPage() {
  const { projects, loading, error, lastUpdated, refresh } = useProjects({
    context: "scheduling",
    includeStats: false,
  });

  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [selectedLocation, setSelectedLocation] = useState<string>("all");
  const [stageFilter, setStageFilter] = useState<StageFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [currentDate, setCurrentDate] = useState(new Date());

  // Filter projects for the queue
  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      if (selectedLocation !== "all" && p.pbLocation !== selectedLocation) return false;
      if (stageFilter !== "all") {
        const stageMap: Record<StageFilter, string[]> = {
          all: [],
          rtb: ["Ready To Build"],
          blocked: ["RTB - Blocked"],
          construction: ["Construction"],
          survey: ["Site Survey"],
          inspection: ["Inspection"],
        };
        if (!stageMap[stageFilter].includes(p.stage)) return false;
      }
      if (searchQuery && !p.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    });
  }, [projects, selectedLocation, stageFilter, searchQuery]);

  // Get scheduled projects for calendar
  const scheduledProjects = useMemo(() => {
    return projects.filter((p) => p.constructionScheduleDate || p.forecastedInstallDate);
  }, [projects]);

  // Stats by location
  const locationStats = useMemo(() => {
    const stats: Record<string, { count: number; value: number; rtb: number }> = {};
    projects.forEach((p) => {
      if (!stats[p.pbLocation]) {
        stats[p.pbLocation] = { count: 0, value: 0, rtb: 0 };
      }
      stats[p.pbLocation].count++;
      stats[p.pbLocation].value += p.amount || 0;
      if (p.isRtb) stats[p.pbLocation].rtb++;
    });
    return stats;
  }, [projects]);

  // Queue totals
  const queueStats = useMemo(() => {
    const total = filteredProjects.length;
    const value = filteredProjects.reduce((sum, p) => sum + (p.amount || 0), 0);
    return { total, value };
  }, [filteredProjects]);

  // Calendar navigation
  const navigateMonth = (delta: number) => {
    setCurrentDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  // Export functions
  const exportCSV = () => {
    const headers = ["Project", "Location", "Stage", "Value", "Scheduled Date", "Crew"];
    const rows = scheduledProjects.map((p) => [
      p.name,
      p.pbLocation,
      p.stage,
      p.amount,
      p.constructionScheduleDate || p.forecastedInstallDate || "",
      p.installCrew || "Unassigned",
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `schedule-${currentDate.toISOString().split("T")[0]}.csv`;
    a.click();
  };

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <Header
        title="PB Master Scheduler"
        subtitle="RTB + Construction - Live HubSpot Data"
        lastUpdated={lastUpdated || undefined}
        loading={loading}
        error={error}
        showBackLink
        rightContent={
          <button
            onClick={exportCSV}
            className="text-xs px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded hover:border-orange-500 transition-colors"
          >
            Export CSV
          </button>
        }
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Project Queue */}
        <aside className="w-80 border-r border-zinc-800 flex flex-col bg-surface overflow-hidden">
          {/* Stage Tabs */}
          <div className="p-3 border-b border-zinc-800">
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
              Install Pipeline
            </h2>
            <div className="flex flex-wrap gap-1 mb-3">
              {(["all", "rtb", "blocked", "construction", "survey", "inspection"] as StageFilter[]).map((stage) => (
                <button
                  key={stage}
                  onClick={() => setStageFilter(stage)}
                  className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                    stageFilter === stage
                      ? stage === "rtb"
                        ? "border-emerald-500 text-emerald-400 bg-emerald-500/10"
                        : stage === "blocked"
                        ? "border-yellow-500 text-yellow-400 bg-yellow-500/10"
                        : stage === "construction"
                        ? "border-blue-500 text-blue-400 bg-blue-500/10"
                        : "border-orange-500 text-orange-400 bg-orange-500/10"
                      : "border-zinc-700 text-zinc-400 hover:border-zinc-600"
                  }`}
                >
                  {stage === "all" ? "All" : stage.charAt(0).toUpperCase() + stage.slice(1)}
                </button>
              ))}
            </div>
            <input
              type="text"
              placeholder="Search projects..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full input-dark text-xs"
            />
          </div>

          {/* Queue Count */}
          <div className="px-3 py-2 bg-zinc-900 border-b border-zinc-800 flex justify-between text-xs text-zinc-500">
            <span>{queueStats.total} projects</span>
            <span>${(queueStats.value / 1000).toFixed(0)}k</span>
          </div>

          {/* Project List */}
          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {loading ? (
              <div className="text-center py-8 text-zinc-500 text-sm">Loading...</div>
            ) : filteredProjects.length === 0 ? (
              <div className="text-center py-8 text-zinc-500 text-sm">No projects found</div>
            ) : (
              filteredProjects.map((project) => (
                <ProjectQueueItem
                  key={project.id}
                  project={project}
                  selected={selectedProject?.id === project.id}
                  onClick={() => setSelectedProject(project.id === selectedProject?.id ? null : project)}
                />
              ))
            )}
          </div>
        </aside>

        {/* Main Content - Calendar */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* View Tabs */}
          <div className="flex gap-0.5 p-2 bg-zinc-900 border-b border-zinc-800">
            {(["month", "week", "gantt"] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`flex-1 py-2 text-xs font-semibold rounded transition-colors ${
                  viewMode === mode
                    ? "bg-orange-500/20 text-orange-400 border border-orange-500"
                    : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-zinc-600"
                }`}
              >
                {mode === "month" ? "Month" : mode === "week" ? "Week" : "Gantt"}
              </button>
            ))}
          </div>

          {/* Location Tabs */}
          <div className="flex gap-1 p-2 bg-zinc-900 border-b border-zinc-800 overflow-x-auto">
            <button
              onClick={() => setSelectedLocation("all")}
              className={`px-3 py-1.5 text-[10px] font-medium rounded whitespace-nowrap transition-colors ${
                selectedLocation === "all"
                  ? "bg-orange-500/20 text-orange-400 border border-orange-500"
                  : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-zinc-600"
              }`}
            >
              All Locations
            </button>
            {Object.keys(LOCATIONS).map((loc) => (
              <button
                key={loc}
                onClick={() => setSelectedLocation(loc)}
                className={`px-3 py-1.5 text-[10px] font-medium rounded whitespace-nowrap transition-colors ${
                  selectedLocation === loc
                    ? "bg-orange-500/20 text-orange-400 border border-orange-500"
                    : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-zinc-600"
                }`}
              >
                {loc}
                {locationStats[loc] && (
                  <span className="ml-1 opacity-70">{locationStats[loc].count}</span>
                )}
              </button>
            ))}
          </div>

          {/* Stats Bar */}
          <div className="flex gap-2 p-2 bg-zinc-900 border-b border-zinc-800 flex-wrap">
            <StatBadge label="RTB" value={projects.filter((p) => p.isRtb).length} color="emerald" />
            <StatBadge label="Construction" value={projects.filter((p) => p.stage === "Construction").length} color="blue" />
            <StatBadge label="Blocked" value={projects.filter((p) => p.isBlocked).length} color="yellow" />
            <StatBadge label="Inspection" value={projects.filter((p) => p.stage === "Inspection").length} color="purple" />
          </div>

          {/* Selected Project Instructions */}
          {selectedProject && (
            <div className="px-4 py-2 bg-orange-500/10 border-b border-orange-500/30">
              <span className="text-xs text-orange-400">
                <strong>{selectedProject.name}</strong> selected - click a day to schedule
              </span>
            </div>
          )}

          {/* Calendar/Views */}
          <div className="flex-1 overflow-auto p-4">
            {viewMode === "month" && (
              <MonthView
                currentDate={currentDate}
                projects={scheduledProjects.filter(
                  (p) => selectedLocation === "all" || p.pbLocation === selectedLocation
                )}
                onNavigate={navigateMonth}
                onToday={goToToday}
                selectedProject={selectedProject}
              />
            )}
            {viewMode === "week" && (
              <WeekView
                currentDate={currentDate}
                projects={scheduledProjects.filter(
                  (p) => selectedLocation === "all" || p.pbLocation === selectedLocation
                )}
                selectedLocation={selectedLocation}
              />
            )}
            {viewMode === "gantt" && (
              <GanttView
                currentDate={currentDate}
                projects={scheduledProjects.filter(
                  (p) => selectedLocation === "all" || p.pbLocation === selectedLocation
                )}
                selectedLocation={selectedLocation}
              />
            )}
          </div>
        </main>

        {/* Right Panel - Crew Capacity */}
        <aside className="w-64 border-l border-zinc-800 bg-surface overflow-y-auto hidden xl:block">
          <div className="p-4 border-b border-zinc-800">
            <h3 className="text-sm font-semibold mb-3">Crew Capacity</h3>
            <div className="space-y-3">
              {Object.entries(CREWS_BY_LOCATION)
                .filter(([loc]) => selectedLocation === "all" || loc === selectedLocation)
                .map(([location, config]) => (
                  <div key={location} className="bg-zinc-800/50 rounded-lg p-3">
                    <div className="text-xs font-semibold mb-2">{location}</div>
                    {config.crews.map((crew) => (
                      <div key={crew.name} className="flex items-center gap-2 mb-1">
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: crew.color }}
                        />
                        <span className="text-[10px] text-zinc-400">{crew.name}</span>
                      </div>
                    ))}
                    <div className="text-[10px] text-zinc-500 mt-2">
                      Capacity: {config.monthlyCapacity}/month
                    </div>
                  </div>
                ))}
            </div>
          </div>

          <div className="p-4 border-b border-zinc-800">
            <h3 className="text-sm font-semibold mb-3">Export</h3>
            <div className="space-y-2">
              <button
                onClick={exportCSV}
                className="w-full text-left text-xs px-3 py-2 bg-zinc-800/50 rounded hover:bg-zinc-700 transition-colors"
              >
                Download CSV
              </button>
              <button
                onClick={() => {
                  const text = scheduledProjects
                    .map((p) => `${p.name} - ${p.constructionScheduleDate || "TBD"}`)
                    .join("\n");
                  navigator.clipboard.writeText(text);
                }}
                className="w-full text-left text-xs px-3 py-2 bg-zinc-800/50 rounded hover:bg-zinc-700 transition-colors"
              >
                Copy to Clipboard
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

// Project Queue Item Component
function ProjectQueueItem({
  project,
  selected,
  onClick,
}: {
  project: Project;
  selected: boolean;
  onClick: () => void;
}) {
  const stageClass =
    project.stage === "Ready To Build"
      ? "border-l-emerald-500"
      : project.stage === "RTB - Blocked"
      ? "border-l-yellow-500"
      : project.stage === "Construction"
      ? "border-l-blue-500"
      : project.stage === "Site Survey"
      ? "border-l-cyan-500"
      : "border-l-purple-500";

  return (
    <div
      onClick={onClick}
      className={`bg-zinc-900 border border-zinc-800 border-l-4 ${stageClass} rounded-lg p-3 cursor-pointer transition-all ${
        selected ? "border-orange-500 bg-orange-500/10 shadow-lg" : "hover:border-zinc-600"
      }`}
    >
      <div className="flex justify-between items-start mb-1">
        <div className="text-xs font-semibold text-white truncate max-w-[180px]">{project.name}</div>
        <div className="text-[10px] font-mono text-orange-400 font-semibold">
          ${((project.amount || 0) / 1000).toFixed(0)}k
        </div>
      </div>
      <div className="text-[10px] text-zinc-500 mb-2 truncate">
        {project.pbLocation} - {project.ahj}
      </div>
      <div className="flex gap-1 flex-wrap">
        <span
          className={`text-[9px] px-1.5 py-0.5 rounded ${
            project.stage === "Ready To Build"
              ? "bg-emerald-500/20 text-emerald-400"
              : project.stage === "RTB - Blocked"
              ? "bg-yellow-500/20 text-yellow-400"
              : project.stage === "Construction"
              ? "bg-blue-500/20 text-blue-400"
              : "bg-zinc-700 text-zinc-400"
          }`}
        >
          {project.stage}
        </span>
        {project.equipment.systemSizeKwdc > 0 && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400">
            {project.equipment.systemSizeKwdc.toFixed(1)}kW
          </span>
        )}
        {project.equipment.battery.count > 0 && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400">
            Battery
          </span>
        )}
        {project.constructionScheduleDate && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/30 text-blue-300 font-semibold">
            Scheduled
          </span>
        )}
      </div>
      {project.daysForInstallers > 0 && (
        <div className="text-[9px] text-zinc-500 mt-2">
          Est. {project.daysForInstallers} install days
        </div>
      )}
    </div>
  );
}

// Stat Badge Component
function StatBadge({ label, value, color }: { label: string; value: number; color: string }) {
  const colorClasses: Record<string, string> = {
    emerald: "bg-emerald-500",
    blue: "bg-blue-500",
    yellow: "bg-yellow-500",
    purple: "bg-purple-500",
  };

  return (
    <div className="flex items-center gap-2 px-2 py-1 bg-zinc-800 rounded border border-zinc-700">
      <div className={`w-2 h-2 rounded-sm ${colorClasses[color]}`} />
      <span className="font-mono text-sm font-semibold">{value}</span>
      <span className="text-[10px] text-zinc-500 uppercase">{label}</span>
    </div>
  );
}

// Month View Component
function MonthView({
  currentDate,
  projects,
  onNavigate,
  onToday,
  selectedProject,
}: {
  currentDate: Date;
  projects: Project[];
  onNavigate: (delta: number) => void;
  onToday: () => void;
  selectedProject: Project | null;
}) {
  const monthName = currentDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const today = new Date();

  // Generate calendar days
  const calendarDays = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startOffset = firstDay.getDay();
    const daysInMonth = lastDay.getDate();

    const days: Array<{ date: Date; isCurrentMonth: boolean; isWeekend: boolean; isToday: boolean }> = [];

    // Previous month days
    for (let i = startOffset - 1; i >= 0; i--) {
      const date = new Date(year, month, -i);
      days.push({
        date,
        isCurrentMonth: false,
        isWeekend: date.getDay() === 0 || date.getDay() === 6,
        isToday: false,
      });
    }

    // Current month days
    for (let i = 1; i <= daysInMonth; i++) {
      const date = new Date(year, month, i);
      days.push({
        date,
        isCurrentMonth: true,
        isWeekend: date.getDay() === 0 || date.getDay() === 6,
        isToday:
          date.getDate() === today.getDate() &&
          date.getMonth() === today.getMonth() &&
          date.getFullYear() === today.getFullYear(),
      });
    }

    // Next month days to fill the grid
    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) {
      const date = new Date(year, month + 1, i);
      days.push({
        date,
        isCurrentMonth: false,
        isWeekend: date.getDay() === 0 || date.getDay() === 6,
        isToday: false,
      });
    }

    return days;
  }, [currentDate, today]);

  // Get projects for a specific date
  const getProjectsForDate = (date: Date) => {
    const dateStr = date.toISOString().split("T")[0];
    return projects.filter((p) => {
      const scheduleDate = p.constructionScheduleDate || p.forecastedInstallDate;
      return scheduleDate === dateStr;
    });
  };

  return (
    <div>
      {/* Navigation */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => onNavigate(-1)}
          className="px-3 py-1.5 text-xs bg-zinc-800 border border-zinc-700 rounded hover:bg-zinc-700 transition-colors"
        >
          Prev
        </button>
        <h2 className="text-lg font-semibold">{monthName}</h2>
        <div className="flex gap-2">
          <button
            onClick={onToday}
            className="px-3 py-1.5 text-xs bg-zinc-800 border border-zinc-700 rounded hover:bg-zinc-700 transition-colors"
          >
            Today
          </button>
          <button
            onClick={() => onNavigate(1)}
            className="px-3 py-1.5 text-xs bg-zinc-800 border border-zinc-700 rounded hover:bg-zinc-700 transition-colors"
          >
            Next
          </button>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-0.5 bg-zinc-800 rounded-lg overflow-hidden">
        {/* Day Headers */}
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
          <div key={day} className="bg-zinc-900 p-2 text-center text-xs font-semibold text-zinc-500">
            {day}
          </div>
        ))}

        {/* Calendar Days */}
        {calendarDays.map((day, index) => {
          const dayProjects = getProjectsForDate(day.date);

          return (
            <div
              key={index}
              className={`bg-zinc-900 min-h-[100px] p-1 relative cursor-pointer transition-colors ${
                !day.isCurrentMonth ? "opacity-40" : ""
              } ${day.isToday ? "ring-2 ring-orange-500 ring-inset" : ""} ${
                day.isWeekend ? "bg-zinc-950 opacity-60" : "hover:bg-zinc-800"
              }`}
            >
              <div className={`text-xs font-semibold mb-1 ${day.isToday ? "text-orange-400" : "text-zinc-500"}`}>
                {day.date.getDate()}
              </div>
              <div className="space-y-0.5">
                {dayProjects.slice(0, 3).map((project) => (
                  <div
                    key={project.id}
                    className={`text-[9px] px-1 py-0.5 rounded truncate cursor-pointer ${
                      project.stage === "Construction"
                        ? "bg-blue-500 text-white"
                        : project.stage === "Ready To Build"
                        ? "bg-emerald-500 text-black"
                        : "bg-cyan-500 text-white"
                    }`}
                    title={project.name}
                  >
                    {project.name}
                  </div>
                ))}
                {dayProjects.length > 3 && (
                  <div className="text-[9px] text-zinc-500 text-center">+{dayProjects.length - 3} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Week View Component
function WeekView({
  currentDate,
  projects,
  selectedLocation,
}: {
  currentDate: Date;
  projects: Project[];
  selectedLocation: string;
}) {
  // Get the start of the week (Monday)
  const getWeekStart = (date: Date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
  };

  const weekStart = getWeekStart(currentDate);
  const weekDays = Array.from({ length: 5 }, (_, i) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + i);
    return date;
  });

  const crews =
    selectedLocation === "all"
      ? Object.entries(CREWS_BY_LOCATION).flatMap(([loc, config]) =>
          config.crews.map((c) => ({ ...c, location: loc }))
        )
      : CREWS_BY_LOCATION[selectedLocation as LocationKey]?.crews.map((c) => ({
          ...c,
          location: selectedLocation,
        })) || [];

  const getProjectsForDateAndCrew = (date: Date, crewName: string) => {
    const dateStr = date.toISOString().split("T")[0];
    return projects.filter((p) => {
      const scheduleDate = p.constructionScheduleDate || p.forecastedInstallDate;
      return scheduleDate === dateStr && (p.installCrew === crewName || p.installCrew === "Unassigned");
    });
  };

  const today = new Date();

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">
        Week of {weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
      </h2>

      <div className="grid gap-px bg-zinc-800 rounded-lg overflow-hidden" style={{ gridTemplateColumns: "120px repeat(5, 1fr)" }}>
        {/* Header Row */}
        <div className="bg-zinc-900 p-2" />
        {weekDays.map((day) => {
          const isToday =
            day.getDate() === today.getDate() &&
            day.getMonth() === today.getMonth() &&
            day.getFullYear() === today.getFullYear();

          return (
            <div
              key={day.toISOString()}
              className={`bg-zinc-900 p-2 text-center ${isToday ? "bg-orange-500/20" : ""}`}
            >
              <div className="text-xs font-semibold text-zinc-500">
                {day.toLocaleDateString("en-US", { weekday: "short" })}
              </div>
              <div className={`text-sm font-bold ${isToday ? "text-orange-400" : ""}`}>
                {day.getDate()}
              </div>
            </div>
          );
        })}

        {/* Crew Rows */}
        {crews.map((crew) => (
          <>
            <div
              key={`${crew.name}-header`}
              className="bg-zinc-950 p-2 border-r-2"
              style={{ borderColor: crew.color }}
            >
              <div className="text-xs font-semibold">{crew.name}</div>
              <div className="text-[10px] text-zinc-500">{crew.location}</div>
            </div>
            {weekDays.map((day) => {
              const dayProjects = getProjectsForDateAndCrew(day, crew.name);

              return (
                <div
                  key={`${crew.name}-${day.toISOString()}`}
                  className="bg-zinc-900 min-h-[60px] p-1 hover:bg-zinc-800 transition-colors"
                >
                  {dayProjects.map((p) => (
                    <div
                      key={p.id}
                      className="text-[10px] px-2 py-1 rounded mb-1 bg-blue-500 text-white truncate"
                      title={p.name}
                    >
                      {p.name}
                    </div>
                  ))}
                </div>
              );
            })}
          </>
        ))}
      </div>
    </div>
  );
}

// Gantt View Component
function GanttView({
  currentDate,
  projects,
  selectedLocation,
}: {
  currentDate: Date;
  projects: Project[];
  selectedLocation: string;
}) {
  // Generate 14 days starting from current date
  const days = Array.from({ length: 14 }, (_, i) => {
    const date = new Date(currentDate);
    date.setDate(currentDate.getDate() + i);
    return date;
  });

  const today = new Date();

  // Group projects by location
  const projectsByLocation = useMemo(() => {
    const grouped: Record<string, Project[]> = {};
    projects.forEach((p) => {
      if (selectedLocation !== "all" && p.pbLocation !== selectedLocation) return;
      if (!grouped[p.pbLocation]) grouped[p.pbLocation] = [];
      grouped[p.pbLocation].push(p);
    });
    return grouped;
  }, [projects, selectedLocation]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">2-Week Timeline</h2>
        <div className="flex gap-4 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-blue-500" />
            <span className="text-zinc-400">Construction</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-cyan-500" />
            <span className="text-zinc-400">Scheduled</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-emerald-500" />
            <span className="text-zinc-400">RTB</span>
          </div>
        </div>
      </div>

      <div className="bg-zinc-800 rounded-lg overflow-hidden">
        {/* Header Row */}
        <div className="grid gap-px" style={{ gridTemplateColumns: "140px repeat(14, 1fr)" }}>
          <div className="bg-zinc-900 p-2" />
          {days.map((day) => {
            const isToday =
              day.getDate() === today.getDate() &&
              day.getMonth() === today.getMonth() &&
              day.getFullYear() === today.getFullYear();
            const isWeekend = day.getDay() === 0 || day.getDay() === 6;

            return (
              <div
                key={day.toISOString()}
                className={`bg-zinc-900 p-1 text-center ${isToday ? "bg-orange-500/20" : ""} ${
                  isWeekend ? "opacity-50" : ""
                }`}
              >
                <div className="text-[9px] font-semibold text-zinc-500">
                  {day.toLocaleDateString("en-US", { weekday: "short" })}
                </div>
                <div className={`text-xs font-bold ${isToday ? "text-orange-400" : ""}`}>
                  {day.getDate()}
                </div>
              </div>
            );
          })}
        </div>

        {/* Location Rows */}
        {Object.entries(projectsByLocation).map(([location, locProjects]) => (
          <div key={location}>
            <div
              className="grid gap-px"
              style={{ gridTemplateColumns: "140px repeat(14, 1fr)" }}
            >
              <div className="bg-zinc-950 p-2">
                <div className="text-xs font-semibold">{location}</div>
                <div className="text-[10px] text-zinc-500">{locProjects.length} projects</div>
              </div>
              {days.map((day) => {
                const dateStr = day.toISOString().split("T")[0];
                const dayProjects = locProjects.filter((p) => {
                  const scheduleDate = p.constructionScheduleDate || p.forecastedInstallDate;
                  return scheduleDate === dateStr;
                });

                return (
                  <div key={day.toISOString()} className="bg-zinc-900 min-h-[40px] p-0.5 relative">
                    {dayProjects.map((p, idx) => (
                      <div
                        key={p.id}
                        className={`absolute left-1 right-1 rounded text-[8px] px-1 py-0.5 truncate ${
                          p.stage === "Construction"
                            ? "bg-blue-500 text-white"
                            : p.stage === "Ready To Build"
                            ? "bg-emerald-500 text-black"
                            : "bg-cyan-500 text-white"
                        }`}
                        style={{ top: `${idx * 20 + 4}px` }}
                        title={p.name}
                      >
                        {p.name}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
