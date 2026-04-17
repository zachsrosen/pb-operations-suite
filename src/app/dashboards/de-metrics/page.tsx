"use client";

import { useMemo, useRef, useEffect, useState, useCallback } from "react";
import DashboardShell from "@/components/DashboardShell";
import { MetricCard } from "@/components/ui/MetricCard";
import { MonthlyBarChart, aggregateMonthly } from "@/components/ui/MonthlyBarChart";
import { MultiSelectFilter, FilterOption } from "@/components/ui/MultiSelectFilter";
import { formatMoney } from "@/lib/format";
import { RawProject } from "@/lib/types";
import { useProjectData } from "@/hooks/useProjectData";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { useDEMetricsFilters } from "@/stores/dashboard-filters";

// Active design pipeline statuses (pre-completion, pre-engineering)
const ACTIVE_DESIGN_STATUSES = [
  "Ready for Design",
  "In Progress",
  "Initial Review",            // label: "Ready For Review"
  "Ready for Review",          // label: "Final Review/Stamping"
  "Draft Complete",            // label: "Draft Complete — Waiting on Approvals"
  "DA Approved",
];

const IN_ENGINEERING_STATUSES = [
  "Submitted To Engineering",
];

const REVISION_STATUSES = [
  "Revision Needed - DA Rejected",
  "DA Revision In Progress",
  "DA Revision Completed",
  "Revision Needed - Rejected by AHJ",
  "Permit Revision In Progress",
  "Permit Revision Completed",
  "Revision Needed - Rejected by Utility",
  "Utility Revision In Progress",
  "Utility Revision Completed",
  "Revision Needed - Rejected",  // label: "Revision Needed — As-Built"
  "As-Built Revision In Progress",
  "As-Built Revision Completed",
];

// ---- DA Performance types ----
type DaReworkFlags = {
  hadRejection: boolean;
  hadSalesChanges: boolean;
  hadOpsChanges: boolean;
};

interface DAGroupMetrics {
  count: number;
  avgTurnaround: number | null;
  avgRevisions: number | null;
  firstTryRate: number | null;
  customerFirstTryRate: number | null;
  salesChangesRate: number | null;
  opsChangesRate: number | null;
  totalRevisions: number;
}

// ---- DA Performance color helpers ----
const DA_TURNAROUND_THRESHOLDS = [5, 10, 20] as const;
const DA_REVISION_THRESHOLDS = [0.5, 1, 2] as const;

function getDaColor(value: number | null | undefined, thresholds: readonly number[]): string {
  if (value === null || value === undefined) return "text-muted";
  if (value <= thresholds[0]) return "text-emerald-400";
  if (value <= thresholds[1]) return "text-yellow-400";
  if (value <= thresholds[2]) return "text-orange-400";
  return "text-red-400";
}

function getFirstTryColor(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return "text-muted";
  if (rate >= 80) return "text-emerald-400";
  if (rate >= 60) return "text-yellow-400";
  if (rate >= 40) return "text-orange-400";
  return "text-red-400";
}

// Inverse: higher % = worse. Used for "Needed Sales/Ops Changes %".
function getReworkColor(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return "text-muted";
  if (rate < 5) return "text-emerald-400";
  if (rate < 15) return "text-yellow-400";
  if (rate < 30) return "text-orange-400";
  return "text-red-400";
}

const REWORK_WINDOW_CAP_DAYS = 180;

// ---- Sort helpers ----
type SortKey = "designer" | "count" | "revenue";
type SortDir = "asc" | "desc";

function sortIndicator(active: boolean, dir: SortDir) {
  if (!active) return " \u21C5";
  return dir === "asc" ? " \u2191" : " \u2193";
}

export default function DEMetricsPage() {
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  const { data: projects, loading, lastUpdated } = useProjectData<RawProject[]>({
    params: { context: "executive" },
    transform: (raw: unknown) => (raw as { projects: RawProject[] }).projects,
  });
  const safeProjects = projects ?? [];

  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("de-metrics", { projectCount: safeProjects.length });
    }
  }, [loading, safeProjects.length, trackDashboardView]);

  // ---- Filter state ----
  const { filters: persistedFilters, setFilters: setPersisted, clearFilters } = useDEMetricsFilters();
  const [searchQuery, setSearchQuery] = useState("");

  // ---- Sort state for designer table ----
  const [sortKey, setSortKey] = useState<SortKey>("count");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }, [sortKey]);

  // ---- DA Performance flags (from property history) ----
  const [reworkFlags, setReworkFlags] = useState<Record<string, DaReworkFlags>>({});
  const [reworkLoading, setReworkLoading] = useState(false);

  // ---- DA Performance by Office (computed from designProjects, respects all filters) ----
  const computeGroupMetrics = useCallback(
    (projects: RawProject[], flags: Record<string, DaReworkFlags>, flagsEnabled: boolean): DAGroupMetrics => {
      const turnarounds = projects
        .filter((p) => p.designApprovalSentDate && p.designApprovalDate)
        .map((p) => {
          const sent = new Date(p.designApprovalSentDate! + "T12:00:00");
          const approved = new Date(p.designApprovalDate! + "T12:00:00");
          return Math.floor((approved.getTime() - sent.getTime()) / (1000 * 60 * 60 * 24));
        })
        .filter((d) => d >= 0);
      const revisions = projects
        .map((p) => p.daRevisionCounter)
        .filter((v): v is number => v !== null && v !== undefined && !isNaN(v) && v >= 0);
      const firstTryCount = revisions.filter((v) => v === 0).length;

      // Rework rates: only computed when flags are enabled AND loaded for every deal in the group.
      // A deal without a flag entry is treated as missing (not "false") to avoid understating rework.
      let customerFirstTryRate: number | null = null;
      let salesChangesRate: number | null = null;
      let opsChangesRate: number | null = null;
      if (flagsEnabled && projects.length > 0) {
        const withFlags = projects.filter((p) => p.id && flags[p.id]);
        if (withFlags.length > 0) {
          const rejected = withFlags.filter((p) => flags[p.id!].hadRejection).length;
          const sales = withFlags.filter((p) => flags[p.id!].hadSalesChanges).length;
          const ops = withFlags.filter((p) => flags[p.id!].hadOpsChanges).length;
          const denom = withFlags.length;
          customerFirstTryRate = Math.round(((denom - rejected) / denom) * 1000) / 10;
          salesChangesRate = Math.round((sales / denom) * 1000) / 10;
          opsChangesRate = Math.round((ops / denom) * 1000) / 10;
        }
      }

      return {
        count: projects.length,
        avgTurnaround: turnarounds.length > 0
          ? Math.round((turnarounds.reduce((s, v) => s + v, 0) / turnarounds.length) * 10) / 10
          : null,
        avgRevisions: revisions.length > 0
          ? Math.round((revisions.reduce((s, v) => s + v, 0) / revisions.length) * 10) / 10
          : null,
        firstTryRate: revisions.length > 0
          ? Math.round((firstTryCount / revisions.length) * 1000) / 10
          : null,
        customerFirstTryRate,
        salesChangesRate,
        opsChangesRate,
        totalRevisions: revisions.reduce((s, v) => s + v, 0),
      };
    },
    []
  );

  const TIME_PRESETS = [30, 60, 90, 180, 365] as const;
  type TimePreset = (typeof TIME_PRESETS)[number];
  const [timePreset, setTimePreset] = useState<TimePreset | "custom">(30);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  // Helper: is date within the selected window?
  const isInWindow = useCallback((dateStr: string | undefined | null) => {
    if (!dateStr) return false;
    const d = new Date(dateStr + "T12:00:00");
    if (timePreset === "custom") {
      if (!customFrom && !customTo) return true;
      if (customFrom && d < new Date(customFrom + "T00:00:00")) return false;
      if (customTo && d > new Date(customTo + "T23:59:59")) return false;
      return true;
    }
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - timePreset);
    return d >= cutoff;
  }, [timePreset, customFrom, customTo]);

  const timeWindowLabel = useMemo(() => {
    if (timePreset === "custom") {
      if (customFrom && customTo) return `${customFrom} → ${customTo}`;
      if (customFrom) return `From ${customFrom}`;
      if (customTo) return `Until ${customTo}`;
      return "All time";
    }
    return `Last ${timePreset} days`;
  }, [timePreset, customFrom, customTo]);

  // Rework flags are only computed inside a capped window (property history is N+1).
  const reworkEnabled = useMemo(() => {
    if (timePreset === "custom") {
      if (!customFrom || !customTo) return false;
      const from = new Date(customFrom + "T00:00:00");
      const to = new Date(customTo + "T23:59:59");
      const spanDays = Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
      return spanDays <= REWORK_WINDOW_CAP_DAYS;
    }
    return timePreset <= REWORK_WINDOW_CAP_DAYS;
  }, [timePreset, customFrom, customTo]);

  // ---- Build filter option lists ----
  const locationOptions: FilterOption[] = useMemo(
    () =>
      [...new Set(safeProjects.map((p) => p.pbLocation || ""))]
        .filter(Boolean)
        .sort()
        .map((loc) => ({ value: loc, label: loc })),
    [safeProjects]
  );

  const ownerOptions: FilterOption[] = useMemo(
    () =>
      [...new Set(safeProjects.map((p) => p.designLead || "Unknown"))]
        .sort()
        .map((o) => ({ value: o, label: o })),
    [safeProjects]
  );

  const hasActiveFilters =
    persistedFilters.locations.length > 0 ||
    persistedFilters.owners.length > 0 ||
    searchQuery.length > 0;

  // Filter to projects with any design data (cohort filter — includes designApprovalSentDate)
  const designProjects = useMemo(
    () =>
      safeProjects.filter((p) => {
        // Cohort inclusion: must have at least one design-related attribute
        const inCohort =
          p.stage === "Design & Engineering" ||
          p.designStatus ||
          p.designCompletionDate ||
          p.designApprovalDate ||
          p.designApprovalSentDate;

        if (!inCohort) return false;

        // Apply persisted filters
        if (
          persistedFilters.locations.length > 0 &&
          !persistedFilters.locations.includes(p.pbLocation || "")
        )
          return false;
        if (
          persistedFilters.owners.length > 0 &&
          !persistedFilters.owners.includes(p.designLead || "Unknown")
        )
          return false;

        // Apply search
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          const haystack = [p.name, p.designLead, p.pbLocation, p.designStatus]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          if (!haystack.includes(q)) return false;
        }

        return true;
      }),
    [safeProjects, persistedFilters, searchQuery]
  );

  // Deals in the DA cohort for the current window (shared by table + flag fetch).
  const daProjectsInWindow = useMemo(
    () => designProjects.filter((p) => p.designApprovalDate && isInWindow(p.designApprovalDate)),
    [designProjects, isInWindow]
  );

  // Fetch rework flags for in-window deals when enabled.
  useEffect(() => {
    if (!reworkEnabled) {
      setReworkFlags({});
      setReworkLoading(false);
      return;
    }
    const dealsPayload = daProjectsInWindow
      .filter((p) => p.id !== undefined && p.id !== null)
      .map((p) => ({
        dealId: String(p.id),
        revisionCounter: p.daRevisionCounter ?? null,
        approvalDate: p.designApprovalDate ?? null,
      }));
    if (dealsPayload.length === 0) {
      setReworkFlags({});
      setReworkLoading(false);
      return;
    }
    const controller = new AbortController();
    setReworkLoading(true);
    fetch("/api/hubspot/da-rework-flags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deals: dealsPayload }),
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((json: { flags?: Record<string, DaReworkFlags> }) => {
        setReworkFlags(json.flags ?? {});
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        console.error("[de-metrics] rework flags fetch failed:", err);
        setReworkFlags({});
      })
      .finally(() => {
        setReworkLoading(false);
      });
    return () => controller.abort();
  }, [reworkEnabled, daProjectsInWindow]);

  // ---- DA Performance by Office (computed from designProjects — respects all page filters) ----
  const daByLocation = useMemo(() => {
    const groups: Record<string, RawProject[]> = {};
    for (const p of daProjectsInWindow) {
      const loc = p.pbLocation || "Unknown";
      if (loc === "Unknown") continue;
      if (!groups[loc]) groups[loc] = [];
      groups[loc].push(p);
    }
    const byLocation: Record<string, DAGroupMetrics> = {};
    for (const [loc, projects] of Object.entries(groups)) {
      byLocation[loc] = computeGroupMetrics(projects, reworkFlags, reworkEnabled);
    }
    return byLocation;
  }, [daProjectsInWindow, computeGroupMetrics, reworkFlags, reworkEnabled]);

  const daLocations = useMemo(
    () => Object.keys(daByLocation).sort(),
    [daByLocation]
  );

  const daTotals = useMemo(
    (): DAGroupMetrics => computeGroupMetrics(daProjectsInWindow, reworkFlags, reworkEnabled),
    [daProjectsInWindow, computeGroupMetrics, reworkFlags, reworkEnabled]
  );

  // ---- Approval Metrics (FIXED: use designApprovalSentDate for "Sent") ----
  const approvalMetrics = useMemo(() => {
    const sent = designProjects.filter((p) => p.designApprovalSentDate);
    const approved = designProjects.filter((p) => p.designApprovalDate);
    const pending = designProjects.filter(
      (p) => p.designApprovalSentDate && !p.designApprovalDate
    );

    return {
      sent: { count: sent.length, revenue: sent.reduce((s, p) => s + (p.amount || 0), 0) },
      approved: { count: approved.length, revenue: approved.reduce((s, p) => s + (p.amount || 0), 0) },
      pending: { count: pending.length, revenue: pending.reduce((s, p) => s + (p.amount || 0), 0) },
    };
  }, [designProjects]);

  // ---- Time-windowed performance metrics ----
  const windowedMetrics = useMemo(() => {
    // Approval volume (independent cohorts)
    const sentInWindow = designProjects.filter((p) =>
      isInWindow(p.designApprovalSentDate)
    );
    const approvedInWindow = designProjects.filter((p) =>
      isInWindow(p.designApprovalDate)
    );

    // Approval rate (same cohort: sent in window, of those how many approved)
    const sentAndApproved = sentInWindow.filter((p) => p.designApprovalDate);
    const approvalRate = sentInWindow.length > 0
      ? Math.round((sentAndApproved.length / sentInWindow.length) * 100)
      : 0;

    // Design turnaround: designStartDate → dateReturnedFromDesigners
    const designTurnarounds = designProjects
      .filter((p) => p.designStartDate && p.dateReturnedFromDesigners && isInWindow(p.dateReturnedFromDesigners))
      .map((p) => {
        const start = new Date(p.designStartDate! + "T12:00:00");
        const end = new Date(p.dateReturnedFromDesigners! + "T12:00:00");
        return Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      })
      .filter((d) => d >= 0);
    const avgDesignTurnaround = designTurnarounds.length > 0
      ? Math.round(designTurnarounds.reduce((a, b) => a + b, 0) / designTurnarounds.length)
      : 0;

    // DA turnaround: designApprovalSentDate → designApprovalDate
    const daTurnarounds = designProjects
      .filter((p) => p.designApprovalSentDate && p.designApprovalDate && isInWindow(p.designApprovalDate))
      .map((p) => {
        const start = new Date(p.designApprovalSentDate! + "T12:00:00");
        const end = new Date(p.designApprovalDate! + "T12:00:00");
        return Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      })
      .filter((d) => d >= 0);
    const avgDATurnaround = daTurnarounds.length > 0
      ? Math.round(daTurnarounds.reduce((a, b) => a + b, 0) / daTurnarounds.length)
      : 0;

    return {
      sentCount: sentInWindow.length,
      approvedCount: approvedInWindow.length,
      approvalRate,
      approvalRateN: sentAndApproved.length, // numerator: sent in window AND approved
      avgDesignTurnaround,
      designTurnaroundN: designTurnarounds.length,
      avgDATurnaround,
      daTurnaroundN: daTurnarounds.length,
    };
  }, [designProjects, isInWindow]);

  // ---- Design Status Metrics ----
  const designMetrics = useMemo(() => {
    const active = designProjects.filter((p) => p.designStatus && ACTIVE_DESIGN_STATUSES.includes(p.designStatus));
    const inEngineering = designProjects.filter((p) => p.designStatus && IN_ENGINEERING_STATUSES.includes(p.designStatus));
    const completed = designProjects.filter((p) => p.designCompletionDate);
    const inRevision = designProjects.filter((p) => p.designStatus && REVISION_STATUSES.includes(p.designStatus));

    return {
      active: { count: active.length, revenue: active.reduce((s, p) => s + (p.amount || 0), 0) },
      inEngineering: { count: inEngineering.length, revenue: inEngineering.reduce((s, p) => s + (p.amount || 0), 0) },
      completed: { count: completed.length, revenue: completed.reduce((s, p) => s + (p.amount || 0), 0) },
      inRevision: { count: inRevision.length, revenue: inRevision.reduce((s, p) => s + (p.amount || 0), 0) },
    };
  }, [designProjects]);

  // ---- Status breakdown for horizontal bars ----
  const statusBreakdown = useMemo(() => {
    const counts: Record<string, { count: number; revenue: number }> = {};
    designProjects.forEach((p) => {
      if (p.designStatus) {
        if (!counts[p.designStatus]) counts[p.designStatus] = { count: 0, revenue: 0 };
        counts[p.designStatus].count += 1;
        counts[p.designStatus].revenue += p.amount || 0;
      }
    });
    const maxCount = Math.max(1, ...Object.values(counts).map((c) => c.count));
    return Object.entries(counts)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 15)
      .map(([status, data]) => ({
        status,
        ...data,
        pct: (data.count / maxCount) * 100,
      }));
  }, [designProjects]);

  // ---- Monthly trends ----
  const completionTrend = useMemo(
    () => aggregateMonthly(
      designProjects
        .filter((p) => p.designCompletionDate)
        .map((p) => ({ date: p.designCompletionDate!, amount: p.amount || 0 })),
      12
    ),
    [designProjects]
  );

  const approvalTrend = useMemo(
    () => aggregateMonthly(
      designProjects
        .filter((p) => p.designApprovalDate)
        .map((p) => ({ date: p.designApprovalDate!, amount: p.amount || 0 })),
      12
    ),
    [designProjects]
  );

  // ---- Designer productivity (sorted) ----
  const designerStats = useMemo(() => {
    const byDesigner: Record<string, { count: number; revenue: number }> = {};
    designProjects.forEach((p) => {
      const designer = p.designLead || "Unknown";
      if (!byDesigner[designer]) byDesigner[designer] = { count: 0, revenue: 0 };
      byDesigner[designer].count += 1;
      byDesigner[designer].revenue += p.amount || 0;
    });
    const entries = Object.entries(byDesigner);

    entries.sort((a, b) => {
      const mul = sortDir === "asc" ? 1 : -1;
      if (sortKey === "designer") return mul * a[0].localeCompare(b[0]);
      if (sortKey === "count") return mul * (a[1].count - b[1].count);
      return mul * (a[1].revenue - b[1].revenue);
    });

    return entries.slice(0, 10);
  }, [designProjects, sortKey, sortDir]);

  // ---- DA Backlog (sent but not yet approved) ----
  const daBacklog = useMemo(() => {
    return designProjects
      .filter(p => p.designApprovalSentDate && !p.designApprovalDate)
      .map(p => {
        const sentDate = new Date(p.designApprovalSentDate! + "T12:00:00");
        const daysWaiting = Math.floor((Date.now() - sentDate.getTime()) / (1000 * 60 * 60 * 24));
        return { ...p, daysWaiting };
      })
      .sort((a, b) => b.daysWaiting - a.daysWaiting);
  }, [designProjects]);

  // ---- DA Submission Rate per Designer (Weekly) ----
  const daWeeklyByDesigner = useMemo(() => {
    const now = Date.now();
    const eightWeeksAgo = now - 56 * 24 * 60 * 60 * 1000;

    // Get all week start dates for headers
    const weekStarts: string[] = [];
    for (let i = 7; i >= 0; i--) {
      const d = new Date(now - i * 7 * 24 * 60 * 60 * 1000);
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      const label = `${monday.getMonth() + 1}/${monday.getDate()}`;
      if (!weekStarts.includes(label)) weekStarts.push(label);
    }

    const byDesigner: Record<string, Record<string, number>> = {};

    designProjects
      .filter(p => p.designApprovalSentDate && new Date(p.designApprovalSentDate + "T12:00:00").getTime() > eightWeeksAgo)
      .forEach(p => {
        const designer = p.designLead || "Unassigned";
        const d = new Date(p.designApprovalSentDate! + "T12:00:00");
        const monday = new Date(d);
        monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
        const week = `${monday.getMonth() + 1}/${monday.getDate()}`;
        if (!byDesigner[designer]) byDesigner[designer] = {};
        byDesigner[designer][week] = (byDesigner[designer][week] || 0) + 1;
      });

    return { byDesigner, weekStarts: weekStarts.slice(-8) };
  }, [designProjects]);

  // ---- Export ----
  const exportRows = useMemo(
    () => designProjects.map((p) => ({
      name: p.name,
      designLead: p.designLead || "",
      stage: p.stage,
      designStatus: p.designStatus || "",
      designCompletionDate: p.designCompletionDate || "",
      designApprovalSentDate: p.designApprovalSentDate || "",
      designApprovalDate: p.designApprovalDate || "",
      location: p.pbLocation || "",
      amount: p.amount || 0,
    })),
    [designProjects]
  );

  return (
    <DashboardShell
      title="D&E Metrics"
      accentColor="purple"
      lastUpdated={lastUpdated}
      exportData={{ data: exportRows, filename: "de-metrics.csv" }}
      fullWidth
    >
      {/* Filter Row */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by PROJ #, name..."
          className="px-3 py-2 bg-surface-2 border border-t-border rounded-lg text-sm max-w-xs focus:outline-none focus:border-muted focus:ring-1 focus:ring-muted"
        />
        <MultiSelectFilter
          label="Location"
          options={locationOptions}
          selected={persistedFilters.locations}
          onChange={(v) => setPersisted({ ...persistedFilters, locations: v })}
          accentColor="indigo"
        />
        <MultiSelectFilter
          label="Designer"
          options={ownerOptions}
          selected={persistedFilters.owners}
          onChange={(v) => setPersisted({ ...persistedFilters, owners: v })}
          accentColor="indigo"
        />
        {hasActiveFilters && (
          <button
            onClick={() => {
              clearFilters();
              setSearchQuery("");
            }}
            className="text-xs px-2 py-1 text-red-400 hover:text-red-300"
          >
            Clear All
          </button>
        )}
      </div>

      {/* Time-Windowed Performance */}
      <div className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 className="text-lg font-semibold text-foreground">Performance</h2>
          <div className="flex items-center gap-2">
            <div className="flex bg-surface-2 rounded-lg p-0.5 border border-t-border">
              {TIME_PRESETS.map((d) => (
                <button
                  key={d}
                  onClick={() => setTimePreset(d)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    timePreset === d
                      ? "bg-purple-600 text-white shadow-sm"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  {d >= 365 ? `${d / 365}y` : `${d}d`}
                </button>
              ))}
              <button
                onClick={() => setTimePreset("custom")}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  timePreset === "custom"
                    ? "bg-purple-600 text-white shadow-sm"
                    : "text-muted hover:text-foreground"
                }`}
              >
                Custom
              </button>
            </div>
            {timePreset === "custom" && (
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="px-2 py-1 text-xs bg-surface-2 border border-t-border rounded-md text-foreground focus:outline-none focus:border-purple-500"
                />
                <span className="text-xs text-muted">→</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="px-2 py-1 text-xs bg-surface-2 border border-t-border rounded-md text-foreground focus:outline-none focus:border-purple-500"
                />
              </div>
            )}
          </div>
        </div>

        {/* Approval stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4 stagger-grid">
          <MetricCard
            label="DA Sent"
            value={loading ? "\u2014" : String(windowedMetrics.sentCount)}
            sub={timeWindowLabel}
            border="border-l-4 border-l-blue-500"
          />
          <MetricCard
            label="DA Approved"
            value={loading ? "\u2014" : String(windowedMetrics.approvedCount)}
            sub={timeWindowLabel}
            border="border-l-4 border-l-emerald-500"
            valueColor="text-emerald-400"
          />
          <MetricCard
            label="Approval Rate"
            value={loading ? "\u2014" : `${windowedMetrics.approvalRate}%`}
            sub={`${windowedMetrics.approvalRateN} of ${windowedMetrics.sentCount} sent in window`}
            border="border-l-4 border-l-indigo-500"
          />
        </div>

        {/* Turnaround stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 stagger-grid">
          <MetricCard
            label="Avg Design Turnaround"
            value={loading ? "\u2014" : `${windowedMetrics.avgDesignTurnaround}d`}
            sub={`Start \u2192 Returned (n=${windowedMetrics.designTurnaroundN})`}
            border="border-l-4 border-l-purple-500"
          />
          <MetricCard
            label="Avg DA Turnaround"
            value={loading ? "\u2014" : `${windowedMetrics.avgDATurnaround}d`}
            sub={`Sent \u2192 Approved (n=${windowedMetrics.daTurnaroundN})`}
            border="border-l-4 border-l-cyan-500"
          />
        </div>
      </div>

      {/* Design Approvals Section */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-foreground mb-3">Design Approvals</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 stagger-grid">
          <MetricCard
            label="Sent for Approval"
            value={loading ? "\u2014" : String(approvalMetrics.sent.count)}
            sub={loading ? undefined : formatMoney(approvalMetrics.sent.revenue)}
            border="border-l-4 border-l-blue-500"
          />
          <MetricCard
            label="Approved"
            value={loading ? "\u2014" : String(approvalMetrics.approved.count)}
            sub={loading ? undefined : formatMoney(approvalMetrics.approved.revenue)}
            border="border-l-4 border-l-emerald-500"
            valueColor="text-emerald-400"
          />
          <MetricCard
            label="Pending Approval"
            value={loading ? "\u2014" : String(approvalMetrics.pending.count)}
            sub={loading ? undefined : formatMoney(approvalMetrics.pending.revenue)}
            border="border-l-4 border-l-yellow-500"
            valueColor={approvalMetrics.pending.count > 10 ? "text-yellow-400" : undefined}
          />
        </div>
      </div>

      {/* DA Performance by Office */}
      <div className="bg-surface border border-t-border rounded-xl overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-t-border">
          <h2 className="text-lg font-semibold text-foreground">DA Performance by Office</h2>
          <p className="text-sm text-muted mt-0.5">
            Turnaround, revisions, and first-try approval rate by location &middot; Uses the time window and filters above
          </p>
        </div>

        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-10 bg-skeleton rounded animate-pulse" />
            ))}
          </div>
        ) : daLocations.length === 0 ? (
          <div className="p-6 text-center text-muted text-sm">No DA performance data available for this time window</div>
        ) : (
          <>
            {/* Summary row */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 px-5 py-4 border-b border-t-border bg-surface-2/30">
              <div className="text-center">
                <p className="text-xs text-muted mb-0.5">Avg Turnaround</p>
                <p className={`text-xl font-mono font-bold ${getDaColor(daTotals.avgTurnaround, DA_TURNAROUND_THRESHOLDS)}`}>
                  {daTotals.avgTurnaround !== null ? daTotals.avgTurnaround.toFixed(1) : "--"}
                </p>
                <p className="text-xs text-muted">days</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted mb-0.5">DAs Approved</p>
                <p className="text-xl font-mono font-bold text-foreground">{daTotals.count}</p>
                <p className="text-xs text-muted">{timeWindowLabel}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted mb-0.5">Design First-Try</p>
                <p className={`text-xl font-mono font-bold ${getFirstTryColor(daTotals.firstTryRate)}`}>
                  {daTotals.firstTryRate !== null ? `${daTotals.firstTryRate}%` : "--"}
                </p>
                <p className="text-xs text-muted">0 revisions</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted mb-0.5">Customer Approval First-Try</p>
                <p className={`text-xl font-mono font-bold ${getFirstTryColor(daTotals.customerFirstTryRate)}`}>
                  {daTotals.customerFirstTryRate !== null
                    ? `${daTotals.customerFirstTryRate}%`
                    : reworkLoading
                    ? "…"
                    : "—"}
                </p>
                <p className="text-xs text-muted">never rejected</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted mb-0.5">Needed Sales Changes</p>
                <p className={`text-xl font-mono font-bold ${getReworkColor(daTotals.salesChangesRate)}`}>
                  {daTotals.salesChangesRate !== null
                    ? `${daTotals.salesChangesRate}%`
                    : reworkLoading
                    ? "…"
                    : "—"}
                </p>
                <p className="text-xs text-muted">sales rework</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted mb-0.5">Needed Ops Changes</p>
                <p className={`text-xl font-mono font-bold ${getReworkColor(daTotals.opsChangesRate)}`}>
                  {daTotals.opsChangesRate !== null
                    ? `${daTotals.opsChangesRate}%`
                    : reworkLoading
                    ? "…"
                    : "—"}
                </p>
                <p className="text-xs text-muted">ops rework</p>
              </div>
            </div>

            {!reworkEnabled && (
              <div className="px-5 py-2 text-xs text-muted border-b border-t-border bg-surface-2/20">
                Customer Approval First-Try, Sales Changes, and Ops Changes are only computed for windows ≤ {REWORK_WINDOW_CAP_DAYS} days.
              </div>
            )}

            {/* By-location table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-t-border bg-surface-2/50 text-left text-muted">
                    <th className="px-4 py-3 font-semibold">Location</th>
                    <th className="px-4 py-3 font-semibold text-center">DAs</th>
                    <th className="px-4 py-3 font-semibold text-center">Avg Turnaround</th>
                    <th className="px-4 py-3 font-semibold text-center">Avg Revisions</th>
                    <th className="px-4 py-3 font-semibold text-center">Design First-Try %</th>
                    <th className="px-4 py-3 font-semibold text-center">Customer Approval First-Try %</th>
                    <th className="px-4 py-3 font-semibold text-center">Needed Sales Changes %</th>
                    <th className="px-4 py-3 font-semibold text-center">Needed Ops Changes %</th>
                    <th className="px-4 py-3 font-semibold text-center">Total Revisions</th>
                  </tr>
                </thead>
                <tbody>
                  {daLocations.map((loc, i) => {
                    const m = daByLocation[loc];
                    const pctCell = (v: number | null) => (v !== null ? `${v}%` : reworkLoading ? "…" : "—");
                    return (
                      <tr key={loc} className={`border-b border-t-border/50 ${i % 2 === 0 ? "" : "bg-surface-2/20"}`}>
                        <td className="px-4 py-3 font-medium text-foreground">{loc}</td>
                        <td className="px-4 py-3 text-center text-foreground">{m.count}</td>
                        <td className={`px-4 py-3 text-center font-mono ${getDaColor(m.avgTurnaround, DA_TURNAROUND_THRESHOLDS)}`}>
                          {m.avgTurnaround !== null ? m.avgTurnaround.toFixed(1) : "--"}
                        </td>
                        <td className={`px-4 py-3 text-center font-mono ${getDaColor(m.avgRevisions, DA_REVISION_THRESHOLDS)}`}>
                          {m.avgRevisions !== null ? m.avgRevisions.toFixed(1) : "--"}
                        </td>
                        <td className={`px-4 py-3 text-center font-mono ${getFirstTryColor(m.firstTryRate)}`}>
                          {m.firstTryRate !== null ? `${m.firstTryRate}%` : "--"}
                        </td>
                        <td className={`px-4 py-3 text-center font-mono ${getFirstTryColor(m.customerFirstTryRate)}`}>
                          {pctCell(m.customerFirstTryRate)}
                        </td>
                        <td className={`px-4 py-3 text-center font-mono ${getReworkColor(m.salesChangesRate)}`}>
                          {pctCell(m.salesChangesRate)}
                        </td>
                        <td className={`px-4 py-3 text-center font-mono ${getReworkColor(m.opsChangesRate)}`}>
                          {pctCell(m.opsChangesRate)}
                        </td>
                        <td className="px-4 py-3 text-center text-muted">{m.totalRevisions}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Designs Section */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-foreground mb-3">Design Pipeline</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger-grid">
          <MetricCard
            label="Active Design Pipeline"
            value={loading ? "\u2014" : String(designMetrics.active.count)}
            sub={loading ? undefined : formatMoney(designMetrics.active.revenue)}
            border="border-l-4 border-l-slate-500"
          />
          <MetricCard
            label="In Engineering"
            value={loading ? "\u2014" : String(designMetrics.inEngineering.count)}
            sub={loading ? undefined : formatMoney(designMetrics.inEngineering.revenue)}
            border="border-l-4 border-l-cyan-500"
          />
          <MetricCard
            label="Design Complete"
            value={loading ? "\u2014" : String(designMetrics.completed.count)}
            sub={loading ? undefined : formatMoney(designMetrics.completed.revenue)}
            border="border-l-4 border-l-emerald-500"
            valueColor="text-emerald-400"
          />
          <MetricCard
            label="In Revision"
            value={loading ? "\u2014" : String(designMetrics.inRevision.count)}
            sub={loading ? undefined : formatMoney(designMetrics.inRevision.revenue)}
            border="border-l-4 border-l-orange-500"
            valueColor={designMetrics.inRevision.count > 5 ? "text-orange-400" : undefined}
          />
        </div>
      </div>

      {/* Monthly Trends */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <MonthlyBarChart
          title="Design Completions (12 months)"
          data={completionTrend}
          months={12}
          accentColor="purple"
          primaryLabel="completed"
        />
        <MonthlyBarChart
          title="Design Approvals (12 months)"
          data={approvalTrend}
          months={12}
          accentColor="emerald"
          primaryLabel="approved"
        />
      </div>

      {/* Deal Counts by Design Status */}
      <div className="bg-surface border border-t-border rounded-xl p-6 shadow-card mb-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Projects by Design Status</h2>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-8 bg-skeleton rounded animate-pulse" />
            ))}
          </div>
        ) : statusBreakdown.length === 0 ? (
          <p className="text-sm text-muted italic">No design status data available.</p>
        ) : (
          <div className="space-y-2">
            {statusBreakdown.map((s) => (
              <div key={s.status} className="flex items-center gap-3">
                <div className="w-52 text-sm text-muted truncate" title={s.status}>{s.status}</div>
                <div className="flex-1 h-6 bg-surface-2 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-purple-500 rounded-full transition-all duration-500 flex items-center justify-end pr-2"
                    style={{ width: `${Math.max(s.pct, s.count > 0 ? 6 : 0)}%` }}
                  >
                    {s.count > 0 && (
                      <span className="text-xs font-semibold text-white">{s.count}</span>
                    )}
                  </div>
                </div>
                <div className="w-24 text-right text-xs text-muted">{formatMoney(s.revenue)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Designer / Lead Productivity */}
      <div className="bg-surface border border-t-border rounded-xl p-6 shadow-card mb-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Projects by Design Lead</h2>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-8 bg-skeleton rounded animate-pulse" />
            ))}
          </div>
        ) : designerStats.length === 0 ? (
          <p className="text-sm text-muted italic">No designer data available.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-t-border text-left text-muted">
                  <th
                    className="pb-2 pr-4 cursor-pointer hover:text-foreground"
                    onClick={() => handleSort("designer")}
                  >
                    Design Lead{sortIndicator(sortKey === "designer", sortDir)}
                  </th>
                  <th
                    className="pb-2 pr-4 text-right cursor-pointer hover:text-foreground"
                    onClick={() => handleSort("count")}
                  >
                    Projects{sortIndicator(sortKey === "count", sortDir)}
                  </th>
                  <th
                    className="pb-2 text-right cursor-pointer hover:text-foreground"
                    onClick={() => handleSort("revenue")}
                  >
                    Revenue{sortIndicator(sortKey === "revenue", sortDir)}
                  </th>
                </tr>
              </thead>
              <tbody>
                {designerStats.map(([designer, data]) => (
                  <tr key={designer} className="border-b border-t-border/50">
                    <td className="py-2 pr-4 text-foreground">{designer}</td>
                    <td className="py-2 pr-4 text-right font-semibold text-foreground">{data.count}</td>
                    <td className="py-2 text-right text-muted">{formatMoney(data.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* DA Backlog — Awaiting Approval */}
      <div className="bg-surface border border-t-border rounded-xl p-6 shadow-card mb-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          DA Backlog — Awaiting Approval ({daBacklog.length})
        </h2>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-8 bg-skeleton rounded animate-pulse" />
            ))}
          </div>
        ) : daBacklog.length === 0 ? (
          <p className="text-sm text-muted italic">No projects awaiting DA approval</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-t-border text-left text-muted">
                  <th className="pb-2 pr-4">Project</th>
                  <th className="pb-2 pr-4">Designer</th>
                  <th className="pb-2 pr-4 text-right">Days Waiting</th>
                  <th className="pb-2">Location</th>
                </tr>
              </thead>
              <tbody>
                {daBacklog.map((p) => {
                  const isRed = p.daysWaiting > 14;
                  const isOrange = !isRed && p.daysWaiting > 7;
                  return (
                    <tr key={p.id ?? p.name} className="border-b border-t-border/50">
                      <td className="py-2 pr-4 text-foreground">{p.name}</td>
                      <td className="py-2 pr-4 text-muted">{p.designLead || "—"}</td>
                      <td className="py-2 pr-4 text-right">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${
                            isRed
                              ? "text-red-400 bg-red-500/10"
                              : isOrange
                              ? "text-orange-400 bg-orange-500/10"
                              : "text-foreground"
                          }`}
                        >
                          {p.daysWaiting}d
                        </span>
                      </td>
                      <td className="py-2 text-muted">{p.pbLocation || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* DA Submission Rate by Designer (Last 8 Weeks) */}
      <div className="bg-surface border border-t-border rounded-xl p-6 shadow-card mb-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          DA Submission Rate by Designer (Last 8 Weeks)
        </h2>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-8 bg-skeleton rounded animate-pulse" />
            ))}
          </div>
        ) : Object.keys(daWeeklyByDesigner.byDesigner).length === 0 ? (
          <p className="text-sm text-muted italic">No DA submissions in the last 8 weeks.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-t-border text-left text-muted">
                  <th className="pb-2 pr-4">Designer</th>
                  {daWeeklyByDesigner.weekStarts.map((w) => (
                    <th key={w} className="pb-2 px-2 text-right whitespace-nowrap">{w}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(daWeeklyByDesigner.byDesigner).map(([designer, weeks]) => (
                  <tr key={designer} className="border-b border-t-border/50">
                    <td className="py-2 pr-4 text-foreground">{designer}</td>
                    {daWeeklyByDesigner.weekStarts.map((w) => (
                      <td key={w} className="py-2 px-2 text-right text-muted">
                        {weeks[w] ? <span className="font-semibold text-foreground">{weeks[w]}</span> : "—"}
                      </td>
                    ))}
                  </tr>
                ))}
                {/* Totals row */}
                <tr className="border-t-2 border-t-border font-semibold">
                  <td className="py-2 pr-4 text-foreground">Total</td>
                  {daWeeklyByDesigner.weekStarts.map((w) => {
                    const total = Object.values(daWeeklyByDesigner.byDesigner).reduce(
                      (sum, weeks) => sum + (weeks[w] || 0),
                      0
                    );
                    return (
                      <td key={w} className="py-2 px-2 text-right text-foreground">
                        {total || "—"}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
