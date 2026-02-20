"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DashboardShell from "@/components/DashboardShell";
import { useActivityTracking } from "@/hooks/useActivityTracking";

type SourceName = "hubspot" | "zuper" | "zoho";

interface ComparableProduct {
  id: string;
  name: string | null;
  sku: string | null;
  price: number | null;
  status: string | null;
}

interface ComparisonRow {
  key: string;
  hubspot: ComparableProduct | null;
  zuper: ComparableProduct | null;
  zoho: ComparableProduct | null;
  reasons: string[];
  isMismatch: boolean;
}

interface SourceHealth {
  configured: boolean;
  count: number;
  error: string | null;
}

interface ProductComparisonResponse {
  rows: ComparisonRow[];
  summary: {
    totalRows: number;
    mismatchRows: number;
    fullyMatchedRows: number;
    missingBySource: Record<SourceName, number>;
    sourceCounts: Record<SourceName, number>;
  };
  health: Record<SourceName, SourceHealth>;
  warnings: string[];
  lastUpdated: string;
}

function formatSourceName(source: SourceName): string {
  if (source === "hubspot") return "HubSpot";
  if (source === "zuper") return "Zuper";
  return "Zoho";
}

function formatCurrency(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDateTime(dateString: string | null): string | null {
  if (!dateString) return null;
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ProductCell({ product }: { product: ComparableProduct | null }) {
  if (!product) {
    return <span className="text-xs text-red-500 dark:text-red-400">Missing</span>;
  }

  return (
    <div className="space-y-1">
      <div className="text-sm font-medium text-foreground">{product.name || "-"}</div>
      <div className="text-xs text-muted">SKU: {product.sku || "-"}</div>
      <div className="text-xs text-muted">Price: {formatCurrency(product.price)}</div>
      <div className="text-xs text-muted">Status: {product.status || "-"}</div>
    </div>
  );
}

export default function ProductComparisonPage() {
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  const [accessChecked, setAccessChecked] = useState(false);
  const [isAllowed, setIsAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ProductComparisonResponse | null>(null);
  const [search, setSearch] = useState("");
  const [showMatchedRows, setShowMatchedRows] = useState(false);
  const [missingFilter, setMissingFilter] = useState<"all" | SourceName>("all");

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/products/comparison", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Failed to fetch comparison data (${response.status})`);
      }
      const json = (await response.json()) as ProductComparisonResponse;
      setData(json);
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load product comparison");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch("/api/auth/sync", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Auth check failed (${response.status})`);
        const authPayload = (await response.json()) as { role?: string };
        const role = authPayload.role || "VIEWER";
        const allowed = role === "ADMIN" || role === "OWNER";
        setAccessChecked(true);
        setIsAllowed(allowed);
        if (!allowed) {
          setError("Admin or owner access required for this dashboard.");
          setLoading(false);
        }
      })
      .catch(() => {
        setAccessChecked(true);
        setIsAllowed(false);
        setError("Unable to verify access. Please refresh and try again.");
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!accessChecked || !isAllowed) return;
    fetchData();
  }, [accessChecked, isAllowed, fetchData]);

  useEffect(() => {
    if (!isAllowed || hasTrackedView.current) return;
    trackDashboardView("product-comparison", {});
    hasTrackedView.current = true;
  }, [isAllowed, trackDashboardView]);

  const rows = useMemo(() => {
    if (!data) return [];
    const searchTerm = search.trim().toLowerCase();

    return data.rows.filter((row) => {
      if (!showMatchedRows && !row.isMismatch) return false;
      if (missingFilter === "hubspot" && row.hubspot) return false;
      if (missingFilter === "zuper" && row.zuper) return false;
      if (missingFilter === "zoho" && row.zoho) return false;

      if (!searchTerm) return true;

      const haystack = [
        row.key,
        row.hubspot?.name,
        row.hubspot?.sku,
        row.zuper?.name,
        row.zuper?.sku,
        row.zoho?.name,
        row.zoho?.sku,
        ...row.reasons,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(searchTerm);
    });
  }, [data, missingFilter, search, showMatchedRows]);

  const exportRows = useMemo(() => {
    return rows.map((row) => ({
      key: row.key,
      reasons: row.reasons.join(" | "),
      hubspot_name: row.hubspot?.name || "",
      hubspot_sku: row.hubspot?.sku || "",
      hubspot_price: row.hubspot?.price ?? "",
      zuper_name: row.zuper?.name || "",
      zuper_sku: row.zuper?.sku || "",
      zuper_price: row.zuper?.price ?? "",
      zoho_name: row.zoho?.name || "",
      zoho_sku: row.zoho?.sku || "",
      zoho_price: row.zoho?.price ?? "",
    }));
  }, [rows]);

  const lastUpdated = formatDateTime(data?.lastUpdated || null);

  return (
    <DashboardShell
      title="Product Catalog Comparison"
      subtitle="Cross-check HubSpot, Zuper, and Zoho product data"
      accentColor="cyan"
      lastUpdated={lastUpdated}
      breadcrumbs={[{ label: "Testing", href: "/suites/testing" }]}
      exportData={{ data: exportRows, filename: "product-catalog-comparison" }}
    >
      {loading && (
        <div className="bg-surface border border-t-border rounded-xl p-6 text-sm text-muted">
          Loading product comparison data...
        </div>
      )}

      {!loading && error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {!loading && !error && data && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="bg-surface border border-t-border rounded-xl p-4">
              <div className="text-xs text-muted">Compared keys</div>
              <div className="text-2xl font-semibold mt-1">{data.summary.totalRows}</div>
            </div>
            <div className="bg-surface border border-t-border rounded-xl p-4">
              <div className="text-xs text-muted">Mismatches</div>
              <div className="text-2xl font-semibold text-red-400 mt-1">{data.summary.mismatchRows}</div>
            </div>
            <div className="bg-surface border border-t-border rounded-xl p-4">
              <div className="text-xs text-muted">Fully matched</div>
              <div className="text-2xl font-semibold text-green-400 mt-1">{data.summary.fullyMatchedRows}</div>
            </div>
            <div className="bg-surface border border-t-border rounded-xl p-4">
              <div className="text-xs text-muted">Visible rows</div>
              <div className="text-2xl font-semibold mt-1">{rows.length}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {(["hubspot", "zuper", "zoho"] as SourceName[]).map((source) => (
              <div key={source} className="bg-surface border border-t-border rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{formatSourceName(source)}</h3>
                  <span
                    className={`text-xs px-2 py-0.5 rounded border ${
                      data.health[source].configured
                        ? "border-green-500/40 text-green-400 bg-green-500/10"
                        : "border-yellow-500/40 text-yellow-300 bg-yellow-500/10"
                    }`}
                  >
                    {data.health[source].configured ? "Configured" : "Not configured"}
                  </span>
                </div>
                <div className="text-xs text-muted mt-2">
                  Products fetched: {data.health[source].count}
                </div>
                {data.health[source].error && (
                  <div className="text-xs text-amber-300 mt-2">{data.health[source].error}</div>
                )}
              </div>
            ))}
          </div>

          {data.warnings.length > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
              <div className="text-xs font-semibold text-amber-300 uppercase tracking-wide">Warnings</div>
              <ul className="mt-2 space-y-1 text-sm text-amber-100">
                {data.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="bg-surface border border-t-border rounded-xl p-4 space-y-3">
            <div className="flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by name, SKU, key, or mismatch reason"
                className="w-full lg:max-w-xl px-3 py-2 rounded-lg border border-t-border bg-background text-sm outline-none focus:border-cyan-500/50"
              />
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs text-muted flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={showMatchedRows}
                    onChange={(event) => setShowMatchedRows(event.target.checked)}
                  />
                  Show matched rows
                </label>
                <select
                  className="px-2 py-1.5 rounded border border-t-border bg-background text-xs"
                  value={missingFilter}
                  onChange={(event) => setMissingFilter(event.target.value as "all" | SourceName)}
                >
                  <option value="all">All gaps</option>
                  <option value="hubspot">Missing in HubSpot</option>
                  <option value="zuper">Missing in Zuper</option>
                  <option value="zoho">Missing in Zoho</option>
                </select>
                <button
                  onClick={fetchData}
                  className="px-3 py-1.5 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 text-xs hover:bg-cyan-500/20 transition-colors"
                >
                  Refresh
                </button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-t-border">
              <table className="w-full text-left text-xs">
                <thead className="bg-background/80 text-muted">
                  <tr>
                    <th className="px-3 py-2">Key</th>
                    <th className="px-3 py-2">HubSpot</th>
                    <th className="px-3 py-2">Zuper</th>
                    <th className="px-3 py-2">Zoho</th>
                    <th className="px-3 py-2">Mismatch Reasons</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key} className="border-t border-t-border align-top">
                      <td className="px-3 py-2 font-mono text-[11px] text-muted">{row.key}</td>
                      <td className="px-3 py-2">
                        <ProductCell product={row.hubspot} />
                      </td>
                      <td className="px-3 py-2">
                        <ProductCell product={row.zuper} />
                      </td>
                      <td className="px-3 py-2">
                        <ProductCell product={row.zoho} />
                      </td>
                      <td className="px-3 py-2">
                        {row.reasons.length === 0 ? (
                          <span className="text-green-400">Matched</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {row.reasons.map((reason) => (
                              <span
                                key={`${row.key}-${reason}`}
                                className="px-2 py-0.5 rounded border border-red-500/30 bg-red-500/10 text-red-300"
                              >
                                {reason}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-muted">
                        No rows match the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
