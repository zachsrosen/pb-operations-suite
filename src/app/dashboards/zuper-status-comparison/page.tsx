"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import DashboardShell from "@/components/DashboardShell";
import { useActivityTracking } from "@/hooks/useActivityTracking";

// ---- Types ----

interface ComparisonRecord {
  projectNumber: string;
  dealId: string | null;
  dealName: string | null;
  dealUrl: string | null;
  pbLocation: string | null;
  zuperJobUid: string;
  zuperJobTitle: string;
  zuperStatus: string;
  hubspotStatus: string | null;
  category: string;
  isMismatch: boolean;
  zuperScheduledStart: string | null;
  zuperScheduledEnd: string | null;
  zuperCreatedAt: string | null;
  zuperCompletedAt: string | null;
  hubspotScheduleDate: string | null;
  hubspotCompletionDate: string | null;
  scheduleDateMatch: boolean | null;
  completionDateMatch: boolean | null;
  team: string | null;
  assignedTo: string | null;
}

interface CategorySlot {
  zuperJobUid: string | null;
  zuperStatus: string | null;
  hubspotStatus: string | null;
  isMismatch: boolean;
  zuperScheduledStart: string | null;
  hubspotScheduleDate: string | null;
  scheduleDateMatch: boolean | null;
  zuperCompletedAt: string | null;
  hubspotCompletionDate: string | null;
  completionDateMatch: boolean | null;
  team: string | null;
  assignedTo: string | null;
}

interface ProjectGroupedRecord {
  projectNumber: string;
  dealId: string | null;
  dealName: string | null;
  dealUrl: string | null;
  pbLocation: string | null;
  survey: CategorySlot;
  construction: CategorySlot;
  inspection: CategorySlot;
  hasAnyMismatch: boolean;
  hasAnyDateMismatch: boolean;
}

interface CategoryStats {
  total: number;
  mismatches: number;
  scheduleDateMismatches: number;
  completionDateMismatches: number;
}

interface ApiResponse {
  records: ComparisonRecord[];
  projectRecords: ProjectGroupedRecord[];
  stats: {
    total: number;
    mismatches: number;
    matched: number;
    noHubspotDeal: number;
    scheduleDateMismatches: number;
    completionDateMismatches: number;
    byCategory: {
      site_survey: CategoryStats;
      construction: CategoryStats;
      inspection: CategoryStats;
    };
  };
  dateRange: { from: string; to: string };
  lastUpdated: string;
}

// ---- Constants ----

type CategoryKey = "site_survey" | "construction" | "inspection";

const CATEGORY_LABELS: Record<string, string> = {
  site_survey: "Site Survey",
  construction: "Construction",
  inspection: "Inspection",
};

const CATEGORY_BG: Record<string, string> = {
  site_survey: "bg-blue-50 dark:bg-blue-950/30",
  construction: "bg-orange-50 dark:bg-orange-950/30",
  inspection: "bg-purple-50 dark:bg-purple-950/30",
};

const CATEGORY_BADGE: Record<string, string> = {
  site_survey: "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200",
  construction: "bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-200",
  inspection: "bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-200",
};

const SCHEDULE_DATE_LABELS: Record<string, string> = {
  site_survey: "Survey Schedule",
  construction: "Install Schedule",
  inspection: "Inspection Schedule",
};

const COMPLETION_DATE_LABELS: Record<string, string> = {
  site_survey: "Survey Completion",
  construction: "Construction Complete",
  inspection: "Inspection Pass",
};

type ViewMode = "status" | "dates" | "all" | "project-status" | "project-dates";

// ---- Helpers ----

function formatShortDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

function getZuperJobUrl(jobUid: string): string {
  const webBase = "https://us-west-1c.zuperpro.com";
  return `${webBase}/app/job/${jobUid}`;
}

// ---- Status dot color helper ----

function statusDotColor(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("complete") || s.includes("passed")) return "bg-green-500";
  if (s.includes("started") || s.includes("way") || s.includes("progress")) return "bg-blue-500";
  if (s.includes("scheduled") || s.includes("ready")) return "bg-yellow-500";
  if (s.includes("fail") || s.includes("reject")) return "bg-red-500";
  if (s.includes("hold") || s.includes("loose") || s.includes("partial") || s.includes("revisit")) return "bg-amber-500";
  return "bg-zinc-400";
}

// ---- Date comparison badge ----

function DateMatchBadge({ match }: { match: boolean | null }) {
  if (match === null) return <span className="text-xs text-zinc-400">-</span>;
  if (match) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    </span>
  );
}

// ---- Component ----

export default function ZuperStatusComparisonPage() {
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  /* ---- Admin access guard (JWT role is stale, so check via API) ---- */
  const [accessChecked, setAccessChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    fetch("/api/auth/sync", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`Auth check failed (${r.status})`);
        return r.json();
      })
      .then(data => {
        const role = data.role || "TECH_OPS";
        setAccessChecked(true);
        if (role !== "ADMIN") {
          setIsAdmin(false);
          setError("Admin access required for this dashboard.");
          setLoading(false);
          return;
        }
        setIsAdmin(true);
      })
      .catch(() => {
        setAccessChecked(true);
        setIsAdmin(false);
        setError("Unable to verify access. Please refresh and try again.");
        setLoading(false);
      });
  }, []);

  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [showMismatchesOnly, setShowMismatchesOnly] = useState(false);
  const [showDateMismatchesOnly, setShowDateMismatchesOnly] = useState(false);
  const [selectedPbLocations, setSelectedPbLocations] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<string>("projectNumber");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [viewMode, setViewMode] = useState<ViewMode>("all");

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/zuper/status-comparison");
      if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);
      const json: ApiResponse = await response.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accessChecked || !isAdmin) return;
    fetchData();
  }, [accessChecked, isAdmin, fetchData]);

  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("zuper-status-comparison", {
        projectCount: data?.stats?.total || 0,
      });
    }
  }, [loading, trackDashboardView, data]);

  const pbLocations = useMemo(() => {
    if (!data?.records) return [];
    return [...new Set(
      data.records
        .map((r) => r.pbLocation || "Unknown")
    )].sort((a, b) => a.localeCompare(b));
  }, [data]);

  const togglePbLocation = useCallback((location: string) => {
    setSelectedPbLocations((prev) =>
      prev.includes(location)
        ? prev.filter((l) => l !== location)
        : [...prev, location]
    );
  }, []);

  // Filtered and sorted records
  const filteredRecords = useMemo(() => {
    if (!data) return [];
    let records = data.records;

    if (activeCategory !== "all") {
      records = records.filter((r) => r.category === activeCategory);
    }
    if (showMismatchesOnly) {
      records = records.filter((r) => r.isMismatch);
    }
    if (showDateMismatchesOnly) {
      records = records.filter((r) => r.scheduleDateMatch === false || r.completionDateMatch === false);
    }
    if (selectedPbLocations.length > 0) {
      records = records.filter((r) => selectedPbLocations.includes(r.pbLocation || "Unknown"));
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      records = records.filter(
        (r) =>
          r.projectNumber.toLowerCase().includes(q) ||
          (r.dealName || "").toLowerCase().includes(q) ||
          (r.pbLocation || "").toLowerCase().includes(q) ||
          r.zuperStatus.toLowerCase().includes(q) ||
          (r.hubspotStatus || "").toLowerCase().includes(q) ||
          (r.team || "").toLowerCase().includes(q) ||
          (r.assignedTo || "").toLowerCase().includes(q)
      );
    }

    records = [...records].sort((a, b) => {
      let aVal: string | number = "";
      let bVal: string | number = "";

      switch (sortField) {
        case "projectNumber":
          aVal = parseInt(a.projectNumber.replace(/\D/g, "")) || 0;
          bVal = parseInt(b.projectNumber.replace(/\D/g, "")) || 0;
          break;
        case "zuperStatus":
          aVal = a.zuperStatus.toLowerCase();
          bVal = b.zuperStatus.toLowerCase();
          break;
        case "hubspotStatus":
          aVal = (a.hubspotStatus || "").toLowerCase();
          bVal = (b.hubspotStatus || "").toLowerCase();
          break;
        case "category":
          aVal = a.category;
          bVal = b.category;
          break;
        case "zuperScheduledStart":
          aVal = a.zuperScheduledStart || "";
          bVal = b.zuperScheduledStart || "";
          break;
        case "hubspotScheduleDate":
          aVal = a.hubspotScheduleDate || "";
          bVal = b.hubspotScheduleDate || "";
          break;
        default:
          aVal = a.projectNumber;
          bVal = b.projectNumber;
      }

      if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

    return records;
  }, [data, activeCategory, showMismatchesOnly, showDateMismatchesOnly, selectedPbLocations, searchQuery, sortField, sortDir]);

  // Filtered project-grouped records
  const filteredProjectRecords = useMemo(() => {
    if (!data?.projectRecords) return [];
    let records = data.projectRecords;

    if (showMismatchesOnly) {
      records = records.filter((r) => r.hasAnyMismatch);
    }
    if (showDateMismatchesOnly) {
      records = records.filter((r) => r.hasAnyDateMismatch);
    }
    if (selectedPbLocations.length > 0) {
      records = records.filter((r) => selectedPbLocations.includes(r.pbLocation || "Unknown"));
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      records = records.filter(
        (r) =>
          r.projectNumber.toLowerCase().includes(q) ||
          (r.dealName || "").toLowerCase().includes(q) ||
          (r.pbLocation || "").toLowerCase().includes(q) ||
          (r.survey.zuperStatus || "").toLowerCase().includes(q) ||
          (r.construction.zuperStatus || "").toLowerCase().includes(q) ||
          (r.inspection.zuperStatus || "").toLowerCase().includes(q) ||
          (r.survey.hubspotStatus || "").toLowerCase().includes(q) ||
          (r.construction.hubspotStatus || "").toLowerCase().includes(q) ||
          (r.inspection.hubspotStatus || "").toLowerCase().includes(q)
      );
    }
    return records;
  }, [data, showMismatchesOnly, showDateMismatchesOnly, selectedPbLocations, searchQuery]);

  const isProjectView = viewMode === "project-status" || viewMode === "project-dates";

  // CSV export
  const exportData = useMemo(() => {
    if (!filteredRecords.length) return undefined;
    const data = filteredRecords.map((r) => ({
      "Project Number": r.projectNumber,
      "Deal Name": r.dealName || "-",
      "PB Location": r.pbLocation || "Unknown",
      Category: CATEGORY_LABELS[r.category] || r.category,
      "Zuper Status": r.zuperStatus,
      "HubSpot Status": r.hubspotStatus || "-",
      "Status Match": r.isMismatch ? "MISMATCH" : "Match",
      "Zuper Scheduled Start": r.zuperScheduledStart || "-",
      "HubSpot Schedule Date": r.hubspotScheduleDate || "-",
      "Schedule Date Match": r.scheduleDateMatch === null ? "N/A" : r.scheduleDateMatch ? "Match" : "MISMATCH",
      "Zuper Completed": r.zuperCompletedAt || "-",
      "HubSpot Completion Date": r.hubspotCompletionDate || "-",
      "Completion Date Match": r.completionDateMatch === null ? "N/A" : r.completionDateMatch ? "Match" : "MISMATCH",
      Team: r.team || "-",
      "Assigned To": r.assignedTo || "-",
      "HubSpot URL": r.dealUrl || "-",
      "Zuper URL": getZuperJobUrl(r.zuperJobUid),
    })) as Record<string, unknown>[];
    return { data, filename: "zuper-status-comparison" };
  }, [filteredRecords]);

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const SortIcon = ({ field }: { field: string }) => {
    if (sortField !== field) return <span className="text-zinc-400 dark:text-zinc-600 ml-1">&uarr;&darr;</span>;
    return <span className="ml-1">{sortDir === "asc" ? "\u2191" : "\u2193"}</span>;
  };

  // ---- Loading / Error states ----

  if (loading) {
    return (
      <DashboardShell
        title="Zuper Status Comparison"
        subtitle="Loading status data..."
        accentColor="cyan"
        breadcrumbs={[{ label: "Dashboards", href: "/" }, { label: "Zuper Status Comparison" }]}
      >
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-600" />
          <span className="ml-3 text-zinc-500 dark:text-zinc-400">
            Fetching Zuper jobs and HubSpot deal data...
          </span>
        </div>
      </DashboardShell>
    );
  }

  if (error) {
    return (
      <DashboardShell
        title="Zuper Status Comparison"
        subtitle="Error loading data"
        accentColor="cyan"
        breadcrumbs={[{ label: "Dashboards", href: "/" }, { label: "Zuper Status Comparison" }]}
      >
        <div className="text-center py-20">
          <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
          <button
            onClick={fetchData}
            className="px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors"
          >
            Retry
          </button>
        </div>
      </DashboardShell>
    );
  }

  const stats = data?.stats;

  return (
    <DashboardShell
      title="Zuper Status Comparison"
      subtitle="Compare Zuper job statuses and dates with HubSpot deal data"
      accentColor="cyan"
      lastUpdated={data?.lastUpdated}
      breadcrumbs={[{ label: "Dashboards", href: "/" }, { label: "Zuper Status Comparison" }]}
      exportData={exportData}
      headerRight={
        <button
          onClick={fetchData}
          className="px-3 py-1.5 text-sm bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors"
        >
          Refresh
        </button>
      }
    >
      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <StatCard label="Total Jobs" value={stats?.total || 0} />
        <StatCard label="Status Match" value={stats?.matched || 0} color="green" />
        <StatCard label="Status Mismatches" value={stats?.mismatches || 0} color="red" />
        <StatCard label="No HubSpot Deal" value={stats?.noHubspotDeal || 0} color="yellow" />
        <StatCard label="Schedule Date Mismatches" value={stats?.scheduleDateMismatches || 0} color="orange" />
        <StatCard label="Completion Date Mismatches" value={stats?.completionDateMismatches || 0} color="purple" />
      </div>

      {/* Category Breakdown Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {(["site_survey", "construction", "inspection"] as const).map((cat) => {
          const catStats = stats?.byCategory?.[cat];
          const matchRate =
            catStats && catStats.total > 0
              ? Math.round(((catStats.total - catStats.mismatches) / catStats.total) * 100)
              : 0;

          return (
            <button
              key={cat}
              onClick={() => setActiveCategory((prev) => (prev === cat ? "all" : cat))}
              className={`rounded-xl border p-4 text-left transition-all ${
                activeCategory === cat
                  ? `ring-2 ring-offset-2 dark:ring-offset-zinc-900 ${
                      cat === "site_survey"
                        ? "ring-blue-500 border-blue-300 dark:border-blue-700"
                        : cat === "construction"
                        ? "ring-orange-500 border-orange-300 dark:border-orange-700"
                        : "ring-purple-500 border-purple-300 dark:border-purple-700"
                    }`
                  : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700"
              } ${CATEGORY_BG[cat]}`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${CATEGORY_BADGE[cat]}`}>
                  {CATEGORY_LABELS[cat]}
                </span>
                {activeCategory === cat && (
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">Active</span>
                )}
              </div>
              <div className="flex items-end justify-between mb-2">
                <div>
                  <div className="text-xl font-bold">{catStats?.total || 0} jobs</div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 space-x-2">
                    <span>{catStats?.mismatches || 0} status</span>
                    <span>{catStats?.scheduleDateMismatches || 0} sched.</span>
                    <span>{catStats?.completionDateMismatches || 0} compl.</span>
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className={`text-lg font-bold ${
                      matchRate >= 90
                        ? "text-green-600 dark:text-green-400"
                        : matchRate >= 70
                        ? "text-yellow-600 dark:text-yellow-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {matchRate}%
                  </div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">status match</div>
                </div>
              </div>
              <div className="h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    matchRate >= 90 ? "bg-green-500" : matchRate >= 70 ? "bg-yellow-500" : "bg-red-500"
                  }`}
                  style={{ width: `${matchRate}%` }}
                />
              </div>
            </button>
          );
        })}
      </div>

      {/* View Mode + Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* View mode toggles */}
        <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
          {([
            { key: "all", label: "All" },
            { key: "status", label: "Status" },
            { key: "dates", label: "Dates" },
            { key: "project-status", label: "Project Status" },
            { key: "project-dates", label: "Project Dates" },
          ] as { key: ViewMode; label: string }[]).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setViewMode(key)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                viewMode === key
                  ? "bg-cyan-600 text-white"
                  : "bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="relative flex-1 min-w-[200px] max-w-md">
          <input
            type="text"
            placeholder="Search project, name, status, team..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
          />
          <svg className="absolute left-3 top-2.5 w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {pbLocations.map((location) => {
            const isSelected = selectedPbLocations.includes(location);
            return (
              <button
                key={location}
                onClick={() => togglePbLocation(location)}
                className={`px-2 py-1 rounded-md text-xs border transition-colors ${
                  isSelected
                    ? "bg-cyan-500/15 border-cyan-500/60 text-cyan-700 dark:text-cyan-300"
                    : "bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600"
                }`}
                aria-pressed={isSelected}
                type="button"
              >
                {location}
              </button>
            );
          })}
        </div>

        <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showMismatchesOnly}
            onChange={(e) => setShowMismatchesOnly(e.target.checked)}
            className="rounded border-zinc-300 dark:border-zinc-600 text-red-600 focus:ring-red-500"
          />
          <span className="text-zinc-700 dark:text-zinc-300">Status mismatches</span>
        </label>

        <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showDateMismatchesOnly}
            onChange={(e) => setShowDateMismatchesOnly(e.target.checked)}
            className="rounded border-zinc-300 dark:border-zinc-600 text-orange-600 focus:ring-orange-500"
          />
          <span className="text-zinc-700 dark:text-zinc-300">Date mismatches</span>
        </label>

        {(activeCategory !== "all" || selectedPbLocations.length > 0) && (
          <button
            onClick={() => {
              setActiveCategory("all");
              setSelectedPbLocations([]);
            }}
            className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline"
          >
            Clear filter
          </button>
        )}

        <span className="ml-auto text-xs text-zinc-500 dark:text-zinc-400">
          {isProjectView ? `${filteredProjectRecords.length} projects` : `${filteredRecords.length} records`}
          {data?.dateRange && (
            <span className="ml-2 text-zinc-400">
              ({formatShortDate(data.dateRange.from)} - {formatShortDate(data.dateRange.to)})
            </span>
          )}
        </span>
      </div>

      {/* Project View Tables */}
      {isProjectView && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-700">
                  <th className="px-3 py-2.5 text-left font-medium text-zinc-600 dark:text-zinc-300 text-xs sticky left-0 bg-zinc-50 dark:bg-zinc-800/50 z-10">
                    Project
                  </th>
                  {viewMode === "project-status" ? (
                    <>
                      <th colSpan={3} className="px-2 py-1 text-center font-medium text-xs border-l border-zinc-200 dark:border-zinc-700">
                        <span className={`px-2 py-0.5 rounded-full ${CATEGORY_BADGE.site_survey}`}>Site Survey</span>
                      </th>
                      <th colSpan={3} className="px-2 py-1 text-center font-medium text-xs border-l border-zinc-200 dark:border-zinc-700">
                        <span className={`px-2 py-0.5 rounded-full ${CATEGORY_BADGE.construction}`}>Construction</span>
                      </th>
                      <th colSpan={3} className="px-2 py-1 text-center font-medium text-xs border-l border-zinc-200 dark:border-zinc-700">
                        <span className={`px-2 py-0.5 rounded-full ${CATEGORY_BADGE.inspection}`}>Inspection</span>
                      </th>
                    </>
                  ) : (
                    <>
                      <th colSpan={5} className="px-2 py-1 text-center font-medium text-xs border-l border-zinc-200 dark:border-zinc-700">
                        <span className={`px-2 py-0.5 rounded-full ${CATEGORY_BADGE.site_survey}`}>Site Survey</span>
                      </th>
                      <th colSpan={5} className="px-2 py-1 text-center font-medium text-xs border-l border-zinc-200 dark:border-zinc-700">
                        <span className={`px-2 py-0.5 rounded-full ${CATEGORY_BADGE.construction}`}>Construction</span>
                      </th>
                      <th colSpan={5} className="px-2 py-1 text-center font-medium text-xs border-l border-zinc-200 dark:border-zinc-700">
                        <span className={`px-2 py-0.5 rounded-full ${CATEGORY_BADGE.inspection}`}>Inspection</span>
                      </th>
                    </>
                  )}
                  <th className="px-3 py-2.5 text-center font-medium text-zinc-600 dark:text-zinc-300 text-xs border-l border-zinc-200 dark:border-zinc-700">
                    Links
                  </th>
                </tr>
                <tr className="bg-zinc-50/50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-700 text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                  <th className="px-3 py-1.5 text-left sticky left-0 bg-zinc-50/50 dark:bg-zinc-800/30 z-10">&nbsp;</th>
                  {viewMode === "project-status" ? (
                    <>
                      {/* Survey status sub-headers */}
                      <th className="px-2 py-1.5 text-left border-l border-zinc-200 dark:border-zinc-700">Zuper</th>
                      <th className="px-2 py-1.5 text-left">HubSpot</th>
                      <th className="px-2 py-1.5 text-center">Match</th>
                      {/* Construction status sub-headers */}
                      <th className="px-2 py-1.5 text-left border-l border-zinc-200 dark:border-zinc-700">Zuper</th>
                      <th className="px-2 py-1.5 text-left">HubSpot</th>
                      <th className="px-2 py-1.5 text-center">Match</th>
                      {/* Inspection status sub-headers */}
                      <th className="px-2 py-1.5 text-left border-l border-zinc-200 dark:border-zinc-700">Zuper</th>
                      <th className="px-2 py-1.5 text-left">HubSpot</th>
                      <th className="px-2 py-1.5 text-center">Match</th>
                    </>
                  ) : (
                    <>
                      {/* Survey date sub-headers */}
                      <th className="px-2 py-1.5 text-left border-l border-zinc-200 dark:border-zinc-700">Z Sched</th>
                      <th className="px-2 py-1.5 text-left">HS Sched</th>
                      <th className="px-2 py-1.5 text-left">Z Compl</th>
                      <th className="px-2 py-1.5 text-left">HS Compl</th>
                      <th className="px-2 py-1.5 text-center">Match</th>
                      {/* Construction date sub-headers */}
                      <th className="px-2 py-1.5 text-left border-l border-zinc-200 dark:border-zinc-700">Z Sched</th>
                      <th className="px-2 py-1.5 text-left">HS Sched</th>
                      <th className="px-2 py-1.5 text-left">Z Compl</th>
                      <th className="px-2 py-1.5 text-left">HS Compl</th>
                      <th className="px-2 py-1.5 text-center">Match</th>
                      {/* Inspection date sub-headers */}
                      <th className="px-2 py-1.5 text-left border-l border-zinc-200 dark:border-zinc-700">Z Sched</th>
                      <th className="px-2 py-1.5 text-left">HS Sched</th>
                      <th className="px-2 py-1.5 text-left">Z Compl</th>
                      <th className="px-2 py-1.5 text-left">HS Compl</th>
                      <th className="px-2 py-1.5 text-center">Match</th>
                    </>
                  )}
                  <th className="px-3 py-1.5 border-l border-zinc-200 dark:border-zinc-700">&nbsp;</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {filteredProjectRecords.length === 0 ? (
                  <tr>
                    <td colSpan={20} className="px-4 py-12 text-center text-zinc-500 dark:text-zinc-400">
                      No records found matching your filters.
                    </td>
                  </tr>
                ) : (
                  filteredProjectRecords.map((rec) => (
                    <tr
                      key={rec.projectNumber}
                      className={`hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors ${
                        (viewMode === "project-status" && rec.hasAnyMismatch) || (viewMode === "project-dates" && rec.hasAnyDateMismatch)
                          ? "bg-red-50/40 dark:bg-red-950/10"
                          : ""
                      }`}
                    >
                      <td className="px-3 py-2 sticky left-0 bg-white dark:bg-zinc-900 z-10">
                        <div className="font-mono font-medium text-zinc-900 dark:text-zinc-100 text-xs">
                          {rec.projectNumber}
                        </div>
                        {rec.dealName && (
                          <div className="text-[10px] text-zinc-500 dark:text-zinc-400 truncate max-w-[140px]" title={rec.dealName}>
                            {rec.dealName.replace(/^PROJ-\d+\s*\|\s*/, "").split("|")[0]?.trim()}
                          </div>
                        )}
                      </td>

                      {viewMode === "project-status" ? (
                        <>
                          {/* Survey status */}
                          <ProjectStatusCells slot={rec.survey} />
                          {/* Construction status */}
                          <ProjectStatusCells slot={rec.construction} />
                          {/* Inspection status */}
                          <ProjectStatusCells slot={rec.inspection} />
                        </>
                      ) : (
                        <>
                          {/* Survey dates */}
                          <ProjectDateCells slot={rec.survey} />
                          {/* Construction dates */}
                          <ProjectDateCells slot={rec.construction} />
                          {/* Inspection dates */}
                          <ProjectDateCells slot={rec.inspection} />
                        </>
                      )}

                      <td className="px-3 py-2 text-center border-l border-zinc-200 dark:border-zinc-700">
                        <div className="flex items-center justify-center gap-1.5">
                          {rec.dealUrl && (
                            <a href={rec.dealUrl} target="_blank" rel="noopener noreferrer" className="text-orange-600 dark:text-orange-400 hover:text-orange-800" title="HubSpot">
                              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" /></svg>
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Per-Job Results Table */}
      {!isProjectView && (
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-700">
                <th className="px-3 py-2.5 text-left font-medium text-zinc-600 dark:text-zinc-300 cursor-pointer hover:text-zinc-900 dark:hover:text-white text-xs" onClick={() => handleSort("projectNumber")}>
                  Project <SortIcon field="projectNumber" />
                </th>
                <th className="px-3 py-2.5 text-left font-medium text-zinc-600 dark:text-zinc-300 cursor-pointer hover:text-zinc-900 dark:hover:text-white text-xs" onClick={() => handleSort("category")}>
                  Type <SortIcon field="category" />
                </th>

                {/* Status columns */}
                {(viewMode === "status" || viewMode === "all") && (
                  <>
                    <th className="px-3 py-2.5 text-left font-medium text-zinc-600 dark:text-zinc-300 cursor-pointer hover:text-zinc-900 dark:hover:text-white text-xs" onClick={() => handleSort("zuperStatus")}>
                      Zuper Status <SortIcon field="zuperStatus" />
                    </th>
                    <th className="px-3 py-2.5 text-left font-medium text-zinc-600 dark:text-zinc-300 cursor-pointer hover:text-zinc-900 dark:hover:text-white text-xs" onClick={() => handleSort("hubspotStatus")}>
                      HS Status <SortIcon field="hubspotStatus" />
                    </th>
                    <th className="px-3 py-2.5 text-center font-medium text-zinc-600 dark:text-zinc-300 text-xs">
                      Sts
                    </th>
                  </>
                )}

                {/* Date columns */}
                {(viewMode === "dates" || viewMode === "all") && (
                  <>
                    <th className="px-3 py-2.5 text-left font-medium text-zinc-600 dark:text-zinc-300 cursor-pointer hover:text-zinc-900 dark:hover:text-white text-xs" onClick={() => handleSort("zuperScheduledStart")}>
                      Zuper Sched. <SortIcon field="zuperScheduledStart" />
                    </th>
                    <th className="px-3 py-2.5 text-left font-medium text-zinc-600 dark:text-zinc-300 cursor-pointer hover:text-zinc-900 dark:hover:text-white text-xs" onClick={() => handleSort("hubspotScheduleDate")}>
                      HS Sched. <SortIcon field="hubspotScheduleDate" />
                    </th>
                    <th className="px-3 py-2.5 text-center font-medium text-zinc-600 dark:text-zinc-300 text-xs" title="Schedule Date Match">
                      Sch
                    </th>
                    <th className="px-3 py-2.5 text-left font-medium text-zinc-600 dark:text-zinc-300 text-xs">
                      Zuper Compl.
                    </th>
                    <th className="px-3 py-2.5 text-left font-medium text-zinc-600 dark:text-zinc-300 text-xs">
                      HS Compl.
                    </th>
                    <th className="px-3 py-2.5 text-center font-medium text-zinc-600 dark:text-zinc-300 text-xs" title="Completion Date Match">
                      Cmp
                    </th>
                  </>
                )}

                <th className="px-3 py-2.5 text-left font-medium text-zinc-600 dark:text-zinc-300 text-xs">
                  Team
                </th>
                <th className="px-3 py-2.5 text-center font-medium text-zinc-600 dark:text-zinc-300 text-xs">
                  Links
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={15} className="px-4 py-12 text-center text-zinc-500 dark:text-zinc-400">
                    No records found matching your filters.
                  </td>
                </tr>
              ) : (
                filteredRecords.map((record, idx) => {
                  const hasAnyMismatch = record.isMismatch || record.scheduleDateMatch === false || record.completionDateMatch === false;
                  return (
                    <tr
                      key={`${record.zuperJobUid}-${idx}`}
                      className={`hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors ${
                        hasAnyMismatch ? "bg-red-50/40 dark:bg-red-950/10" : ""
                      }`}
                    >
                      {/* Project */}
                      <td className="px-3 py-2.5">
                        <div className="font-mono font-medium text-zinc-900 dark:text-zinc-100 text-xs">
                          {record.projectNumber}
                        </div>
                        {record.dealName && (
                          <div className="text-[10px] text-zinc-500 dark:text-zinc-400 truncate max-w-[160px]" title={record.dealName}>
                            {record.dealName.replace(/^PROJ-\d+\s*\|\s*/, "").split("|")[0]?.trim()}
                          </div>
                        )}
                      </td>

                      {/* Category */}
                      <td className="px-3 py-2.5">
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${CATEGORY_BADGE[record.category]}`}>
                          {CATEGORY_LABELS[record.category]}
                        </span>
                      </td>

                      {/* Status columns */}
                      {(viewMode === "status" || viewMode === "all") && (
                        <>
                          <td className="px-3 py-2.5">
                            <StatusBadge status={record.zuperStatus} />
                          </td>
                          <td className="px-3 py-2.5">
                            {record.hubspotStatus ? (
                              <StatusBadge status={record.hubspotStatus} />
                            ) : (
                              <span className="text-[10px] text-zinc-400 italic">
                                {record.dealId ? "Not set" : "No deal"}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <MatchIcon match={!record.isMismatch} />
                          </td>
                        </>
                      )}

                      {/* Date columns */}
                      {(viewMode === "dates" || viewMode === "all") && (
                        <>
                          <td className="px-3 py-2.5 text-[11px] text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                            {formatShortDate(record.zuperScheduledStart)}
                          </td>
                          <td className="px-3 py-2.5 text-[11px] text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                            {formatShortDate(record.hubspotScheduleDate)}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <DateMatchBadge match={record.scheduleDateMatch} />
                          </td>
                          <td className="px-3 py-2.5 text-[11px] text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                            {formatShortDate(record.zuperCompletedAt || record.zuperScheduledEnd)}
                          </td>
                          <td className="px-3 py-2.5 text-[11px] text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                            {formatShortDate(record.hubspotCompletionDate)}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <DateMatchBadge match={record.completionDateMatch} />
                          </td>
                        </>
                      )}

                      {/* Team */}
                      <td className="px-3 py-2.5">
                        {record.team && (
                          <div className="text-[10px] text-zinc-600 dark:text-zinc-400 truncate max-w-[100px]" title={record.team}>
                            {record.team}
                          </div>
                        )}
                        {record.assignedTo && (
                          <div className="text-[10px] text-zinc-500 truncate max-w-[100px]" title={record.assignedTo}>
                            {record.assignedTo}
                          </div>
                        )}
                        {!record.team && !record.assignedTo && <span className="text-[10px] text-zinc-400">-</span>}
                      </td>

                      {/* Links */}
                      <td className="px-3 py-2.5 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {record.dealUrl && (
                            <a
                              href={record.dealUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-orange-600 dark:text-orange-400 hover:text-orange-800 dark:hover:text-orange-300"
                              title="HubSpot"
                            >
                              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
                              </svg>
                            </a>
                          )}
                          <a
                            href={getZuperJobUrl(record.zuperJobUid)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-cyan-600 dark:text-cyan-400 hover:text-cyan-800 dark:hover:text-cyan-300"
                            title="Zuper"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* Mismatch Breakdown */}
      {data && stats && (stats.mismatches > 0 || stats.scheduleDateMismatches > 0 || stats.completionDateMismatches > 0) && (
        <div className="mt-8">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
            Mismatch Breakdown
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(["site_survey", "construction", "inspection"] as CategoryKey[]).map((cat) => {
              const catRecords = data.records.filter((r) => r.category === cat);
              const statusMismatches = catRecords.filter((r) => r.isMismatch);
              const schedMismatches = catRecords.filter((r) => r.scheduleDateMatch === false);
              const complMismatches = catRecords.filter((r) => r.completionDateMatch === false);

              if (statusMismatches.length === 0 && schedMismatches.length === 0 && complMismatches.length === 0) return null;

              // Group status mismatches
              const statusPairs = new Map<string, number>();
              for (const r of statusMismatches) {
                const key = `${r.zuperStatus} \u2192 ${r.hubspotStatus || "Not set"}`;
                statusPairs.set(key, (statusPairs.get(key) || 0) + 1);
              }
              const sortedPairs = [...statusPairs.entries()].sort((a, b) => b[1] - a[1]);

              return (
                <div key={cat} className={`rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 ${CATEGORY_BG[cat]}`}>
                  <h4 className="font-medium text-zinc-900 dark:text-zinc-100 mb-3">
                    {CATEGORY_LABELS[cat]}
                  </h4>

                  {statusMismatches.length > 0 && (
                    <div className="mb-3">
                      <div className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">
                        Status Mismatches ({statusMismatches.length})
                      </div>
                      <div className="space-y-1">
                        {sortedPairs.slice(0, 5).map(([pair, count]) => (
                          <div key={pair} className="flex items-center justify-between text-xs">
                            <span className="text-zinc-600 dark:text-zinc-400 truncate mr-2">{pair}</span>
                            <span className="font-mono font-medium text-zinc-900 dark:text-zinc-100 flex-shrink-0">{count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {schedMismatches.length > 0 && (
                    <div className="mb-2">
                      <div className="text-[10px] font-semibold text-orange-600 dark:text-orange-400 uppercase tracking-wider mb-1">
                        {SCHEDULE_DATE_LABELS[cat]} Mismatches: {schedMismatches.length}
                      </div>
                    </div>
                  )}

                  {complMismatches.length > 0 && (
                    <div>
                      <div className="text-[10px] font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wider mb-1">
                        {COMPLETION_DATE_LABELS[cat]} Mismatches: {complMismatches.length}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </DashboardShell>
  );
}

// ---- Sub-components ----

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  const colorClasses: Record<string, string> = {
    green: "border-green-200 dark:border-green-800/50 bg-green-50 dark:bg-green-950/20",
    red: "border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-950/20",
    yellow: "border-yellow-200 dark:border-yellow-800/50 bg-yellow-50 dark:bg-yellow-950/20",
    orange: "border-orange-200 dark:border-orange-800/50 bg-orange-50 dark:bg-orange-950/20",
    purple: "border-purple-200 dark:border-purple-800/50 bg-purple-50 dark:bg-purple-950/20",
  };
  const textClasses: Record<string, string> = {
    green: "text-green-600 dark:text-green-400",
    red: "text-red-600 dark:text-red-400",
    yellow: "text-yellow-600 dark:text-yellow-400",
    orange: "text-orange-600 dark:text-orange-400",
    purple: "text-purple-600 dark:text-purple-400",
  };
  const valueClasses: Record<string, string> = {
    green: "text-green-700 dark:text-green-300",
    red: "text-red-700 dark:text-red-300",
    yellow: "text-yellow-700 dark:text-yellow-300",
    orange: "text-orange-700 dark:text-orange-300",
    purple: "text-purple-700 dark:text-purple-300",
  };

  return (
    <div className={`rounded-xl border p-3 ${color ? colorClasses[color] : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"}`}>
      <div className={`text-xs ${color ? textClasses[color] : "text-zinc-500 dark:text-zinc-400"}`}>{label}</div>
      <div className={`text-xl font-bold mt-0.5 ${color ? valueClasses[color] : ""}`}>{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 text-[11px] font-medium">
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDotColor(status)}`} />
      {status}
    </span>
  );
}

function ProjectStatusCells({ slot }: { slot: CategorySlot }) {
  if (!slot.zuperStatus) {
    return (
      <>
        <td className="px-2 py-2 border-l border-zinc-200 dark:border-zinc-700">
          <span className="text-[10px] text-zinc-400 italic">No job</span>
        </td>
        <td className="px-2 py-2"><span className="text-[10px] text-zinc-400">-</span></td>
        <td className="px-2 py-2 text-center"><span className="text-[10px] text-zinc-400">-</span></td>
      </>
    );
  }
  return (
    <>
      <td className="px-2 py-2 border-l border-zinc-200 dark:border-zinc-700">
        <StatusBadge status={slot.zuperStatus} />
      </td>
      <td className="px-2 py-2">
        {slot.hubspotStatus ? (
          <StatusBadge status={slot.hubspotStatus} />
        ) : (
          <span className="text-[10px] text-zinc-400 italic">Not set</span>
        )}
      </td>
      <td className="px-2 py-2 text-center">
        <MatchIcon match={!slot.isMismatch} />
      </td>
    </>
  );
}

function ProjectDateCells({ slot }: { slot: CategorySlot }) {
  if (!slot.zuperStatus) {
    return (
      <>
        <td className="px-2 py-2 border-l border-zinc-200 dark:border-zinc-700">
          <span className="text-[10px] text-zinc-400 italic">No job</span>
        </td>
        <td className="px-2 py-2"><span className="text-[10px] text-zinc-400">-</span></td>
        <td className="px-2 py-2"><span className="text-[10px] text-zinc-400">-</span></td>
        <td className="px-2 py-2"><span className="text-[10px] text-zinc-400">-</span></td>
        <td className="px-2 py-2 text-center"><span className="text-[10px] text-zinc-400">-</span></td>
      </>
    );
  }
  const hasDateMismatch = slot.scheduleDateMatch === false || slot.completionDateMatch === false;
  return (
    <>
      <td className={`px-2 py-2 text-[11px] whitespace-nowrap border-l border-zinc-200 dark:border-zinc-700 ${hasDateMismatch ? "text-red-600 dark:text-red-400" : "text-zinc-600 dark:text-zinc-400"}`}>
        {formatShortDate(slot.zuperScheduledStart)}
      </td>
      <td className={`px-2 py-2 text-[11px] whitespace-nowrap ${hasDateMismatch ? "text-red-600 dark:text-red-400" : "text-zinc-600 dark:text-zinc-400"}`}>
        {formatShortDate(slot.hubspotScheduleDate)}
      </td>
      <td className={`px-2 py-2 text-[11px] whitespace-nowrap ${hasDateMismatch ? "text-red-600 dark:text-red-400" : "text-zinc-600 dark:text-zinc-400"}`}>
        {formatShortDate(slot.zuperCompletedAt)}
      </td>
      <td className={`px-2 py-2 text-[11px] whitespace-nowrap ${hasDateMismatch ? "text-red-600 dark:text-red-400" : "text-zinc-600 dark:text-zinc-400"}`}>
        {formatShortDate(slot.hubspotCompletionDate)}
      </td>
      <td className="px-2 py-2 text-center">
        <div className="flex items-center justify-center gap-0.5">
          <DateMatchBadge match={slot.scheduleDateMatch} />
          <DateMatchBadge match={slot.completionDateMatch} />
        </div>
      </td>
    </>
  );
}

function MatchIcon({ match }: { match: boolean }) {
  if (match) {
    return (
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-100 dark:bg-green-900/30">
        <svg className="w-3 h-3 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-100 dark:bg-red-900/30">
      <svg className="w-3 h-3 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    </span>
  );
}
