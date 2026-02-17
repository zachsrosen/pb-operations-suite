"use client";

import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
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
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

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
    const diff = nowMs - new Date(dateStr).getTime();
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
  const { addToast } = useToast();

  /* ---- Form state ---- */
  const [skuId, setSkuId] = useState("");
  const [skuFilter, setSkuFilter] = useState("");
  const [location, setLocation] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [txType, setTxType] = useState<"RECEIVED" | "ADJUSTED" | "RETURNED" | "ALLOCATED">("RECEIVED");
  const [reason, setReason] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [projectSearch, setProjectSearch] = useState("");
  const [projectResults, setProjectResults] = useState<{ id: string; name: string; projectNumber?: string }[]>([]);
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const PB_LOCATIONS = ["Westminster", "Centennial", "Colorado Springs", "San Luis Obispo", "Camarillo"];

  /* ---- SKU options grouped by category ---- */
  const skusByCategory = useMemo(() => {
    const groups: Record<string, EquipmentSku[]> = {};
    const filtered = props.skus.filter((s) => {
      if (!skuFilter) return true;
      const term = skuFilter.toLowerCase();
      return (
        s.brand.toLowerCase().includes(term) ||
        s.model.toLowerCase().includes(term) ||
        (s.unitSpec !== null && String(s.unitSpec).includes(term)) ||
        s.category.toLowerCase().includes(term)
      );
    });
    for (const sku of filtered) {
      if (!groups[sku.category]) groups[sku.category] = [];
      groups[sku.category].push(sku);
    }
    return groups;
  }, [props.skus, skuFilter]);

  /* ---- Debounced project search ---- */
  useEffect(() => {
    if (txType !== "ALLOCATED" || !projectSearch.trim()) {
      setProjectResults([]);
      setShowProjectDropdown(false);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/projects?search=${encodeURIComponent(projectSearch)}&limit=10&fields=id,name,projectNumber`
        );
        if (res.ok) {
          const data = await res.json();
          const results = (data.projects || []).map((p: { id: string; name: string; projectNumber?: string }) => ({
            id: p.id,
            name: p.name,
            projectNumber: p.projectNumber,
          }));
          setProjectResults(results);
          setShowProjectDropdown(results.length > 0);
        }
      } catch {
        /* ignore search errors */
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [projectSearch, txType]);

  /* ---- Clear project when type changes away from ALLOCATED ---- */
  useEffect(() => {
    if (txType !== "ALLOCATED") {
      setProjectId(null);
      setProjectName(null);
      setProjectSearch("");
    }
  }, [txType]);

  /* ---- Submit handler ---- */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!skuId || !location || quantity < 1) return;

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        skuId,
        location,
        type: txType,
        quantity,
      };
      if (reason.trim()) body.reason = reason.trim();
      if (txType === "ALLOCATED" && projectId) {
        body.projectId = projectId;
        body.projectName = projectName;
      }

      const res = await fetch("/api/inventory/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to record transaction");
      }

      addToast({
        type: "success",
        title: "Transaction Recorded",
        message: `${txType} ${quantity} unit${quantity > 1 ? "s" : ""} at ${location}`,
      });

      // Reset form
      setSkuId("");
      setQuantity(1);
      setReason("");
      setProjectId(null);
      setProjectName(null);
      setProjectSearch("");

      await props.onTransactionCreated();
    } catch (err) {
      addToast({
        type: "error",
        title: "Transaction Failed",
        message: err instanceof Error ? err.message : "An error occurred",
      });
    } finally {
      setSubmitting(false);
    }
  };

  /* ---- Relative time helper ---- */
  const relativeTime = (dateStr: string) => {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diff = now - then;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
  };

  /* ---- Transaction type config ---- */
  const TX_TYPES = [
    { value: "RECEIVED" as const, label: "Received", color: "text-emerald-400", accent: "accent-green-500" },
    { value: "ADJUSTED" as const, label: "Adjusted", color: "text-amber-400", accent: "accent-amber-500" },
    { value: "RETURNED" as const, label: "Returned", color: "text-blue-400", accent: "accent-blue-500" },
    { value: "ALLOCATED" as const, label: "Allocated", color: "text-orange-400", accent: "accent-orange-500" },
  ];

  const TX_BADGE_COLORS: Record<string, string> = {
    RECEIVED: "bg-emerald-500/15 text-emerald-400",
    ADJUSTED: "bg-amber-500/15 text-amber-400",
    RETURNED: "bg-blue-500/15 text-blue-400",
    ALLOCATED: "bg-orange-500/15 text-orange-400",
    TRANSFERRED: "bg-purple-500/15 text-purple-400",
  };

  return (
    <div className="space-y-6">
      {/* ---- Quick Entry Form ---- */}
      <div className="bg-surface/50 border border-t-border rounded-xl p-6">
        <h3 className="text-sm font-semibold text-foreground mb-4">Record Stock Change</h3>

        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* SKU Selector */}
            <div className="flex flex-col">
              <label className="text-xs font-medium text-muted mb-1">SKU</label>
              <input
                type="text"
                placeholder="Filter SKUs..."
                value={skuFilter}
                onChange={(e) => setSkuFilter(e.target.value)}
                className="bg-surface-2 border border-t-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500/50 mb-1"
              />
              <select
                value={skuId}
                onChange={(e) => setSkuId(e.target.value)}
                required
                className="bg-surface-2 border border-t-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
              >
                <option value="">Select SKU...</option>
                {CATEGORY_ORDER.map((cat) => {
                  const items = skusByCategory[cat];
                  if (!items || items.length === 0) return null;
                  return (
                    <optgroup key={cat} label={CATEGORY_LABELS[cat] || cat}>
                      {items.map((sku) => (
                        <option key={sku.id} value={sku.id}>
                          {sku.brand} — {sku.model}
                          {sku.unitSpec !== null ? ` (${sku.unitSpec} ${sku.unitLabel || ""})` : ""}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
            </div>

            {/* Location Selector */}
            <div className="flex flex-col">
              <label className="text-xs font-medium text-muted mb-1">Location</label>
              <select
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                required
                className="bg-surface-2 border border-t-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
              >
                <option value="">Select Location...</option>
                {PB_LOCATIONS.map((loc) => (
                  <option key={loc} value={loc}>{loc}</option>
                ))}
              </select>
            </div>

            {/* Quantity */}
            <div className="flex flex-col">
              <label className="text-xs font-medium text-muted mb-1">Quantity</label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  className="w-8 h-8 flex items-center justify-center bg-surface-2 border border-t-border rounded-lg text-foreground hover:bg-surface-elevated transition-colors text-sm font-medium"
                >
                  -
                </button>
                <input
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                  className="bg-surface-2 border border-t-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500/50 w-20 text-center"
                />
                <button
                  type="button"
                  onClick={() => setQuantity((q) => q + 1)}
                  className="w-8 h-8 flex items-center justify-center bg-surface-2 border border-t-border rounded-lg text-foreground hover:bg-surface-elevated transition-colors text-sm font-medium"
                >
                  +
                </button>
              </div>
            </div>

            {/* Transaction Type */}
            <div className="flex flex-col">
              <label className="text-xs font-medium text-muted mb-1">Type</label>
              <div className="flex flex-wrap gap-3 mt-1">
                {TX_TYPES.map((t) => (
                  <label key={t.value} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="txType"
                      value={t.value}
                      checked={txType === t.value}
                      onChange={() => setTxType(t.value)}
                      className={`${t.accent}`}
                    />
                    <span className={`text-xs font-medium ${t.color}`}>{t.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Project Search (when ALLOCATED) */}
            {txType === "ALLOCATED" && (
              <div className="flex flex-col relative">
                <label className="text-xs font-medium text-muted mb-1">Project</label>
                {projectName ? (
                  <div className="flex items-center gap-2 bg-surface-2 border border-t-border rounded-lg px-3 py-2 text-sm">
                    <span className="text-foreground truncate flex-1">{projectName}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setProjectId(null);
                        setProjectName(null);
                        setProjectSearch("");
                      }}
                      className="text-muted hover:text-red-400 text-xs transition-colors"
                    >
                      clear
                    </button>
                  </div>
                ) : (
                  <input
                    type="text"
                    placeholder="Search projects..."
                    value={projectSearch}
                    onChange={(e) => setProjectSearch(e.target.value)}
                    onFocus={() => projectResults.length > 0 && setShowProjectDropdown(true)}
                    onBlur={() => setTimeout(() => setShowProjectDropdown(false), 200)}
                    className="bg-surface-2 border border-t-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                  />
                )}
                {showProjectDropdown && projectResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-surface-elevated border border-t-border rounded-lg shadow-card-lg overflow-hidden max-h-48 overflow-y-auto">
                    {projectResults.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setProjectId(p.id);
                          setProjectName(p.name);
                          setProjectSearch("");
                          setShowProjectDropdown(false);
                        }}
                        className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-surface-2 transition-colors border-b border-t-border last:border-b-0"
                      >
                        <span className="font-medium">{p.name}</span>
                        {p.projectNumber && (
                          <span className="text-muted ml-2 text-xs">#{p.projectNumber}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Reason */}
            <div className="flex flex-col">
              <label className="text-xs font-medium text-muted mb-1">Reason (optional)</label>
              <input
                type="text"
                placeholder="e.g. New shipment, cycle count adjustment..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="bg-surface-2 border border-t-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
              />
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting || !skuId || !location || quantity < 1}
            className="mt-4 w-full px-4 py-2.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                Recording...
              </>
            ) : (
              "Record Transaction"
            )}
          </button>
        </form>
      </div>

      {/* ---- Recent Transactions ---- */}
      <div className="bg-surface/50 border border-t-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-t-border">
          <h3 className="text-sm font-semibold text-foreground">Recent Transactions</h3>
        </div>

        {props.transactions.length === 0 ? (
          <div className="text-muted text-sm text-center py-8">
            No transactions recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-2/50 text-muted text-xs">
                  <th className="text-left px-4 py-2 font-medium">Time</th>
                  <th className="text-left px-4 py-2 font-medium">SKU</th>
                  <th className="text-left px-4 py-2 font-medium">Location</th>
                  <th className="text-left px-4 py-2 font-medium">Type</th>
                  <th className="text-right px-4 py-2 font-medium">Qty</th>
                  <th className="text-left px-4 py-2 font-medium">Note</th>
                  <th className="text-left px-4 py-2 font-medium">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-t-border">
                {props.transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-surface-2/30 transition-colors">
                    <td className="px-4 py-2 text-muted text-xs whitespace-nowrap">
                      {relativeTime(tx.createdAt)}
                    </td>
                    <td className="px-4 py-2 text-foreground text-xs whitespace-nowrap">
                      {tx.stock.sku.brand} {tx.stock.sku.model}
                    </td>
                    <td className="px-4 py-2 text-muted text-xs whitespace-nowrap">
                      {tx.stock.location}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                          TX_BADGE_COLORS[tx.type] || "bg-zinc-500/15 text-zinc-400"
                        }`}
                      >
                        {tx.type}
                      </span>
                    </td>
                    <td
                      className={`px-4 py-2 text-right text-xs font-mono font-medium whitespace-nowrap ${
                        tx.quantity >= 0 ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {tx.quantity >= 0 ? `+${tx.quantity}` : `\u2212${Math.abs(tx.quantity)}`}
                    </td>
                    <td className="px-4 py-2 text-muted text-xs max-w-[200px] truncate">
                      {tx.reason || (tx.projectName ? `Project: ${tx.projectName}` : "\u2014")}
                    </td>
                    <td className="px-4 py-2 text-muted text-xs whitespace-nowrap">
                      {tx.performedBy}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function NeedsReportTab(props: {
  needsReport: NeedsReport | null;
  filterLocations: string[];
  filterCategories: string[];
}) {
  const { needsReport, filterLocations, filterCategories } = props;
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  /* Toggle expand/collapse for a row */
  const toggleRow = useCallback((key: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  /* Filter needs by location and category */
  const filteredNeeds = useMemo(() => {
    if (!needsReport?.needs) return [];
    return needsReport.needs.filter((n) => {
      if (filterLocations.length > 0 && !filterLocations.includes(n.location))
        return false;
      if (filterCategories.length > 0 && !filterCategories.includes(n.category))
        return false;
      return true;
    });
  }, [needsReport, filterLocations, filterCategories]);

  /* Aggregate to SKU level and group by category */
  const groupedData = useMemo(() => {
    // Aggregate by (category, brand, model)
    const agg = new Map<
      string,
      {
        category: string;
        brand: string;
        model: string;
        unitSpec: number | null;
        unitLabel: string | null;
        weightedDemand: number;
        onHand: number;
        gap: number;
        suggestedOrder: number;
        locations: { location: string; weightedDemand: number; onHand: number; gap: number }[];
      }
    >();

    for (const n of filteredNeeds) {
      const key = `${n.category}:${n.brand}:${n.model}`;
      const existing = agg.get(key);
      if (existing) {
        existing.weightedDemand += n.weightedDemand;
        existing.onHand += n.onHand;
        existing.gap += n.gap;
        existing.suggestedOrder += n.suggestedOrder;
        existing.locations.push({
          location: n.location,
          weightedDemand: n.weightedDemand,
          onHand: n.onHand,
          gap: n.gap,
        });
      } else {
        agg.set(key, {
          category: n.category,
          brand: n.brand,
          model: n.model,
          unitSpec: n.unitSpec,
          unitLabel: n.unitLabel,
          weightedDemand: n.weightedDemand,
          onHand: n.onHand,
          gap: n.gap,
          suggestedOrder: n.suggestedOrder,
          locations: [
            {
              location: n.location,
              weightedDemand: n.weightedDemand,
              onHand: n.onHand,
              gap: n.gap,
            },
          ],
        });
      }
    }

    // Group by category in CATEGORY_ORDER
    const groups: {
      category: string;
      rows: (typeof agg extends Map<string, infer V> ? V : never)[];
    }[] = [];

    for (const cat of CATEGORY_ORDER) {
      const catRows = [...agg.values()].filter((r) => r.category === cat);
      if (catRows.length > 0) {
        groups.push({ category: cat, rows: catRows });
      }
    }

    return groups;
  }, [filteredNeeds]);

  /* Recompute summary from filtered data */
  const filteredSummary = useMemo(() => {
    let shortfalls = 0;
    let surplus = 0;
    let balanced = 0;
    for (const group of groupedData) {
      for (const row of group.rows) {
        if (row.gap > 0) shortfalls++;
        else if (row.gap < 0) surplus++;
        else balanced++;
      }
    }
    const total = shortfalls + surplus + balanced;
    return { shortfalls, surplus, balanced, total };
  }, [groupedData]);

  /* CSV export */
  const handleExportCsv = useCallback(() => {
    if (!filteredNeeds.length) return;
    const header = "Category,Brand,Model,Spec,Location,Weighted Demand,On Hand,Gap,Suggested Order";
    const rows = filteredNeeds.map((n) => {
      const spec =
        n.unitSpec != null
          ? `${n.unitSpec}${n.unitLabel ? ` ${n.unitLabel}` : ""}`
          : "";
      return [
        CATEGORY_LABELS[n.category] || n.category,
        `"${n.brand}"`,
        `"${n.model}"`,
        `"${spec}"`,
        `"${n.location}"`,
        n.weightedDemand,
        n.onHand,
        n.gap,
        n.suggestedOrder,
      ].join(",");
    });
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const date = new Date().toISOString().split("T")[0];
    a.href = url;
    a.download = `inventory-needs-report-${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filteredNeeds]);

  /* Empty state */
  if (!needsReport || !needsReport.needs || needsReport.needs.length === 0) {
    return (
      <div className="text-muted text-sm text-center py-12">
        No demand data available. Sync SKUs and ensure projects have equipment data.
      </div>
    );
  }

  return (
    <div>
      {/* Stage Weight Controls */}
      <div className="bg-surface/50 border border-t-border rounded-xl p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground/80">Stage Weights</h3>
          <span className="text-xs text-muted">
            {needsReport.projectsAnalyzed} project{needsReport.projectsAnalyzed !== 1 ? "s" : ""} analyzed
          </span>
        </div>
        <div className="flex flex-wrap gap-3">
          {Object.entries(needsReport.stageWeights).map(([stage, weight]) => (
            <div
              key={stage}
              className="flex items-center gap-1.5 bg-surface-2/50 rounded-lg px-2.5 py-1.5"
            >
              <span className="text-xs text-muted whitespace-nowrap">{stage}:</span>
              <span className="text-xs font-medium text-foreground tabular-nums w-10 text-right">
                {Math.round(weight * 100)}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Summary Health Bar */}
      <div className="mb-6">
        <div className="h-3 rounded-full overflow-hidden flex bg-surface-2/50">
          {filteredSummary.total > 0 && (
            <>
              {filteredSummary.shortfalls > 0 && (
                <div
                  className="bg-red-500 transition-all"
                  style={{
                    width: `${(filteredSummary.shortfalls / filteredSummary.total) * 100}%`,
                  }}
                />
              )}
              {filteredSummary.balanced > 0 && (
                <div
                  className="bg-zinc-500 transition-all"
                  style={{
                    width: `${(filteredSummary.balanced / filteredSummary.total) * 100}%`,
                  }}
                />
              )}
              {filteredSummary.surplus > 0 && (
                <div
                  className="bg-green-500 transition-all"
                  style={{
                    width: `${(filteredSummary.surplus / filteredSummary.total) * 100}%`,
                  }}
                />
              )}
            </>
          )}
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <p className="text-xs text-muted">
            <span className="text-red-400 font-medium">{filteredSummary.shortfalls}</span>
            {" shortfall"}{filteredSummary.shortfalls !== 1 ? "s" : ""}
            {" \u2022 "}
            <span className="text-foreground/60 font-medium">{filteredSummary.balanced}</span>
            {" balanced \u2022 "}
            <span className="text-green-400 font-medium">{filteredSummary.surplus}</span>
            {" surplus out of "}
            <span className="text-foreground/80 font-medium">{filteredSummary.total}</span>
            {" SKUs"}
          </p>
          <button
            onClick={handleExportCsv}
            disabled={filteredNeeds.length === 0}
            className="px-3 py-1 bg-surface-2 hover:bg-surface-2/80 border border-t-border text-xs text-foreground rounded-lg transition-colors disabled:opacity-50"
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* Needs Table — Grouped by Category */}
      {groupedData.length === 0 ? (
        <div className="text-muted text-sm text-center py-12">
          No matching needs data for the current filters.
        </div>
      ) : (
        <div className="space-y-6">
          {groupedData.map((group) => {
            const subtotal = group.rows.reduce(
              (acc, r) => ({
                weightedDemand: acc.weightedDemand + r.weightedDemand,
                onHand: acc.onHand + r.onHand,
                gap: acc.gap + r.gap,
                suggestedOrder: acc.suggestedOrder + r.suggestedOrder,
              }),
              { weightedDemand: 0, onHand: 0, gap: 0, suggestedOrder: 0 }
            );

            return (
              <div key={group.category}>
                <h4 className="text-sm font-semibold text-foreground/80 mb-2">
                  {CATEGORY_LABELS[group.category] || group.category}{" "}
                  <span className="text-muted font-normal">
                    ({group.rows.length} SKU{group.rows.length !== 1 ? "s" : ""})
                  </span>
                </h4>
                <div className="bg-surface/50 border border-t-border rounded-xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="bg-surface-2/50">
                          <th className="px-4 py-2.5 text-xs text-muted uppercase tracking-wider font-medium w-6" />
                          <th className="px-4 py-2.5 text-xs text-muted uppercase tracking-wider font-medium">Brand</th>
                          <th className="px-4 py-2.5 text-xs text-muted uppercase tracking-wider font-medium">Model</th>
                          <th className="px-4 py-2.5 text-xs text-muted uppercase tracking-wider font-medium">Spec</th>
                          <th className="px-4 py-2.5 text-xs text-muted uppercase tracking-wider font-medium text-right">W. Demand</th>
                          <th className="px-4 py-2.5 text-xs text-muted uppercase tracking-wider font-medium text-right">On Hand</th>
                          <th className="px-4 py-2.5 text-xs text-muted uppercase tracking-wider font-medium text-right">Gap</th>
                          <th className="px-4 py-2.5 text-xs text-muted uppercase tracking-wider font-medium text-right">Suggested Order</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.rows.map((row) => {
                          const rowKey = `${row.category}:${row.brand}:${row.model}`;
                          const isExpanded = expandedRows.has(rowKey);
                          const specStr =
                            row.unitSpec != null
                              ? `${row.unitSpec}${row.unitLabel ? ` ${row.unitLabel}` : ""}`
                              : "\u2014";

                          return (
                            <Fragment key={rowKey}>
                              <tr
                                onClick={() => toggleRow(rowKey)}
                                className="border-b border-t-border hover:bg-surface-2/30 transition-colors cursor-pointer"
                              >
                                <td className="px-4 py-3 text-sm text-muted">
                                  <span
                                    className={`inline-block transition-transform text-xs ${
                                      isExpanded ? "rotate-90" : ""
                                    }`}
                                  >
                                    {"\u25B6"}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-sm text-foreground">{row.brand}</td>
                                <td className="px-4 py-3 text-sm text-foreground">{row.model}</td>
                                <td className="px-4 py-3 text-sm text-muted">{specStr}</td>
                                <td className="px-4 py-3 text-sm text-foreground text-right tabular-nums">
                                  {row.weightedDemand.toLocaleString()}
                                </td>
                                <td className="px-4 py-3 text-sm text-foreground text-right tabular-nums">
                                  {row.onHand.toLocaleString()}
                                </td>
                                <td className="px-4 py-3 text-sm font-medium text-right">
                                  <span
                                    className={`inline-block px-2 py-0.5 rounded-md tabular-nums ${
                                      row.gap > 0
                                        ? "text-red-400 bg-red-500/10"
                                        : row.gap < 0
                                          ? "text-green-400 bg-green-500/10"
                                          : "text-muted"
                                    }`}
                                  >
                                    {row.gap > 0
                                      ? `+${row.gap.toLocaleString()}`
                                      : row.gap < 0
                                        ? row.gap.toLocaleString()
                                        : "0"}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-sm text-right tabular-nums">
                                  {row.suggestedOrder > 0 ? (
                                    <span className="font-bold text-cyan-400">
                                      {row.suggestedOrder.toLocaleString()}
                                    </span>
                                  ) : (
                                    <span className="text-muted">{"\u2014"}</span>
                                  )}
                                </td>
                              </tr>
                              {/* Expanded location detail */}
                              {isExpanded && (
                                <tr className="border-b border-t-border">
                                  <td colSpan={8} className="p-0">
                                    <div className="bg-surface-2/20 px-8 py-2">
                                      <table className="w-full text-left">
                                        <thead>
                                          <tr>
                                            <th className="px-3 py-1.5 text-[10px] text-muted uppercase tracking-wider font-medium">
                                              Location
                                            </th>
                                            <th className="px-3 py-1.5 text-[10px] text-muted uppercase tracking-wider font-medium text-right">
                                              Demand
                                            </th>
                                            <th className="px-3 py-1.5 text-[10px] text-muted uppercase tracking-wider font-medium text-right">
                                              On Hand
                                            </th>
                                            <th className="px-3 py-1.5 text-[10px] text-muted uppercase tracking-wider font-medium text-right">
                                              Gap
                                            </th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {row.locations.map((loc) => (
                                            <tr
                                              key={loc.location}
                                              className="border-b border-t-border/50 last:border-b-0"
                                            >
                                              <td className="px-3 py-1 text-xs text-foreground">
                                                {loc.location}
                                              </td>
                                              <td className="px-3 py-1 text-xs text-muted text-right tabular-nums">
                                                {loc.weightedDemand.toLocaleString()}
                                              </td>
                                              <td className="px-3 py-1 text-xs text-foreground text-right tabular-nums">
                                                {loc.onHand.toLocaleString()}
                                              </td>
                                              <td className="px-3 py-1 text-xs font-medium text-right tabular-nums">
                                                <span
                                                  className={
                                                    loc.gap > 0
                                                      ? "text-red-400"
                                                      : loc.gap < 0
                                                        ? "text-green-400"
                                                        : "text-muted"
                                                  }
                                                >
                                                  {loc.gap > 0
                                                    ? `+${loc.gap.toLocaleString()}`
                                                    : loc.gap < 0
                                                      ? loc.gap.toLocaleString()
                                                      : "0"}
                                                </span>
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                        {/* Subtotal row */}
                        <tr className="bg-surface-2/30 font-bold">
                          <td className="px-4 py-2.5 text-xs text-muted" />
                          <td
                            colSpan={3}
                            className="px-4 py-2.5 text-xs text-muted uppercase tracking-wider"
                          >
                            Subtotal
                          </td>
                          <td className="px-4 py-2.5 text-sm text-foreground text-right tabular-nums">
                            {subtotal.weightedDemand.toLocaleString()}
                          </td>
                          <td className="px-4 py-2.5 text-sm text-foreground text-right tabular-nums">
                            {subtotal.onHand.toLocaleString()}
                          </td>
                          <td className="px-4 py-2.5 text-sm text-right">
                            <span
                              className={`tabular-nums ${
                                subtotal.gap > 0
                                  ? "text-red-400"
                                  : subtotal.gap < 0
                                    ? "text-green-400"
                                    : "text-muted"
                              }`}
                            >
                              {subtotal.gap > 0
                                ? `+${subtotal.gap.toLocaleString()}`
                                : subtotal.gap < 0
                                  ? subtotal.gap.toLocaleString()
                                  : "0"}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-sm text-right tabular-nums">
                            {subtotal.suggestedOrder > 0 ? (
                              <span className="text-cyan-400">
                                {subtotal.suggestedOrder.toLocaleString()}
                              </span>
                            ) : (
                              <span className="text-muted">{"\u2014"}</span>
                            )}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
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
