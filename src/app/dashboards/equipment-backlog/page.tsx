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
  modules: { brand: string; model: string; count: number; wattage: number; productName?: string };
  inverter: { brand: string; model: string; count: number; sizeKwac: number; productName?: string };
  battery: { brand: string; model: string; count: number; sizeKwh: number; expansionCount: number; productName?: string; expansionProductName?: string; expansionModel?: string };
  evCount: number;
  systemSizeKwdc: number;
  systemSizeKwac: number;
}

/** Format product as "Name (model)" or just "Name" if no model */
function formatProduct(name: string | undefined, model: string | undefined): string {
  const n = (name || "").trim();
  const m = (model || "").trim();
  if (!n) return m || "Unknown";
  if (!m) return n;
  return `${n} (${m})`;
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

interface ProductSummary {
  productName: string;
  totalCount: number;
  projects: number;
}

interface EquipmentBacklogResponse {
  projects: Project[];
  lastUpdated: string | null;
}

/* ------------------------------------------------------------------ */
/*  Stage classification                                               */
/* ------------------------------------------------------------------ */

const BUILT_STAGES = new Set(["Inspection", "Permission To Operate", "Close Out"]);
const IN_PROGRESS_STAGES = new Set(["Construction"]);

function classifyStage(stage: string): "backlog" | "in_progress" | "built" {
  if (BUILT_STAGES.has(stage)) return "built";
  if (IN_PROGRESS_STAGES.has(stage)) return "in_progress";
  return "backlog";
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function aggregateEquipment(projects: Project[]) {
  let modules = 0, inverters = 0, batteries = 0, batteryExpansions = 0, ev = 0, value = 0;
  for (const p of projects) {
    const eq = p.equipment;
    if (!eq) continue;
    modules += eq.modules?.count || 0;
    inverters += eq.inverter?.count || 0;
    batteries += eq.battery?.count || 0;
    batteryExpansions += eq.battery?.expansionCount || 0;
    ev += eq.evCount || 0;
    value += p.amount || 0;
  }
  return { projects: projects.length, modules, inverters, batteries, batteryExpansions, ev, value };
}

function buildProductSummary(
  projects: Project[],
  getProductName: (eq: Equipment) => string,
  getCount: (eq: Equipment) => number,
): ProductSummary[] {
  const map = new Map<string, ProductSummary>();
  for (const p of projects) {
    const eq = p.equipment;
    if (!eq) continue;
    const count = getCount(eq);
    if (!count) continue;
    const name = getProductName(eq) || "Unknown";
    const existing = map.get(name);
    if (existing) {
      existing.totalCount += count;
      existing.projects += 1;
    } else {
      map.set(name, { productName: name, totalCount: count, projects: 1 });
    }
  }
  return [...map.values()].sort((a, b) => b.totalCount - a.totalCount);
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function EquipmentBacklogPage() {
  useActivityTracking();

  const [filterLocations, setFilterLocations] = useState<string[]>([]);
  const [filterStages, setFilterStages] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<"modules" | "stage" | "location" | "name" | "value">("modules");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
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

  /* ---- Filter options ---- */

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

  /* ---- Split into backlog / in-progress / built ---- */

  const { backlogProjects, inProgressProjects, builtProjects } = useMemo(() => {
    const backlog: Project[] = [];
    const inProgress: Project[] = [];
    const built: Project[] = [];
    for (const p of filteredProjects) {
      const cls = classifyStage(p.stage);
      if (cls === "built") built.push(p);
      else if (cls === "in_progress") inProgress.push(p);
      else backlog.push(p);
    }
    return { backlogProjects: backlog, inProgressProjects: inProgress, builtProjects: built };
  }, [filteredProjects]);

  /* ---- Sorted projects ---- */

  const sortedProjects = useMemo(() => {
    return [...filteredProjects].sort((a, b) => {
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
  }, [filteredProjects, sortField, sortDir]);

  /* ---- Aggregated stats ---- */

  const backlogTotals = useMemo(() => aggregateEquipment(backlogProjects), [backlogProjects]);
  const inProgressTotals = useMemo(() => aggregateEquipment(inProgressProjects), [inProgressProjects]);
  const builtTotals = useMemo(() => aggregateEquipment(builtProjects), [builtProjects]);
  const allTotals = useMemo(() => aggregateEquipment(filteredProjects), [filteredProjects]);

  /* ---- Product name breakdowns (backlog only) ---- */

  const moduleProducts = useMemo(
    () => buildProductSummary(backlogProjects, (eq) => formatProduct(eq.modules?.productName, eq.modules?.model), (eq) => eq.modules?.count || 0),
    [backlogProjects]
  );
  const inverterProducts = useMemo(
    () => buildProductSummary(backlogProjects, (eq) => formatProduct(eq.inverter?.productName, eq.inverter?.model), (eq) => eq.inverter?.count || 0),
    [backlogProjects]
  );
  const batteryProducts = useMemo(
    () => buildProductSummary(backlogProjects, (eq) => formatProduct(eq.battery?.productName, eq.battery?.model), (eq) => eq.battery?.count || 0),
    [backlogProjects]
  );
  const batteryExpProducts = useMemo(
    () => buildProductSummary(backlogProjects, (eq) => formatProduct(eq.battery?.expansionProductName, eq.battery?.expansionModel), (eq) => eq.battery?.expansionCount || 0),
    [backlogProjects]
  );
  const evProducts = useMemo(
    () => buildProductSummary(backlogProjects, () => "EV Charger", (eq) => eq.evCount || 0),
    [backlogProjects]
  );

  /* ---- Stage breakdown ---- */

  const stageBreakdown = useMemo(() => {
    const map = new Map<string, { count: number; modules: number; inverters: number; batteries: number; batteryExpansions: number; ev: number; value: number }>();
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
        existing.ev += eq?.evCount || 0;
        existing.value += p.amount || 0;
      } else {
        map.set(stage, {
          count: 1,
          modules: eq?.modules?.count || 0,
          inverters: eq?.inverter?.count || 0,
          batteries: eq?.battery?.count || 0,
          batteryExpansions: eq?.battery?.expansionCount || 0,
          ev: eq?.evCount || 0,
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

  /* ---- Stat card row helper ---- */
  const StatRow = ({ label, totals: t, accent }: { label: string; totals: ReturnType<typeof aggregateEquipment>; accent: string }) => (
    <div className="bg-surface/50 border border-t-border rounded-xl p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-2.5 h-2.5 rounded-full ${accent}`} />
        <h3 className="text-sm font-semibold text-foreground/90">{label}</h3>
        <span className="text-xs text-muted ml-auto">{t.projects} projects</span>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        {[
          { label: "Modules", value: t.modules, color: "text-blue-400" },
          { label: "Inverters", value: t.inverters, color: "text-purple-400" },
          { label: "Batteries", value: t.batteries, color: "text-emerald-400" },
          { label: "Bat. Exp.", value: t.batteryExpansions, color: "text-green-400" },
          { label: "EV Chargers", value: t.ev, color: "text-pink-400" },
          { label: "Value", value: formatMoney(t.value), color: "text-orange-400", raw: true },
        ].map((s) => (
          <div key={s.label} className="text-center">
            <div className={`text-lg font-bold ${s.color}`}>{s.raw ? s.value : (s.value as number).toLocaleString()}</div>
            <div className="text-xs text-muted">{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  );

  /* ---- Product breakdown card ---- */
  const ProductBreakdown = ({ title, items, color }: { title: string; items: ProductSummary[]; color: string }) => (
    <div className="bg-surface/50 border border-t-border rounded-xl p-5">
      <h3 className={`text-sm font-semibold ${color} mb-3`}>{title}</h3>
      {items.length === 0 ? (
        <p className="text-muted text-sm">None</p>
      ) : (
        <div className="space-y-2">
          {items.map((item, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span className="text-foreground/80 truncate mr-2">{item.productName}</span>
              <div className="flex items-center gap-3 shrink-0">
                <span className={`${color} font-medium`}>{item.totalCount.toLocaleString()}</span>
                <span className="text-muted/70 text-xs">{item.projects} jobs</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <DashboardShell
      title="Equipment Backlog"
      subtitle={`${backlogTotals.projects} backlog \u2022 ${inProgressTotals.projects} in progress \u2022 ${builtTotals.projects} built`}
      accentColor="cyan"
      lastUpdated={lastUpdated}
      exportData={{
        data: sortedProjects.map((p) => ({
          Project: p.name,
          "Project #": p.projectNumber,
          Location: p.pbLocation,
          Stage: p.stage,
          Status: classifyStage(p.stage) === "built" ? "Built" : classifyStage(p.stage) === "in_progress" ? "In Progress" : "Backlog",
          Modules: p.equipment?.modules?.count || 0,
          "Module Product": formatProduct(p.equipment?.modules?.productName, p.equipment?.modules?.model),
          Inverters: p.equipment?.inverter?.count || 0,
          "Inverter Product": formatProduct(p.equipment?.inverter?.productName, p.equipment?.inverter?.model),
          Batteries: p.equipment?.battery?.count || 0,
          "Battery Product": formatProduct(p.equipment?.battery?.productName, p.equipment?.battery?.model),
          "Battery Expansions": p.equipment?.battery?.expansionCount || 0,
          "Battery Exp. Product": formatProduct(p.equipment?.battery?.expansionProductName, p.equipment?.battery?.expansionModel),
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

      {view === "summary" ? (
        <>
          {/* Backlog / In Progress / Built stat rows */}
          <StatRow label="Backlog" totals={backlogTotals} accent="bg-cyan-400" />
          <StatRow label="In Progress (Construction)" totals={inProgressTotals} accent="bg-orange-400" />
          <StatRow label="Built (Inspection / PTO / Close Out)" totals={builtTotals} accent="bg-green-400" />

          {/* Stage Breakdown Table */}
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
                    <th className="pb-2 pr-4 text-right">EV</th>
                    <th className="pb-2 text-right">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {stageBreakdown.map(([stage, d]) => {
                    const cls = classifyStage(stage);
                    const rowBg = cls === "built" ? "bg-green-500/5" : cls === "in_progress" ? "bg-orange-500/5" : "";
                    return (
                      <tr key={stage} className={`border-b border-t-border/50 hover:bg-surface-2/30 ${rowBg}`}>
                        <td className="py-2 pr-4">
                          <div className="flex items-center gap-2">
                            <span
                              className="w-2 h-2 rounded-full"
                              style={{ backgroundColor: STAGE_COLORS[stage]?.hex || "#71717A" }}
                            />
                            <span>{stage}</span>
                            {cls === "built" && <span className="text-[10px] text-green-400 font-medium ml-1">BUILT</span>}
                            {cls === "in_progress" && <span className="text-[10px] text-orange-400 font-medium ml-1">IN PROGRESS</span>}
                          </div>
                        </td>
                        <td className="py-2 pr-4 text-right text-foreground/80">{d.count}</td>
                        <td className="py-2 pr-4 text-right text-blue-400">{d.modules.toLocaleString()}</td>
                        <td className="py-2 pr-4 text-right text-purple-400">{d.inverters.toLocaleString()}</td>
                        <td className="py-2 pr-4 text-right text-emerald-400">{d.batteries.toLocaleString()}</td>
                        <td className="py-2 pr-4 text-right text-green-400">{d.batteryExpansions.toLocaleString()}</td>
                        <td className="py-2 pr-4 text-right text-pink-400">{d.ev.toLocaleString()}</td>
                        <td className="py-2 text-right text-muted">{formatMoney(d.value)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Product Breakdowns (backlog only) */}
          <h2 className="text-lg font-semibold mb-3">Backlog Equipment by Product</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
            <ProductBreakdown title="Modules" items={moduleProducts} color="text-blue-400" />
            <ProductBreakdown title="Inverters" items={inverterProducts} color="text-purple-400" />
            <ProductBreakdown title="Batteries" items={batteryProducts} color="text-emerald-400" />
            <ProductBreakdown title="Battery Expansion" items={batteryExpProducts} color="text-green-400" />
            <ProductBreakdown title="EV Chargers" items={evProducts} color="text-pink-400" />
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
                  const cls = classifyStage(p.stage);
                  const rowBg = cls === "built" ? "bg-green-500/5" : cls === "in_progress" ? "bg-orange-500/5" : "";
                  return (
                    <tr key={p.id} className={`border-b border-t-border/50 hover:bg-surface-2/30 ${rowBg}`}>
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
                        {(eq?.modules?.productName || eq?.modules?.model) && (
                          <div className="text-xs text-muted/70 truncate max-w-[180px]">{formatProduct(eq?.modules?.productName, eq?.modules?.model)}</div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="text-purple-400">{eq?.inverter?.count || 0}</div>
                        {(eq?.inverter?.productName || eq?.inverter?.model) && (
                          <div className="text-xs text-muted/70 truncate max-w-[180px]">{formatProduct(eq?.inverter?.productName, eq?.inverter?.model)}</div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="text-emerald-400">{eq?.battery?.count || 0}</div>
                        {(eq?.battery?.productName || eq?.battery?.model) && (
                          <div className="text-xs text-muted/70 truncate max-w-[180px]">{formatProduct(eq?.battery?.productName, eq?.battery?.model)}</div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="text-green-400">{eq?.battery?.expansionCount || 0}</div>
                        {(eq?.battery?.expansionProductName || eq?.battery?.expansionModel) && (
                          <div className="text-xs text-muted/70 truncate max-w-[180px]">{formatProduct(eq?.battery?.expansionProductName, eq?.battery?.expansionModel)}</div>
                        )}
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

      {/* Footer */}
      <div className="mt-6 text-center text-sm text-muted">
        Total pipeline: <span className="text-orange-400 font-medium">{formatMoney(allTotals.value)}</span>
        {filterLocations.length > 0 && (
          <span className="ml-2">({filterLocations.join(", ")})</span>
        )}
      </div>
    </DashboardShell>
  );
}
