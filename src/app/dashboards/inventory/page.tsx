"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import DashboardShell from "@/components/DashboardShell";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { useToast } from "@/contexts/ToastContext";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface EquipmentSku {
  id: string;
  category: string;
  brand: string;
  model: string;
  unitSpec: number | null;
  unitLabel: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  stockLevels?: { location: string; quantityOnHand: number }[];
}

interface StockRecord {
  id: string;
  skuId: string;
  location: string;
  quantityOnHand: number;
  minLevel: number;
  lastCountedAt: string | null;
  sku: EquipmentSku;
}

interface Transaction {
  id: string;
  stockId: string;
  type: string;
  quantity: number;
  reason: string | null;
  projectId: string | null;
  projectName: string | null;
  performedBy: string;
  createdAt: string;
  stock: StockRecord;
}

interface NeedRow {
  brand: string;
  model: string;
  category: string;
  unitSpec: number | null;
  unitLabel: string | null;
  location: string;
  rawDemand: number;
  weightedDemand: number;
  projectCount: number;
  onHand: number;
  gap: number;
  suggestedOrder: number;
}

interface NeedsReport {
  needs: NeedRow[];
  summary: {
    totalSkus: number;
    totalShortfalls: number;
    totalSurplus: number;
    totalBalanced: number;
  };
  stageWeights: Record<string, number>;
  lastUpdated: string;
  projectsAnalyzed: number;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const CATEGORY_LABELS: Record<string, string> = {
  MODULE: "Modules",
  INVERTER: "Inverters",
  BATTERY: "Batteries",
  EV_CHARGER: "EV Chargers",
};

const CATEGORY_ORDER = ["MODULE", "INVERTER", "BATTERY", "EV_CHARGER"];

/* ------------------------------------------------------------------ */
/*  Placeholder tab components (Tasks 9-11)                            */
/* ------------------------------------------------------------------ */

function StockOverviewTab(props: {
  stock: StockRecord[];
  needsReport: NeedsReport | null;
  filterLocations: string[];
  filterCategories: string[];
}) {
  const { stock, needsReport } = props;

  const [sortField, setSortField] = useState<
    "category" | "brand" | "model" | "spec" | "location" | "onHand" | "demand" | "gap" | "lastCounted"
  >("category");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [showShortfallsOnly, setShowShortfallsOnly] = useState(false);

  /* Build demand lookup map from needsReport */
  const demandMap = useMemo(() => {
    const map = new Map<string, { weightedDemand: number; rawDemand: number }>();
    if (!needsReport?.needs) return map;
    for (const n of needsReport.needs) {
      const key = `${n.category}:${n.brand}:${n.model}:${n.location}`;
      map.set(key, { weightedDemand: n.weightedDemand, rawDemand: n.rawDemand });
    }
    return map;
  }, [needsReport]);

  /* Category badge config */
  const CATEGORY_BADGES: Record<string, { short: string; color: string }> = {
    MODULE: { short: "MOD", color: "text-blue-400" },
    INVERTER: { short: "INV", color: "text-amber-400" },
    BATTERY: { short: "BAT", color: "text-green-400" },
    EV_CHARGER: { short: "EV", color: "text-purple-400" },
  };

  /* Compute relative time string */
  const relativeTime = (dateStr: string | null): { text: string; isStale: boolean } => {
    if (!dateStr) return { text: "Never", isStale: true };
    const diff = Date.now() - new Date(dateStr).getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days > 30) return { text: "30+ days", isStale: true };
    if (days === 0) return { text: "Today", isStale: false };
    if (days === 1) return { text: "1 day ago", isStale: false };
    return { text: `${days} days ago`, isStale: false };
  };

  /* Sorted and filtered rows */
  const rows = useMemo(() => {
    const enriched = stock.map((s) => {
      const key = `${s.sku.category}:${s.sku.brand}:${s.sku.model}:${s.location}`;
      const demand = demandMap.get(key);
      const weightedDemand = demand?.weightedDemand ?? 0;
      const gap = s.quantityOnHand - weightedDemand;
      return { ...s, weightedDemand, gap };
    });

    const filtered = showShortfallsOnly
      ? enriched.filter((r) => r.gap < 0)
      : enriched;

    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "category":
          cmp = CATEGORY_ORDER.indexOf(a.sku.category) - CATEGORY_ORDER.indexOf(b.sku.category);
          if (cmp === 0) cmp = a.sku.brand.localeCompare(b.sku.brand);
          break;
        case "brand":
          cmp = a.sku.brand.localeCompare(b.sku.brand);
          break;
        case "model":
          cmp = a.sku.model.localeCompare(b.sku.model);
          break;
        case "spec":
          cmp = (a.sku.unitSpec ?? 0) - (b.sku.unitSpec ?? 0);
          break;
        case "location":
          cmp = a.location.localeCompare(b.location);
          break;
        case "onHand":
          cmp = a.quantityOnHand - b.quantityOnHand;
          break;
        case "demand":
          cmp = a.weightedDemand - b.weightedDemand;
          break;
        case "gap":
          cmp = a.gap - b.gap;
          break;
        case "lastCounted": {
          const aTime = a.lastCountedAt ? new Date(a.lastCountedAt).getTime() : 0;
          const bTime = b.lastCountedAt ? new Date(b.lastCountedAt).getTime() : 0;
          cmp = aTime - bTime;
          break;
        }
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return sorted;
  }, [stock, demandMap, showShortfallsOnly, sortField, sortDir]);

  /* Toggle sort handler */
  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const SortIndicator = ({ field }: { field: typeof sortField }) => (
    <span className="ml-1 text-[10px]">
      {sortField === field ? (sortDir === "asc" ? "\u2191" : "\u2193") : ""}
    </span>
  );

  /* Empty state */
  if (stock.length === 0) {
    return (
      <div className="text-muted text-sm text-center py-12">
        No stock records yet. Use the Receive tab to add inventory.
      </div>
    );
  }

  return (
    <div>
      {/* Shortfalls toggle */}
      <div className="flex items-center gap-2 mb-3">
        <label className="flex items-center gap-2 text-xs text-muted cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showShortfallsOnly}
            onChange={(e) => setShowShortfallsOnly(e.target.checked)}
            className="rounded border-t-border bg-surface-2 text-cyan-500 focus:ring-cyan-500/30 h-3.5 w-3.5"
          />
          Show shortfalls only
        </label>
        <span className="text-xs text-muted ml-auto">
          {rows.length} record{rows.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <div className="bg-surface/50 border border-t-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-surface-2/50">
                {([
                  { field: "category" as const, label: "Cat" },
                  { field: "brand" as const, label: "Brand" },
                  { field: "model" as const, label: "Model" },
                  { field: "spec" as const, label: "Spec" },
                  { field: "location" as const, label: "Location" },
                  { field: "onHand" as const, label: "On Hand" },
                  { field: "demand" as const, label: "Demand" },
                  { field: "gap" as const, label: "Gap" },
                  { field: "lastCounted" as const, label: "Last Counted" },
                ]).map((col) => (
                  <th
                    key={col.field}
                    onClick={() => handleSort(col.field)}
                    className="px-4 py-2.5 text-xs text-muted uppercase tracking-wider font-medium cursor-pointer hover:text-foreground transition-colors whitespace-nowrap"
                  >
                    {col.label}
                    <SortIndicator field={col.field} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-muted text-sm">
                    No shortfalls found.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const badge = CATEGORY_BADGES[row.sku.category] || {
                    short: row.sku.category.slice(0, 3),
                    color: "text-muted",
                  };
                  const counted = relativeTime(row.lastCountedAt);
                  const specStr =
                    row.sku.unitSpec != null
                      ? `${row.sku.unitSpec}${row.sku.unitLabel ? ` ${row.sku.unitLabel}` : ""}`
                      : "\u2014";

                  return (
                    <tr
                      key={row.id}
                      className="border-b border-t-border hover:bg-surface-2/30 transition-colors"
                    >
                      <td className="px-4 py-3 text-sm">
                        <span className={`font-mono text-xs font-semibold ${badge.color}`}>
                          {badge.short}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground">{row.sku.brand}</td>
                      <td className="px-4 py-3 text-sm text-foreground">{row.sku.model}</td>
                      <td className="px-4 py-3 text-sm text-muted">{specStr}</td>
                      <td className="px-4 py-3 text-sm text-foreground">{row.location}</td>
                      <td className="px-4 py-3 text-sm font-medium text-foreground">
                        {row.quantityOnHand.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted">
                        {row.weightedDemand > 0 ? row.weightedDemand.toLocaleString() : "\u2014"}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium">
                        <span
                          className={
                            row.gap < 0
                              ? "text-red-400"
                              : row.gap > 0
                                ? "text-green-400"
                                : "text-muted"
                          }
                        >
                          {row.gap < 0 ? row.gap.toLocaleString() : row.gap > 0 ? `+${row.gap.toLocaleString()}` : "0"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className={counted.isStale ? "text-amber-400" : "text-muted"}>
                          {counted.text}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ReceiveAdjustTab(props: {
  skus: EquipmentSku[];
  transactions: Transaction[];
  onTransactionCreated: () => Promise<void>;
}) {
  void props;
  return (
    <div className="text-muted text-sm text-center py-8">
      Receive &amp; Adjust — building...
    </div>
  );
}

function NeedsReportTab(props: {
  needsReport: NeedsReport | null;
  filterLocations: string[];
  filterCategories: string[];
}) {
  void props;
  return (
    <div className="text-muted text-sm text-center py-8">
      Needs Report — building...
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function InventoryHubPage() {
  useActivityTracking();
  const { addToast } = useToast();

  /* ---- State ---- */

  const [skus, setSkus] = useState<EquipmentSku[]>([]);
  const [stock, setStock] = useState<StockRecord[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [needsReport, setNeedsReport] = useState<NeedsReport | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const [tab, setTab] = useState<"overview" | "receive" | "needs">("overview");
  const [filterLocations, setFilterLocations] = useState<string[]>([]);
  const [filterCategories, setFilterCategories] = useState<string[]>([]);

  /* ---- Data fetching ---- */

  const fetchAll = useCallback(async () => {
    try {
      const [skuRes, stockRes, txRes, needsRes] = await Promise.all([
        fetch("/api/inventory/skus"),
        fetch("/api/inventory/stock"),
        fetch("/api/inventory/transactions?limit=100"),
        fetch("/api/inventory/needs"),
      ]);

      if (!skuRes.ok || !stockRes.ok || !txRes.ok || !needsRes.ok) {
        throw new Error("One or more inventory endpoints failed");
      }

      const [skuData, stockData, txData, needsData] = await Promise.all([
        skuRes.json(),
        stockRes.json(),
        txRes.json(),
        needsRes.json(),
      ]);

      setSkus(skuData.skus || []);
      setStock(stockData.stock || []);
      setTransactions(txData.transactions || []);
      setNeedsReport(needsData);
      setError(null);
    } catch (err) {
      console.error("Inventory fetch error:", err);
      setError("Failed to load inventory data. Please try refreshing.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  /* ---- SKU sync ---- */

  const handleSyncSkus = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/inventory/sync-skus", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Sync failed");
      }
      const data = await res.json();
      addToast({
        type: "success",
        title: "SKU Sync Complete",
        message: `${data.created} new, ${data.existing} existing (${data.total} total from ${data.projectsScanned} projects)`,
      });
      // Refresh all data after sync
      await fetchAll();
    } catch (err) {
      console.error("SKU sync error:", err);
      addToast({
        type: "error",
        title: "Sync Failed",
        message: err instanceof Error ? err.message : "Failed to sync SKUs",
      });
    } finally {
      setSyncing(false);
    }
  }, [addToast, fetchAll]);

  /* ---- Derived data ---- */

  const locations = useMemo(
    () =>
      [...new Set(stock.map((s) => s.location))]
        .filter(Boolean)
        .sort()
        .map((l) => ({ value: l, label: l })),
    [stock]
  );

  const categoryOptions = useMemo(
    () =>
      CATEGORY_ORDER.filter((cat) =>
        skus.some((s) => s.category === cat)
      ).map((cat) => ({
        value: cat,
        label: CATEGORY_LABELS[cat] || cat,
      })),
    [skus]
  );

  const filteredStock = useMemo(() => {
    return stock.filter((s) => {
      if (filterLocations.length > 0 && !filterLocations.includes(s.location))
        return false;
      if (
        filterCategories.length > 0 &&
        !filterCategories.includes(s.sku.category)
      )
        return false;
      return true;
    });
  }, [stock, filterLocations, filterCategories]);

  const stats = useMemo(() => {
    const totalSkus = skus.length;
    const totalOnHand = filteredStock.reduce(
      (sum, s) => sum + s.quantityOnHand,
      0
    );
    const belowMin = filteredStock.filter(
      (s) => s.quantityOnHand < s.minLevel
    ).length;
    const pipelineDemand =
      needsReport?.needs.reduce((sum, n) => sum + n.weightedDemand, 0) || 0;

    return { totalSkus, totalOnHand, belowMin, pipelineDemand };
  }, [skus, filteredStock, needsReport]);

  /* ---- Loading state ---- */

  if (loading) {
    return (
      <DashboardShell title="Inventory Hub" accentColor="cyan">
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400" />
        </div>
      </DashboardShell>
    );
  }

  /* ---- Error state ---- */

  if (error) {
    return (
      <DashboardShell title="Inventory Hub" accentColor="cyan">
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <p className="text-red-400">{error}</p>
          <button
            onClick={() => {
              setLoading(true);
              setError(null);
              fetchAll();
            }}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-sm transition-colors"
          >
            Retry
          </button>
        </div>
      </DashboardShell>
    );
  }

  /* ---- Empty state ---- */

  if (skus.length === 0) {
    return (
      <DashboardShell title="Inventory Hub" accentColor="cyan">
        <div className="flex flex-col items-center justify-center py-20 gap-6">
          <div className="text-center">
            <h2 className="text-lg font-semibold text-foreground mb-2">
              No inventory tracked yet
            </h2>
            <p className="text-muted text-sm max-w-md">
              Sync SKUs from your HubSpot project equipment to start tracking
              inventory levels, stock, and procurement needs.
            </p>
          </div>
          <button
            onClick={handleSyncSkus}
            disabled={syncing}
            className="px-6 py-3 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            {syncing ? (
              <>
                <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                Syncing...
              </>
            ) : (
              "Sync SKUs from HubSpot"
            )}
          </button>
        </div>
      </DashboardShell>
    );
  }

  /* ---- Main render ---- */

  return (
    <DashboardShell
      title="Inventory Hub"
      subtitle={`${stats.totalSkus} SKUs \u2022 ${stats.totalOnHand.toLocaleString()} units on hand`}
      accentColor="cyan"
      lastUpdated={needsReport?.lastUpdated || null}
      headerRight={
        <button
          onClick={handleSyncSkus}
          disabled={syncing}
          className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-md text-xs font-medium transition-colors flex items-center gap-1.5"
        >
          {syncing ? (
            <>
              <span className="animate-spin rounded-full h-3 w-3 border-b-2 border-white" />
              Syncing...
            </>
          ) : (
            "Sync SKUs"
          )}
        </button>
      }
    >
      {/* Filter bar + Tab toggle */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <MultiSelectFilter
          label="Location"
          options={locations}
          selected={filterLocations}
          onChange={setFilterLocations}
          placeholder="All Locations"
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

        {/* Tab toggle */}
        <div className="ml-auto flex bg-surface-2 rounded-lg p-0.5">
          {(
            [
              { key: "overview", label: "Overview" },
              { key: "receive", label: "Receive" },
              { key: "needs", label: "Needs" },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                tab === t.key
                  ? "bg-cyan-600 text-white"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        {[
          {
            label: "SKUs Tracked",
            value: stats.totalSkus.toLocaleString(),
            color: "text-cyan-400",
          },
          {
            label: "Units On Hand",
            value: stats.totalOnHand.toLocaleString(),
            color: "text-emerald-400",
          },
          {
            label: "Below Min Level",
            value: stats.belowMin.toLocaleString(),
            color: stats.belowMin > 0 ? "text-red-400" : "text-muted",
          },
          {
            label: "Pipeline Demand",
            value: stats.pipelineDemand.toLocaleString(),
            color: "text-orange-400",
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-surface/50 border border-t-border rounded-lg p-3 text-center"
          >
            <div className={`text-xl font-bold ${stat.color}`} key={stat.value}>
              {stat.value}
            </div>
            <div className="text-xs text-muted mt-0.5">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Tab Content */}
      {tab === "overview" && (
        <StockOverviewTab
          stock={filteredStock}
          needsReport={needsReport}
          filterLocations={filterLocations}
          filterCategories={filterCategories}
        />
      )}
      {tab === "receive" && (
        <ReceiveAdjustTab
          skus={skus}
          transactions={transactions}
          onTransactionCreated={fetchAll}
        />
      )}
      {tab === "needs" && (
        <NeedsReportTab
          needsReport={needsReport}
          filterLocations={filterLocations}
          filterCategories={filterCategories}
        />
      )}
    </DashboardShell>
  );
}
