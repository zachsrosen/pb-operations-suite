"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DashboardShell from "@/components/DashboardShell";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { MultiSelectFilter, type FilterOption } from "@/components/ui/MultiSelectFilter";

type RowViewMode = "mismatches" | "matches" | "two-of-three" | "all";
type MatchConfidence = "high" | "medium" | "low";

const ALL_SOURCES = ["hubspot", "zuper", "zoho", "opensolar", "quickbooks"] as const;
type SourceName = (typeof ALL_SOURCES)[number];

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
  reasons: string[];
  isMismatch: boolean;
  possibleMatches: PossibleMatch[];
  hubspot: ComparableProduct | null;
  zuper: ComparableProduct | null;
  zoho: ComparableProduct | null;
  opensolar: ComparableProduct | null;
  quickbooks: ComparableProduct | null;
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

interface DisplayRow extends ComparisonRow {
  severity: number;
  missingCount: number;
  bestMatchScore: number | null;
  bestMatchConfidence: MatchConfidence | null;
}

function formatSourceName(source: SourceName): string {
  if (source === "hubspot") return "HubSpot";
  if (source === "zuper") return "Zuper";
  if (source === "zoho") return "Zoho";
  if (source === "opensolar") return "OpenSolar";
  return "QuickBooks";
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

function formatPercent(score: number): string {
  return `${Math.round(score * 100)}%`;
}

function confidenceBucket(score: number | null): MatchConfidence | null {
  if (typeof score !== "number") return null;
  if (score >= 0.85) return "high";
  if (score >= 0.7) return "medium";
  return "low";
}

function confidenceBadgeClass(bucket: MatchConfidence | null): string {
  if (bucket === "high") return "border-green-500/40 bg-green-500/10 text-green-300";
  if (bucket === "medium") return "border-amber-500/40 bg-amber-500/10 text-amber-300";
  if (bucket === "low") return "border-red-500/40 bg-red-500/10 text-red-300";
  return "border-zinc-500/40 bg-zinc-500/10 text-zinc-300";
}

function sourceBadgeClass(source: SourceName): string {
  if (source === "hubspot") return "bg-orange-500/15 border-orange-500/40 text-orange-300";
  if (source === "zuper") return "bg-blue-500/15 border-blue-500/40 text-blue-300";
  if (source === "zoho") return "bg-emerald-500/15 border-emerald-500/40 text-emerald-300";
  if (source === "opensolar") return "bg-teal-500/15 border-teal-500/40 text-teal-300";
  return "bg-sky-500/15 border-sky-500/40 text-sky-300";
}

function reasonBadgeClass(reason: string): string {
  if (reason === "Missing in HubSpot") return "border-orange-500/40 bg-orange-500/10 text-orange-300";
  if (reason === "Missing in Zuper") return "border-blue-500/40 bg-blue-500/10 text-blue-300";
  if (reason === "Missing in Zoho") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  if (reason === "Missing in OpenSolar") return "border-teal-500/40 bg-teal-500/10 text-teal-300";
  if (reason === "Missing in QuickBooks") return "border-sky-500/40 bg-sky-500/10 text-sky-300";
  if (reason.includes("Duplicate")) return "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300";
  if (reason.includes("Price mismatch")) return "border-yellow-500/40 bg-yellow-500/10 text-yellow-300";
  if (reason.includes("SKU mismatch")) return "border-cyan-500/40 bg-cyan-500/10 text-cyan-300";
  if (reason.includes("name mismatch")) return "border-violet-500/40 bg-violet-500/10 text-violet-300";
  return "border-red-500/30 bg-red-500/10 text-red-300";
}

function severityBadgeClass(severity: number): string {
  if (severity >= 24) return "border-red-500/40 bg-red-500/10 text-red-300";
  if (severity >= 14) return "border-orange-500/40 bg-orange-500/10 text-orange-300";
  if (severity >= 7) return "border-amber-500/40 bg-amber-500/10 text-amber-300";
  if (severity > 0) return "border-blue-500/40 bg-blue-500/10 text-blue-300";
  return "border-green-500/40 bg-green-500/10 text-green-300";
}

function normalizeSearchText(value: string | null | undefined): string {
  return String(value || "").toLowerCase().trim();
}

function computeRowSeverity(row: ComparisonRow): number {
  let severity = 0;
  for (const reason of row.reasons) {
    if (reason.startsWith("Missing in")) severity += 10;
    else if (reason.includes("Duplicate")) severity += 8;
    else if (reason.includes("SKU mismatch")) severity += 6;
    else if (reason.includes("Price mismatch")) severity += 5;
    else if (reason.includes("name mismatch")) severity += 4;
    else severity += 3;
  }
  if (row.reasons.length > 0 && row.possibleMatches.length === 0) severity += 4;
  if (row.isMismatch && severity === 0) severity = 1;
  return severity;
}

function severityLabel(severity: number): string {
  if (severity >= 24) return "Critical";
  if (severity >= 14) return "High";
  if (severity >= 7) return "Medium";
  if (severity > 0) return "Low";
  return "Clean";
}

function ProductCell({ source, product }: { source: SourceName; product: ComparableProduct | null }) {
  if (!product) {
    return (
      <div className="rounded-md border border-red-500/25 bg-red-500/5 p-2">
        <div className="text-[11px] font-medium text-red-300">Missing from {formatSourceName(source)}</div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5 min-w-0">
      <div className="text-sm font-medium text-foreground leading-tight break-words">{product.name || "-"}</div>
      <div className="flex flex-wrap gap-1 text-[11px]">
        <span className="px-1.5 py-0.5 rounded border border-t-border bg-background/70 text-muted break-all">
          SKU: {product.sku || "-"}
        </span>
        <span className="px-1.5 py-0.5 rounded border border-t-border bg-background/70 text-muted">
          {formatCurrency(product.price)}
        </span>
        {product.status && (
          <span className="px-1.5 py-0.5 rounded border border-t-border bg-background/70 text-muted">
            {product.status}
          </span>
        )}
      </div>
      {product.description && <div className="text-[11px] text-muted line-clamp-2">{product.description}</div>}
      {product.url && (
        <a
          href={product.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex text-[11px] text-cyan-300 hover:text-cyan-200 underline underline-offset-2"
        >
          Open in {formatSourceName(source)}
        </a>
      )}
    </div>
  );
}

const MISSING_SOURCE_OPTIONS: FilterOption[] = [
  { value: "hubspot", label: "Missing in HubSpot" },
  { value: "zuper", label: "Missing in Zuper" },
  { value: "zoho", label: "Missing in Zoho" },
  { value: "opensolar", label: "Missing in OpenSolar" },
  { value: "quickbooks", label: "Missing in QuickBooks" },
];

const WEBSITE_VIEW_OPTIONS: FilterOption[] = ALL_SOURCES.map((source) => ({
  value: source,
  label: formatSourceName(source),
}));

const VIEW_MODE_OPTIONS: FilterOption[] = [
  { value: "mismatches", label: "Mismatches" },
  { value: "matches", label: "Matches only" },
  { value: "two-of-three", label: "2 of N aligned" },
  { value: "all", label: "All rows" },
];

const MATCH_CONFIDENCE_OPTIONS: FilterOption[] = [
  { value: "high", label: "High confidence" },
  { value: "medium", label: "Medium confidence" },
  { value: "low", label: "Low confidence" },
];

const MISSING_REASON_PREFIX = "Missing in ";

function isBundleInfoWarning(warning: string): boolean {
  const normalized = warning.trim().toLowerCase();
  return normalized.includes("excluded") && normalized.includes("hubspot") && normalized.includes("product bundle");
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
  const [rowViewModes, setRowViewModes] = useState<RowViewMode[]>(["mismatches"]);
  const [visibleSources, setVisibleSources] = useState<SourceName[]>([...ALL_SOURCES]);
  const [missingFilters, setMissingFilters] = useState<SourceName[]>([]);
  const [reasonFilters, setReasonFilters] = useState<string[]>([]);
  const [confidenceFilters, setConfidenceFilters] = useState<MatchConfidence[]>([]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/products/comparison", { cache: "no-store" });
      if (!response.ok) throw new Error(`Failed to fetch comparison data (${response.status})`);
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
        const allowed = (authPayload.role || "VIEWER") === "ADMIN" || (authPayload.role || "VIEWER") === "OWNER";
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

  const configuredSources = useMemo<SourceName[]>(() => {
    if (!data) return [...ALL_SOURCES];
    return ALL_SOURCES.filter((source) => data.health[source]?.configured);
  }, [data]);

  const displayedSources = useMemo<SourceName[]>(() => {
    const selected = visibleSources.length > 0 ? visibleSources : [...ALL_SOURCES];
    return ALL_SOURCES.filter((source) => selected.includes(source));
  }, [visibleSources]);

  const reasonFilterOptions = useMemo<FilterOption[]>(() => {
    if (!data) return [];
    const reasons = new Set<string>();
    for (const row of data.rows) {
      for (const reason of row.reasons) reasons.add(reason);
    }
    return [...reasons].sort((a, b) => a.localeCompare(b)).map((reason) => ({ value: reason, label: reason }));
  }, [data]);

  const visibleWarnings = useMemo(() => {
    if (!data) return [];
    return data.warnings.filter((warning) => !isBundleInfoWarning(warning));
  }, [data]);

  const rows = useMemo<DisplayRow[]>(() => {
    if (!data) return [];
    const searchTerm = normalizeSearchText(search);

    const filtered = data.rows.filter((row) => {
      const presentCount = configuredSources.filter((source) => Boolean(row[source])).length;
      const missingReasons = row.reasons.filter((reason) => reason.startsWith(MISSING_REASON_PREFIX));
      const nonMissingReasons = row.reasons.filter((reason) => !reason.startsWith(MISSING_REASON_PREFIX));
      const isFullyMatched = configuredSources.length > 0 && presentCount === configuredSources.length && row.reasons.length === 0;
      const isTwoOfThreeAligned =
        presentCount === 2 &&
        nonMissingReasons.length === 0 &&
        missingReasons.length === Math.max(configuredSources.length - 2, 1);

      const effectiveModes: RowViewMode[] = rowViewModes.length > 0 ? rowViewModes : ["all"];
      const modeMatch = effectiveModes.some((mode) => {
        if (mode === "all") return true;
        if (mode === "mismatches") return row.isMismatch;
        if (mode === "matches") return isFullyMatched;
        return isTwoOfThreeAligned;
      });
      if (!modeMatch) return false;

      if (missingFilters.length > 0) {
        const matchesMissingSource = missingFilters.some((source) => configuredSources.includes(source) && row[source] === null);
        if (!matchesMissingSource) return false;
      }

      if (reasonFilters.length > 0 && !reasonFilters.some((reason) => row.reasons.includes(reason))) return false;

      if (confidenceFilters.length > 0) {
        const bestScore = row.possibleMatches.reduce<number | null>((best, match) => {
          if (typeof best !== "number") return match.score;
          return Math.max(best, match.score);
        }, null);
        const bucket = confidenceBucket(bestScore);
        if (!bucket || !confidenceFilters.includes(bucket)) return false;
      }

      if (!searchTerm) return true;

      const haystack = [
        row.key,
        ...ALL_SOURCES.map((source) => row[source]?.name || ""),
        ...ALL_SOURCES.map((source) => row[source]?.sku || ""),
        ...row.reasons,
        ...row.possibleMatches.map((match) => match.product.name || ""),
        ...row.possibleMatches.map((match) => match.product.sku || ""),
        ...row.possibleMatches.flatMap((match) => match.signals),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(searchTerm);
    });

    return filtered
      .map((row) => {
        const bestMatchScore = row.possibleMatches.reduce<number | null>((best, match) => {
          if (typeof best !== "number") return match.score;
          return Math.max(best, match.score);
        }, null);
        return {
          ...row,
          severity: computeRowSeverity(row),
          missingCount: configuredSources.filter((source) => row[source] === null).length,
          bestMatchScore,
          bestMatchConfidence: confidenceBucket(bestMatchScore),
        };
      })
      .sort((a, b) => {
        if (a.isMismatch !== b.isMismatch) return a.isMismatch ? -1 : 1;
        if (a.severity !== b.severity) return b.severity - a.severity;
        if (a.missingCount !== b.missingCount) return b.missingCount - a.missingCount;
        const aScore = a.bestMatchScore ?? -1;
        const bScore = b.bestMatchScore ?? -1;
        if (aScore !== bScore) return bScore - aScore;
        return a.key.localeCompare(b.key);
      });
  }, [confidenceFilters, configuredSources, data, missingFilters, reasonFilters, rowViewModes, search]);

  const exportRows = useMemo(() => {
    return rows.map((row) => ({
      key: row.key,
      severity: severityLabel(row.severity),
      reasons: row.reasons.join(" | "),
      best_match_confidence: row.bestMatchConfidence || "",
      possible_matches: row.possibleMatches
        .map((match) => `${formatSourceName(match.source)}:${match.product.name || "-"} (${formatPercent(match.score)})`)
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
      opensolar_name: row.opensolar?.name || "",
      opensolar_sku: row.opensolar?.sku || "",
      opensolar_price: row.opensolar?.price ?? "",
      opensolar_url: row.opensolar?.url || "",
      quickbooks_name: row.quickbooks?.name || "",
      quickbooks_sku: row.quickbooks?.sku || "",
      quickbooks_price: row.quickbooks?.price ?? "",
      quickbooks_url: row.quickbooks?.url || "",
    }));
  }, [rows]);

  const activeFilterCount =
    (search.trim() ? 1 : 0) +
    (rowViewModes.length === 1 && rowViewModes[0] === "mismatches" ? 0 : 1) +
    (visibleSources.length !== ALL_SOURCES.length ? 1 : 0) +
    (missingFilters.length ? 1 : 0) +
    (reasonFilters.length ? 1 : 0) +
    (confidenceFilters.length ? 1 : 0);

  const clearFilters = () => {
    setSearch("");
    setRowViewModes(["mismatches"]);
    setVisibleSources([...ALL_SOURCES]);
    setMissingFilters([]);
    setReasonFilters([]);
    setConfidenceFilters([]);
  };

  const lastUpdated = formatDateTime(data?.lastUpdated || null);

  return (
    <DashboardShell
      title="Product Catalog Comparison"
      subtitle="Cross-check HubSpot, Zuper, Zoho, OpenSolar, and QuickBooks product data"
      accentColor="cyan"
      lastUpdated={lastUpdated}
      breadcrumbs={[{ label: "Admin", href: "/suites/admin" }]}
      exportData={{ data: exportRows, filename: "product-catalog-comparison" }}
    >
      {loading && <div className="bg-surface border border-t-border rounded-xl p-6 text-sm text-muted">Loading product comparison data...</div>}

      {!loading && error && <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-red-300">{error}</div>}

      {!loading && !error && data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
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
            <div className="bg-surface border border-t-border rounded-xl p-4">
              <div className="text-xs text-muted">Active filters</div>
              <div className="text-2xl font-semibold mt-1">{activeFilterCount}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
            {ALL_SOURCES.map((source) => (
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
                <div className="text-xs text-muted mt-2">Products fetched: {data.health[source].count}</div>
                {data.health[source].error && <div className="text-xs text-amber-300 mt-2">{data.health[source].error}</div>}
              </div>
            ))}
          </div>

          {visibleWarnings.length > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
              <div className="text-xs font-semibold text-amber-300 uppercase tracking-wide">Warnings</div>
              <ul className="mt-2 space-y-1 text-sm text-amber-100">
                {visibleWarnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="bg-surface border border-t-border rounded-xl p-4 space-y-3">
            <div className="flex flex-col lg:flex-row gap-3 lg:items-start lg:justify-between">
              <div className="w-full lg:max-w-xl space-y-2">
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by name, SKU, key, reasons, or match signals"
                  className="w-full px-3 py-2 rounded-lg border border-t-border bg-background text-sm outline-none focus:border-cyan-500/50"
                />
                <div className="text-xs text-muted">Card layout optimized for no horizontal scrolling.</div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <MultiSelectFilter
                  label="Websites"
                  options={WEBSITE_VIEW_OPTIONS}
                  selected={visibleSources}
                  onChange={(selected) => setVisibleSources(selected as SourceName[])}
                  placeholder="All websites"
                  accentColor="green"
                />
                <MultiSelectFilter
                  label="View"
                  options={VIEW_MODE_OPTIONS}
                  selected={rowViewModes}
                  onChange={(selected) => setRowViewModes(selected as RowViewMode[])}
                  placeholder="All views"
                  accentColor="blue"
                />
                <MultiSelectFilter
                  label="Missing"
                  options={MISSING_SOURCE_OPTIONS}
                  selected={missingFilters}
                  onChange={(selected) => setMissingFilters(selected as SourceName[])}
                  placeholder="All sources"
                  accentColor="orange"
                />
                <MultiSelectFilter
                  label="Match confidence"
                  options={MATCH_CONFIDENCE_OPTIONS}
                  selected={confidenceFilters}
                  onChange={(selected) => setConfidenceFilters(selected as MatchConfidence[])}
                  placeholder="All confidence"
                  accentColor="teal"
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
                  onClick={clearFilters}
                  className="px-3 py-1.5 rounded border border-t-border bg-background text-xs text-muted hover:text-foreground transition-colors"
                >
                  Clear filters
                </button>
                <button
                  onClick={fetchData}
                  className="px-3 py-1.5 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 text-xs hover:bg-cyan-500/20 transition-colors"
                >
                  Refresh
                </button>
              </div>
            </div>

            <div className="space-y-3 max-h-[72vh] overflow-y-auto pr-1">
              {rows.map((row, index) => (
                <article
                  key={row.key}
                  className={`rounded-lg border p-3 ${
                    row.isMismatch
                      ? "border-red-500/20 bg-red-500/5"
                      : "border-green-500/20 bg-green-500/5"
                  }`}
                >
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-1 min-w-0">
                      <div className="text-[11px] text-muted">Row {index + 1}</div>
                      <div className="font-mono text-[11px] text-muted break-all">{row.key}</div>
                      <div className="flex flex-wrap gap-1">
                        <span className={`px-1.5 py-0.5 rounded border text-[10px] ${severityBadgeClass(row.severity)}`}>
                          {severityLabel(row.severity)}
                        </span>
                        {row.bestMatchConfidence && (
                          <span className={`px-1.5 py-0.5 rounded border text-[10px] ${confidenceBadgeClass(row.bestMatchConfidence)}`}>
                            Best match {row.bestMatchConfidence}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1 text-[11px]">
                      <span className="px-1.5 py-0.5 rounded border border-t-border bg-background/70 text-muted">
                        Missing: {row.missingCount}
                      </span>
                      <span className="px-1.5 py-0.5 rounded border border-t-border bg-background/70 text-muted">
                        Suggestions: {row.possibleMatches.length}
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                    {displayedSources.map((source) => (
                      <div key={`${row.key}-${source}`} className="rounded-md border border-t-border bg-background/40 p-2 min-w-0">
                        <div className="mb-2">
                          <span className={`inline-flex px-1.5 py-0.5 rounded border text-[10px] ${sourceBadgeClass(source)}`}>
                            {formatSourceName(source)}
                          </span>
                        </div>
                        <ProductCell source={source} product={row[source]} />
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 border-t border-t-border pt-3 space-y-2">
                    {row.reasons.length === 0 ? (
                      <div className="text-sm font-medium text-green-400">Matched</div>
                    ) : (
                      <>
                        <div className="flex flex-wrap gap-1">
                          {row.reasons.map((reason) => (
                            <span key={`${row.key}-${reason}`} className={`px-2 py-0.5 rounded border text-[11px] ${reasonBadgeClass(reason)}`}>
                              {reason}
                            </span>
                          ))}
                        </div>

                        {row.possibleMatches.length > 0 ? (
                          <div className="space-y-1.5">
                            <div className="text-[10px] uppercase tracking-wide text-muted">Suggested matches</div>
                            {row.possibleMatches.slice(0, 6).map((match) => {
                              const bucket = confidenceBucket(match.score);
                              return (
                                <div key={`${row.key}-${match.source}-${match.product.id}`} className="rounded-md border border-t-border bg-background/60 p-2">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className={`px-1.5 py-0.5 rounded border text-[10px] ${sourceBadgeClass(match.source)}`}>
                                      {formatSourceName(match.source)}
                                    </span>
                                    <span className="text-sm text-foreground/90 break-words">{match.product.name || "-"}</span>
                                    <span className={`px-1.5 py-0.5 rounded border text-[10px] ${confidenceBadgeClass(bucket)}`}>
                                      {formatPercent(match.score)}
                                    </span>
                                    {match.product.sku && <span className="text-xs text-muted">SKU: {match.product.sku}</span>}
                                    {match.product.url && (
                                      <a href={match.product.url} target="_blank" rel="noreferrer" className="text-cyan-300 hover:text-cyan-200 underline underline-offset-2 text-xs">
                                        Open
                                      </a>
                                    )}
                                  </div>
                                  {match.signals.length > 0 && (
                                    <div className="mt-1 flex flex-wrap gap-1">
                                      {match.signals.slice(0, 4).map((signal) => (
                                        <span
                                          key={`${row.key}-${match.product.id}-${signal}`}
                                          className="px-1.5 py-0.5 rounded border border-t-border bg-background text-[10px] text-muted"
                                        >
                                          {signal}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="text-xs text-muted">No high-confidence suggestions available.</div>
                        )}
                      </>
                    )}
                  </div>
                </article>
              ))}

              {rows.length === 0 && (
                <div className="rounded-lg border border-t-border bg-background/50 p-6 text-center text-muted">
                  No rows match the current filters.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
