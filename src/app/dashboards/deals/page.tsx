"use client";

import { useState, useEffect, useMemo, useCallback, Suspense } from "react";
import DashboardShell from "@/components/DashboardShell";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import type { FilterOption } from "@/components/ui/MultiSelectFilter";
import DealsTable from "./DealsTable";
import DealDetailPanel from "./DealDetailPanel";
import { useDealsFilters } from "./useDealsFilters";
import {
  type TableDeal,
  type SlimDeal,
  projectToTableDeal,
  isProjectPipeline,
  PIPELINE_OPTIONS,
  STATUS_COLUMNS,
} from "./deals-types";
import { STAGE_ORDER } from "@/lib/constants";
import { ACTIVE_STAGES } from "@/lib/deals-pipeline";
import { formatMoney } from "@/lib/format";
import { useSSE } from "@/hooks/useSSE";
import type { Project } from "@/lib/hubspot";

// Stage options per pipeline
function getStageOptions(pipeline: string): FilterOption[] {
  if (isProjectPipeline(pipeline)) {
    return STAGE_ORDER.map((s) => ({ value: s, label: s }));
  }
  const stages = ACTIVE_STAGES[pipeline] || [];
  return stages.map((s) => ({ value: s, label: s }));
}

// Location options from deal data
function getLocationOptions(deals: TableDeal[]): FilterOption[] {
  const locations = [...new Set(deals.map((d) => d.pbLocation).filter(Boolean))].sort();
  return locations.map((l) => ({ value: l, label: l }));
}

// Owner options from project data
function getOwnerOptions(deals: TableDeal[]): FilterOption[] {
  const owners = [
    ...new Set(deals.map((d) => d.dealOwner).filter((o): o is string => !!o)),
  ].sort();
  return owners.map((o) => ({ value: o, label: o }));
}

function DealsPageInner() {
  const { filters, setFilters, setStatusFilter } = useDealsFilters();
  const [allDeals, setAllDeals] = useState<TableDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [selectedDeal, setSelectedDeal] = useState<TableDeal | null>(null);
  const [searchInput, setSearchInput] = useState(filters.search);

  // Fetch data
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      let deals: TableDeal[];

      if (isProjectPipeline(filters.pipeline)) {
        // Fetch ALL projects (no location filter) so dropdown options stay complete.
        // Location filtering is applied client-side below.
        const params = new URLSearchParams({ limit: "0" });
        if (filters.search) params.set("search", filters.search);

        const res = await fetch(`/api/projects?${params}`);
        const data = await res.json();
        deals = (data.projects as Project[]).map(projectToTableDeal);
        setLastUpdated(data.lastUpdated);
      } else {
        // Fetch ALL deals for this pipeline (no location filter) so dropdown
        // options stay complete. Location filtering is applied client-side below.
        const params = new URLSearchParams({
          pipeline: filters.pipeline,
          limit: "0",
        });
        if (filters.search) params.set("search", filters.search);

        const res = await fetch(`/api/deals?${params}`);
        const data = await res.json();
        deals = data.deals as SlimDeal[];
        setLastUpdated(data.lastUpdated);
      }

      setAllDeals(deals);
    } catch (err) {
      console.error("Failed to fetch deals:", err);
    } finally {
      setLoading(false);
    }
  }, [filters.pipeline, filters.search]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // SSE for real-time updates
  useSSE(() => fetchData(), {
    url: "/api/stream",
    cacheKeyFilter: isProjectPipeline(filters.pipeline) ? "projects" : "deals",
  });

  // Debounce search input → URL
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== filters.search) {
        setFilters({ search: searchInput });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput, filters.search, setFilters]);

  // Client-side filtering: stages, owners, status columns, multi-location (deals API)
  const filteredDeals = useMemo(() => {
    let result = allDeals;

    // Location filter (always client-side to keep dropdown options complete)
    if (filters.locations.length > 0) {
      const locSet = new Set(filters.locations);
      result = result.filter((d) => locSet.has(d.pbLocation));
    }

    // Stage filter (always client-side since API only supports single stage)
    if (filters.stages.length > 0) {
      const stageSet = new Set(filters.stages);
      result = result.filter((d) => stageSet.has(d.stage));
    }

    // Owner filter (project pipeline only)
    if (filters.owners.length > 0 && isProjectPipeline(filters.pipeline)) {
      const ownerSet = new Set(filters.owners);
      result = result.filter((d) => d.dealOwner && ownerSet.has(d.dealOwner));
    }

    // Status column filters
    for (const [field, values] of Object.entries(filters.statusFilters)) {
      if (values.length > 0) {
        const valSet = new Set(values);
        result = result.filter((d) => {
          const val = d[field as keyof TableDeal] as string | null;
          return val && valSet.has(val);
        });
      }
    }

    return result;
  }, [allDeals, filters]);

  // Summary stats
  const stats = useMemo(() => {
    const totalValue = filteredDeals.reduce((sum, d) => sum + d.amount, 0);
    const avgDaysInStage = isProjectPipeline(filters.pipeline)
      ? Math.round(
          filteredDeals.reduce((sum, d) => sum + (d.daysSinceStageMovement || 0), 0) /
            (filteredDeals.length || 1)
        )
      : null;
    return { count: filteredDeals.length, totalValue, avgDaysInStage };
  }, [filteredDeals, filters.pipeline]);

  const isProject = isProjectPipeline(filters.pipeline);
  const stageOptions = useMemo(() => getStageOptions(filters.pipeline), [filters.pipeline]);
  const locationOptions = useMemo(() => getLocationOptions(allDeals), [allDeals]);
  const ownerOptions = useMemo(() => getOwnerOptions(allDeals), [allDeals]);

  const handleSort = useCallback(
    (field: string) => {
      if (filters.sort === field) {
        setFilters({ order: filters.order === "asc" ? "desc" : "asc" });
      } else {
        setFilters({ sort: field, order: "asc" });
      }
    },
    [filters.sort, filters.order, setFilters]
  );

  return (
    <DashboardShell
      title="Deals"
      accentColor="orange"
      lastUpdated={lastUpdated}
      fullWidth={true}
    >
      {/* Filter Bar */}
      <div className="flex items-center gap-3 flex-wrap mb-4">
        {/* Pipeline selector */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted uppercase tracking-wider">Pipeline</span>
          <select
            value={filters.pipeline}
            onChange={(e) => setFilters({ pipeline: e.target.value })}
            className="bg-surface-2 border border-t-border rounded-lg px-2 py-1.5 text-sm text-foreground focus:outline-none focus:border-muted"
          >
            {PIPELINE_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        {/* Stage multi-select */}
        <MultiSelectFilter
          label="Stage"
          options={stageOptions}
          selected={filters.stages}
          onChange={(stages) => setFilters({ stages })}
          accentColor="orange"
        />

        {/* Location multi-select */}
        <MultiSelectFilter
          label="Location"
          options={locationOptions}
          selected={filters.locations}
          onChange={(locations) => setFilters({ locations })}
          accentColor="orange"
        />

        {/* Owner filter — project pipeline only */}
        {isProject && (
          <MultiSelectFilter
            label="Owner"
            options={ownerOptions}
            selected={filters.owners}
            onChange={(owners) => setFilters({ owners })}
            accentColor="orange"
          />
        )}

        {/* Search */}
        <div className="relative ml-auto">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search deals..."
            className="pl-8 pr-3 py-1.5 w-[180px] bg-surface-2 border border-t-border rounded-lg text-sm focus:outline-none focus:border-muted"
          />
        </div>

        {/* Deal count */}
        <span className="text-xs text-muted">{stats.count} deals</span>
      </div>

      {/* Active filter pills */}
      {(filters.stages.length > 0 || filters.locations.length > 0 || filters.owners.length > 0) && (
        <div className="flex gap-2 flex-wrap mb-3">
          {filters.stages.map((s) => (
            <FilterPill
              key={`stage-${s}`}
              label={s}
              onRemove={() => setFilters({ stages: filters.stages.filter((v) => v !== s) })}
            />
          ))}
          {filters.locations.map((l) => (
            <FilterPill
              key={`loc-${l}`}
              label={l}
              onRemove={() => setFilters({ locations: filters.locations.filter((v) => v !== l) })}
            />
          ))}
          {filters.owners.map((o) => (
            <FilterPill
              key={`owner-${o}`}
              label={o}
              onRemove={() => setFilters({ owners: filters.owners.filter((v) => v !== o) })}
            />
          ))}
        </div>
      )}

      {/* Summary Stats */}
      <div className="flex gap-5 mb-4">
        <StatBadge value={stats.count} label="Deals" color="#fb923c" />
        <StatBadge value={formatMoney(stats.totalValue)} label="Total Value" color="#4ade80" />
        {isProject && stats.avgDaysInStage != null && (
          <StatBadge value={stats.avgDaysInStage} label="Avg Days in Stage" color="#38bdf8" />
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted">
          <div className="animate-spin w-5 h-5 border-2 border-muted border-t-orange-400 rounded-full mr-3" />
          Loading deals...
        </div>
      ) : (
        <div className="bg-surface border border-t-border rounded-xl overflow-hidden shadow-card">
          <DealsTable
            deals={filteredDeals}
            sort={filters.sort}
            order={filters.order}
            onSort={handleSort}
            onRowClick={setSelectedDeal}
            pipeline={filters.pipeline}
            statusFilters={filters.statusFilters}
            onStatusFilterChange={setStatusFilter}
          />
        </div>
      )}

      {/* Detail Panel */}
      <DealDetailPanel deal={selectedDeal} onClose={() => setSelectedDeal(null)} />
    </DashboardShell>
  );
}

function FilterPill({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-orange-500/15 text-orange-400 border border-orange-500/30 rounded-md text-xs">
      {label}
      <button onClick={onRemove} className="hover:text-orange-200 ml-0.5">
        ×
      </button>
    </span>
  );
}

function StatBadge({ value, label, color }: { value: string | number; label: string; color: string }) {
  return (
    <div className="text-center">
      <div className="text-lg font-bold" style={{ color }}>
        {value}
      </div>
      <div className="text-[10px] text-muted">{label}</div>
    </div>
  );
}

// Wrap in Suspense for useSearchParams
export default function DealsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen text-muted">Loading...</div>}>
      <DealsPageInner />
    </Suspense>
  );
}
