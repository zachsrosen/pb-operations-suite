"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { StatCard } from "@/components/ui/MetricCard";
import { MultiSelectFilter, type FilterOption } from "@/components/ui/MultiSelectFilter";
import { queryKeys } from "@/lib/query-keys";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

const STAGE_OPTIONS: FilterOption[] = [
  { value: "Construction", label: "Construction" },
  { value: "Inspection", label: "Inspection" },
];

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

function m1m2Badge(status: string | null) {
  if (!status) return <span className="text-muted">—</span>;
  const lower = status.toLowerCase();
  let color = "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400";
  if (lower.includes("paid") || lower.includes("approved"))
    color = "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
  else if (lower.includes("rejected") || lower.includes("resubmit"))
    color = "bg-red-500/10 text-red-600 dark:text-red-400";
  else if (lower.includes("submitted") || lower.includes("resubmitted"))
    color = "bg-blue-500/10 text-blue-600 dark:text-blue-400";
  else if (lower.includes("waiting") || lower.includes("ready"))
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

type SortKey = "daysInStage" | "dealName" | "stage" | "location" | "amount";

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
    }
    return asc ? cmp : -cmp;
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PePipelinePage() {
  const [locationFilter, setLocationFilter] = useState<string[]>([]);
  const [stageFilter, setStageFilter] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("daysInStage");
  const [sortAsc, setSortAsc] = useState(false); // descending by default

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

  // Filtered deals
  const filtered = useMemo(() => {
    let result = deals;
    if (locationFilter.length > 0) {
      result = result.filter((d) => locationFilter.includes(d.location));
    }
    if (stageFilter.length > 0) {
      result = result.filter((d) => stageFilter.includes(d.stage));
    }
    return sortDeals(result, sortKey, sortAsc);
  }, [deals, locationFilter, stageFilter, sortKey, sortAsc]);

  // Stats
  const stats = useMemo(() => {
    const inConstruction = filtered.filter((d) => d.stage === "Construction").length;
    const inInspection = filtered.filter((d) => d.stage === "Inspection").length;
    const totalDays = filtered.reduce((sum, d) => sum + d.daysInStage, 0);
    const avgDays = filtered.length > 0 ? Math.round(totalDays / filtered.length) : 0;
    const stale = filtered.filter((d) => d.daysInStage >= STALE_THRESHOLD).length;
    return { inConstruction, inInspection, avgDays, stale };
  }, [filtered]);

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
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="In Construction"
          value={isLoading ? null : stats.inConstruction}
          subtitle="PE deals"
          color="orange"
        />
        <StatCard
          label="In Inspection"
          value={isLoading ? null : stats.inInspection}
          subtitle="PE deals"
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

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <MultiSelectFilter
          label="Location"
          options={locationOptions}
          selected={locationFilter}
          onChange={setLocationFilter}
        />
        <MultiSelectFilter
          label="Stage"
          options={STAGE_OPTIONS}
          selected={stageFilter}
          onChange={setStageFilter}
        />
        <span className="text-muted ml-auto text-sm">
          {filtered.length} deal{filtered.length !== 1 ? "s" : ""}
        </span>
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
                <th className="px-3 py-2">M1 Status</th>
                <th className="px-3 py-2">M2 Status</th>
                <th className="px-3 py-2">Contact</th>
                {renderSortHeader("Amount", "amount")}
              </tr>
            </thead>
            <tbody>
              {filtered.map((deal) => (
                <tr key={deal.dealId} className="bg-surface rounded-md">
                  <td className="rounded-l-md px-3 py-3 font-medium">
                    <a
                      href={`https://app.hubspot.com/contacts/${process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID || "21710069"}/record/0-3/${deal.dealId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                    >
                      {deal.dealName}
                    </a>
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
                  <td className="px-3 py-3">{m1m2Badge(deal.m1Status)}</td>
                  <td className="px-3 py-3">{m1m2Badge(deal.m2Status)}</td>
                  <td className="text-muted px-3 py-3 text-xs">{deal.contactName || "—"}</td>
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
