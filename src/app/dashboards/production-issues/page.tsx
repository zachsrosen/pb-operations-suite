"use client";

import { useEffect, useMemo, useRef } from "react";
import DashboardShell from "@/components/DashboardShell";
import { MiniStat } from "@/components/ui/MetricCard";
import { MultiSelectFilter, FilterOption } from "@/components/ui/MultiSelectFilter";
import { RawProject } from "@/lib/types";
import { useProjectData } from "@/hooks/useProjectData";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { useProductionIssuesFilters } from "@/stores/dashboard-filters";
import { analyzeClipping } from "@/lib/clipping";
import { bucketStage } from "@/lib/production-issues-aggregations";

const RISK_COLORS: Record<string, string> = {
  high: "bg-red-500/20 text-red-400 border-red-500/30",
  moderate: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  low: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  none: "bg-green-500/20 text-green-400 border-green-500/30",
  unknown: "bg-zinc-500/20 text-muted border-zinc-500/30",
};

function monthsBetween(iso: string | undefined, now: Date): number | null {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  const ms = now.getTime() - then.getTime();
  if (ms < 0) return 0;
  return Math.floor(ms / (1000 * 60 * 60 * 24 * 30));
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function riskOf(project: RawProject): keyof typeof RISK_COLORS {
  const a = analyzeClipping({
    id: String(project.id),
    name: project.name,
    url: project.url,
    stage: project.stage,
    equipment: project.equipment as Record<string, unknown>,
  });
  return a ? a.riskLevel : "unknown";
}

function formatCloseDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function equipmentLabel(eq?: { brand?: string; model?: string }): string {
  if (!eq || (!eq.brand && !eq.model)) return "—";
  return `${eq.brand ?? ""} ${eq.model ?? ""}`.trim();
}

export default function ProductionIssuesPage() {
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  const { data: projects, loading, lastUpdated } = useProjectData<RawProject[]>({
    params: { context: "executive" },
    transform: (raw: unknown) => (raw as { projects: RawProject[] }).projects,
  });
  const safeProjects = projects ?? [];

  const { filters, setFilters, clearFilters } = useProductionIssuesFilters();

  // Flagged subset — canonical source for every calc on this page.
  const flagged = useMemo(
    () => safeProjects.filter((p) => p.systemPerformanceReview === true),
    [safeProjects]
  );

  // Precompute per-row metadata once — used by filters, breakdowns, table.
  const flaggedWithMeta = useMemo(
    () =>
      flagged.map((p) => ({
        project: p,
        risk: riskOf(p),
        bucket: bucketStage(p.stage),
      })),
    [flagged]
  );

  const filteredFlagged = useMemo(() => {
    return flaggedWithMeta.filter(({ project, risk, bucket }) => {
      if (filters.locations.length && !filters.locations.includes(project.pbLocation ?? ""))
        return false;
      if (filters.stages.length && !filters.stages.includes(bucket)) return false;
      if (filters.dealOwners.length && !filters.dealOwners.includes(project.dealOwner ?? "Unassigned"))
        return false;
      if (filters.clippingRisks.length && !filters.clippingRisks.includes(risk)) return false;
      return true;
    });
  }, [flaggedWithMeta, filters]);

  const hasActiveFilters =
    filters.locations.length > 0 ||
    filters.stages.length > 0 ||
    filters.dealOwners.length > 0 ||
    filters.clippingRisks.length > 0;

  // Filter option lists — derived from full flagged set so options stay stable as filters narrow results.
  const locationOptions: FilterOption[] = useMemo(
    () =>
      Array.from(new Set(flagged.map((p) => p.pbLocation || "")))
        .filter(Boolean)
        .sort()
        .map((v) => ({ value: v, label: v })),
    [flagged]
  );
  const stageOptions: FilterOption[] = useMemo(
    () => [
      { value: "pto", label: "PTO'd" },
      { value: "active", label: "Active (pre-PTO)" },
      { value: "service", label: "Service" },
      { value: "other", label: "Other" },
    ],
    []
  );
  const ownerOptions: FilterOption[] = useMemo(
    () =>
      Array.from(new Set(flagged.map((p) => p.dealOwner || "Unassigned")))
        .sort()
        .map((v) => ({ value: v, label: v })),
    [flagged]
  );
  const riskOptions: FilterOption[] = useMemo(
    () => [
      { value: "high", label: "High clipping risk" },
      { value: "moderate", label: "Moderate" },
      { value: "low", label: "Low" },
      { value: "none", label: "None" },
      { value: "unknown", label: "Unknown (no equipment data)" },
    ],
    []
  );

  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("production-issues", { projectCount: flagged.length });
    }
  }, [loading, flagged.length, trackDashboardView]);

  // Hero computations
  const now = new Date();
  const totalFlagged = filteredFlagged.length;

  const totalPtod = useMemo(() => {
    // Denominator is always full dataset — see spec.
    return safeProjects.filter((p) => {
      const s = (p.stage || "").toLowerCase();
      return (
        s.includes("pto") ||
        s.includes("permission to operate") ||
        s.includes("operating") ||
        s.includes("complete")
      );
    }).length;
  }, [safeProjects]);

  const pctOfPtod = totalPtod > 0 ? Math.round((totalFlagged / totalPtod) * 100) : null;

  const monthsSinceClose = useMemo(
    () =>
      filteredFlagged
        .map(({ project }) => monthsBetween(project.closeDate, now))
        .filter((n): n is number => n !== null),
    [filteredFlagged, now]
  );

  const medianMonths = median(monthsSinceClose);

  const oldest = useMemo(() => {
    let bestMonths = -1;
    let bestProject: RawProject | null = null;
    for (const { project } of filteredFlagged) {
      const m = monthsBetween(project.closeDate, now);
      if (m !== null && m > bestMonths) {
        bestMonths = m;
        bestProject = project;
      }
    }
    return bestProject ? { project: bestProject, months: bestMonths } : null;
  }, [filteredFlagged, now]);

  const exportRows = useMemo(
    () =>
      filteredFlagged.map(({ project, risk, bucket }) => ({
        project: project.name,
        location: project.pbLocation ?? "",
        stage: project.stage,
        bucket,
        dealOwner: project.dealOwner ?? "Unassigned",
        inverter: equipmentLabel(project.equipment?.inverter),
        module: equipmentLabel(project.equipment?.modules),
        battery:
          project.equipment?.battery?.count === 0
            ? "No battery"
            : equipmentLabel(project.equipment?.battery),
        clippingRisk: risk,
        closeDate: project.closeDate ?? "",
      })),
    [filteredFlagged]
  );

  return (
    <DashboardShell
      title="Production Issues"
      accentColor="red"
      lastUpdated={lastUpdated}
      exportData={{ data: exportRows, filename: "production-issues.csv" }}
    >
      {/* Hero strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <MiniStat label="Total flagged" value={loading ? null : totalFlagged} />
        <MiniStat
          label="% of PTO'd fleet"
          value={loading ? null : pctOfPtod !== null ? `${pctOfPtod}%` : "—"}
        />
        <MiniStat
          label="Median months since close"
          value={loading ? null : medianMonths !== null ? medianMonths : "—"}
        />
        <MiniStat
          label="Oldest flag"
          value={loading ? null : oldest ? `${oldest.months} mo` : "—"}
          subtitle={oldest ? oldest.project.name : undefined}
        />
      </div>

      {/* Filter bar */}
      {!loading && flagged.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <MultiSelectFilter
            label="Location"
            options={locationOptions}
            selected={filters.locations}
            onChange={(v) => setFilters({ ...filters, locations: v })}
          />
          <MultiSelectFilter
            label="Stage"
            options={stageOptions}
            selected={filters.stages}
            onChange={(v) => setFilters({ ...filters, stages: v })}
          />
          <MultiSelectFilter
            label="Deal owner"
            options={ownerOptions}
            selected={filters.dealOwners}
            onChange={(v) => setFilters({ ...filters, dealOwners: v })}
          />
          <MultiSelectFilter
            label="Clipping risk"
            options={riskOptions}
            selected={filters.clippingRisks}
            onChange={(v) => setFilters({ ...filters, clippingRisks: v })}
          />
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="text-xs text-muted hover:text-foreground underline px-2"
            >
              Clear filters
            </button>
          )}
          <div className="ml-auto text-xs text-muted">
            Showing {filteredFlagged.length} of {flagged.length} flagged
          </div>
        </div>
      )}

      {/* Empty states */}
      {!loading && flagged.length === 0 && (
        <div className="rounded-xl border border-t-border bg-surface p-12 text-center">
          <div className="text-4xl mb-3">🎉</div>
          <div className="text-lg font-medium text-foreground mb-2">
            No projects are currently flagged for production review
          </div>
          <div className="text-sm text-muted">
            Projects are flagged from the Clipping Analytics page.
          </div>
        </div>
      )}
      {!loading && flagged.length > 0 && filteredFlagged.length === 0 && (
        <div className="rounded-xl border border-t-border bg-surface p-12 text-center">
          <div className="text-lg font-medium text-foreground mb-2">
            No flagged projects match the current filters
          </div>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="mt-3 text-sm text-orange-500 hover:text-orange-400 underline"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Flagged projects table */}
      {!loading && filteredFlagged.length > 0 && (
        <div className="rounded-xl border border-t-border bg-surface overflow-x-auto mb-6">
          <div className="px-4 py-2 text-xs text-muted border-b border-t-border">
            Flag is set from the Clipping Analytics page.
          </div>
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-muted">
              <tr>
                <th className="text-left p-3">Project</th>
                <th className="text-left p-3">Location</th>
                <th className="text-left p-3">Stage</th>
                <th className="text-left p-3">Deal owner</th>
                <th className="text-left p-3">Inverter</th>
                <th className="text-left p-3">Module</th>
                <th className="text-left p-3">Battery</th>
                <th className="text-left p-3">Clipping risk</th>
                <th className="text-left p-3">Close date</th>
              </tr>
            </thead>
            <tbody>
              {filteredFlagged.map(({ project, risk }) => (
                <tr
                  key={String(project.id)}
                  className="border-t border-t-border hover:bg-surface-2"
                >
                  <td className="p-3">
                    {project.url ? (
                      <a
                        href={project.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-orange-500 hover:text-orange-400 underline"
                      >
                        {project.name}
                      </a>
                    ) : (
                      project.name
                    )}
                  </td>
                  <td className="p-3">{project.pbLocation ?? "—"}</td>
                  <td className="p-3">{project.stage}</td>
                  <td className="p-3">{project.dealOwner ?? "Unassigned"}</td>
                  <td className="p-3">{equipmentLabel(project.equipment?.inverter)}</td>
                  <td className="p-3">{equipmentLabel(project.equipment?.modules)}</td>
                  <td className="p-3">
                    {project.equipment?.battery?.count === 0
                      ? "No battery"
                      : equipmentLabel(project.equipment?.battery)}
                  </td>
                  <td className="p-3">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-xs border ${RISK_COLORS[risk]}`}
                    >
                      {risk}
                    </span>
                  </td>
                  <td className="p-3">{formatCloseDate(project.closeDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* TODO(Task 7): breakdown cards */}
    </DashboardShell>
  );
}
