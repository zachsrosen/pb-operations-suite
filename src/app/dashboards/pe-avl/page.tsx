"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { StatCard } from "@/components/ui/MetricCard";
import { MultiSelectFilter, type FilterOption } from "@/components/ui/MultiSelectFilter";
import { queryKeys } from "@/lib/query-keys";
import type { PeAvlData, PeAvlEntry } from "@/lib/pe-avl";

// ---------------------------------------------------------------------------
// Category display labels (API returns snake_case)
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<string, string> = {
  pv_module: "PV Module",
  pv_inverter: "Inverter",
  pv_racking: "Racking",
  pv_optimizer: "Optimizer",
  pv_fasteners: "Fasteners",
  bess: "Battery (BESS)",
  ev_charger: "EV Charger",
  monitoring: "Monitoring",
};

function categoryLabel(raw: string): string {
  return CATEGORY_LABELS[raw] ?? raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const CATEGORY_COLORS: Record<string, string> = {
  pv_module: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  pv_inverter: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  pv_racking: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  pv_optimizer: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
  pv_fasteners: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
  bess: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  ev_charger: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  monitoring: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
};

function categoryBadge(raw: string) {
  const color = CATEGORY_COLORS[raw] ?? "bg-blue-500/10 text-blue-600 dark:text-blue-400";
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${color}`}>
      {categoryLabel(raw)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Sort
// ---------------------------------------------------------------------------

type SortKey = "manufacturer" | "description" | "category" | "sku";

function sortEntries(entries: PeAvlEntry[], key: SortKey, asc: boolean): PeAvlEntry[] {
  return [...entries].sort((a, b) => {
    const av = String(a[key] ?? "");
    const bv = String(b[key] ?? "");
    const cmp = av.localeCompare(bv);
    return asc ? cmp : -cmp;
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PeAvlPage() {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [manufacturerFilter, setManufacturerFilter] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("manufacturer");
  const [sortAsc, setSortAsc] = useState(true);

  const { data, isLoading } = useQuery<PeAvlData>({
    queryKey: queryKeys.peAvl(),
    queryFn: async () => {
      const res = await fetch("/api/pe-avl");
      if (!res.ok) throw new Error("Failed to fetch AVL data");
      return res.json();
    },
    staleTime: 30 * 60 * 1000,
  });

  const entries = useMemo(() => data?.entries ?? [], [data]);

  const categoryOptions: FilterOption[] = useMemo(() => {
    const cats = new Set(entries.map((e) => e.category).filter(Boolean));
    return [...cats].sort().map((c) => ({ value: c, label: categoryLabel(c) }));
  }, [entries]);

  const manufacturerOptions: FilterOption[] = useMemo(() => {
    const mfrs = new Set(entries.map((e) => e.manufacturer).filter(Boolean));
    return [...mfrs].sort().map((m) => ({ value: m, label: m }));
  }, [entries]);

  const filtered = useMemo(() => {
    let result = entries;

    if (categoryFilter.length > 0) {
      result = result.filter((e) => categoryFilter.includes(e.category));
    }
    if (manufacturerFilter.length > 0) {
      result = result.filter((e) => manufacturerFilter.includes(e.manufacturer));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (e) =>
          e.manufacturer?.toLowerCase().includes(q) ||
          e.description?.toLowerCase().includes(q) ||
          e.sku?.toLowerCase().includes(q) ||
          e.category?.toLowerCase().includes(q),
      );
    }

    return sortEntries(result, sortKey, sortAsc);
  }, [entries, categoryFilter, manufacturerFilter, search, sortKey, sortAsc]);

  const stats = useMemo(() => {
    const categories = new Set(entries.map((e) => e.category).filter(Boolean));
    const manufacturers = new Set(entries.map((e) => e.manufacturer).filter(Boolean));
    return {
      total: entries.length,
      categories: categories.size,
      manufacturers: manufacturers.size,
    };
  }, [entries]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
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
      title="PE Approved Vendor List"
      accentColor="orange"
      lastUpdated={data?.fetchedAt}
      exportData={
        filtered.length > 0
          ? {
              data: filtered.map((e) => ({
                Manufacturer: e.manufacturer,
                SKU: e.sku,
                Description: e.description ?? "",
                Category: categoryLabel(e.category),
              })),
              filename: "pe-avl-export.csv",
            }
          : undefined
      }
      fullWidth
    >
      {/* Hero Stats */}
      <div className="mb-6 grid grid-cols-3 gap-3">
        <StatCard
          label="Total Items"
          value={isLoading ? null : stats.total}
          subtitle="on AVL"
          color="orange"
        />
        <StatCard
          label="Categories"
          value={isLoading ? null : stats.categories}
          subtitle="equipment types"
          color="blue"
        />
        <StatCard
          label="Manufacturers"
          value={isLoading ? null : stats.manufacturers}
          subtitle="unique brands"
          color="purple"
        />
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search manufacturer, description, SKU..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg border border-t-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-orange-500/50 w-64"
        />
        <MultiSelectFilter
          label="Category"
          options={categoryOptions}
          selected={categoryFilter}
          onChange={setCategoryFilter}
        />
        <MultiSelectFilter
          label="Manufacturer"
          options={manufacturerOptions}
          selected={manufacturerFilter}
          onChange={setManufacturerFilter}
        />
        <span className="ml-auto text-muted text-sm">
          {filtered.length} item{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="border-t-border h-8 w-8 animate-spin rounded-full border-2 border-transparent" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-muted py-20 text-center">
          {entries.length === 0
            ? "No AVL data available. Check that PE_API_KEY is configured."
            : "No items match your filters."}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-y-1 text-sm">
            <thead className="text-muted text-left text-xs uppercase tracking-wide">
              <tr>
                {renderSortHeader("Manufacturer", "manufacturer")}
                {renderSortHeader("SKU", "sku")}
                {renderSortHeader("Description", "description")}
                {renderSortHeader("Category", "category")}
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry, i) => (
                <tr key={`${entry.sku}-${i}`} className="bg-surface rounded-md">
                  <td className="rounded-l-md px-3 py-3 font-medium">{entry.manufacturer || "—"}</td>
                  <td className="px-3 py-3 font-mono text-xs">{entry.sku || "—"}</td>
                  <td className="px-3 py-3 text-muted">{entry.description || "—"}</td>
                  <td className="rounded-r-md px-3 py-3">
                    {entry.category ? categoryBadge(entry.category) : "—"}
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
