"use client";

import { useEffect, useMemo, useRef } from "react";
import DashboardShell from "@/components/DashboardShell";
import { MiniStat } from "@/components/ui/MetricCard";
import { RawProject } from "@/lib/types";
import { useProjectData } from "@/hooks/useProjectData";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { useProductionIssuesFilters } from "@/stores/dashboard-filters";

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

  // TODO(Task 6): narrow to filteredFlagged once filters are wired.
  const filteredFlagged = flagged;

  const hasActiveFilters =
    filters.locations.length > 0 ||
    filters.stages.length > 0 ||
    filters.dealOwners.length > 0 ||
    filters.clippingRisks.length > 0;

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
        .map((p) => monthsBetween(p.closeDate, now))
        .filter((n): n is number => n !== null),
    [filteredFlagged, now]
  );

  const medianMonths = median(monthsSinceClose);

  const oldest = useMemo(() => {
    let bestMonths = -1;
    let bestProject: RawProject | null = null;
    for (const p of filteredFlagged) {
      const m = monthsBetween(p.closeDate, now);
      if (m !== null && m > bestMonths) {
        bestMonths = m;
        bestProject = p;
      }
    }
    return bestProject ? { project: bestProject, months: bestMonths } : null;
  }, [filteredFlagged, now]);

  // Satisfy unused-var lint until Task 6 wires these.
  void setFilters;

  return (
    <DashboardShell title="Production Issues" accentColor="red" lastUpdated={lastUpdated}>
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

      {/* TODO(Task 6): filter bar + table */}
      {/* TODO(Task 7): breakdown cards */}
    </DashboardShell>
  );
}
