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
  void props;
  return (
    <div className="text-muted text-sm text-center py-8">
      Stock Overview — building...
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
