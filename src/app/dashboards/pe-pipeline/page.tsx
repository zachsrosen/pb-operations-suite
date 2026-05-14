"use client";

import { useState, useMemo, useCallback, Fragment } from "react";
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

interface PeDocReview {
  docName: string;
  status: string;
  notes: string | null;
  reviewedAt: string;
}

interface PeActionItemSummary {
  id: string;
  docLabel: string;
  errorCode: string | null;
  pageNumber: number | null;
  reviewer: string;
  notes: string | null;
  actionDate: string;
  resolved: boolean;
}

interface PePipelineDeal {
  dealId: string;
  dealName: string;
  stage: string;
  location: string;
  daysInStage: number;
  dateEnteredStage: string | null;
  m1Status: string | null;
  m2Status: string | null;
  amount: number | null;
  contactName: string | null;
  constructionStatus: string | null;
  finalInspectionStatus: string | null;
  zuperJobs: ZuperJobLink[];
  docReviews: PeDocReview[];
  actionItems: PeActionItemSummary[];
  actionRequired: number;
  docsApproved: number;
  totalDocs: number;
}

interface PePipelineResponse {
  deals: PePipelineDeal[];
  cached: boolean;
  stale: boolean;
  lastUpdated: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STALE_THRESHOLD = 14; // days
const WATCH_THRESHOLD = 7; // days

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
  const isConstruction = stage === "Construction";
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
        isConstruction
          ? "bg-orange-500/10 text-orange-600 dark:text-orange-400"
          : "bg-blue-500/10 text-blue-600 dark:text-blue-400"
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

function docStatusColor(status: string): string {
  switch (status) {
    case "APPROVED": return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
    case "ACTION_REQUIRED": return "bg-red-500/10 text-red-600 dark:text-red-400";
    case "UNDER_REVIEW": return "bg-blue-500/10 text-blue-600 dark:text-blue-400";
    case "UPLOADED": return "bg-amber-500/10 text-amber-600 dark:text-amber-400";
    case "REJECTED": return "bg-red-500/10 text-red-600 dark:text-red-400";
    default: return "bg-zinc-500/10 text-zinc-500 dark:text-zinc-400";
  }
}

function docStatusLabel(status: string): string {
  switch (status) {
    case "APPROVED": return "Approved";
    case "ACTION_REQUIRED": return "Action Required";
    case "UNDER_REVIEW": return "Under Review";
    case "UPLOADED": return "Uploaded";
    case "NOT_UPLOADED": return "Not Uploaded";
    case "REJECTED": return "Rejected";
    default: return status;
  }
}

function fmtCurrency(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ---------------------------------------------------------------------------
// Sort
// ---------------------------------------------------------------------------

type SortKey = "daysInStage" | "dealName" | "stage" | "location" | "amount" | "constructionStatus" | "inspectionStatus" | "actionRequired";

function sortDeals(deals: PePipelineDeal[], key: SortKey, asc: boolean): PePipelineDeal[] {
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
      case "constructionStatus":
        cmp = (a.constructionStatus ?? "").localeCompare(b.constructionStatus ?? "");
        break;
      case "inspectionStatus":
        cmp = (a.finalInspectionStatus ?? "").localeCompare(b.finalInspectionStatus ?? "");
        break;
      case "actionRequired":
        cmp = a.actionRequired - b.actionRequired;
        break;
    }
    return asc ? cmp : -cmp;
  });
}

// ---------------------------------------------------------------------------
// Expandable detail row
// ---------------------------------------------------------------------------

function DocReviewDetail({ deal }: { deal: PePipelineDeal }) {
  const openActions = deal.actionItems.filter((a) => !a.resolved);

  return (
    <div className="grid gap-4 md:grid-cols-2 p-4">
      {/* Document statuses */}
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">
          Document Review ({deal.docsApproved}/{deal.totalDocs} approved)
        </h4>
        {deal.docReviews.length === 0 ? (
          <p className="text-muted text-xs">No document review data yet. Run PE API sync.</p>
        ) : (
          <div className="space-y-1">
            {deal.docReviews.map((doc) => (
              <div key={doc.docName} className="flex items-center gap-2 text-xs">
                <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${
                  doc.status === "APPROVED" ? "bg-emerald-500" :
                  doc.status === "ACTION_REQUIRED" ? "bg-red-500" :
                  doc.status === "UNDER_REVIEW" ? "bg-blue-500" :
                  doc.status === "UPLOADED" ? "bg-amber-500" :
                  "bg-zinc-400"
                }`} />
                <span className="text-foreground truncate flex-1">{doc.docName}</span>
                <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[0.6rem] font-semibold ${docStatusColor(doc.status)}`}>
                  {docStatusLabel(doc.status)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Action items */}
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">
          Action Items ({openActions.length} open)
        </h4>
        {deal.actionItems.length === 0 ? (
          <p className="text-muted text-xs">No action items.</p>
        ) : (
          <div className="space-y-2">
            {deal.actionItems.map((item) => (
              <div
                key={item.id}
                className={`rounded-md border p-2 text-xs ${
                  item.resolved
                    ? "border-emerald-500/20 bg-emerald-500/5 opacity-60"
                    : "border-red-500/20 bg-red-500/5"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-foreground">{item.docLabel}</span>
                  {item.errorCode && (
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[0.6rem] text-muted">
                      {item.errorCode}
                    </span>
                  )}
                  {item.pageNumber && (
                    <span className="text-muted">p.{item.pageNumber}</span>
                  )}
                  <span className="ml-auto text-muted">{fmtDate(item.actionDate)}</span>
                </div>
                {item.notes && (
                  <p className="text-muted leading-snug">{item.notes}</p>
                )}
                <p className="text-muted mt-0.5">Reviewer: {item.reviewer}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type StageTab = "all" | "Construction" | "Inspection";

export default function PePipelinePage() {
  const [locationFilter, setLocationFilter] = useState<string[]>([]);
  const [constructionStatusFilter, setConstructionStatusFilter] = useState<string[]>([]);
  const [inspectionStatusFilter, setInspectionStatusFilter] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<StageTab>("all");
  const [sortKey, setSortKey] = useState<SortKey>("daysInStage");
  const [sortAsc, setSortAsc] = useState(false);
  const [expandedDealIds, setExpandedDealIds] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((dealId: string) => {
    setExpandedDealIds((prev) => {
      const next = new Set(prev);
      if (next.has(dealId)) next.delete(dealId);
      else next.add(dealId);
      return next;
    });
  }, []);

  const { data, isLoading } = useQuery<PePipelineResponse>({
    queryKey: queryKeys.pePipeline(),
    queryFn: async () => {
      const res = await fetch("/api/deals/pe-pipeline");
      if (!res.ok) throw new Error("Failed to fetch PE pipeline data");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const deals = useMemo(() => data?.deals ?? [], [data]);

  // Derive location options from data
  const locationOptions: FilterOption[] = useMemo(() => {
    const locs = new Set(deals.map((d) => d.location).filter(Boolean));
    return [...locs].sort().map((l) => ({ value: l, label: l }));
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
    if (constructionStatusFilter.length > 0) {
      result = result.filter((d) => d.constructionStatus && constructionStatusFilter.includes(d.constructionStatus));
    }
    if (inspectionStatusFilter.length > 0) {
      result = result.filter((d) => d.finalInspectionStatus && inspectionStatusFilter.includes(d.finalInspectionStatus));
    }
    return sortDeals(result, sortKey, sortAsc);
  }, [deals, locationFilter, constructionStatusFilter, inspectionStatusFilter, activeTab, sortKey, sortAsc]);

  // Stats
  const stats = useMemo(() => {
    const inConstruction = filtered.filter((d) => d.stage === "Construction").length;
    const inInspection = filtered.filter((d) => d.stage === "Inspection").length;
    const totalDays = filtered.reduce((sum, d) => sum + d.daysInStage, 0);
    const avgDays = filtered.length > 0 ? Math.round(totalDays / filtered.length) : 0;
    const stale = filtered.filter((d) => d.daysInStage >= STALE_THRESHOLD).length;
    const withActions = filtered.filter((d) => d.actionRequired > 0).length;
    const constructionRevenue = filtered
      .filter((d) => d.stage === "Construction")
      .reduce((sum, d) => sum + (d.amount ?? 0), 0);
    const inspectionRevenue = filtered
      .filter((d) => d.stage === "Inspection")
      .reduce((sum, d) => sum + (d.amount ?? 0), 0);
    return { inConstruction, inInspection, avgDays, stale, withActions, constructionRevenue, inspectionRevenue };
  }, [filtered]);

  // Column count for detail row colspan
  const colCount = useMemo(() => {
    let count = 6; // deal, location, stage, days, docs, amount
    if (activeTab !== "Inspection") count++; // construction
    if (activeTab !== "Construction") count++; // inspection
    return count;
  }, [activeTab]);

  // Sort handler
  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(key === "dealName" || key === "location"); // alpha asc, numeric desc
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
      title="PE Pipeline Tracker"
      accentColor="orange"
      lastUpdated={data?.lastUpdated}
      fullWidth
    >
      {/* Hero Stats */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard
          label="In Construction"
          value={isLoading ? null : stats.inConstruction}
          subtitle={isLoading ? "PE deals" : fmtCurrency(stats.constructionRevenue)}
          color="orange"
        />
        <StatCard
          label="In Inspection"
          value={isLoading ? null : stats.inInspection}
          subtitle={isLoading ? "PE deals" : fmtCurrency(stats.inspectionRevenue)}
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
        <StatCard
          label="Action Required"
          value={isLoading ? null : stats.withActions}
          subtitle="deals with PE issues"
          color="red"
        />
      </div>

      {/* Stage Tabs + Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-t-border overflow-hidden">
          {(["all", "Construction", "Inspection"] as StageTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setConstructionStatusFilter([]); setInspectionStatusFilter([]); }}
              className={`px-4 py-2 text-xs font-semibold cursor-pointer transition-colors ${
                activeTab === tab
                  ? tab === "Construction"
                    ? "bg-orange-500 text-black"
                    : tab === "Inspection"
                      ? "bg-blue-500 text-white"
                      : "bg-surface-elevated text-foreground"
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
          ))}
        </div>
        <MultiSelectFilter
          label="Location"
          options={locationOptions}
          selected={locationFilter}
          onChange={setLocationFilter}
        />
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
            href="/dashboards/pipeline-tracker"
            className="text-xs font-medium text-orange-500 hover:text-orange-400 transition-colors"
          >
            ← All Pipelines
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
          No PE deals in construction or inspection stages.
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
                {activeTab !== "Inspection" && renderSortHeader("Construction", "constructionStatus")}
                {activeTab !== "Construction" && renderSortHeader("Inspection", "inspectionStatus")}
                {renderSortHeader("PE Docs", "actionRequired")}
                {renderSortHeader("Amount", "amount")}
              </tr>
            </thead>
            <tbody>
              {filtered.map((deal) => {
                const isExpanded = expandedDealIds.has(deal.dealId);
                return (
                  <Fragment key={deal.dealId}><tr
                      className={`bg-surface rounded-md cursor-pointer transition-colors hover:bg-surface-2 ${isExpanded ? "bg-surface-2" : ""}`}
                      onClick={() => toggleExpand(deal.dealId)}
                    >
                      <td className="rounded-l-md px-3 py-3 font-medium">
                        <div className="flex items-center gap-2">
                          <span className={`text-muted transition-transform text-xs ${isExpanded ? "rotate-90" : ""}`}>▶</span>
                          <a
                            href={`https://app.hubspot.com/contacts/${process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID || "21710069"}/record/0-3/${deal.dealId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:underline"
                            onClick={(e) => e.stopPropagation()}
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
                      {activeTab !== "Inspection" && <td className="px-3 py-3">{statusBadge(deal.constructionStatus)}</td>}
                      {activeTab !== "Construction" && <td className="px-3 py-3">{statusBadge(deal.finalInspectionStatus)}</td>}
                      <td className="px-3 py-3">
                        {deal.totalDocs > 0 ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-muted">
                              {deal.docsApproved}/{deal.totalDocs}
                            </span>
                            {/* Mini progress bar */}
                            <div className="h-1.5 w-16 rounded-full bg-surface-2 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-emerald-500 transition-all"
                                style={{ width: `${deal.totalDocs > 0 ? (deal.docsApproved / deal.totalDocs) * 100 : 0}%` }}
                              />
                            </div>
                            {deal.actionRequired > 0 && (
                              <span className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[0.6rem] font-bold bg-red-500/10 text-red-600 dark:text-red-400">
                                {deal.actionRequired} issue{deal.actionRequired !== 1 ? "s" : ""}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted text-xs">—</span>
                        )}
                      </td>
                      <td className="rounded-r-md px-3 py-3 text-right font-mono text-xs">
                        {fmtCurrency(deal.amount)}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${deal.dealId}-detail`}>
                        <td colSpan={colCount} className="bg-surface-2 rounded-md px-2 py-1">
                          <DocReviewDetail deal={deal} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </DashboardShell>
  );
}
