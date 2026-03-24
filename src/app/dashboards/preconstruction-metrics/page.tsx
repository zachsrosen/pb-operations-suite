"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import DashboardShell from "@/components/DashboardShell";
import { StatCard } from "@/components/ui/MetricCard";
import { MultiSelectFilter, FilterOption } from "@/components/ui/MultiSelectFilter";
import { MonthlyBarChart, aggregateMonthly } from "@/components/ui/MonthlyBarChart";
import { formatMoney } from "@/lib/format";
import { RawProject } from "@/lib/types";
import { useProjectData } from "@/hooks/useProjectData";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { usePreconstMetricsFilters } from "@/stores/dashboard-filters";

const TIME_PRESETS = [30, 60, 90, 180, 365] as const;
type TimePreset = (typeof TIME_PRESETS)[number];

export default function PreconstMetricsPage() {
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  const { data: projects, loading, error, lastUpdated, refetch } = useProjectData<RawProject[]>({
    params: { context: "executive" },
    transform: (raw: unknown) => (raw as { projects: RawProject[] }).projects,
  });
  const safeProjects = projects ?? [];

  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("preconstruction-metrics", { projectCount: safeProjects.length });
    }
  }, [loading, safeProjects.length, trackDashboardView]);

  // ---- Time window ----
  const [timePreset, setTimePreset] = useState<TimePreset | "custom">(90);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const isInWindow = useCallback(
    (dateStr: string | null | undefined): boolean => {
      if (!dateStr) return false;
      const d = new Date(dateStr + "T12:00:00");
      if (isNaN(d.getTime())) return false;

      if (timePreset === "custom") {
        if (!customFrom && !customTo) return true;
        const from = customFrom ? new Date(customFrom + "T00:00:00") : new Date(0);
        const to = customTo ? new Date(customTo + "T23:59:59") : new Date();
        return d >= from && d <= to;
      }

      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - timePreset);
      return d >= cutoff;
    },
    [timePreset, customFrom, customTo]
  );

  const timeWindowLabel = useMemo(() => {
    if (timePreset === "custom") {
      if (!customFrom && !customTo) return "All time";
      if (customFrom && customTo) return `${customFrom} → ${customTo}`;
      if (customFrom) return `From ${customFrom}`;
      return `Until ${customTo}`;
    }
    return timePreset === 365 ? "Last 1 year" : `Last ${timePreset} days`;
  }, [timePreset, customFrom, customTo]);

  // ---- Persisted filters ----
  const { filters: persistedFilters, setFilters: setPersisted, clearFilters } = usePreconstMetricsFilters();

  const hasActiveFilters =
    persistedFilters.locations.length > 0 ||
    persistedFilters.leads.length > 0;

  // ---- Build filter option lists ----
  const locationOptions: FilterOption[] = useMemo(() => {
    const locs = new Set<string>();
    safeProjects.forEach((p) => { if (p.pbLocation) locs.add(p.pbLocation); });
    return Array.from(locs).sort().map((loc) => ({ value: loc, label: loc }));
  }, [safeProjects]);

  const leadOptions: FilterOption[] = useMemo(() => {
    const names = new Set<string>();
    safeProjects.forEach((p) => {
      if (p.siteSurveyor) names.add(p.siteSurveyor);
      if (p.designLead) names.add(p.designLead);
      if (p.permitLead) names.add(p.permitLead);
      if (p.interconnectionsLead) names.add(p.interconnectionsLead);
    });
    return Array.from(names).sort().map((name) => ({ value: name, label: name }));
  }, [safeProjects]);

  // ---- Filtered projects ----
  const filteredProjects = useMemo(() => {
    let result = safeProjects;
    if (persistedFilters.locations.length > 0) {
      result = result.filter((p) => persistedFilters.locations.includes(p.pbLocation || ""));
    }
    if (persistedFilters.leads.length > 0) {
      result = result.filter((p) => {
        const projectLeads = [p.siteSurveyor, p.designLead, p.permitLead, p.interconnectionsLead];
        return projectLeads.some((lead) => lead && persistedFilters.leads.includes(lead));
      });
    }
    return result;
  }, [safeProjects, persistedFilters]);

  // ---- Metrics (windowed) ----
  const surveyMetrics = useMemo(() => ({
    scheduled: {
      count: filteredProjects.filter((p) => isInWindow(p.siteSurveyScheduleDate)).length,
      revenue: filteredProjects.filter((p) => isInWindow(p.siteSurveyScheduleDate)).reduce((s, p) => s + (p.amount || 0), 0),
    },
    completed: {
      count: filteredProjects.filter((p) => isInWindow(p.siteSurveyCompletionDate)).length,
      revenue: filteredProjects.filter((p) => isInWindow(p.siteSurveyCompletionDate)).reduce((s, p) => s + (p.amount || 0), 0),
    },
  }), [filteredProjects, isInWindow]);

  const daMetrics = useMemo(() => ({
    sent: {
      count: filteredProjects.filter((p) => isInWindow(p.designApprovalSentDate)).length,
      revenue: filteredProjects.filter((p) => isInWindow(p.designApprovalSentDate)).reduce((s, p) => s + (p.amount || 0), 0),
    },
    approved: {
      count: filteredProjects.filter((p) => isInWindow(p.designApprovalDate)).length,
      revenue: filteredProjects.filter((p) => isInWindow(p.designApprovalDate)).reduce((s, p) => s + (p.amount || 0), 0),
    },
  }), [filteredProjects, isInWindow]);

  const permitMetrics = useMemo(() => ({
    submitted: {
      count: filteredProjects.filter((p) => isInWindow(p.permitSubmitDate)).length,
      revenue: filteredProjects.filter((p) => isInWindow(p.permitSubmitDate)).reduce((s, p) => s + (p.amount || 0), 0),
    },
    issued: {
      count: filteredProjects.filter((p) => isInWindow(p.permitIssueDate)).length,
      revenue: filteredProjects.filter((p) => isInWindow(p.permitIssueDate)).reduce((s, p) => s + (p.amount || 0), 0),
    },
  }), [filteredProjects, isInWindow]);

  const icMetrics = useMemo(() => ({
    submitted: {
      count: filteredProjects.filter((p) => isInWindow(p.interconnectionSubmitDate)).length,
      revenue: filteredProjects.filter((p) => isInWindow(p.interconnectionSubmitDate)).reduce((s, p) => s + (p.amount || 0), 0),
    },
    approved: {
      count: filteredProjects.filter((p) => isInWindow(p.interconnectionApprovalDate)).length,
      revenue: filteredProjects.filter((p) => isInWindow(p.interconnectionApprovalDate)).reduce((s, p) => s + (p.amount || 0), 0),
    },
  }), [filteredProjects, isInWindow]);

  // ---- Monthly trends (12 months) ----
  const surveyScheduledTrend = useMemo(
    () => aggregateMonthly(
      filteredProjects.filter((p) => p.siteSurveyScheduleDate).map((p) => ({ date: p.siteSurveyScheduleDate!, amount: p.amount || 0 })),
      12
    ),
    [filteredProjects]
  );
  const surveyCompletedTrend = useMemo(
    () => aggregateMonthly(
      filteredProjects.filter((p) => p.siteSurveyCompletionDate).map((p) => ({ date: p.siteSurveyCompletionDate!, amount: p.amount || 0 })),
      12
    ),
    [filteredProjects]
  );

  const daSentTrend = useMemo(
    () => aggregateMonthly(
      filteredProjects.filter((p) => p.designApprovalSentDate).map((p) => ({ date: p.designApprovalSentDate!, amount: p.amount || 0 })),
      12
    ),
    [filteredProjects]
  );
  const daApprovedTrend = useMemo(
    () => aggregateMonthly(
      filteredProjects.filter((p) => p.designApprovalDate).map((p) => ({ date: p.designApprovalDate!, amount: p.amount || 0 })),
      12
    ),
    [filteredProjects]
  );

  const permitSubmitTrend = useMemo(
    () => aggregateMonthly(
      filteredProjects.filter((p) => p.permitSubmitDate).map((p) => ({ date: p.permitSubmitDate!, amount: p.amount || 0 })),
      12
    ),
    [filteredProjects]
  );
  const permitIssueTrend = useMemo(
    () => aggregateMonthly(
      filteredProjects.filter((p) => p.permitIssueDate).map((p) => ({ date: p.permitIssueDate!, amount: p.amount || 0 })),
      12
    ),
    [filteredProjects]
  );

  const icSubmitTrend = useMemo(
    () => aggregateMonthly(
      filteredProjects.filter((p) => p.interconnectionSubmitDate).map((p) => ({ date: p.interconnectionSubmitDate!, amount: p.amount || 0 })),
      12
    ),
    [filteredProjects]
  );
  const icApprovedTrend = useMemo(
    () => aggregateMonthly(
      filteredProjects.filter((p) => p.interconnectionApprovalDate).map((p) => ({ date: p.interconnectionApprovalDate!, amount: p.amount || 0 })),
      12
    ),
    [filteredProjects]
  );

  // ---- Export (respects filters, ignores time window) ----
  const exportRows = useMemo(
    () => filteredProjects
      .filter((p) =>
        p.siteSurveyScheduleDate || p.siteSurveyCompletionDate ||
        p.designApprovalSentDate || p.designApprovalDate ||
        p.permitSubmitDate || p.permitIssueDate ||
        p.interconnectionSubmitDate || p.interconnectionApprovalDate
      )
      .map((p) => ({
        name: p.name,
        stage: p.stage,
        pbLocation: p.pbLocation || "",
        amount: p.amount || 0,
        siteSurveyScheduleDate: p.siteSurveyScheduleDate || "",
        siteSurveyCompletionDate: p.siteSurveyCompletionDate || "",
        siteSurveyor: p.siteSurveyor || "",
        designApprovalSentDate: p.designApprovalSentDate || "",
        designApprovalDate: p.designApprovalDate || "",
        designLead: p.designLead || "",
        permitSubmitDate: p.permitSubmitDate || "",
        permitIssueDate: p.permitIssueDate || "",
        permitLead: p.permitLead || "Unknown",
        interconnectionSubmitDate: p.interconnectionSubmitDate || "",
        interconnectionApprovalDate: p.interconnectionApprovalDate || "",
        interconnectionsLead: p.interconnectionsLead || "Unknown",
      })),
    [filteredProjects]
  );

  if (error) {
    return (
      <DashboardShell title="Preconstruction Metrics" accentColor="blue">
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-center">
          <p className="text-red-400 font-medium">{error}</p>
          <button onClick={() => refetch()} className="mt-3 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 rounded-lg text-red-300 text-sm transition-colors">
            Retry
          </button>
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell
      title="Preconstruction Metrics"
      accentColor="blue"
      lastUpdated={lastUpdated}
      exportData={{ data: exportRows, filename: "preconstruction-metrics.csv" }}
      fullWidth
    >
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <MultiSelectFilter
          label="Location"
          options={locationOptions}
          selected={persistedFilters.locations}
          onChange={(v) => setPersisted({ ...persistedFilters, locations: v })}
          placeholder="All Locations"
          accentColor="blue"
        />
        <MultiSelectFilter
          label="Preconstruction Lead"
          options={leadOptions}
          selected={persistedFilters.leads}
          onChange={(v) => setPersisted({ ...persistedFilters, leads: v })}
          placeholder="All Leads"
          accentColor="blue"
        />
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="text-xs text-muted hover:text-foreground px-3 py-2 border border-t-border rounded-lg hover:border-muted transition-colors"
          >
            Clear All
          </button>
        )}
      </div>

      {/* Time Window Toggle */}
      <div className="flex items-center gap-2 flex-wrap mb-6">
        <span className="text-xs text-muted mr-1">Time window:</span>
        {TIME_PRESETS.map((d) => (
          <button
            key={d}
            onClick={() => setTimePreset(d)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              timePreset === d
                ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                : "bg-surface-2 text-muted hover:text-foreground border border-transparent"
            }`}
          >
            {d === 365 ? "1y" : `${d}d`}
          </button>
        ))}
        <button
          onClick={() => setTimePreset("custom")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            timePreset === "custom"
              ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
              : "bg-surface-2 text-muted hover:text-foreground border border-transparent"
          }`}
        >
          Custom
        </button>
        {timePreset === "custom" && (
          <>
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="px-2 py-1.5 rounded-lg text-xs bg-surface-2 text-foreground border border-t-border"
            />
            <span className="text-xs text-muted">→</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="px-2 py-1.5 rounded-lg text-xs bg-surface-2 text-foreground border border-t-border"
            />
          </>
        )}
        <span className="text-xs text-muted ml-auto">{timeWindowLabel}</span>
      </div>

      {/* Section 1: Site Survey */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-foreground mb-3">Site Survey</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 stagger-grid mb-4">
          <StatCard
            label="Surveys Scheduled"
            value={loading ? "—" : String(surveyMetrics.scheduled.count)}
            subtitle={loading ? undefined : formatMoney(surveyMetrics.scheduled.revenue)}
            color="blue"
          />
          <StatCard
            label="Surveys Completed"
            value={loading ? "—" : String(surveyMetrics.completed.count)}
            subtitle={loading ? undefined : formatMoney(surveyMetrics.completed.revenue)}
            color="emerald"
          />
        </div>
        <MonthlyBarChart
          title="Surveys (12 months)"
          data={surveyScheduledTrend}
          secondaryData={surveyCompletedTrend}
          primaryLabel="scheduled"
          secondaryLabel="completed"
          months={12}
          accentColor="blue"
        />
      </div>

      {/* Section 2: Design Approval */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-foreground mb-3">Design Approval</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 stagger-grid mb-4">
          <StatCard
            label="DAs Sent"
            value={loading ? "—" : String(daMetrics.sent.count)}
            subtitle={loading ? undefined : formatMoney(daMetrics.sent.revenue)}
            color="purple"
          />
          <StatCard
            label="DAs Approved"
            value={loading ? "—" : String(daMetrics.approved.count)}
            subtitle={loading ? undefined : formatMoney(daMetrics.approved.revenue)}
            color="emerald"
          />
        </div>
        <MonthlyBarChart
          title="Design Approvals (12 months)"
          data={daSentTrend}
          secondaryData={daApprovedTrend}
          primaryLabel="sent"
          secondaryLabel="approved"
          months={12}
          accentColor="purple"
        />
      </div>

      {/* Section 3: Permitting */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-foreground mb-3">Permitting</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 stagger-grid mb-4">
          <StatCard
            label="Permits Submitted"
            value={loading ? "—" : String(permitMetrics.submitted.count)}
            subtitle={loading ? undefined : formatMoney(permitMetrics.submitted.revenue)}
            color="cyan"
          />
          <StatCard
            label="Permits Issued"
            value={loading ? "—" : String(permitMetrics.issued.count)}
            subtitle={loading ? undefined : formatMoney(permitMetrics.issued.revenue)}
            color="emerald"
          />
        </div>
        <MonthlyBarChart
          title="Permits (12 months)"
          data={permitSubmitTrend}
          secondaryData={permitIssueTrend}
          primaryLabel="submitted"
          secondaryLabel="issued"
          months={12}
          accentColor="cyan"
        />
      </div>

      {/* Section 4: Interconnection */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-foreground mb-3">Interconnection</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 stagger-grid mb-4">
          <StatCard
            label="IC Submitted"
            value={loading ? "—" : String(icMetrics.submitted.count)}
            subtitle={loading ? undefined : formatMoney(icMetrics.submitted.revenue)}
            color="blue"
          />
          <StatCard
            label="IC Approved"
            value={loading ? "—" : String(icMetrics.approved.count)}
            subtitle={loading ? undefined : formatMoney(icMetrics.approved.revenue)}
            color="emerald"
          />
        </div>
        <MonthlyBarChart
          title="Interconnection (12 months)"
          data={icSubmitTrend}
          secondaryData={icApprovedTrend}
          primaryLabel="submitted"
          secondaryLabel="approved"
          months={12}
          accentColor="blue"
        />
      </div>
    </DashboardShell>
  );
}
