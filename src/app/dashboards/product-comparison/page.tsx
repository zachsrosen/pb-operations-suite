"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DashboardShell from "@/components/DashboardShell";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { MultiSelectFilter, type FilterOption } from "@/components/ui/MultiSelectFilter";

type SourceName = "hubspot" | "zuper" | "zoho";

interface ComparableProduct {
  id: string;
  name: string | null;
  sku: string | null;
  price: number | null;
  status: string | null;
  description: string | null;
  url: string | null;
}

interface PossibleMatch {
  source: SourceName;
  product: ComparableProduct;
  score: number;
  signals: string[];
}

interface ComparisonRow {
  key: string;
  hubspot: ComparableProduct | null;
  zuper: ComparableProduct | null;
  zoho: ComparableProduct | null;
  reasons: string[];
  isMismatch: boolean;
  possibleMatches: PossibleMatch[];
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

function ProductCell({ source, product }: { source: SourceName; product: ComparableProduct | null }) {
  if (!product) {
    return <span className="text-xs text-red-500 dark:text-red-400">Missing</span>;
  }

  return (
    <div className="space-y-1">
      <div className="text-sm font-medium text-foreground">{product.name || "-"}</div>
      <div className="text-xs text-muted">SKU: {product.sku || "-"}</div>
      <div className="text-xs text-muted">Price: {formatCurrency(product.price)}</div>
      <div className="text-xs text-muted">Status: {product.status || "-"}</div>
      {product.url && (
        <a
          href={product.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex text-xs text-cyan-300 hover:text-cyan-200 underline underline-offset-2"
        >
          Open in {formatSourceName(source)}
        </a>
      )}
    </div>
  );
}

function reasonBadgeClass(reason: string): string {
  if (reason === "Missing in HubSpot") {
    return "border-orange-500/40 bg-orange-500/10 text-orange-300";
  }
  if (reason === "Missing in Zuper") {
    return "border-blue-500/40 bg-blue-500/10 text-blue-300";
  }
  if (reason === "Missing in Zoho") {
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  }
  if (reason.includes("Duplicate")) {
    return "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300";
  }
  if (reason.includes("Price mismatch")) {
    return "border-yellow-500/40 bg-yellow-500/10 text-yellow-300";
  }
  if (reason.includes("SKU mismatch")) {
    return "border-cyan-500/40 bg-cyan-500/10 text-cyan-300";
  }
  if (reason.includes("name mismatch")) {
    return "border-violet-500/40 bg-violet-500/10 text-violet-300";
  }
  return "border-red-500/30 bg-red-500/10 text-red-300";
}

function sourceBadgeClass(source: SourceName): string {
  if (source === "hubspot") return "bg-orange-500/15 border-orange-500/40 text-orange-300";
  if (source === "zuper") return "bg-blue-500/15 border-blue-500/40 text-blue-300";
  return "bg-emerald-500/15 border-emerald-500/40 text-emerald-300";
}

const MISSING_SOURCE_OPTIONS: FilterOption[] = [
  { value: "hubspot", label: "Missing in HubSpot" },
  { value: "zuper", label: "Missing in Zuper" },
  { value: "zoho", label: "Missing in Zoho" },
];

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
  const [missingFilters, setMissingFilters] = useState<SourceName[]>([]);
  const [reasonFilters, setReasonFilters] = useState<string[]>([]);

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

  const reasonFilterOptions = useMemo<FilterOption[]>(() => {
    if (!data) return [];
    const reasons = new Set<string>();
    for (const row of data.rows) {
      for (const reason of row.reasons) reasons.add(reason);
    }
    return [...reasons]
      .sort((a, b) => a.localeCompare(b))
      .map((reason) => ({ value: reason, label: reason }));
  }, [data]);

  const rows = useMemo(() => {
    if (!data) return [];
    const searchTerm = search.trim().toLowerCase();

    return data.rows.filter((row) => {
      if (!showMatchedRows && !row.isMismatch) return false;
      if (missingFilters.length > 0) {
        const matchesMissingSource = missingFilters.some((source) => {
          if (source === "hubspot") return row.hubspot === null;
          if (source === "zuper") return row.zuper === null;
          return row.zoho === null;
        });
        if (!matchesMissingSource) return false;
      }
      if (reasonFilters.length > 0 && !reasonFilters.some((reason) => row.reasons.includes(reason))) {
        return false;
      }

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
        ...row.possibleMatches.map((match) => match.product.name || ""),
        ...row.possibleMatches.map((match) => match.product.sku || ""),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(searchTerm);
    });
  }, [data, missingFilters, reasonFilters, search, showMatchedRows]);

  const exportRows = useMemo(() => {
    return rows.map((row) => ({
      key: row.key,
      reasons: row.reasons.join(" | "),
      possible_matches: row.possibleMatches
        .map(
          (match) =>
            `${formatSourceName(match.source)}:${match.product.name || "-"} (${Math.round(match.score * 100)}%)`
        )
        .join(" | "),
      hubspot_name: row.hubspot?.name || "",
      hubspot_sku: row.hubspot?.sku || "",
      hubspot_price: row.hubspot?.price ?? "",
      hubspot_url: row.hubspot?.url || "",
      zuper_name: row.zuper?.name || "",
      zuper_sku: row.zuper?.sku || "",
      zuper_price: row.zuper?.price ?? "",
      zuper_url: row.zuper?.url || "",
      zoho_name: row.zoho?.name || "",
      zoho_sku: row.zoho?.sku || "",
      zoho_price: row.zoho?.price ?? "",
      zoho_url: row.zoho?.url || "",
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
                <MultiSelectFilter
                  label="Missing"
                  options={MISSING_SOURCE_OPTIONS}
                  selected={missingFilters}
                  onChange={(selected) => setMissingFilters(selected as SourceName[])}
                  placeholder="All sources"
                  accentColor="orange"
                />
                <MultiSelectFilter
                  label="Reasons"
                  options={reasonFilterOptions}
                  selected={reasonFilters}
                  onChange={setReasonFilters}
                  placeholder="All reasons"
                  accentColor="purple"
                />
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
                        <ProductCell source="hubspot" product={row.hubspot} />
                      </td>
                      <td className="px-3 py-2">
                        <ProductCell source="zuper" product={row.zuper} />
                      </td>
                      <td className="px-3 py-2">
                        <ProductCell source="zoho" product={row.zoho} />
                      </td>
                      <td className="px-3 py-2">
                        {row.reasons.length === 0 ? (
                          <span className="text-green-400">Matched</span>
                        ) : (
                          <div className="space-y-2">
                            <div className="flex flex-wrap gap-1">
                              {row.reasons.map((reason) => (
                                <span
                                  key={`${row.key}-${reason}`}
                                  className={`px-2 py-0.5 rounded border ${reasonBadgeClass(reason)}`}
                                >
                                  {reason}
                                </span>
                              ))}
                            </div>
                            {row.possibleMatches.length > 0 && (
                              <div className="space-y-1">
                                <div className="text-[10px] uppercase tracking-wide text-muted">Possible matches</div>
                                {row.possibleMatches.map((match) => (
                                  <div
                                    key={`${row.key}-${match.source}-${match.product.id}`}
                                    className="flex flex-wrap items-center gap-1 text-[11px] text-foreground/85"
                                  >
                                    <span className={`px-1.5 py-0.5 rounded border ${sourceBadgeClass(match.source)}`}>
                                      {formatSourceName(match.source)}
                                    </span>
                                    <span>{match.product.name || "-"}</span>
                                    <span className="text-muted">({Math.round(match.score * 100)}%)</span>
                                    {match.product.sku && <span className="text-muted">SKU: {match.product.sku}</span>}
                                    {match.product.url && (
                                      <a
                                        href={match.product.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-cyan-300 hover:text-cyan-200 underline underline-offset-2"
                                      >
                                        Open
                                      </a>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
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
