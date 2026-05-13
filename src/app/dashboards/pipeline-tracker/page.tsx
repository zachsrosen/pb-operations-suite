"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { StatCard } from "@/components/ui/MetricCard";
import { MultiSelectFilter, type FilterOption } from "@/components/ui/MultiSelectFilter";
import { queryKeys } from "@/lib/query-keys";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ZuperJobLink {
  jobUid: string;
  category: string;
  status: string;
  url: string;
}

interface PipelineDeal {
  dealId: string;
  dealName: string;
  stage: string;
  location: string;
  daysInStage: number;
  dateEnteredStage: string | null;
  amount: number | null;
  constructionStatus: string | null;
  finalInspectionStatus: string | null;
  siteSurveyStatus: string | null;
  isPE: boolean;
  zuperJobs: ZuperJobLink[];
}

interface PipelineResponse {
  deals: PipelineDeal[];
  cached: boolean;
  stale: boolean;
  lastUpdated: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STALE_THRESHOLD = 14;
const WATCH_THRESHOLD = 7;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysColor(days: number): string {
  if (days >= STALE_THRESHOLD) return "text-red-500 dark:text-red-400";
  if (days >= WATCH_THRESHOLD) return "text-amber-500 dark:text-amber-400";
  return "text-emerald-500 dark:text-emerald-400";
}

function daysBg(days: number): string {
  if (days >= STALE_THRESHOLD) return "bg-red-500/10";
  if (days >= WATCH_THRESHOLD) return "bg-amber-500/10";
  return "bg-emerald-500/10";
}

function stageBadge(stage: string) {
  const colorMap: Record<string, string> = {
    "Site Survey": "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    Construction: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
    Inspection: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  };
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
        colorMap[stage] ?? "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400"
      }`}
    >
      {stage}
    </span>
  );
}

function statusBadge(status: string | null) {
  if (!status) return <span className="text-muted">—</span>;
  const lower = status.toLowerCase();
  let color = "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400";
  if (lower.includes("complete") || lower.includes("pass"))
    color = "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
  else if (lower.includes("fail") || lower.includes("cancel"))
    color = "bg-red-500/10 text-red-600 dark:text-red-400";
  else if (lower.includes("schedule") || lower.includes("progress"))
    color = "bg-blue-500/10 text-blue-600 dark:text-blue-400";
  else if (lower.includes("pending") || lower.includes("waiting") || lower.includes("hold"))
    color = "bg-amber-500/10 text-amber-600 dark:text-amber-400";
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${color}`}>
      {status}
    </span>
  );
}

function fmtCurrency(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

// ---------------------------------------------------------------------------
// Sort
// ---------------------------------------------------------------------------

type SortKey = "daysInStage" | "dealName" | "stage" | "location" | "amount" | "surveyStatus" | "constructionStatus" | "inspectionStatus";

function sortDeals(deals: PipelineDeal[], key: SortKey, asc: boolean): PipelineDeal[] {
  return [...deals].sort((a, b) => {
    let cmp = 0;
    switch (key) {
      case "daysInStage":
        cmp = a.daysInStage - b.daysInStage;
        break;
      case "dealName":
        cmp = a.dealName.localeCompare(b.dealName);
        break;
      case "stage":
        cmp = a.stage.localeCompare(b.stage);
        break;
      case "location":
        cmp = a.location.localeCompare(b.location);
        break;
      case "amount":
        cmp = (a.amount ?? 0) - (b.amount ?? 0);
        break;
      case "surveyStatus":
        cmp = (a.siteSurveyStatus ?? "").localeCompare(b.siteSurveyStatus ?? "");
        break;
      case "constructionStatus":
        cmp = (a.constructionStatus ?? "").localeCompare(b.constructionStatus ?? "");
        break;
      case "inspectionStatus":
        cmp = (a.finalInspectionStatus ?? "").localeCompare(b.finalInspectionStatus ?? "");
        break;
    }
    return asc ? cmp : -cmp;
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type StageTab = "all" | "Site Survey" | "Construction" | "Inspection";

export default function PipelineTrackerPage() {
  const [locationFilter, setLocationFilter] = useState<string[]>([]);
  const [surveyStatusFilter, setSurveyStatusFilter] = useState<string[]>([]);
  const [constructionStatusFilter, setConstructionStatusFilter] = useState<string[]>([]);
  const [inspectionStatusFilter, setInspectionStatusFilter] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<StageTab>("all");
  const [sortKey, setSortKey] = useState<SortKey>("daysInStage");
  const [sortAsc, setSortAsc] = useState(false);

  const { data, isLoading } = useQuery<PipelineResponse>({
    queryKey: queryKeys.pipelineTracker(),
    queryFn: async () => {
      const res = await fetch("/api/deals/pipeline-tracker");
      if (!res.ok) throw new Error("Failed to fetch pipeline data");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const deals = useMemo(() => data?.deals ?? [], [data]);

  const locationOptions: FilterOption[] = useMemo(() => {
    const locs = new Set(deals.map((d) => d.location).filter(Boolean));
    return [...locs].sort().map((l) => ({ value: l, label: l }));
  }, [deals]);

  const surveyStatusOptions: FilterOption[] = useMemo(() => {
    const s = new Set(deals.map((d) => d.siteSurveyStatus).filter(Boolean) as string[]);
    return [...s].sort().map((v) => ({ value: v, label: v }));
  }, [deals]);

  const constructionStatusOptions: FilterOption[] = useMemo(() => {
    const s = new Set(deals.map((d) => d.constructionStatus).filter(Boolean) as string[]);
    return [...s].sort().map((v) => ({ value: v, label: v }));
  }, [deals]);

  const inspectionStatusOptions: FilterOption[] = useMemo(() => {
    const s = new Set(deals.map((d) => d.finalInspectionStatus).filter(Boolean) as string[]);
    return [...s].sort().map((v) => ({ value: v, label: v }));
  }, [deals]);

  const filtered = useMemo(() => {
    let result = deals;
    if (locationFilter.length > 0) {
      result = result.filter((d) => locationFilter.includes(d.location));
    }
    if (activeTab !== "all") {
      result = result.filter((d) => d.stage === activeTab);
    }
    if (surveyStatusFilter.length > 0) {
      result = result.filter((d) => d.siteSurveyStatus && surveyStatusFilter.includes(d.siteSurveyStatus));
    }
    if (constructionStatusFilter.length > 0) {
      result = result.filter((d) => d.constructionStatus && constructionStatusFilter.includes(d.constructionStatus));
    }
    if (inspectionStatusFilter.length > 0) {
      result = result.filter((d) => d.finalInspectionStatus && inspectionStatusFilter.includes(d.finalInspectionStatus));
    }
    return sortDeals(result, sortKey, sortAsc);
  }, [deals, locationFilter, surveyStatusFilter, constructionStatusFilter, inspectionStatusFilter, activeTab, sortKey, sortAsc]);

  const stats = useMemo(() => {
    const inSiteSurvey = filtered.filter((d) => d.stage === "Site Survey").length;
    const inConstruction = filtered.filter((d) => d.stage === "Construction").length;
    const inInspection = filtered.filter((d) => d.stage === "Inspection").length;
    const totalDays = filtered.reduce((sum, d) => sum + d.daysInStage, 0);
    const avgDays = filtered.length > 0 ? Math.round(totalDays / filtered.length) : 0;
    const stale = filtered.filter((d) => d.daysInStage >= STALE_THRESHOLD).length;
    const siteSurveyRevenue = filtered
      .filter((d) => d.stage === "Site Survey")
      .reduce((sum, d) => sum + (d.amount ?? 0), 0);
    const constructionRevenue = filtered
      .filter((d) => d.stage === "Construction")
      .reduce((sum, d) => sum + (d.amount ?? 0), 0);
    const inspectionRevenue = filtered
      .filter((d) => d.stage === "Inspection")
      .reduce((sum, d) => sum + (d.amount ?? 0), 0);
    return { inSiteSurvey, inConstruction, inInspection, avgDays, stale, siteSurveyRevenue, constructionRevenue, inspectionRevenue };
  }, [filtered]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(key === "dealName" || key === "location");
    }
  }

  function renderSortHeader(label: string, field: SortKey) {
    return (
      <th
        className="cursor-pointer select-none px-3 py-2 hover:text-foreground"
        onClick={() => handleSort(field)}
      >
        {label} {sortKey === field ? (sortAsc ? "▲" : "▼") : ""}
      </th>
    );
  }

  return (
    <DashboardShell
      title="Pipeline Tracker"
      accentColor="orange"
      lastUpdated={data?.lastUpdated}
      fullWidth
    >
      {/* Hero Stats */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard
          label="Site Survey"
          value={isLoading ? null : stats.inSiteSurvey}
          subtitle={isLoading ? "deals" : fmtCurrency(stats.siteSurveyRevenue)}
          color="emerald"
        />
        <StatCard
          label="In Construction"
          value={isLoading ? null : stats.inConstruction}
          subtitle={isLoading ? "deals" : fmtCurrency(stats.constructionRevenue)}
          color="orange"
        />
        <StatCard
          label="In Inspection"
          value={isLoading ? null : stats.inInspection}
          subtitle={isLoading ? "deals" : fmtCurrency(stats.inspectionRevenue)}
          color="blue"
        />
        <StatCard
          label="Avg Days in Stage"
          value={isLoading ? null : stats.avgDays}
          subtitle="across all"
          color="purple"
        />
        <StatCard
          label={`Stale (${STALE_THRESHOLD}+ days)`}
          value={isLoading ? null : stats.stale}
          subtitle="need attention"
          color="red"
        />
      </div>

      {/* Stage Tabs + Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-t-border overflow-hidden">
          {(["all", "Site Survey", "Construction", "Inspection"] as StageTab[]).map((tab) => {
            const tabColor =
              tab === "Site Survey"
                ? "bg-emerald-500 text-black"
                : tab === "Construction"
                  ? "bg-orange-500 text-black"
                  : tab === "Inspection"
                    ? "bg-blue-500 text-white"
                    : "bg-surface-elevated text-foreground";
            return (
              <button
                key={tab}
                onClick={() => { setActiveTab(tab); setSurveyStatusFilter([]); setConstructionStatusFilter([]); setInspectionStatusFilter([]); }}
                className={`px-4 py-2 text-xs font-semibold cursor-pointer transition-colors ${
                  activeTab === tab
                    ? tabColor
                    : "bg-background text-muted hover:text-foreground"
                }`}
              >
                {tab === "all" ? "All" : tab}
                <span className="ml-1.5 opacity-70">
                  {tab === "all"
                    ? deals.filter((d) => locationFilter.length === 0 || locationFilter.includes(d.location)).length
                    : deals.filter((d) => d.stage === tab && (locationFilter.length === 0 || locationFilter.includes(d.location))).length}
                </span>
              </button>
            );
          })}
        </div>
        <MultiSelectFilter
          label="Location"
          options={locationOptions}
          selected={locationFilter}
          onChange={setLocationFilter}
        />
        {(activeTab === "all" || activeTab === "Site Survey") && (
          <MultiSelectFilter
            label="Survey Status"
            options={surveyStatusOptions}
            selected={surveyStatusFilter}
            onChange={setSurveyStatusFilter}
          />
        )}
        {(activeTab === "all" || activeTab === "Construction") && (
          <MultiSelectFilter
            label="Construction Status"
            options={constructionStatusOptions}
            selected={constructionStatusFilter}
            onChange={setConstructionStatusFilter}
          />
        )}
        {(activeTab === "all" || activeTab === "Inspection") && (
          <MultiSelectFilter
            label="Inspection Status"
            options={inspectionStatusOptions}
            selected={inspectionStatusFilter}
            onChange={setInspectionStatusFilter}
          />
        )}
        <div className="ml-auto flex items-center gap-3">
          <Link
            href="/dashboards/pe-pipeline"
            className="text-xs font-medium text-emerald-500 hover:text-emerald-400 transition-colors"
          >
            PE Pipeline →
          </Link>
          <span className="text-muted text-sm">
            {filtered.length} deal{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="border-t-border h-8 w-8 animate-spin rounded-full border-2 border-transparent" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-muted py-20 text-center">
          No deals found.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-y-1 text-sm">
            <thead className="text-muted text-left text-xs uppercase tracking-wide">
              <tr>
                {renderSortHeader("Deal", "dealName")}
                {renderSortHeader("Location", "location")}
                {renderSortHeader("Stage", "stage")}
                {renderSortHeader("Days in Stage", "daysInStage")}
                {(activeTab === "all" || activeTab === "Site Survey") && renderSortHeader("Survey Status", "surveyStatus")}
                {(activeTab === "all" || activeTab === "Construction") && renderSortHeader("Construction", "constructionStatus")}
                {(activeTab === "all" || activeTab === "Inspection") && renderSortHeader("Inspection", "inspectionStatus")}
                <th className="px-3 py-2">Zuper</th>
                {renderSortHeader("Amount", "amount")}
              </tr>
            </thead>
            <tbody>
              {filtered.map((deal) => (
                <tr key={deal.dealId} className={`bg-surface rounded-md ${deal.isPE ? "border-l-[3px] border-l-emerald-500" : ""}`}>
                  <td className="rounded-l-md px-3 py-3 font-medium">
                    <div className="flex items-center gap-1.5">
                      {deal.isPE && (
                        <span className="inline-block rounded-full px-1.5 py-0.5 text-[0.6rem] font-semibold bg-emerald-500/15 text-emerald-500 border border-emerald-500/30">
                          PE
                        </span>
                      )}
                      <a
                        href={`https://app.hubspot.com/contacts/${process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID || "21710069"}/record/0-3/${deal.dealId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline"
                      >
                        {deal.dealName}
                      </a>
                    </div>
                  </td>
                  <td className="px-3 py-3">{deal.location || "—"}</td>
                  <td className="px-3 py-3">{stageBadge(deal.stage)}</td>
                  <td className="px-3 py-3">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${daysBg(deal.daysInStage)} ${daysColor(deal.daysInStage)}`}
                    >
                      {deal.daysInStage}d
                    </span>
                  </td>
                  {(activeTab === "all" || activeTab === "Site Survey") && <td className="px-3 py-3">{statusBadge(deal.siteSurveyStatus)}</td>}
                  {(activeTab === "all" || activeTab === "Construction") && <td className="px-3 py-3">{statusBadge(deal.constructionStatus)}</td>}
                  {(activeTab === "all" || activeTab === "Inspection") && <td className="px-3 py-3">{statusBadge(deal.finalInspectionStatus)}</td>}
                  <td className="px-3 py-3">
                    {deal.zuperJobs.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {deal.zuperJobs.map((job) => (
                          <a
                            key={job.jobUid}
                            href={job.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`${job.category} — ${job.status}`}
                            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20 transition-colors"
                          >
                            {job.category === "Site Survey" ? "Survey" : job.category}
                          </a>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="rounded-r-md px-3 py-3 text-right font-mono text-xs">
                    {fmtCurrency(deal.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DashboardShell>
  );
}
