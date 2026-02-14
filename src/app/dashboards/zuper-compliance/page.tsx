"use client";

import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import DashboardShell from "@/components/DashboardShell";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import { useActivityTracking } from "@/hooks/useActivityTracking";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface JobEntry {
  jobUid: string;
  title: string;
  status: string;
  category: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  completedTime: string | null;
  daysToComplete: number | null;
  daysLate: number | null;
  onOurWayTime: string | null;
  onOurWayOnTime: boolean | null;
}

interface UserMetrics {
  userName: string;
  userUid: string;
  teamName: string;
  totalJobs: number;
  completedJobs: number;
  onTimeCompletions: number;
  lateCompletions: number;
  stuckJobs: number;
  neverStartedJobs: number;
  avgDaysToComplete: number;
  avgDaysLate: number;
  onTimePercent: number;
  onOurWayOnTime: number;
  onOurWayLate: number;
  onOurWayPercent: number;
  complianceScore: number;
  grade: string;
  byCategory: Record<string, number>;
  stuckJobsList: JobEntry[];
  lateJobsList: JobEntry[];
  neverStartedJobsList: JobEntry[];
  completedJobsList: JobEntry[];
}

interface ComplianceSummary {
  totalJobs: number;
  totalCompleted: number;
  overallOnTimePercent: number;
  totalStuck: number;
  totalNeverStarted: number;
  avgCompletionDays: number;
  avgDaysLate: number;
  overallOnOurWayPercent: number;
  userCount: number;
}

interface ComplianceData {
  users: UserMetrics[];
  summary: ComplianceSummary;
  filters: { teams: string[]; categories: string[] };
  dateRange: { from: string; to: string; days: number };
  lastUpdated: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const ZUPER_WEB_BASE = "https://us-west-1c.zuperpro.com";

type SortField =
  | "userName"
  | "teamName"
  | "totalJobs"
  | "onTimePercent"
  | "lateCompletions"
  | "stuckJobs"
  | "neverStartedJobs"
  | "avgDaysToComplete"
  | "avgDaysLate"
  | "onOurWayPercent"
  | "complianceScore";

const DATE_PRESETS = [7, 14, 30, 60, 90];

/* ------------------------------------------------------------------ */
/*  Zuper job link                                                     */
/* ------------------------------------------------------------------ */

function zuperJobUrl(jobUid: string) {
  return `${ZUPER_WEB_BASE}/jobs/${jobUid}/details`;
}

/* ------------------------------------------------------------------ */
/*  Job list table component (reused for stuck, late, never-started)   */
/* ------------------------------------------------------------------ */

function JobListTable({
  jobs,
  title,
  emptyMessage,
  showTiming,
}: {
  jobs: JobEntry[];
  title: string;
  emptyMessage: string;
  showTiming?: boolean;
}) {
  if (jobs.length === 0) {
    return (
      <div>
        <h4 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
          {title} (0)
        </h4>
        <p className="text-sm text-emerald-400">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div>
      <h4 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
        {title} ({jobs.length})
      </h4>
      <div className="bg-surface/50 border border-t-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted text-left border-b border-t-border">
              <th className="px-3 py-2">Job</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Sched End</th>
              {showTiming && <th className="px-3 py-2">Days Late</th>}
              {showTiming && <th className="px-3 py-2">OOW</th>}
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.jobUid} className="border-b border-t-border/30">
                <td className="px-3 py-1.5">
                  <a
                    href={zuperJobUrl(j.jobUid)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-red-400 hover:text-red-300 underline underline-offset-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {j.title || j.jobUid}
                  </a>
                </td>
                <td className="px-3 py-1.5 text-amber-400">{j.status}</td>
                <td className="px-3 py-1.5 text-muted">{j.category}</td>
                <td className="px-3 py-1.5 text-muted">
                  {j.scheduledEnd
                    ? new Date(j.scheduledEnd).toLocaleDateString()
                    : "\u2014"}
                </td>
                {showTiming && (
                  <td className="px-3 py-1.5">
                    {j.daysLate != null ? (
                      <span className="text-rose-400">{j.daysLate}d</span>
                    ) : (
                      <span className="text-foreground/50">\u2014</span>
                    )}
                  </td>
                )}
                {showTiming && (
                  <td className="px-3 py-1.5">
                    {j.onOurWayOnTime === true && (
                      <span className="text-green-400 text-xs">On time</span>
                    )}
                    {j.onOurWayOnTime === false && (
                      <span className="text-rose-400 text-xs">Late</span>
                    )}
                    {j.onOurWayOnTime == null && (
                      <span className="text-foreground/50">\u2014</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function ZuperCompliancePage() {
  useActivityTracking();

  const [data, setData] = useState<ComplianceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [showMethodology, setShowMethodology] = useState(false);

  // Date range
  const [days, setDays] = useState(30);

  // Filters
  const [filterTeams, setFilterTeams] = useState<string[]>([]);
  const [filterCategories, setFilterCategories] = useState<string[]>([]);

  // Sort
  const [sortField, setSortField] = useState<SortField>("complianceScore");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Expanded rows — track which tab is active per user
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<"stuck" | "late" | "neverStarted" | "completed" | "categories">("stuck");

  /* ---- Data fetching ---- */

  const fetchData = useCallback(async () => {
    try {
      const params = new URLSearchParams({ days: String(days) });
      if (filterTeams.length === 1) params.set("team", filterTeams[0]);
      if (filterCategories.length === 1) params.set("category", filterCategories[0]);

      const res = await fetch(`/api/zuper/compliance?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch compliance data");
      const json: ComplianceData = await res.json();
      setData(json);
      setLastUpdated(json.lastUpdated || null);
      setError(null);
    } catch (err) {
      console.error("Compliance fetch error:", err);
      setError("Failed to load compliance data. Please try refreshing.");
    } finally {
      setLoading(false);
    }
  }, [days, filterTeams, filterCategories]);

  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]);

  /* ---- Derived filter options ---- */

  const teamOptions = useMemo(
    () =>
      (data?.filters.teams || [])
        .filter(Boolean)
        .sort()
        .map((t) => ({ value: t, label: t })),
    [data?.filters.teams]
  );

  const categoryOptions = useMemo(
    () =>
      (data?.filters.categories || [])
        .filter(Boolean)
        .sort()
        .map((c) => ({ value: c, label: c })),
    [data?.filters.categories]
  );

  /* ---- Filtered users (client-side multi-select) ---- */

  const filteredUsers = useMemo(() => {
    if (!data) return [];
    return data.users.filter((u) => {
      if (filterTeams.length > 1 && !filterTeams.includes(u.teamName || ""))
        return false;
      if (filterCategories.length > 1) {
        const hasCategory = filterCategories.some(
          (cat) => (u.byCategory[cat] || 0) > 0
        );
        if (!hasCategory) return false;
      }
      return true;
    });
  }, [data, filterTeams, filterCategories]);

  /* ---- Sorted users ---- */

  const sortedUsers = useMemo(() => {
    const sorted = [...filteredUsers].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "userName":
          cmp = (a.userName || "").localeCompare(b.userName || "");
          break;
        case "teamName":
          cmp = (a.teamName || "").localeCompare(b.teamName || "");
          break;
        case "totalJobs":
          cmp = a.totalJobs - b.totalJobs;
          break;
        case "onTimePercent":
          cmp = a.onTimePercent - b.onTimePercent;
          break;
        case "lateCompletions":
          cmp = a.lateCompletions - b.lateCompletions;
          break;
        case "stuckJobs":
          cmp = a.stuckJobs - b.stuckJobs;
          break;
        case "neverStartedJobs":
          cmp = a.neverStartedJobs - b.neverStartedJobs;
          break;
        case "avgDaysToComplete":
          cmp = a.avgDaysToComplete - b.avgDaysToComplete;
          break;
        case "avgDaysLate":
          cmp = a.avgDaysLate - b.avgDaysLate;
          break;
        case "onOurWayPercent":
          cmp = a.onOurWayPercent - b.onOurWayPercent;
          break;
        case "complianceScore":
          cmp = a.complianceScore - b.complianceScore;
          break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
    return sorted;
  }, [filteredUsers, sortField, sortDir]);

  /* ---- Column sort handler ---- */

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => (
    <span className="ml-1 text-muted/70">
      {sortField === field ? (sortDir === "asc" ? "\u25B2" : "\u25BC") : "\u25BC"}
    </span>
  );

  /* ---- Styling helpers ---- */

  const gradeClasses = (grade: string) => {
    switch (grade) {
      case "A":
      case "B":
        return "bg-green-500/20 text-green-400";
      case "C":
        return "bg-yellow-500/20 text-yellow-400";
      case "D":
      case "F":
        return "bg-red-500/20 text-red-400";
      default:
        return "bg-surface-2 text-muted";
    }
  };

  const pctColor = (pct: number) => {
    if (pct >= 80) return "text-green-400";
    if (pct >= 60) return "text-yellow-400";
    return "text-red-400";
  };

  /* ---- Export data ---- */

  const exportRows = useMemo(() => {
    return sortedUsers.map((u) => ({
      User: u.userName,
      Team: u.teamName || "",
      "Total Jobs": u.totalJobs,
      Completed: u.completedJobs,
      "On-Time %": u.onTimePercent,
      Late: u.lateCompletions,
      Stuck: u.stuckJobs,
      "Never Started": u.neverStartedJobs,
      "Avg Days": u.avgDaysToComplete,
      "Avg Days Late": u.avgDaysLate,
      "OOW On-Time %": u.onOurWayPercent,
      Grade: u.grade,
      Score: u.complianceScore,
    }));
  }, [sortedUsers]);

  /* ---- Render: loading state ---- */

  if (loading) {
    return (
      <DashboardShell title="Zuper Compliance" accentColor="red">
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-400" />
        </div>
      </DashboardShell>
    );
  }

  /* ---- Render: error state ---- */

  if (error) {
    return (
      <DashboardShell title="Zuper Compliance" accentColor="red">
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <p className="text-red-400">{error}</p>
          <button
            onClick={() => {
              setLoading(true);
              setError(null);
              fetchData();
            }}
            className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-sm transition-colors"
          >
            Retry
          </button>
        </div>
      </DashboardShell>
    );
  }

  const summary = data?.summary;

  return (
    <DashboardShell
      title="Zuper Compliance"
      subtitle={`${summary?.userCount || 0} users \u2022 ${days}-day window`}
      accentColor="red"
      lastUpdated={lastUpdated}
      exportData={{
        data: exportRows,
        filename: "zuper-compliance",
      }}
    >
      {/* Methodology Toggle */}
      <div className="mb-6">
        <button
          onClick={() => setShowMethodology((v) => !v)}
          className="flex items-center gap-2 text-sm text-muted hover:text-foreground transition-colors"
        >
          <svg
            className={`w-4 h-4 transition-transform ${showMethodology ? "rotate-90" : ""}`}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
              clipRule="evenodd"
            />
          </svg>
          How is this calculated?
        </button>

        {showMethodology && (
          <div className="mt-3 bg-surface/50 border border-t-border rounded-xl p-5 text-sm text-foreground/80 space-y-3">
            <div>
              <h4 className="font-semibold text-foreground mb-1">Compliance Score (0–100)</h4>
              <p className="text-muted">
                <span className="text-foreground/90 font-medium">50%</span> On-Time Completion Rate +{" "}
                <span className="text-foreground/90 font-medium">30%</span> Non-Stuck Rate +{" "}
                <span className="text-foreground/90 font-medium">20%</span> Started Rate
              </p>
              <p className="text-muted mt-1">
                Grades: <span className="text-green-400">A</span> (90+) &bull;{" "}
                <span className="text-green-400">B</span> (75–89) &bull;{" "}
                <span className="text-yellow-400">C</span> (60–74) &bull;{" "}
                <span className="text-red-400">D</span> (45–59) &bull;{" "}
                <span className="text-red-400">F</span> (&lt;45)
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="space-y-2">
                <div>
                  <span className="font-medium text-foreground">On-Time %</span>
                  <span className="text-muted"> — % of completed jobs finished within 1 day of scheduled end.
                  Completed statuses: Completed, Construction Complete, Passed, Partial Pass, Failed.</span>
                </div>
                <div>
                  <span className="font-medium text-foreground">Stuck Jobs</span>
                  <span className="text-muted"> — Jobs currently in &quot;On Our Way&quot;, &quot;Started&quot;, or &quot;In Progress&quot; where scheduled end has passed. These should be completed or updated.</span>
                </div>
                <div>
                  <span className="font-medium text-foreground">Never Started</span>
                  <span className="text-muted"> — Jobs in &quot;New&quot;, &quot;Scheduled&quot;, &quot;Unassigned&quot;, &quot;Ready to Schedule/Build/Inspect&quot; with scheduled start in the past.</span>
                </div>
              </div>
              <div className="space-y-2">
                <div>
                  <span className="font-medium text-foreground">Avg Days</span>
                  <span className="text-muted"> — Average days from scheduled start to completion.</span>
                </div>
                <div>
                  <span className="font-medium text-foreground">Avg Days Late</span>
                  <span className="text-muted"> — Average days past scheduled end for late jobs only. If a job finishes 3 days after its scheduled end, that counts as 3 days late.</span>
                </div>
                <div>
                  <span className="font-medium text-foreground">OOW % (On Our Way)</span>
                  <span className="text-muted"> — % of completed jobs where &quot;On Our Way&quot; was triggered before or during the scheduled window. If it was set after the scheduled end, it counts as late — meaning they didn&apos;t use it in real-time and had to retroactively select it.</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Date Range Selector + Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex bg-surface-2 rounded-lg p-0.5">
          {DATE_PRESETS.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                days === d
                  ? "bg-red-600 text-white"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>

        <MultiSelectFilter
          label="Team"
          options={teamOptions}
          selected={filterTeams}
          onChange={setFilterTeams}
          placeholder="All Teams"
          accentColor="orange"
        />
        <MultiSelectFilter
          label="Category"
          options={categoryOptions}
          selected={filterCategories}
          onChange={setFilterCategories}
          placeholder="All Categories"
          accentColor="blue"
        />
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mb-8">
        {[
          {
            label: "Total Jobs",
            value: (summary?.totalJobs || 0).toLocaleString(),
            color: "text-red-400",
          },
          {
            label: "Completed",
            value: (summary?.totalCompleted || 0).toLocaleString(),
            color: "text-emerald-400",
          },
          {
            label: "On-Time %",
            value: `${summary?.overallOnTimePercent || 0}%`,
            color: "text-green-400",
          },
          {
            label: "Stuck Jobs",
            value: (summary?.totalStuck || 0).toLocaleString(),
            color: "text-amber-400",
          },
          {
            label: "Never Started",
            value: (summary?.totalNeverStarted || 0).toLocaleString(),
            color: "text-orange-400",
          },
          {
            label: "Avg Days",
            value: String(summary?.avgCompletionDays || 0),
            color: "text-blue-400",
          },
          {
            label: "Avg Days Late",
            value: String(summary?.avgDaysLate || 0),
            color: "text-rose-400",
          },
          {
            label: "OOW On-Time %",
            value: `${summary?.overallOnOurWayPercent || 0}%`,
            color: "text-cyan-400",
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-surface/50 border border-t-border rounded-lg p-3 text-center"
          >
            <div className={`text-xl font-bold ${stat.color}`} key={String(stat.value)}>
              {stat.value}
            </div>
            <div className="text-xs text-muted mt-0.5">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* User Scorecard Table */}
      <div className="bg-surface/50 border border-t-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted text-left border-b border-t-border bg-surface/80">
                <th className="px-4 py-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("userName")}>
                  User <SortIcon field="userName" />
                </th>
                <th className="px-4 py-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("teamName")}>
                  Team <SortIcon field="teamName" />
                </th>
                <th className="px-4 py-3 cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("totalJobs")}>
                  Total <SortIcon field="totalJobs" />
                </th>
                <th className="px-4 py-3 cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("onTimePercent")}>
                  On-Time % <SortIcon field="onTimePercent" />
                </th>
                <th className="px-4 py-3 cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("lateCompletions")}>
                  Late <SortIcon field="lateCompletions" />
                </th>
                <th className="px-4 py-3 cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("stuckJobs")}>
                  Stuck <SortIcon field="stuckJobs" />
                </th>
                <th className="px-4 py-3 cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("neverStartedJobs")}>
                  Not Started <SortIcon field="neverStartedJobs" />
                </th>
                <th className="px-4 py-3 cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("avgDaysToComplete")}>
                  Avg Days <SortIcon field="avgDaysToComplete" />
                </th>
                <th className="px-4 py-3 cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("avgDaysLate")}>
                  Avg Late <SortIcon field="avgDaysLate" />
                </th>
                <th className="px-4 py-3 cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("onOurWayPercent")} title="On Our Way set on time vs late">
                  OOW % <SortIcon field="onOurWayPercent" />
                </th>
                <th className="px-4 py-3 cursor-pointer hover:text-foreground text-center" onClick={() => handleSort("complianceScore")}>
                  Grade <SortIcon field="complianceScore" />
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedUsers.map((u) => {
                const isExpanded = expandedUser === u.userUid;

                return (
                  <Fragment key={u.userUid}>
                    <tr
                      className={`border-b border-t-border/50 hover:bg-surface-2/30 cursor-pointer transition-colors ${
                        isExpanded ? "bg-surface-2/20" : ""
                      }`}
                      onClick={() => {
                        setExpandedUser(isExpanded ? null : u.userUid);
                        if (!isExpanded) setDetailTab("stuck");
                      }}
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <svg
                            className={`w-3 h-3 text-muted/60 transition-transform shrink-0 ${
                              isExpanded ? "rotate-90" : ""
                            }`}
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                          <span className="font-medium text-foreground/90">{u.userName}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-muted">{u.teamName || "\u2014"}</td>
                      <td className="px-4 py-2.5 text-right text-foreground/80">{u.totalJobs}</td>
                      <td className={`px-4 py-2.5 text-right font-medium ${pctColor(u.onTimePercent)}`}>
                        {u.onTimePercent}%
                      </td>
                      <td className="px-4 py-2.5 text-right text-foreground/80">{u.lateCompletions}</td>
                      <td className="px-4 py-2.5 text-right">
                        <span className={u.stuckJobs > 0 ? "text-amber-400 font-medium" : "text-foreground/80"}>
                          {u.stuckJobs}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className={u.neverStartedJobs > 0 ? "text-orange-400 font-medium" : "text-foreground/80"}>
                          {u.neverStartedJobs}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-blue-400">{u.avgDaysToComplete}</td>
                      <td className="px-4 py-2.5 text-right">
                        <span className={u.avgDaysLate > 0 ? "text-rose-400 font-medium" : "text-foreground/80"}>
                          {u.avgDaysLate > 0 ? `${u.avgDaysLate}d` : "\u2014"}
                        </span>
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right font-medium ${pctColor(u.onOurWayPercent)}`}
                        title={`${u.onOurWayOnTime} on-time / ${u.onOurWayLate} late`}
                      >
                        {u.onOurWayOnTime + u.onOurWayLate > 0 ? `${u.onOurWayPercent}%` : "\u2014"}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span
                          className={`inline-flex items-center justify-center w-8 h-8 rounded-lg text-sm font-bold ${gradeClasses(u.grade)}`}
                        >
                          {u.grade}
                        </span>
                      </td>
                    </tr>

                    {/* Expanded detail row */}
                    {isExpanded && (
                      <tr className="border-b border-t-border/50">
                        <td colSpan={11} className="px-4 py-4 bg-surface-2/20">
                          {/* Score breakdown */}
                          <div className="flex flex-wrap items-center gap-4 text-xs text-muted mb-4">
                            <span>
                              Score: <span className="text-foreground/80 font-medium">{u.complianceScore}</span>/100
                            </span>
                            <span>= 50% on-time ({u.onTimePercent}%) + 30% non-stuck + 20% started</span>
                            {u.onOurWayOnTime + u.onOurWayLate > 0 && (
                              <span className="text-cyan-400">
                                OOW: {u.onOurWayOnTime} on-time / {u.onOurWayLate} late
                              </span>
                            )}
                            {u.avgDaysLate > 0 && (
                              <span className="text-rose-400">
                                Avg {u.avgDaysLate}d past scheduled end
                              </span>
                            )}
                          </div>

                          {/* Detail tabs */}
                          <div className="flex gap-1 mb-4 bg-surface/50 rounded-lg p-0.5 w-fit">
                            {([
                              { key: "stuck" as const, label: "Stuck", count: u.stuckJobs },
                              { key: "late" as const, label: "Late", count: u.lateCompletions },
                              { key: "neverStarted" as const, label: "Not Started", count: u.neverStartedJobs },
                              { key: "completed" as const, label: "Completed", count: u.completedJobs },
                              { key: "categories" as const, label: "Categories", count: Object.keys(u.byCategory).length },
                            ]).map((tab) => (
                              <button
                                key={tab.key}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDetailTab(tab.key);
                                }}
                                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                                  detailTab === tab.key
                                    ? "bg-red-600 text-white"
                                    : "text-muted hover:text-foreground"
                                }`}
                              >
                                {tab.label} ({tab.count})
                              </button>
                            ))}
                          </div>

                          {/* Tab content */}
                          {detailTab === "stuck" && (
                            <JobListTable
                              jobs={u.stuckJobsList}
                              title="Stuck Jobs"
                              emptyMessage="No stuck jobs"
                            />
                          )}
                          {detailTab === "late" && (
                            <JobListTable
                              jobs={u.lateJobsList}
                              title="Late Completions"
                              emptyMessage="No late completions"
                              showTiming
                            />
                          )}
                          {detailTab === "neverStarted" && (
                            <JobListTable
                              jobs={u.neverStartedJobsList}
                              title="Never Started Jobs"
                              emptyMessage="No never-started jobs"
                            />
                          )}
                          {detailTab === "completed" && (
                            <JobListTable
                              jobs={u.completedJobsList}
                              title="All Completed Jobs"
                              emptyMessage="No completed jobs"
                              showTiming
                            />
                          )}
                          {detailTab === "categories" && (
                            <div>
                              <h4 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                                Jobs by Category
                              </h4>
                              {Object.keys(u.byCategory).length > 0 ? (
                                <div className="bg-surface/50 border border-t-border rounded-lg overflow-hidden">
                                  <table className="w-full text-sm">
                                    <thead>
                                      <tr className="text-muted text-left border-b border-t-border">
                                        <th className="px-3 py-2">Category</th>
                                        <th className="px-3 py-2 text-right">Jobs</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {Object.entries(u.byCategory)
                                        .sort((a, b) => b[1] - a[1])
                                        .map(([cat, count]) => (
                                          <tr key={cat} className="border-b border-t-border/30">
                                            <td className="px-3 py-1.5 text-foreground/80">{cat}</td>
                                            <td className="px-3 py-1.5 text-right text-foreground/80">{count}</td>
                                          </tr>
                                        ))}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <p className="text-muted text-sm">No category data</p>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}

              {sortedUsers.length === 0 && (
                <tr>
                  <td colSpan={11} className="text-center py-12 text-muted">
                    No users match the current filters
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer summary */}
      <div className="mt-6 text-center text-sm text-muted">
        {data?.dateRange && (
          <span>
            Date range: {data.dateRange.from} to {data.dateRange.to} ({data.dateRange.days} days)
          </span>
        )}
        {filterTeams.length > 0 && (
          <span className="ml-2">| Teams: {filterTeams.join(", ")}</span>
        )}
        {filterCategories.length > 0 && (
          <span className="ml-2">| Categories: {filterCategories.join(", ")}</span>
        )}
      </div>
    </DashboardShell>
  );
}
