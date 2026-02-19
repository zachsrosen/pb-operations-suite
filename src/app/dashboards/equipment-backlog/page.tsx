"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { MultiSelectFilter, ProjectSearchBar } from "@/components/ui/MultiSelectFilter";
import { formatMoney } from "@/lib/format";
import { STAGE_COLORS, STAGE_ORDER } from "@/lib/constants";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { queryKeys } from "@/lib/query-keys";
import { useSSE } from "@/hooks/useSSE";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Equipment {
  modules: { brand: string; model: string; count: number; wattage: number };
  inverter: { brand: string; model: string; count: number; sizeKwac: number };
  battery: { brand: string; model: string; count: number; sizeKwh: number; expansionCount: number };
  evCount: number;
  systemSizeKwdc: number;
  systemSizeKwac: number;
}

interface Project {
  id: string | number;
  name: string;
  projectNumber: string;
  pbLocation: string;
  stage: string;
  amount: number;
  equipment: Equipment;
  address: string;
  city: string;
}

interface EquipmentSummary {
  brand: string;
  model: string;
  totalCount: number;
  projects: number;
}

interface EquipmentBacklogResponse {
  projects: Project[];
  lastUpdated: string | null;
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function EquipmentBacklogPage() {
  useActivityTracking();

  // Filters
  const [filterLocations, setFilterLocations] = useState<string[]>([]);
  const [filterStages, setFilterStages] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<"modules" | "stage" | "location" | "name" | "value">("modules");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // View mode
  const [view, setView] = useState<"summary" | "projects">("summary");

  /* ---- Data fetching ---- */

  const equipmentQueryParams = {
    context: "equipment",
    limit: "0",
    fields: "id,name,projectNumber,pbLocation,stage,amount,equipment,address,city",
  };

  const { data, isLoading, isError, refetch } = useQuery<EquipmentBacklogResponse>({
    queryKey: queryKeys.projects.list(equipmentQueryParams),
    queryFn: async () => {
      const res = await fetch(
        "/api/projects?context=equipment&limit=0&fields=id,name,projectNumber,pbLocation,stage,amount,equipment,address,city"
      );
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  useSSE(null, { cacheKeyFilter: "projects" });

  const projects: Project[] = data?.projects ?? [];
  const lastUpdated = data?.lastUpdated ?? null;

  /* ---- Derived filter options ---- */

  const locations = useMemo(
    () =>
      [...new Set(projects.map((p) => p.pbLocation))]
        .filter((l) => l && l !== "Unknown")
        .sort()
        .map((l) => ({ value: l, label: l })),
    [projects]
  );

  const stages = useMemo(
    () =>
      [...new Set(projects.map((p) => p.stage))]
        .filter(Boolean)
        .sort((a, b) => {
          const ai = STAGE_ORDER.indexOf(a as (typeof STAGE_ORDER)[number]);
          const bi = STAGE_ORDER.indexOf(b as (typeof STAGE_ORDER)[number]);
          return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        })
        .map((s) => ({ value: s, label: s })),
    [projects]
  );

  /* ---- Filtered projects ---- */

  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      if (filterLocations.length > 0 && !filterLocations.includes(p.pbLocation || "")) return false;
      if (filterStages.length > 0 && !filterStages.includes(p.stage || "")) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (
          !(p.name || "").toLowerCase().includes(q) &&
          !(p.projectNumber || "").toLowerCase().includes(q) &&
          !(p.pbLocation || "").toLowerCase().includes(q) &&
          !(p.address || "").toLowerCase().includes(q) &&
          !(p.city || "").toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [projects, filterLocations, filterStages, searchQuery]);

  /* ---- Sorted projects ---- */

  const sortedProjects = useMemo(() => {
    const sorted = [...filteredProjects].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "modules":
          cmp = (a.equipment?.modules?.count || 0) - (b.equipment?.modules?.count || 0);
          break;
        case "stage":
          cmp = (STAGE_ORDER.indexOf(a.stage as (typeof STAGE_ORDER)[number]) ?? 999) -
                (STAGE_ORDER.indexOf(b.stage as (typeof STAGE_ORDER)[number]) ?? 999);
          break;
        case "location":
          cmp = (a.pbLocation || "").localeCompare(b.pbLocation || "");
          break;
        case "name":
          cmp = (a.name || "").localeCompare(b.name || "");
          break;
        case "value":
          cmp = (a.amount || 0) - (b.amount || 0);
          break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
    return sorted;
  }, [filteredProjects, sortField, sortDir]);

  /* ---- Aggregated equipment stats ---- */

  const totals = useMemo(() => {
    let totalModules = 0;
    let totalInverters = 0;
    let totalBatteries = 0;
    let totalBatteryExpansions = 0;
    let totalEv = 0;
    let totalValue = 0;

    for (const p of filteredProjects) {
      const eq = p.equipment;
      if (!eq) continue;
      totalModules += eq.modules?.count || 0;
      totalInverters += eq.inverter?.count || 0;
      totalBatteries += eq.battery?.count || 0;
      totalBatteryExpansions += eq.battery?.expansionCount || 0;
      totalEv += eq.evCount || 0;
      totalValue += p.amount || 0;
    }

    return {
      projects: filteredProjects.length,
      totalModules,
      totalInverters,
      totalBatteries,
      totalBatteryExpansions,
      totalEv,
      totalValue,
    };
  }, [filteredProjects]);

  /* ---- Equipment breakdown by brand/model ---- */

  const moduleSummary = useMemo(() => {
    const map = new Map<string, EquipmentSummary>();
    for (const p of filteredProjects) {
      const m = p.equipment?.modules;
      if (!m || !m.count) continue;
      const key = `${m.brand || "Unknown"}|||${m.model || "Unknown"}`;
      const existing = map.get(key);
      if (existing) {
        existing.totalCount += m.count;
        existing.projects += 1;
      } else {
        map.set(key, { brand: m.brand || "Unknown", model: m.model || "Unknown", totalCount: m.count, projects: 1 });
      }
    }
    return [...map.values()].sort((a, b) => b.totalCount - a.totalCount);
  }, [filteredProjects]);

  const inverterSummary = useMemo(() => {
    const map = new Map<string, EquipmentSummary>();
    for (const p of filteredProjects) {
      const inv = p.equipment?.inverter;
      if (!inv || !inv.count) continue;
      const key = `${inv.brand || "Unknown"}|||${inv.model || "Unknown"}`;
      const existing = map.get(key);
      if (existing) {
        existing.totalCount += inv.count;
        existing.projects += 1;
      } else {
        map.set(key, { brand: inv.brand || "Unknown", model: inv.model || "Unknown", totalCount: inv.count, projects: 1 });
      }
    }
    return [...map.values()].sort((a, b) => b.totalCount - a.totalCount);
  }, [filteredProjects]);

  const batterySummary = useMemo(() => {
    const map = new Map<string, EquipmentSummary>();
    for (const p of filteredProjects) {
      const bat = p.equipment?.battery;
      if (!bat || !bat.count) continue;
      const key = `${bat.brand || "Unknown"}|||${bat.model || "Unknown"}`;
      const existing = map.get(key);
      if (existing) {
        existing.totalCount += bat.count;
        existing.projects += 1;
      } else {
        map.set(key, {
          brand: bat.brand || "Unknown",
          model: bat.model || "Unknown",
          totalCount: bat.count,
          projects: 1,
        });
      }
    }
    return [...map.values()].sort((a, b) => b.totalCount - a.totalCount);
  }, [filteredProjects]);

  /* ---- Stage breakdown ---- */

  const stageBreakdown = useMemo(() => {
    const map = new Map<string, { count: number; modules: number; inverters: number; batteries: number; batteryExpansions: number; value: number }>();
    for (const p of filteredProjects) {
      const stage = p.stage || "Unknown";
      const existing = map.get(stage);
      const eq = p.equipment;
      if (existing) {
        existing.count += 1;
        existing.modules += eq?.modules?.count || 0;
        existing.inverters += eq?.inverter?.count || 0;
        existing.batteries += eq?.battery?.count || 0;
        existing.batteryExpansions += eq?.battery?.expansionCount || 0;
        existing.value += p.amount || 0;
      } else {
        map.set(stage, {
          count: 1,
          modules: eq?.modules?.count || 0,
          inverters: eq?.inverter?.count || 0,
          batteries: eq?.battery?.count || 0,
          batteryExpansions: eq?.battery?.expansionCount || 0,
          value: p.amount || 0,
        });
      }
    }
    return [...map.entries()]
      .sort((a, b) => {
        const ai = STAGE_ORDER.indexOf(a[0] as (typeof STAGE_ORDER)[number]);
        const bi = STAGE_ORDER.indexOf(b[0] as (typeof STAGE_ORDER)[number]);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      });
  }, [filteredProjects]);

  /* ---- Location breakdown ---- */

  const locationBreakdown = useMemo(() => {
    const map = new Map<string, { count: number; modules: number; inverters: number; batteries: number; batteryExpansions: number; value: number }>();
    for (const p of filteredProjects) {
      const loc = p.pbLocation || "Unknown";
      const eq = p.equipment;
      const existing = map.get(loc);
      if (existing) {
        existing.count += 1;
        existing.modules += eq?.modules?.count || 0;
        existing.inverters += eq?.inverter?.count || 0;
        existing.batteries += eq?.battery?.count || 0;
        existing.batteryExpansions += eq?.battery?.expansionCount || 0;
        existing.value += p.amount || 0;
      } else {
        map.set(loc, {
          count: 1,
          modules: eq?.modules?.count || 0,
          inverters: eq?.inverter?.count || 0,
          batteries: eq?.battery?.count || 0,
          batteryExpansions: eq?.battery?.expansionCount || 0,
          value: p.amount || 0,
        });
      }
    }
    return [...map.entries()].sort((a, b) => b[1].modules - a[1].modules);
  }, [filteredProjects]);

  /* ---- Column sort handler ---- */

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const SortIcon = ({ field }: { field: typeof sortField }) => (
    <span className="ml-1 text-muted/70">
      {sortField === field ? (sortDir === "asc" ? "\u25B2" : "\u25BC") : "\u25BC"}
    </span>
  );

  /* ---- Render ---- */

  if (isLoading) {
    return (
      <DashboardShell title="Equipment Backlog" accentColor="cyan">
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400" />
        </div>
      </DashboardShell>
    );
  }

  if (isError) {
    return (
      <DashboardShell title="Equipment Backlog" accentColor="cyan">
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <p className="text-red-400">Failed to load equipment data. Please try refreshing.</p>
          <button
            onClick={() => refetch()}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-sm transition-colors"
          >
            Retry
          </button>
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell
      title="Equipment Backlog"
      subtitle={`${totals.projects} projects \u2022 ${totals.totalModules.toLocaleString()} modules`}
      accentColor="cyan"
      lastUpdated={lastUpdated}
      exportData={{
        data: sortedProjects.map((p) => ({
          Project: p.name,
          "Project #": p.projectNumber,
          Location: p.pbLocation,
          Stage: p.stage,
          "Module Brand": p.equipment?.modules?.brand || "",
          "Module Model": p.equipment?.modules?.model || "",
          Modules: p.equipment?.modules?.count || 0,
          "Inverter Brand": p.equipment?.inverter?.brand || "",
          "Inverter Model": p.equipment?.inverter?.model || "",
          Inverters: p.equipment?.inverter?.count || 0,
          "Battery Brand": p.equipment?.battery?.brand || "",
          "Battery Model": p.equipment?.battery?.model || "",
          Batteries: p.equipment?.battery?.count || 0,
          "Battery Expansions": p.equipment?.battery?.expansionCount || 0,
          "EV Chargers": p.equipment?.evCount || 0,
          Value: p.amount || 0,
        })),
        filename: "equipment-backlog",
      }}
    >
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <MultiSelectFilter
          label="Location"
          options={locations}
          selected={filterLocations}
          onChange={setFilterLocations}
          placeholder="All Locations"
          accentColor="orange"
        />
        <MultiSelectFilter
          label="Stage"
          options={stages}
          selected={filterStages}
          onChange={setFilterStages}
          placeholder="All Stages"
          accentColor="blue"
        />
        <ProjectSearchBar onSearch={setSearchQuery} />
        <div className="ml-auto flex bg-surface-2 rounded-lg p-0.5">
          <button
            onClick={() => setView("summary")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              view === "summary" ? "bg-cyan-600 text-white" : "text-muted hover:text-foreground"
            }`}
          >
            Summary
          </button>
          <button
            onClick={() => setView("projects")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              view === "projects" ? "bg-cyan-600 text-white" : "text-muted hover:text-foreground"
            }`}
          >
            Projects
          </button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-8">
        {[
          { label: "Projects", value: totals.projects.toLocaleString(), color: "text-cyan-400" },
          { label: "Modules", value: totals.totalModules.toLocaleString(), color: "text-blue-400" },
          { label: "Inverters", value: totals.totalInverters.toLocaleString(), color: "text-purple-400" },
          { label: "Batteries", value: totals.totalBatteries.toLocaleString(), color: "text-emerald-400" },
          { label: "Battery Exp.", value: totals.totalBatteryExpansions.toLocaleString(), color: "text-green-400" },
          { label: "EV Chargers", value: totals.totalEv.toLocaleString(), color: "text-pink-400" },
          { label: "Pipeline Value", value: formatMoney(totals.totalValue), color: "text-orange-400" },
        ].map((stat) => (
          <div key={stat.label} className="bg-surface/50 border border-t-border rounded-lg p-3 text-center">
            <div className={`text-xl font-bold ${stat.color}`}>{stat.value}</div>
            <div className="text-xs text-muted mt-0.5">{stat.label}</div>
          </div>
        ))}
      </div>

      {view === "summary" ? (
        <>
          {/* Stage Breakdown */}
          <div className="bg-surface/50 border border-t-border rounded-xl p-6 mb-6">
            <h2 className="text-lg font-semibold mb-4">Equipment by Stage</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted text-left border-b border-t-border">
                    <th className="pb-2 pr-4">Stage</th>
                    <th className="pb-2 pr-4 text-right">Projects</th>
                    <th className="pb-2 pr-4 text-right">Modules</th>
                    <th className="pb-2 pr-4 text-right">Inverters</th>
                    <th className="pb-2 pr-4 text-right">Batteries</th>
                    <th className="pb-2 pr-4 text-right">Bat. Exp.</th>
                    <th className="pb-2 text-right">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {stageBreakdown.map(([stage, data]) => (
                    <tr key={stage} className="border-b border-t-border/50 hover:bg-surface-2/30">
                      <td className="py-2 pr-4">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: STAGE_COLORS[stage]?.hex || "#71717A" }}
                          />
                          {stage}
                        </div>
                      </td>
                      <td className="py-2 pr-4 text-right text-foreground/80">{data.count}</td>
                      <td className="py-2 pr-4 text-right text-blue-400">{data.modules.toLocaleString()}</td>
                      <td className="py-2 pr-4 text-right text-purple-400">{data.inverters.toLocaleString()}</td>
                      <td className="py-2 pr-4 text-right text-emerald-400">{data.batteries.toLocaleString()}</td>
                      <td className="py-2 pr-4 text-right text-green-400">{data.batteryExpansions.toLocaleString()}</td>
                      <td className="py-2 text-right text-muted">{formatMoney(data.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Location Breakdown */}
          <div className="bg-surface/50 border border-t-border rounded-xl p-6 mb-6">
            <h2 className="text-lg font-semibold mb-4">Equipment by Location</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted text-left border-b border-t-border">
                    <th className="pb-2 pr-4">Location</th>
                    <th className="pb-2 pr-4 text-right">Projects</th>
                    <th className="pb-2 pr-4 text-right">Modules</th>
                    <th className="pb-2 pr-4 text-right">Inverters</th>
                    <th className="pb-2 pr-4 text-right">Batteries</th>
                    <th className="pb-2 pr-4 text-right">Bat. Exp.</th>
                    <th className="pb-2 text-right">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {locationBreakdown.map(([location, data]) => (
                    <tr key={location} className="border-b border-t-border/50 hover:bg-surface-2/30">
                      <td className="py-2 pr-4 text-foreground/80">{location}</td>
                      <td className="py-2 pr-4 text-right text-foreground/80">{data.count}</td>
                      <td className="py-2 pr-4 text-right text-blue-400">{data.modules.toLocaleString()}</td>
                      <td className="py-2 pr-4 text-right text-purple-400">{data.inverters.toLocaleString()}</td>
                      <td className="py-2 pr-4 text-right text-emerald-400">{data.batteries.toLocaleString()}</td>
                      <td className="py-2 pr-4 text-right text-green-400">{data.batteryExpansions.toLocaleString()}</td>
                      <td className="py-2 text-right text-muted">{formatMoney(data.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Equipment Breakdowns */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            {/* Modules */}
            <div className="bg-surface/50 border border-t-border rounded-xl p-6">
              <h3 className="text-sm font-semibold text-blue-400 mb-3">Modules by Brand / Model</h3>
              {moduleSummary.length === 0 ? (
                <p className="text-muted text-sm">No module data</p>
              ) : (
                <div className="space-y-2">
                  {moduleSummary.map((m, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <div className="truncate mr-2">
                        <span className="text-foreground/80">{m.brand}</span>
                        {m.model !== "Unknown" && (
                          <span className="text-muted ml-1">{m.model}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-blue-400 font-medium">{m.totalCount.toLocaleString()}</span>
                        <span className="text-muted/70 text-xs">{m.projects} jobs</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Inverters */}
            <div className="bg-surface/50 border border-t-border rounded-xl p-6">
              <h3 className="text-sm font-semibold text-purple-400 mb-3">Inverters by Brand / Model</h3>
              {inverterSummary.length === 0 ? (
                <p className="text-muted text-sm">No inverter data</p>
              ) : (
                <div className="space-y-2">
                  {inverterSummary.map((inv, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <div className="truncate mr-2">
                        <span className="text-foreground/80">{inv.brand}</span>
                        {inv.model !== "Unknown" && (
                          <span className="text-muted ml-1">{inv.model}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-purple-400 font-medium">{inv.totalCount.toLocaleString()}</span>
                        <span className="text-muted/70 text-xs">{inv.projects} jobs</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Batteries */}
            <div className="bg-surface/50 border border-t-border rounded-xl p-6">
              <h3 className="text-sm font-semibold text-emerald-400 mb-3">Batteries by Brand / Model</h3>
              {batterySummary.length === 0 ? (
                <p className="text-muted text-sm">No battery data</p>
              ) : (
                <div className="space-y-2">
                  {batterySummary.map((bat, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <div className="truncate mr-2">
                        <span className="text-foreground/80">{bat.brand}</span>
                        {bat.model !== "Unknown" && (
                          <span className="text-muted ml-1">{bat.model}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-emerald-400 font-medium">{bat.totalCount.toLocaleString()}</span>
                        <span className="text-muted/70 text-xs">{bat.projects} jobs</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        /* ---- Projects Table View ---- */
        <div className="bg-surface/50 border border-t-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted text-left border-b border-t-border bg-surface/80">
                  <th className="px-4 py-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("name")}>
                    Project <SortIcon field="name" />
                  </th>
                  <th className="px-4 py-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("location")}>
                    Location <SortIcon field="location" />
                  </th>
                  <th className="px-4 py-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("stage")}>
                    Stage <SortIcon field="stage" />
                  </th>
                  <th className="px-4 py-3 cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("modules")}>
                    Modules <SortIcon field="modules" />
                  </th>
                  <th className="px-4 py-3 text-right">Inverters</th>
                  <th className="px-4 py-3 text-right">Batteries</th>
                  <th className="px-4 py-3 text-right">Bat. Exp.</th>
                  <th className="px-4 py-3 text-right">EV</th>
                  <th className="px-4 py-3 cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("value")}>
                    Value <SortIcon field="value" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedProjects.map((p) => {
                  const eq = p.equipment;
                  return (
                    <tr key={p.id} className="border-b border-t-border/50 hover:bg-surface-2/30">
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-foreground/90 truncate max-w-[220px]">{p.name}</div>
                        <div className="text-xs text-muted">{p.projectNumber}</div>
                      </td>
                      <td className="px-4 py-2.5 text-muted">{p.pbLocation}</td>
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: STAGE_COLORS[p.stage]?.hex || "#71717A" }}
                          />
                          <span className="text-foreground/80">{p.stage}</span>
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="text-blue-400">{eq?.modules?.count || 0}</div>
                        {eq?.modules?.brand && (
                          <div className="text-xs text-muted/70 truncate max-w-[160px]">{eq.modules.brand}{eq.modules.model ? ` ${eq.modules.model}` : ""}</div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="text-purple-400">{eq?.inverter?.count || 0}</div>
                        {eq?.inverter?.brand && (
                          <div className="text-xs text-muted/70 truncate max-w-[160px]">{eq.inverter.brand}{eq.inverter.model ? ` ${eq.inverter.model}` : ""}</div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="text-emerald-400">{eq?.battery?.count || 0}</div>
                        {eq?.battery?.brand && (
                          <div className="text-xs text-muted/70 truncate max-w-[160px]">{eq.battery.brand}{eq.battery.model ? ` ${eq.battery.model}` : ""}</div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right text-green-400">
                        {eq?.battery?.expansionCount || 0}
                      </td>
                      <td className="px-4 py-2.5 text-right text-pink-400">
                        {eq?.evCount || 0}
                      </td>
                      <td className="px-4 py-2.5 text-right text-muted">
                        {formatMoney(p.amount)}
                      </td>
                    </tr>
                  );
                })}
                {sortedProjects.length === 0 && (
                  <tr>
                    <td colSpan={9} className="text-center py-12 text-muted">
                      No projects match the current filters
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pipeline Value Footer */}
      <div className="mt-6 text-center text-sm text-muted">
        Filtered pipeline value: <span className="text-orange-400 font-medium">{formatMoney(totals.totalValue)}</span>
        {filterLocations.length > 0 && (
          <span className="ml-2">
            ({filterLocations.join(", ")})
          </span>
        )}
      </div>
    </DashboardShell>
  );
}
