"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { MultiSelectFilter, ProjectSearchBar } from "@/components/ui/MultiSelectFilter";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { queryKeys } from "@/lib/query-keys";

interface UnscheduledJob {
  jobUid: string;
  jobTitle: string;
  jobCategory: string;
  jobStatus: string;
  jobPriority: string | null;
  customerName: string | null;
  address: string;
  city: string;
  state: string;
  zip: string;
  ageDays: number;
  assignedTeam: string | null;
  assignedUserNames: string[];
  hubspotDealId: string | null;
  projectName: string | null;
  zuperUrl: string;
  lastSyncedAt: string;
}

interface UnscheduledResponse {
  jobs: UnscheduledJob[];
  total: number;
  lastUpdated: string | null;
}

type SortField = "age" | "title" | "category" | "status" | "city";
type SortDir = "asc" | "desc";

function SortIcon({
  field,
  current,
  dir,
}: {
  field: SortField;
  current: SortField;
  dir: SortDir;
}) {
  return (
    <span className="ml-1 text-muted/70">
      {current === field ? (dir === "asc" ? "▲" : "▼") : "▼"}
    </span>
  );
}

function ageBadgeColor(ageDays: number): string {
  if (ageDays >= 14) return "text-red-400 bg-red-400/10";
  if (ageDays >= 7) return "text-orange-400 bg-orange-400/10";
  if (ageDays >= 3) return "text-amber-400 bg-amber-400/10";
  return "text-foreground/70 bg-surface-2/50";
}

export default function ServiceUnscheduledPage() {
  useActivityTracking();

  const [filterCategories, setFilterCategories] = useState<string[]>([]);
  const [filterStatuses, setFilterStatuses] = useState<string[]>([]);
  const [filterStates, setFilterStates] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("age");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const { data, isLoading, isError, refetch } = useQuery<UnscheduledResponse>({
    queryKey: queryKeys.projects.list({ context: "service-unscheduled" }),
    queryFn: async () => {
      const res = await fetch("/api/service/unscheduled-jobs");
      if (!res.ok) throw new Error("Failed to fetch unscheduled jobs");
      return res.json();
    },
    staleTime: 60 * 1000,
  });

  const jobs = data?.jobs ?? [];
  const lastUpdated = data?.lastUpdated ?? null;

  const categories = useMemo(
    () =>
      [...new Set(jobs.map((j) => j.jobCategory))]
        .filter(Boolean)
        .sort()
        .map((c) => ({ value: c, label: c })),
    [jobs]
  );

  const statuses = useMemo(
    () =>
      [...new Set(jobs.map((j) => j.jobStatus))]
        .filter(Boolean)
        .sort()
        .map((s) => ({ value: s, label: s })),
    [jobs]
  );

  const states = useMemo(
    () =>
      [...new Set(jobs.map((j) => j.state))]
        .filter(Boolean)
        .sort()
        .map((s) => ({ value: s, label: s })),
    [jobs]
  );

  const filteredJobs = useMemo(() => {
    return jobs.filter((j) => {
      if (filterCategories.length > 0 && !filterCategories.includes(j.jobCategory)) return false;
      if (filterStatuses.length > 0 && !filterStatuses.includes(j.jobStatus)) return false;
      if (filterStates.length > 0 && !filterStates.includes(j.state)) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (
          !(j.jobTitle || "").toLowerCase().includes(q) &&
          !(j.customerName || "").toLowerCase().includes(q) &&
          !(j.address || "").toLowerCase().includes(q) &&
          !(j.city || "").toLowerCase().includes(q) &&
          !(j.jobUid || "").toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [jobs, filterCategories, filterStatuses, filterStates, searchQuery]);

  const sortedJobs = useMemo(() => {
    return [...filteredJobs].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "age":
          cmp = a.ageDays - b.ageDays;
          break;
        case "title":
          cmp = (a.jobTitle || "").localeCompare(b.jobTitle || "");
          break;
        case "category":
          cmp = (a.jobCategory || "").localeCompare(b.jobCategory || "");
          break;
        case "status":
          cmp = (a.jobStatus || "").localeCompare(b.jobStatus || "");
          break;
        case "city":
          cmp = (a.city || "").localeCompare(b.city || "");
          break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
  }, [filteredJobs, sortField, sortDir]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir(field === "age" ? "desc" : "asc");
    }
  };

  const exportData = useMemo(
    () =>
      sortedJobs.map((j) => ({
        "Job Title": j.jobTitle,
        Category: j.jobCategory,
        Status: j.jobStatus,
        Priority: j.jobPriority || "",
        Customer: j.customerName || "",
        Address: j.address,
        City: j.city,
        State: j.state,
        Zip: j.zip,
        "Days Unscheduled": j.ageDays,
        Team: j.assignedTeam || "",
        "Assigned Users": j.assignedUserNames.join(", "),
        "HubSpot Deal ID": j.hubspotDealId || "",
        "Zuper URL": j.zuperUrl,
      })),
    [sortedJobs]
  );

  if (isLoading) {
    return (
      <DashboardShell title="Unscheduled Service Jobs" accentColor="cyan">
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400" />
        </div>
      </DashboardShell>
    );
  }

  if (isError) {
    return (
      <DashboardShell title="Unscheduled Service Jobs" accentColor="cyan">
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <p className="text-red-400">Failed to load unscheduled jobs.</p>
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

  const oldCount = jobs.filter((j) => j.ageDays >= 7).length;
  const newCount = jobs.length - oldCount;

  return (
    <DashboardShell
      title="Unscheduled Service Jobs"
      subtitle={`${jobs.length} jobs awaiting a scheduled date`}
      accentColor="cyan"
      lastUpdated={lastUpdated}
      exportData={{ data: exportData, filename: "unscheduled-service-jobs" }}
    >
      {/* Summary stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <div className="bg-surface/50 border border-t-border rounded-xl p-4">
          <div className="text-xs text-muted mb-1">Total Unscheduled</div>
          <div className="text-2xl font-bold text-cyan-400">{jobs.length}</div>
        </div>
        <div className="bg-surface/50 border border-t-border rounded-xl p-4">
          <div className="text-xs text-muted mb-1">Aged 7+ Days</div>
          <div className="text-2xl font-bold text-orange-400">{oldCount}</div>
        </div>
        <div className="bg-surface/50 border border-t-border rounded-xl p-4">
          <div className="text-xs text-muted mb-1">New (under 7 days)</div>
          <div className="text-2xl font-bold text-foreground/80">{newCount}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <MultiSelectFilter
          label="Category"
          options={categories}
          selected={filterCategories}
          onChange={setFilterCategories}
          placeholder="All Categories"
          accentColor="cyan"
        />
        <MultiSelectFilter
          label="Status"
          options={statuses}
          selected={filterStatuses}
          onChange={setFilterStatuses}
          placeholder="All Statuses"
          accentColor="blue"
        />
        <MultiSelectFilter
          label="State"
          options={states}
          selected={filterStates}
          onChange={setFilterStates}
          placeholder="All States"
          accentColor="purple"
        />
        <ProjectSearchBar onSearch={setSearchQuery} />
        <div className="ml-auto text-xs text-muted">
          Showing {sortedJobs.length} of {jobs.length}
        </div>
      </div>

      {/* Table */}
      <div className="bg-surface/50 border border-t-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto max-h-[70vh]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface/95 backdrop-blur-sm z-10">
              <tr className="text-muted text-left border-b border-t-border">
                <th
                  className="px-4 py-3 cursor-pointer hover:text-foreground"
                  onClick={() => handleSort("title")}
                >
                  Job <SortIcon field="title" current={sortField} dir={sortDir} />
                </th>
                <th
                  className="px-4 py-3 cursor-pointer hover:text-foreground"
                  onClick={() => handleSort("category")}
                >
                  Category <SortIcon field="category" current={sortField} dir={sortDir} />
                </th>
                <th
                  className="px-4 py-3 cursor-pointer hover:text-foreground"
                  onClick={() => handleSort("status")}
                >
                  Status <SortIcon field="status" current={sortField} dir={sortDir} />
                </th>
                <th
                  className="px-4 py-3 cursor-pointer hover:text-foreground"
                  onClick={() => handleSort("city")}
                >
                  Location <SortIcon field="city" current={sortField} dir={sortDir} />
                </th>
                <th className="px-4 py-3">Team</th>
                <th
                  className="px-4 py-3 cursor-pointer hover:text-foreground text-right"
                  onClick={() => handleSort("age")}
                >
                  Age <SortIcon field="age" current={sortField} dir={sortDir} />
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedJobs.map((j) => (
                <tr key={j.jobUid} className="border-b border-t-border/50 hover:bg-surface-2/30">
                  <td className="px-4 py-2.5">
                    <a
                      href={j.zuperUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block font-medium text-foreground/90 hover:text-cyan-400 truncate max-w-[280px] transition-colors"
                    >
                      {j.jobTitle}
                    </a>
                    {j.customerName && (
                      <div className="text-xs text-muted truncate max-w-[280px]">{j.customerName}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-foreground/80">{j.jobCategory}</td>
                  <td className="px-4 py-2.5">
                    <span className="inline-block text-xs px-2 py-0.5 rounded bg-surface-2/50 text-foreground/70">
                      {j.jobStatus}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-muted">
                    {[j.city, j.state].filter(Boolean).join(", ") || "—"}
                  </td>
                  <td className="px-4 py-2.5 text-muted text-xs">
                    {j.assignedUserNames.length > 0
                      ? j.assignedUserNames.join(", ")
                      : j.assignedTeam || "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span
                      className={`inline-block text-xs font-medium px-2 py-0.5 rounded ${ageBadgeColor(j.ageDays)}`}
                    >
                      {j.ageDays}d
                    </span>
                  </td>
                </tr>
              ))}
              {sortedJobs.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-muted">
                    {jobs.length === 0
                      ? "No unscheduled jobs — everything is on the calendar."
                      : "No jobs match the current filters"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardShell>
  );
}
