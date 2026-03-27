"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import DashboardShell from "@/components/DashboardShell";
import { MultiSelectFilter, type FilterOption } from "@/components/ui/MultiSelectFilter";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorState } from "@/components/ui/ErrorState";
import { formatCurrency } from "@/lib/format";
import { useProgressiveDeals } from "@/hooks/useProgressiveDeals";

// --- Types ---

interface Deal {
  id: number;
  name: string;
  amount: number;
  stage: string;
  stageId: string;
  pipeline: string;
  pbLocation: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  projectType: string;
  serviceType?: string | null;
  closeDate: string | null;
  createDate: string | null;
  lastModified: string | null;
  url: string;
  isActive: boolean;
  daysSinceCreate: number;
  companyId: string | null;
  companyName: string | null;
}

interface SoProduct {
  id: string;
  name: string;
  sku: string | null;
  sellPrice: number | null;
}

interface SoLineItem {
  productId: string;
  name: string;
  sku: string | null;
  unitPrice: number;
  quantity: number;
}

interface SoResult {
  zohoSoId: string;
  zohoSoNumber: string;
  totalAmount: number;
  alreadyExisted?: boolean;
}

// --- Constants ---

/** Color palette for stage badges — assigned by index from the data */
const STAGE_COLOR_PALETTE = [
  "bg-blue-500",
  "bg-purple-500",
  "bg-yellow-500",
  "bg-orange-500",
  "bg-pink-500",
  "bg-cyan-500",
  "bg-teal-500",
  "bg-indigo-500",
  "bg-rose-500",
  "bg-amber-500",
];

/** Terminal stages that get fixed colors regardless of position */
const TERMINAL_STAGE_COLORS: Record<string, string> = {
  Completed: "bg-green-500",
  Cancelled: "bg-red-500",
};

function getStageColor(stage: string, index: number): string {
  return TERMINAL_STAGE_COLORS[stage] || STAGE_COLOR_PALETTE[index % STAGE_COLOR_PALETTE.length];
}

// --- Component ---

export default function ServicePipelinePage() {
  const {
    deals: allDeals,
    loading,
    loadingMore,
    progress,
    error,
    lastUpdated,
    stageOrder,
    refetch: fetchData,
  } = useProgressiveDeals<Deal>({
    params: { pipeline: "service", active: "false" },
  });

  // Multiselect filter state (empty = show all)
  const [filterLocations, setFilterLocations] = useState<string[]>([]);
  const [filterStages, setFilterStages] = useState<string[]>([]);
  const [activeOnly, setActiveOnly] = useState(true);

  // Activity tracking
  const { trackDashboardView, trackFilter } = useActivityTracking();
  const hasTrackedView = useRef(false);

  // SO panel state
  const [soSelectedDeal, setSoSelectedDeal] = useState<Deal | null>(null);
  const [soProducts, setSoProducts] = useState<SoProduct[]>([]);
  const [soLineItems, setSoLineItems] = useState<SoLineItem[]>([]);
  const [soLoading, setSoLoading] = useState(false);
  const [soSubmitting, setSoSubmitting] = useState(false);
  const [soResult, setSoResult] = useState<SoResult | null>(null);
  const [soError, setSoError] = useState<string | null>(null);
  const [soProductSearch, setSoProductSearch] = useState("");
  const soRequestTokenRef = useRef<string | null>(null);

  // Track dashboard view
  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("service", { projectCount: allDeals.length });
    }
  }, [loading, allDeals.length, trackDashboardView]);

  // Track filter changes
  useEffect(() => {
    if (!loading && hasTrackedView.current) {
      trackFilter("service", { locations: filterLocations, stages: filterStages });
    }
  }, [filterLocations, filterStages, loading, trackFilter]);

  // Derive filter options from data
  const locationOptions: FilterOption[] = useMemo(
    () =>
      [...new Set(allDeals.map((d) => d.pbLocation))]
        .filter((l) => l !== "Unknown")
        .sort()
        .map(l => ({ value: l, label: l })),
    [allDeals]
  );

  // Derive stages from actual deal data, ordered by pipeline flow
  const allStages = useMemo(() => {
    const stagesInData = new Set(allDeals.map(d => d.stage).filter(Boolean));
    if (stageOrder.length > 0) {
      // Use pipeline-ordered stages, then append any unknown stages at the end
      const ordered = stageOrder.filter(s => stagesInData.has(s));
      const unknown = [...stagesInData].filter(s => !stageOrder.includes(s));
      return [...ordered, ...unknown];
    }
    // Fallback: insertion order from data
    return [...stagesInData];
  }, [allDeals, stageOrder]);

  const stageOptions: FilterOption[] = useMemo(
    () => allStages.map(s => ({ value: s, label: s })),
    [allStages]
  );

  // Pipeline stages = non-terminal (for the visualization bar)
  const pipelineStages = useMemo(
    () => allStages.filter(s => !TERMINAL_STAGE_COLORS[s]),
    [allStages]
  );

  // Filtered deals
  const filteredDeals = useMemo(
    () =>
      allDeals.filter((d) => {
        if (activeOnly && !d.isActive) return false;
        if (filterLocations.length > 0 && !filterLocations.includes(d.pbLocation)) return false;
        if (filterStages.length > 0 && !filterStages.includes(d.stage)) return false;
        return true;
      }),
    [allDeals, filterLocations, filterStages, activeOnly]
  );

  // Active deals from filtered set
  const activeDeals = useMemo(
    () => filteredDeals.filter((d) => d.isActive),
    [filteredDeals]
  );

  // Stats
  const totalValue = useMemo(
    () => activeDeals.reduce((sum, d) => sum + d.amount, 0),
    [activeDeals]
  );

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of allStages) counts[s] = 0;
    activeDeals.forEach((d) => {
      if (counts[d.stage] !== undefined) counts[d.stage]++;
    });
    return counts;
  }, [activeDeals, allStages]);

  // SO panel handlers
  const handleOpenSoPanel = useCallback(async (deal: Deal) => {
    soRequestTokenRef.current = crypto.randomUUID();
    setSoSelectedDeal(deal);
    setSoLineItems([]);
    setSoResult(null);
    setSoError(null);
    setSoProductSearch("");
    setSoLoading(true);

    try {
      // Fetch products and deal line items in parallel
      const [productsRes, lineItemsRes] = await Promise.all([
        fetch("/api/inventory/products?category=SERVICE&active=true"),
        fetch(`/api/service/deal-line-items?dealId=${deal.id}`),
      ]);

      if (!productsRes.ok) throw new Error("Failed to load products");
      const productsData = await productsRes.json();
      setSoProducts(
        (productsData.skus || []).map((p: Record<string, unknown>) => ({
          id: p.id as string,
          name: (p.name || p.model || "Unnamed") as string,
          sku: p.sku as string | null,
          sellPrice: p.sellPrice as number | null,
        }))
      );

      // Auto-populate from deal line items if available
      if (lineItemsRes.ok) {
        const lineItemsData = await lineItemsRes.json();
        const items = (lineItemsData.items || []) as Array<{
          productId: string | null;
          name: string;
          sku: string | null;
          quantity: number;
          unitPrice: number;
          matched: boolean;
        }>;

        if (items.length > 0) {
          // Pre-fill with matched items (have a productId for SO creation)
          const prefilled: SoLineItem[] = items
            .filter(item => item.productId && item.matched)
            .map(item => ({
              productId: item.productId!,
              name: item.name,
              sku: item.sku,
              unitPrice: item.unitPrice,
              quantity: item.quantity,
            }));

          if (prefilled.length > 0) {
            setSoLineItems(prefilled);
          }
        }
      }
    } catch {
      setSoError("Failed to load service products");
    } finally {
      setSoLoading(false);
    }
  }, []);

  const handleSubmitSo = useCallback(async () => {
    if (!soSelectedDeal || soLineItems.length === 0 || !soRequestTokenRef.current) return;
    setSoSubmitting(true);
    setSoError(null);

    try {
      const res = await fetch("/api/service/create-so", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId: String(soSelectedDeal.id),
          requestToken: soRequestTokenRef.current,
          items: soLineItems.map(li => ({ productId: li.productId, quantity: li.quantity })),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create SO");

      setSoResult({
        zohoSoId: data.zohoSoId,
        zohoSoNumber: data.zohoSoNumber,
        totalAmount: data.totalAmount,
        alreadyExisted: data.alreadyExisted,
      });
    } catch (err) {
      setSoError(err instanceof Error ? err.message : "Failed to create SO");
    } finally {
      setSoSubmitting(false);
    }
  }, [soSelectedDeal, soLineItems]);

  // --- Loading state ---
  if (loading && allDeals.length === 0) {
    return (
      <DashboardShell title="Service Pipeline" accentColor="blue">
        <LoadingSpinner color="blue" message="Loading Service Pipeline..." />
      </DashboardShell>
    );
  }

  // --- Error state ---
  if (error && allDeals.length === 0) {
    return (
      <DashboardShell title="Service Pipeline" accentColor="blue">
        <ErrorState message={error} onRetry={fetchData} color="blue" />
      </DashboardShell>
    );
  }

  // --- Header controls ---
  const headerRight = (
    <div className="flex items-center gap-3">
      <MultiSelectFilter
        label="Location"
        options={locationOptions}
        selected={filterLocations}
        onChange={setFilterLocations}
      />
      <MultiSelectFilter
        label="Stage"
        options={stageOptions}
        selected={filterStages}
        onChange={setFilterStages}
      />
      <button
        onClick={() => setActiveOnly(!activeOnly)}
        className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
          activeOnly
            ? "bg-blue-600 text-white"
            : "bg-surface-2 text-muted hover:text-foreground"
        }`}
      >
        Active Only
      </button>
      <button
        onClick={fetchData}
        className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg text-sm font-medium text-foreground"
      >
        Refresh
      </button>
    </div>
  );

  return (
    <DashboardShell
      title="Service Pipeline"
      subtitle={loadingMore && progress ? `Loading ${progress.loaded}${progress.total ? `/${progress.total}` : ""} deals...` : undefined}
      accentColor="blue"
      lastUpdated={lastUpdated}
      breadcrumbs={[{ label: "Dashboards", href: "/" }, { label: "Service Pipeline" }]}
      headerRight={headerRight}
    >
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-surface rounded-xl p-4 border border-t-border">
          <div className="text-2xl font-bold text-blue-400">
            {activeDeals.length}
          </div>
          <div className="text-sm text-muted">Active Jobs</div>
        </div>
        <div className="bg-surface rounded-xl p-4 border border-t-border">
          <div className="text-2xl font-bold text-green-400">
            {formatCurrency(totalValue)}
          </div>
          <div className="text-sm text-muted">Pipeline Value</div>
        </div>
        <div className="bg-surface rounded-xl p-4 border border-t-border">
          <div className="text-2xl font-bold text-foreground">
            {filteredDeals.length}
          </div>
          <div className="text-sm text-muted">Showing</div>
        </div>
        <div className="bg-surface rounded-xl p-4 border border-t-border">
          <div className="text-2xl font-bold text-foreground">
            {allDeals.length}
          </div>
          <div className="text-sm text-muted">Total Jobs</div>
        </div>
      </div>

      {/* Pipeline Stages Visualization */}
      <div className="bg-surface rounded-xl border border-t-border p-4 mb-6">
        <h2 className="text-lg font-semibold mb-4">Pipeline Stages</h2>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {pipelineStages.map((stage, idx) => (
            <div key={stage} className="flex-1 min-w-[140px]">
              <div className="text-center mb-2">
                <span className="text-xs text-muted">{stage}</span>
                <div className="text-lg font-bold">{stageCounts[stage] || 0}</div>
              </div>
              <div
                className={`h-2 ${getStageColor(stage, idx)} rounded-full opacity-60`}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Service Jobs Table */}
      <div className="bg-surface rounded-xl border border-t-border overflow-hidden">
        <div className="p-4 border-b border-t-border">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">
              Service Jobs ({filteredDeals.length})
              {filteredDeals.length !== activeDeals.length && (
                <span className="text-sm font-normal text-muted ml-2">
                  {activeDeals.length} active
                </span>
              )}
            </h2>
            {loadingMore && progress && (
              <span className="text-xs text-muted">
                Loading {progress.loaded}{progress.total ? ` of ${progress.total}` : ""} deals...
              </span>
            )}
          </div>
          {loadingMore && (
            <div className="mt-2 h-1 bg-surface-2 rounded-full overflow-hidden">
              {progress?.total ? (
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-300"
                  style={{ width: `${(progress.loaded / progress.total) * 100}%` }}
                />
              ) : (
                <div className="h-full w-1/3 bg-blue-500 rounded-full animate-pulse" />
              )}
            </div>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-surface">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">
                  Job
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">
                  Location
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">
                  Stage
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-muted uppercase">
                  Amount
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">
                  Created
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-muted uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-t-border">
              {filteredDeals.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-muted"
                  >
                    No jobs found
                  </td>
                </tr>
              ) : (
                filteredDeals.map((deal) => (
                  <tr
                    key={deal.id}
                    className={`hover:bg-surface/50 ${
                      !deal.isActive ? "opacity-50" : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{deal.name}</div>
                      <div className="text-xs text-muted">
                        {deal.address || "No address"}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground/80">
                      {deal.pbLocation}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                          getStageColor(deal.stage, allStages.indexOf(deal.stage))
                        } bg-opacity-20 text-white`}
                      >
                        {deal.stage}
                      </span>
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-mono text-sm ${
                        deal.amount > 0 ? "text-green-400" : "text-muted"
                      }`}
                    >
                      {formatCurrency(deal.amount)}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted">
                      {deal.createDate || "-"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenSoPanel(deal);
                        }}
                        title="Create Sales Order"
                        className="text-sm px-2 py-1 rounded mr-2 text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10"
                      >
                        Create SO
                      </button>
                      <a
                        href={deal.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300 text-sm"
                      >
                        Open &rarr;
                      </a>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* SO Creation Slide-over Panel */}
      {soSelectedDeal && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSoSelectedDeal(null)} />
          <div className="relative w-full max-w-lg bg-surface border-l border-t-border overflow-y-auto">
            <div className="p-6">
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">Create Sales Order</h2>
                  <p className="text-sm text-muted">{soSelectedDeal.name}</p>
                  <p className="text-xs text-muted">{soSelectedDeal.address}</p>
                </div>
                <button onClick={() => setSoSelectedDeal(null)} className="text-muted hover:text-foreground text-xl">✕</button>
              </div>

              {soResult ? (
                <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
                  <p className="text-green-400 font-medium">
                    {soResult.alreadyExisted ? "Sales Order already exists" : "Sales Order created"}
                  </p>
                  <p className="text-sm text-muted mt-1">SO #: {soResult.zohoSoNumber}</p>
                  <p className="text-sm text-muted">Total: {formatCurrency(soResult.totalAmount)}</p>
                </div>
              ) : (
                <>
                  {/* Product picker */}
                  <div className="mb-4">
                    <input
                      type="text"
                      placeholder="Search products..."
                      value={soProductSearch}
                      onChange={(e) => setSoProductSearch(e.target.value)}
                      className="w-full px-3 py-2 bg-surface-2 border border-t-border rounded text-sm text-foreground placeholder:text-muted"
                    />
                  </div>

                  {soLoading ? (
                    <div className="flex justify-center py-8">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-cyan-500" />
                    </div>
                  ) : (
                    <div className="max-h-48 overflow-y-auto mb-4 border border-t-border rounded">
                      {soProducts
                        .filter(p => {
                          const q = soProductSearch.toLowerCase();
                          return !q || p.name.toLowerCase().includes(q) || (p.sku || "").toLowerCase().includes(q);
                        })
                        .map(p => (
                          <button
                            key={p.id}
                            onClick={() => {
                              if (!soLineItems.find(li => li.productId === p.id)) {
                                setSoLineItems(prev => [...prev, {
                                  productId: p.id,
                                  name: p.name,
                                  sku: p.sku,
                                  unitPrice: p.sellPrice || 0,
                                  quantity: 1,
                                }]);
                              }
                            }}
                            className="w-full text-left px-3 py-2 hover:bg-surface-2 border-b border-t-border last:border-b-0"
                          >
                            <div className="text-sm text-foreground">{p.name}</div>
                            <div className="text-xs text-muted">{p.sku || "No SKU"} · {formatCurrency(p.sellPrice || 0)}</div>
                          </button>
                        ))}
                      {soProducts.filter(p => {
                        const q = soProductSearch.toLowerCase();
                        return !q || p.name.toLowerCase().includes(q) || (p.sku || "").toLowerCase().includes(q);
                      }).length === 0 && (
                        <div className="px-3 py-4 text-sm text-muted text-center">No service products found</div>
                      )}
                    </div>
                  )}

                  {/* Line items */}
                  {soLineItems.length > 0 && (
                    <div className="mb-4">
                      <h3 className="text-sm font-medium text-foreground mb-2">Line Items</h3>
                      {soLineItems.map((li, idx) => (
                        <div key={li.productId} className="flex items-center gap-2 mb-2 p-2 bg-surface-2 rounded">
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-foreground truncate">{li.name}</div>
                            <div className="text-xs text-muted">{formatCurrency(li.unitPrice)} each</div>
                          </div>
                          <input
                            type="number"
                            min={1}
                            value={li.quantity}
                            onChange={(e) => {
                              const qty = Math.max(1, parseInt(e.target.value) || 1);
                              setSoLineItems(prev => prev.map((item, i) => i === idx ? { ...item, quantity: qty } : item));
                            }}
                            className="w-16 px-2 py-1 bg-surface border border-t-border rounded text-sm text-foreground text-center"
                          />
                          <div className="w-20 text-right text-sm text-foreground">
                            {formatCurrency(li.unitPrice * li.quantity)}
                          </div>
                          <button
                            onClick={() => setSoLineItems(prev => prev.filter((_, i) => i !== idx))}
                            className="text-red-400 hover:text-red-300 text-sm"
                          >✕</button>
                        </div>
                      ))}
                      <div className="text-right text-sm font-medium text-foreground mt-2 pt-2 border-t border-t-border">
                        Total: {formatCurrency(soLineItems.reduce((sum, li) => sum + li.unitPrice * li.quantity, 0))}
                      </div>
                    </div>
                  )}

                  {/* Error */}
                  {soError && (
                    <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded text-sm text-red-400">
                      {soError}
                    </div>
                  )}

                  {/* Submit */}
                  <button
                    onClick={handleSubmitSo}
                    disabled={soLineItems.length === 0 || soSubmitting}
                    className="w-full py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-sm font-medium"
                  >
                    {soSubmitting ? "Creating..." : "Create Sales Order"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
