"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import DashboardShell from "@/components/DashboardShell";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { MultiSelectFilter, type FilterOption } from "@/components/ui/MultiSelectFilter";
import { FORM_CATEGORIES, getCategoryLabel } from "@/lib/catalog-fields";

type RowViewMode = "mismatches" | "matches" | "two-of-three" | "all";
type MatchConfidence = "high" | "medium" | "low";
type QueueFilter = "unlinked" | "resolved" | "no-internal" | "duplicates" | "pinned";

const ALL_SOURCES = ["internal", "hubspot", "zuper", "zoho"] as const;
type SourceName = (typeof ALL_SOURCES)[number];
const ACTIVE_SOURCES = [...ALL_SOURCES];
const LINKABLE_SOURCES = ["hubspot", "zuper", "zoho"] as const;
type LinkableSourceName = (typeof LINKABLE_SOURCES)[number];
const LINK_FIELD_BY_SOURCE: Record<LinkableSourceName, "hubspotProductId" | "zuperItemId" | "zohoItemId"> = {
  hubspot: "hubspotProductId",
  zuper: "zuperItemId",
  zoho: "zohoItemId",
};

interface ComparableProduct {
  id: string;
  name: string | null;
  sku: string | null;
  price: number | null;
  status: string | null;
  description: string | null;
  url: string | null;
  linkedExternalIds?: Partial<Record<LinkableSourceName, string | null>>;
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
  internalDuplicates?: ComparableProduct[];
  internal: ComparableProduct | null;
  hubspot: ComparableProduct | null;
  zuper: ComparableProduct | null;
  zoho: ComparableProduct | null;
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
  queueStates: QueueFilter[];
}

interface CachedCatalogProduct {
  source: string;
  externalId: string;
  name: string | null;
  sku: string | null;
  description: string | null;
  price: number | null;
  status: string | null;
  url: string | null;
}

interface SourceSearchState {
  open: boolean;
  query: string;
  loading: boolean;
  error: string | null;
  results: CachedCatalogProduct[];
}

interface CreateSourceProductResponse {
  source: LinkableSourceName;
  created: boolean;
  externalId: string;
  linkField: "hubspotProductId" | "zuperItemId" | "zohoItemId";
  product: ComparableProduct;
}

interface InventorySkuResponse {
  sku?: {
    id: string;
    brand: string;
    model: string;
    sku: string | null;
    description: string | null;
    sellPrice: number | null;
    isActive: boolean;
    hubspotProductId: string | null;
    zuperItemId: string | null;
    zohoItemId: string | null;
  };
  error?: string;
}

interface InternalCreateDraft {
  open: boolean;
  category: string;
  brand: string;
  model: string;
  sku: string;
  description: string;
  sellPrice: string;
  unitCost: string;
}

type CleanupScope = "duplicates" | "pinned" | "visible";

interface CleanupActionsInput {
  internal: "none" | "deactivate";
  links: "none" | "unlink_selected";
  external: "none" | "delete_selected";
  sources: LinkableSourceName[];
  deleteCachedProducts: boolean;
}

interface CleanupConfirmationResponse {
  token: string;
  issuedAt: number;
  expiresAt: number;
}

interface CleanupApiExternalResult {
  source: LinkableSourceName;
  externalId: string;
  status: "deleted" | "archived" | "not_found" | "failed" | "skipped";
  message: string;
  httpStatus?: number;
}

interface CleanupApiResult {
  internalSkuId: string;
  status: "succeeded" | "partial" | "failed";
  message: string;
  links: {
    status: "skipped" | "planned" | "updated" | "partial";
    message: string;
    changedFields: string[];
  };
  externalBySource: Partial<Record<LinkableSourceName, CleanupApiExternalResult>>;
  internal: {
    status: "skipped" | "planned" | "updated" | "partial";
    message: string;
  };
  cache: {
    status: "skipped" | "planned" | "updated" | "partial";
    message: string;
    removedCount: number;
  };
}

interface CleanupApiResponse {
  dryRun: boolean;
  summary: {
    total: number;
    succeeded: number;
    partial: number;
    failed: number;
  };
  results: CleanupApiResult[];
}

function formatSourceName(source: SourceName): string {
  if (source === "internal") return "Internal";
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
  if (source === "internal") return "bg-zinc-500/15 border-zinc-500/40 text-zinc-200";
  if (source === "hubspot") return "bg-orange-500/15 border-orange-500/40 text-orange-300";
  if (source === "zuper") return "bg-blue-500/15 border-blue-500/40 text-blue-300";
  if (source === "zoho") return "bg-emerald-500/15 border-emerald-500/40 text-emerald-300";
  return "bg-sky-500/15 border-sky-500/40 text-sky-300";
}

function reasonBadgeClass(reason: string): string {
  if (reason === "Missing in Internal") return "border-zinc-500/40 bg-zinc-500/10 text-zinc-300";
  if (reason === "Missing in HubSpot") return "border-orange-500/40 bg-orange-500/10 text-orange-300";
  if (reason === "Missing in Zuper") return "border-blue-500/40 bg-blue-500/10 text-blue-300";
  if (reason === "Missing in Zoho") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  if (reason.includes("Internal link missing")) return "border-amber-500/40 bg-amber-500/10 text-amber-300";
  if (reason.includes("Internal link mismatch")) return "border-red-500/40 bg-red-500/10 text-red-300";
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

function queueBadgeLabel(queueState: QueueFilter): string {
  if (queueState === "unlinked") return "Needs links";
  if (queueState === "resolved") return "Resolved";
  if (queueState === "no-internal") return "Missing internal";
  if (queueState === "duplicates") return "Duplicate internal";
  return "Pinned";
}

function queueBadgeClass(queueState: QueueFilter): string {
  if (queueState === "unlinked") return "border-orange-500/40 bg-orange-500/10 text-orange-200";
  if (queueState === "resolved") return "border-green-500/40 bg-green-500/10 text-green-300";
  if (queueState === "no-internal") return "border-zinc-500/40 bg-zinc-500/10 text-zinc-200";
  if (queueState === "duplicates") return "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-200";
  return "border-amber-500/40 bg-amber-500/10 text-amber-200";
}

function normalizeSearchText(value: string | null | undefined): string {
  return String(value || "").toLowerCase().trim();
}

function normalizeComparableText(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeComparableSku(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function missingReasonForSource(source: SourceName): string {
  return `Missing in ${formatSourceName(source)}`;
}

function configuredSourcesFromPayload(payload: ProductComparisonResponse): SourceName[] {
  return ACTIVE_SOURCES.filter((source) => payload.health[source]?.configured);
}

function evaluateDynamicReasons(row: ComparisonRow, configuredSources: SourceName[]): string[] {
  const reasons: string[] = [];

  for (const source of configuredSources) {
    if (!row[source]) reasons.push(missingReasonForSource(source));
  }

  const present = configuredSources.map((source) => row[source]).filter(Boolean) as ComparableProduct[];
  const names = new Set(present.map((product) => normalizeComparableText(product.name)).filter(Boolean));
  const skus = new Set(present.map((product) => normalizeComparableSku(product.sku)).filter(Boolean));
  const hasSharedSku = skus.size === 1 && skus.size > 0;

  if (names.size > 1 && !hasSharedSku) reasons.push("Product name mismatch");
  if (skus.size > 1) reasons.push("SKU mismatch");

  const numericPrices = present
    .map((product) => product.price)
    .filter((price): price is number => typeof price === "number" && Number.isFinite(price))
    .map((price) => Number(price.toFixed(2)));
  if (numericPrices.length >= 2) {
    const uniquePrices = new Set(numericPrices);
    if (uniquePrices.size > 1) reasons.push("Price mismatch");
  }

  const internalProduct = row.internal;
  const linkedExternalIds = internalProduct?.linkedExternalIds;
  if (internalProduct && linkedExternalIds) {
    for (const source of LINKABLE_SOURCES) {
      if (!configuredSources.includes(source)) continue;
      const linkedId = String(linkedExternalIds[source] || "").trim();
      const externalProduct = row[source];
      if (!externalProduct) {
        if (linkedId) reasons.push(`Internal link mismatch for ${formatSourceName(source)}`);
        continue;
      }
      if (!linkedId) {
        reasons.push(`Internal link missing for ${formatSourceName(source)}`);
        continue;
      }
      if (linkedId !== externalProduct.id) {
        reasons.push(`Internal link mismatch for ${formatSourceName(source)}`);
      }
    }
  }

  return uniqueStrings(reasons);
}

function recomputeRowState(row: ComparisonRow, configuredSources: SourceName[]): ComparisonRow {
  const duplicateReasons = row.reasons.filter((reason) => reason.startsWith("Duplicate "));
  const nextReasons = uniqueStrings([...duplicateReasons, ...evaluateDynamicReasons(row, configuredSources)]);
  return {
    ...row,
    reasons: nextReasons,
    isMismatch: nextReasons.length > 0,
    possibleMatches: nextReasons.length === 0 ? [] : row.possibleMatches,
  };
}

function computeRowSeverity(row: ComparisonRow): number {
  let severity = 0;
  for (const reason of row.reasons) {
    if (reason.startsWith("Missing in")) severity += 10;
    else if (reason.includes("Internal link missing")) severity += 9;
    else if (reason.includes("Internal link mismatch")) severity += 11;
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
      <div className="text-[11px] leading-relaxed">
        <span className="text-muted/70">Desc:</span>{" "}
        <span className={product.description ? "text-foreground/80" : "text-muted/50"}>
          {product.description ? product.description : "—"}
        </span>
      </div>
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

function isLinkableSource(source: SourceName): source is LinkableSourceName {
  return LINKABLE_SOURCES.includes(source as LinkableSourceName);
}

function getLinkedExternalId(product: ComparableProduct | null, source: LinkableSourceName): string | null {
  if (!product?.linkedExternalIds) return null;
  const value = product.linkedExternalIds[source];
  const normalized = String(value || "").trim();
  return normalized || null;
}

function sourceSearchKey(rowKey: string, source: LinkableSourceName): string {
  return `${rowKey}:${source}`;
}

function displayLinkValue(value: string | null | undefined): string {
  const normalized = String(value || "").trim();
  return normalized || "—";
}

function defaultSourceSearchQuery(row: ComparisonRow, source: LinkableSourceName): string {
  const seed = [
    row[source]?.sku,
    row[source]?.name,
    row.internal?.sku,
    row.internal?.name,
  ]
    .map((value) => String(value || "").trim())
    .find(Boolean);
  return seed || "";
}

function cachedCatalogToComparableProduct(candidate: CachedCatalogProduct): ComparableProduct {
  return {
    id: candidate.externalId,
    name: candidate.name,
    sku: candidate.sku,
    price: candidate.price,
    status: candidate.status,
    description: candidate.description,
    url: candidate.url,
  };
}

function splitBrandAndModel(name: string | null | undefined): { brand: string; model: string } {
  const cleaned = String(name || "").trim();
  if (!cleaned) return { brand: "", model: "" };
  const [first, ...rest] = cleaned.split(/\s+/);
  return {
    brand: first || "",
    model: rest.length > 0 ? rest.join(" ") : cleaned,
  };
}

function chooseSeedProductForInternal(row: ComparisonRow): ComparableProduct | null {
  return row.zoho || row.zuper || row.hubspot || null;
}

function inferInternalCategory(row: ComparisonRow): string {
  const seed = chooseSeedProductForInternal(row);
  const text = `${seed?.name || ""} ${seed?.description || ""} ${seed?.status || ""}`.toLowerCase();
  if (text.includes("battery")) return "BATTERY";
  if (text.includes("inverter")) return "INVERTER";
  if (text.includes("module") || text.includes("panel")) return "MODULE";
  if (text.includes("charger") || text.includes("ev")) return "EV_CHARGER";
  if (text.includes("gateway")) return "GATEWAY";
  if (text.includes("service")) return "SERVICE";
  if (text.includes("racking") || text.includes("rail") || text.includes("mount")) return "RACKING";
  return "RACKING";
}

function parseNumericInput(value: string): number | null {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

const MISSING_SOURCE_OPTIONS: FilterOption[] = [
  { value: "internal", label: "Missing in Internal" },
  { value: "hubspot", label: "Missing in HubSpot" },
  { value: "zuper", label: "Missing in Zuper" },
  { value: "zoho", label: "Missing in Zoho" },
];

const WEBSITE_VIEW_OPTIONS: FilterOption[] = ACTIVE_SOURCES.map((source) => ({
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

const QUEUE_FILTER_OPTIONS: FilterOption[] = [
  { value: "unlinked", label: "Needs links" },
  { value: "resolved", label: "Resolved links" },
  { value: "no-internal", label: "Missing internal" },
  { value: "duplicates", label: "Duplicates" },
  { value: "pinned", label: "Pinned rows" },
];

const DEFAULT_QUEUE_FILTERS: QueueFilter[] = ["unlinked", "no-internal", "duplicates", "pinned"];
const CLEANUP_SCOPE_OPTIONS: Array<{ value: CleanupScope; label: string; description: string }> = [
  { value: "duplicates", label: "Visible duplicates", description: "Only rows in the duplicate queue with an internal product." },
  { value: "pinned", label: "Pinned rows", description: "Rows you pinned while linking/matching." },
  { value: "visible", label: "All visible rows", description: "All currently visible rows with an internal product." },
];
const CLEANUP_CONFIRM_TEXT = "CLEANUP";
const CLEANUP_MAX_BATCH = 50;

const MISSING_REASON_PREFIX = "Missing in ";

function isBundleInfoWarning(warning: string): boolean {
  const normalized = warning.trim().toLowerCase();
  return normalized.includes("excluded") && normalized.includes("hubspot") && normalized.includes("product bundle");
}

function deriveQueueStates(
  row: ComparisonRow,
  configuredSources: SourceName[],
  pinned: boolean
): QueueFilter[] {
  const states: QueueFilter[] = [];
  if (pinned) states.push("pinned");
  if (row.reasons.some((reason) => reason.startsWith("Duplicate Internal entries"))) {
    states.push("duplicates");
  }

  if (!row.internal) {
    states.push("no-internal");
    return states;
  }

  const configuredLinkableSources = configuredSources.filter(isLinkableSource);
  const hasMissingConfiguredSource = configuredLinkableSources.some((source) => row[source] === null);
  const hasLinkMismatchReason = row.reasons.some((reason) => reason.includes("Internal link mismatch for "));
  const hasLinkMissingReason = row.reasons.some((reason) => reason.includes("Internal link missing for "));

  if (hasMissingConfiguredSource || hasLinkMismatchReason || hasLinkMissingReason) {
    states.push("unlinked");
  } else {
    states.push("resolved");
  }

  return states;
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
  const [visibleSources, setVisibleSources] = useState<SourceName[]>([...ACTIVE_SOURCES]);
  const [queueFilters, setQueueFilters] = useState<QueueFilter[]>([...DEFAULT_QUEUE_FILTERS]);
  const [missingFilters, setMissingFilters] = useState<SourceName[]>([]);
  const [reasonFilters, setReasonFilters] = useState<string[]>([]);
  const [confidenceFilters, setConfidenceFilters] = useState<MatchConfidence[]>([]);
  const [linkingKeys, setLinkingKeys] = useState<Record<string, boolean>>({});
  const [creatingKeys, setCreatingKeys] = useState<Record<string, boolean>>({});
  const [mergingKeys, setMergingKeys] = useState<Record<string, boolean>>({});
  const [creatingInternalKeys, setCreatingInternalKeys] = useState<Record<string, boolean>>({});
  const [internalCreateByRow, setInternalCreateByRow] = useState<Record<string, InternalCreateDraft>>({});
  const [searchStateBySource, setSearchStateBySource] = useState<Record<string, SourceSearchState>>({});
  const [pinnedRowKeys, setPinnedRowKeys] = useState<Record<string, true>>({});
  const [actionFeedback, setActionFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [mergePreview, setMergePreview] = useState<{
    row: DisplayRow;
    sourceDuplicate: ComparableProduct;
    targetPrimary: ComparableProduct;
  } | null>(null);
  const [cleanupFeatureEnabled, setCleanupFeatureEnabled] = useState(false);
  const [cleanupModalOpen, setCleanupModalOpen] = useState(false);
  const [cleanupScope, setCleanupScope] = useState<CleanupScope>("duplicates");
  const [cleanupActions, setCleanupActions] = useState<CleanupActionsInput>({
    internal: "none",
    links: "unlink_selected",
    external: "none",
    sources: [],
    deleteCachedProducts: false,
  });
  const [cleanupDryRun, setCleanupDryRun] = useState(false);
  const [cleanupConfirmInput, setCleanupConfirmInput] = useState("");
  const [cleanupRunning, setCleanupRunning] = useState(false);
  const [cleanupProgress, setCleanupProgress] = useState<{ completed: number; total: number } | null>(null);
  const [cleanupBatchResponses, setCleanupBatchResponses] = useState<CleanupApiResponse[]>([]);
  const [compactCards, setCompactCards] = useState(true);
  const [expandedRowKeys, setExpandedRowKeys] = useState<Record<string, true>>({});
  const [isBackgroundRefreshing, setIsBackgroundRefreshing] = useState(false);
  const backgroundRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backgroundRefreshInFlightRef = useRef(false);

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

  const runBackgroundRefresh = useCallback(async () => {
    if (backgroundRefreshInFlightRef.current) return;
    backgroundRefreshInFlightRef.current = true;
    setIsBackgroundRefreshing(true);

    try {
      const response = await fetch("/api/products/comparison", { cache: "no-store" });
      if (!response.ok) return;
      const json = (await response.json()) as ProductComparisonResponse;
      setData(json);
      setError(null);
    } catch {
      // Keep this silent to avoid interrupting active linking workflows.
    } finally {
      backgroundRefreshInFlightRef.current = false;
      setIsBackgroundRefreshing(false);
    }
  }, []);

  const scheduleBackgroundRefresh = useCallback(
    (delayMs = 1200) => {
      if (backgroundRefreshTimerRef.current) {
        clearTimeout(backgroundRefreshTimerRef.current);
      }
      backgroundRefreshTimerRef.current = setTimeout(() => {
        backgroundRefreshTimerRef.current = null;
        void runBackgroundRefresh();
      }, delayMs);
    },
    [runBackgroundRefresh]
  );

  const toggleSourceSearch = useCallback((row: DisplayRow, source: LinkableSourceName) => {
    const key = sourceSearchKey(row.key, source);
    setSearchStateBySource((prev) => {
      const existing = prev[key];
      if (existing) {
        return {
          ...prev,
          [key]: {
            ...existing,
            open: !existing.open,
          },
        };
      }
      return {
        ...prev,
        [key]: {
          open: true,
          query: defaultSourceSearchQuery(row, source),
          loading: false,
          error: null,
          results: [],
        },
      };
    });
  }, []);

  const updateSourceSearchQuery = useCallback((rowKey: string, source: LinkableSourceName, query: string) => {
    const key = sourceSearchKey(rowKey, source);
    setSearchStateBySource((prev) => {
      const existing = prev[key] ?? {
        open: true,
        query: "",
        loading: false,
        error: null,
        results: [],
      };
      return {
        ...prev,
        [key]: {
          ...existing,
          query,
        },
      };
    });
  }, []);

  const runSourceSearch = useCallback(
    async (row: DisplayRow, source: LinkableSourceName, queryInput?: string) => {
      const key = sourceSearchKey(row.key, source);
      const query = String(queryInput ?? (searchStateBySource[key]?.query || "")).trim();
      if (!query) {
        setSearchStateBySource((prev) => ({
          ...prev,
          [key]: {
            ...(prev[key] ?? {
              open: true,
              query: "",
              loading: false,
              error: null,
              results: [],
            }),
            error: "Enter a search term.",
            loading: false,
          },
        }));
        return;
      }

      setSearchStateBySource((prev) => ({
        ...prev,
        [key]: {
          ...(prev[key] ?? {
            open: true,
            query,
            loading: false,
            error: null,
            results: [],
          }),
          open: true,
          query,
          loading: true,
          error: null,
        },
      }));

      try {
        const response = await fetch(
          `/api/products/cache?source=${encodeURIComponent(source)}&search=${encodeURIComponent(query)}&limit=12`,
          { cache: "no-store" }
        );
        const payload = (await response.json().catch(() => null)) as
          | { error?: string; products?: CachedCatalogProduct[] }
          | null;
        if (!response.ok) {
          throw new Error(payload?.error || `Failed to search ${formatSourceName(source)} (${response.status})`);
        }
        const products = Array.isArray(payload?.products) ? payload.products : [];

        setSearchStateBySource((prev) => ({
          ...prev,
          [key]: {
            ...(prev[key] ?? {
              open: true,
              query,
              loading: false,
              error: null,
              results: [],
            }),
            open: true,
            query,
            loading: false,
            error: null,
            results: products,
          },
        }));
      } catch (error) {
        setSearchStateBySource((prev) => ({
          ...prev,
          [key]: {
            ...(prev[key] ?? {
              open: true,
              query,
              loading: false,
              error: null,
              results: [],
            }),
            open: true,
            query,
            loading: false,
            results: [],
            error: error instanceof Error ? error.message : "Catalog search failed",
          },
        }));
      }
    },
    [searchStateBySource]
  );

  const applyLocalLinkUpdate = useCallback((
    rowKey: string,
    source: LinkableSourceName,
    externalId: string,
    sourceProduct: ComparableProduct | null
  ) => {
    setData((prev) => {
      if (!prev) return prev;
      const configuredSources = configuredSourcesFromPayload(prev);
      const nextRows = prev.rows.map((candidateRow) => {
        if (candidateRow.key !== rowKey || !candidateRow.internal) return candidateRow;
        const shouldSetSourceProduct =
          Boolean(sourceProduct) &&
          (!candidateRow[source] || candidateRow[source]?.id === externalId);
        const nextRow: ComparisonRow = {
          ...candidateRow,
          ...(shouldSetSourceProduct ? { [source]: sourceProduct } : {}),
          internal: {
            ...candidateRow.internal,
            linkedExternalIds: {
              ...(candidateRow.internal.linkedExternalIds || {}),
              [source]: externalId,
            },
          },
        };
        return recomputeRowState(nextRow, configuredSources);
      });
      return {
        ...prev,
        rows: nextRows,
      };
    });
  }, []);

  const confirmSourceLink = useCallback(
    async (row: DisplayRow, source: LinkableSourceName, externalId: string) => {
      if (!row.internal?.id) {
        setActionFeedback({ type: "error", message: "No internal product found for this row." });
        return;
      }

      const linkKey = `${row.key}:${source}:${externalId}`;
      setLinkingKeys((prev) => ({ ...prev, [linkKey]: true }));
      setActionFeedback(null);

      const patchBody: Record<string, string> = { id: row.internal.id };
      for (const linkableSource of LINKABLE_SOURCES) {
        const resolvedExternalId =
          linkableSource === source
            ? externalId
            : row[linkableSource]?.id || getLinkedExternalId(row.internal, linkableSource);
        if (!resolvedExternalId) continue;
        patchBody[LINK_FIELD_BY_SOURCE[linkableSource]] = resolvedExternalId;
      }

      try {
        const response = await fetch("/api/inventory/skus", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patchBody),
        });

        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!response.ok) {
          throw new Error(payload?.error || `Failed to link ${formatSourceName(source)} (${response.status})`);
        }

        const searchKey = sourceSearchKey(row.key, source);
        const candidate = searchStateBySource[searchKey]?.results.find((result) => result.externalId === externalId);
        const suggestedMatch = row.possibleMatches.find(
          (match) => match.source === source && match.product.id === externalId
        );
        const sourceProduct =
          row[source]?.id === externalId
            ? row[source]
            : candidate
              ? cachedCatalogToComparableProduct(candidate)
              : suggestedMatch?.product || null;
        applyLocalLinkUpdate(row.key, source, externalId, sourceProduct);
        setPinnedRowKeys((prev) => ({ ...prev, [row.key]: true }));
        scheduleBackgroundRefresh();
        const syncedCount = Object.keys(patchBody).length - 1;
        setActionFeedback({
          type: "success",
          message: `Linked ${formatSourceName(source)} and synced ${syncedCount} catalog ID${syncedCount === 1 ? "" : "s"} to inventory. Row pinned so you can continue linking other systems.`,
        });
      } catch (error) {
        setActionFeedback({
          type: "error",
          message: error instanceof Error ? error.message : "Failed to save link",
        });
      } finally {
        setLinkingKeys((prev) => {
          const next = { ...prev };
          delete next[linkKey];
          return next;
        });
      }
    },
    [applyLocalLinkUpdate, scheduleBackgroundRefresh, searchStateBySource]
  );

  const createMissingSourceProduct = useCallback(
    async (row: DisplayRow, source: LinkableSourceName) => {
      if (!row.internal?.id) {
        setActionFeedback({ type: "error", message: "No internal product found for this row." });
        return;
      }

      const createKey = `${row.key}:${source}:create`;
      setCreatingKeys((prev) => ({ ...prev, [createKey]: true }));
      setActionFeedback(null);

      try {
        const response = await fetch("/api/products/comparison/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            internalSkuId: row.internal.id,
            source,
          }),
        });

        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | CreateSourceProductResponse
          | null;
        if (!response.ok || !payload || !("externalId" in payload)) {
          throw new Error(payload && "error" in payload && payload.error ? payload.error : `Failed to create ${formatSourceName(source)} item (${response.status})`);
        }

        applyLocalLinkUpdate(row.key, source, payload.externalId, payload.product || null);
        setPinnedRowKeys((prev) => ({ ...prev, [row.key]: true }));
        scheduleBackgroundRefresh();
        setActionFeedback({
          type: "success",
          message: `${
            payload.created ? "Created" : "Found existing"
          } ${formatSourceName(source)} product and linked it to inventory.`,
        });
      } catch (error) {
        setActionFeedback({
          type: "error",
          message: error instanceof Error ? error.message : `Failed to create ${formatSourceName(source)} product`,
        });
      } finally {
        setCreatingKeys((prev) => {
          const next = { ...prev };
          delete next[createKey];
          return next;
        });
      }
    },
    [applyLocalLinkUpdate, scheduleBackgroundRefresh]
  );

  const toggleInternalCreate = useCallback((row: DisplayRow) => {
    setInternalCreateByRow((prev) => {
      const existing = prev[row.key];
      if (existing) {
        return {
          ...prev,
          [row.key]: {
            ...existing,
            open: !existing.open,
          },
        };
      }
      const seed = chooseSeedProductForInternal(row);
      const split = splitBrandAndModel(seed?.name);
      return {
        ...prev,
        [row.key]: {
          open: true,
          category: inferInternalCategory(row),
          brand: split.brand,
          model: split.model,
          sku: seed?.sku || "",
          description: seed?.description || "",
          sellPrice: typeof seed?.price === "number" ? String(seed.price) : "",
          unitCost: "",
        },
      };
    });
  }, []);

  const updateInternalCreateField = useCallback(
    (rowKey: string, field: keyof Omit<InternalCreateDraft, "open">, value: string) => {
      setInternalCreateByRow((prev) => {
        const existing = prev[rowKey];
        if (!existing) return prev;
        return {
          ...prev,
          [rowKey]: {
            ...existing,
            [field]: value,
          },
        };
      });
    },
    []
  );

  const createInternalFromRow = useCallback(
    async (row: DisplayRow) => {
      const draft = internalCreateByRow[row.key];
      if (!draft) return;

      const category = draft.category.trim();
      const brand = draft.brand.trim();
      const model = draft.model.trim();
      if (!category || !brand || !model) {
        setActionFeedback({
          type: "error",
          message: "Category, brand, and model are required to create an internal product.",
        });
        return;
      }

      setCreatingInternalKeys((prev) => ({ ...prev, [row.key]: true }));
      setActionFeedback(null);

      try {
        const payload = {
          category,
          brand,
          model,
          sku: draft.sku.trim() || null,
          description: draft.description.trim() || null,
          sellPrice: parseNumericInput(draft.sellPrice),
          unitCost: parseNumericInput(draft.unitCost),
          hubspotProductId: row.hubspot?.id || null,
          zuperItemId: row.zuper?.id || null,
          zohoItemId: row.zoho?.id || null,
        };

        const response = await fetch("/api/inventory/skus", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const result = (await response.json().catch(() => null)) as InventorySkuResponse | null;
        if (!response.ok || !result?.sku) {
          throw new Error(result?.error || `Failed to create internal product (${response.status})`);
        }

        const created = result.sku;
        const internalProduct: ComparableProduct = {
          id: created.id,
          name: `${created.brand} ${created.model}`.trim() || null,
          sku: created.sku,
          price: typeof created.sellPrice === "number" ? created.sellPrice : null,
          status: created.isActive ? "active" : "inactive",
          description: created.description,
          url: `/dashboards/catalog/edit/${encodeURIComponent(created.id)}`,
          linkedExternalIds: {
            hubspot: created.hubspotProductId || null,
            zuper: created.zuperItemId || null,
            zoho: created.zohoItemId || null,
          },
        };

        setData((prev) => {
          if (!prev) return prev;
          const configuredSources = configuredSourcesFromPayload(prev);
          return {
            ...prev,
            rows: prev.rows.map((candidateRow) => {
              if (candidateRow.key !== row.key) return candidateRow;
              const nextRow: ComparisonRow = {
                ...candidateRow,
                internal: internalProduct,
              };
              return recomputeRowState(nextRow, configuredSources);
            }),
          };
        });

        setPinnedRowKeys((prev) => ({ ...prev, [row.key]: true }));
        scheduleBackgroundRefresh();
        setInternalCreateByRow((prev) => ({
          ...prev,
          [row.key]: {
            ...draft,
            open: false,
          },
        }));
        setActionFeedback({
          type: "success",
          message: "Created internal product and linked available source IDs. Saved to inventory.",
        });
      } catch (error) {
        setActionFeedback({
          type: "error",
          message: error instanceof Error ? error.message : "Failed to create internal product",
        });
      } finally {
        setCreatingInternalKeys((prev) => {
          const next = { ...prev };
          delete next[row.key];
          return next;
        });
      }
    },
    [internalCreateByRow, scheduleBackgroundRefresh]
  );

  const mergeDuplicateInternalIntoPrimary = useCallback(
    async (row: DisplayRow, sourceSkuId: string) => {
      if (!row.internal?.id) {
        setActionFeedback({ type: "error", message: "Primary internal product is missing for this row." });
        return;
      }
      if (!sourceSkuId || sourceSkuId === row.internal.id) {
        setActionFeedback({ type: "error", message: "Invalid duplicate product selected for merge." });
        return;
      }

      const mergeKey = `${row.key}:${sourceSkuId}:${row.internal.id}`;
      setMergingKeys((prev) => ({ ...prev, [mergeKey]: true }));
      setActionFeedback(null);

      try {
        const response = await fetch("/api/inventory/skus/merge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceSkuId,
            targetSkuId: row.internal.id,
          }),
        });
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!response.ok) {
          throw new Error(payload?.error || `Failed to merge duplicate internal product (${response.status})`);
        }

        setData((prev) => {
          if (!prev) return prev;
          const configuredSources = configuredSourcesFromPayload(prev);
          return {
            ...prev,
            rows: prev.rows.map((candidateRow) => {
              if (candidateRow.key !== row.key) return candidateRow;
              const nextDuplicates = (candidateRow.internalDuplicates || []).filter((entry) => entry.id !== sourceSkuId);
              const hasRemainingInternalDuplicates = nextDuplicates.length > 1;
              const nextRow: ComparisonRow = {
                ...candidateRow,
                ...(hasRemainingInternalDuplicates ? { internalDuplicates: nextDuplicates } : { internalDuplicates: undefined }),
              };
              return recomputeRowState(nextRow, configuredSources);
            }),
          };
        });

        setPinnedRowKeys((prev) => ({ ...prev, [row.key]: true }));
        scheduleBackgroundRefresh();
        setMergePreview((prev) => (prev && prev.row.key === row.key && prev.sourceDuplicate.id === sourceSkuId ? null : prev));
        setActionFeedback({
          type: "success",
          message: "Merged duplicate internal product into the primary product. Row pinned for further linking work.",
        });
      } catch (error) {
        setActionFeedback({
          type: "error",
          message: error instanceof Error ? error.message : "Failed to merge duplicate internal product",
        });
      } finally {
        setMergingKeys((prev) => {
          const next = { ...prev };
          delete next[mergeKey];
          return next;
        });
      }
    },
    [scheduleBackgroundRefresh]
  );

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
    if (!accessChecked || !isAllowed) return;
    let cancelled = false;

    fetch("/api/products/cleanup/confirm", {
      method: "GET",
      cache: "no-store",
    })
      .then((response) => {
        if (cancelled) return;
        setCleanupFeatureEnabled(response.ok);
      })
      .catch(() => {
        if (cancelled) return;
        setCleanupFeatureEnabled(false);
      });

    return () => {
      cancelled = true;
    };
  }, [accessChecked, isAllowed]);

  useEffect(() => {
    if (!isAllowed || hasTrackedView.current) return;
    trackDashboardView("product-comparison", {});
    hasTrackedView.current = true;
  }, [isAllowed, trackDashboardView]);

  useEffect(() => {
    return () => {
      if (backgroundRefreshTimerRef.current) {
        clearTimeout(backgroundRefreshTimerRef.current);
        backgroundRefreshTimerRef.current = null;
      }
    };
  }, []);

  const configuredSources = useMemo<SourceName[]>(() => {
    if (!data) return [...ACTIVE_SOURCES];
    return ACTIVE_SOURCES.filter((source) => data.health[source]?.configured);
  }, [data]);

  const displayedSources = useMemo<SourceName[]>(() => {
    const selected = visibleSources.length > 0 ? visibleSources : [...ACTIVE_SOURCES];
    return ACTIVE_SOURCES.filter((source) => selected.includes(source));
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
      const isPinned = Boolean(pinnedRowKeys[row.key]);
      const queueStates = deriveQueueStates(row, configuredSources, isPinned);
      const presentCount = configuredSources.filter((source) => Boolean(row[source])).length;
      const missingReasons = row.reasons.filter((reason) => reason.startsWith(MISSING_REASON_PREFIX));
      const nonMissingReasons = row.reasons.filter((reason) => !reason.startsWith(MISSING_REASON_PREFIX));
      const isFullyMatched = configuredSources.length > 0 && presentCount === configuredSources.length && row.reasons.length === 0;
      const isTwoOfThreeAligned =
        presentCount === 2 &&
        nonMissingReasons.length === 0 &&
        missingReasons.length === Math.max(configuredSources.length - 2, 1);

      if (queueFilters.length > 0 && !queueFilters.some((queueFilter) => queueStates.includes(queueFilter))) {
        return false;
      }

      if (!isPinned) {
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
      }

      if (!searchTerm) return true;

      const haystack = [
        row.key,
        ...ALL_SOURCES.map((source) => row[source]?.name || ""),
        ...ALL_SOURCES.map((source) => row[source]?.sku || ""),
        ...LINKABLE_SOURCES.map((source) => row.internal?.linkedExternalIds?.[source] || ""),
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
          queueStates: deriveQueueStates(row, configuredSources, Boolean(pinnedRowKeys[row.key])),
        };
      })
      .sort((a, b) => {
        const queuePriority = (candidate: DisplayRow): number => {
          if (candidate.queueStates.includes("pinned")) return 4;
          if (candidate.queueStates.includes("duplicates")) return 3;
          if (candidate.queueStates.includes("unlinked")) return 2;
          if (candidate.queueStates.includes("no-internal")) return 1;
          if (candidate.queueStates.includes("resolved")) return 0;
          return 0;
        };
        const queueDelta = queuePriority(b) - queuePriority(a);
        if (queueDelta !== 0) return queueDelta;
        if (a.isMismatch !== b.isMismatch) return a.isMismatch ? -1 : 1;
        if (a.severity !== b.severity) return b.severity - a.severity;
        if (a.missingCount !== b.missingCount) return b.missingCount - a.missingCount;
        const aScore = a.bestMatchScore ?? -1;
        const bScore = b.bestMatchScore ?? -1;
        if (aScore !== bScore) return bScore - aScore;
        return a.key.localeCompare(b.key);
      });
  }, [confidenceFilters, configuredSources, data, missingFilters, pinnedRowKeys, queueFilters, reasonFilters, rowViewModes, search]);

  const cleanupCandidateRows = useMemo<DisplayRow[]>(() => {
    if (cleanupScope === "duplicates") {
      return rows.filter((row) => row.queueStates.includes("duplicates") && Boolean(row.internal?.id));
    }
    if (cleanupScope === "pinned") {
      return rows.filter((row) => Boolean(pinnedRowKeys[row.key]) && Boolean(row.internal?.id));
    }
    return rows.filter((row) => Boolean(row.internal?.id));
  }, [cleanupScope, pinnedRowKeys, rows]);

  const cleanupSkuIds = useMemo<string[]>(() => {
    const ids = cleanupCandidateRows
      .map((row) => row.internal?.id || "")
      .filter(Boolean);
    return [...new Set(ids)];
  }, [cleanupCandidateRows]);

  const cleanupScopeLabel = useMemo<string>(() => {
    const match = CLEANUP_SCOPE_OPTIONS.find((option) => option.value === cleanupScope);
    return match?.label || "Selected rows";
  }, [cleanupScope]);

  const applyCleanupResultsToLocalData = useCallback(
    (results: CleanupApiResult[], actions: CleanupActionsInput) => {
      if (results.length === 0) return;
      const bySkuId = new Map<string, CleanupApiResult>(results.map((result) => [result.internalSkuId, result]));
      setData((prev) => {
        if (!prev) return prev;
        const configured = configuredSourcesFromPayload(prev);
        return {
          ...prev,
          rows: prev.rows.map((row) => {
            const internalId = row.internal?.id;
            if (!internalId) return row;
            const cleanupResult = bySkuId.get(internalId);
            if (!cleanupResult) return row;

            let nextRow: ComparisonRow = row;
            if (row.internal) {
              const nextLinks = { ...(row.internal.linkedExternalIds || {}) };
              if (actions.links === "unlink_selected") {
                for (const source of actions.sources) {
                  nextLinks[source] = null;
                }
              }

              nextRow = {
                ...nextRow,
                internal: {
                  ...row.internal,
                  status:
                    actions.internal === "deactivate" &&
                    (cleanupResult.internal.status === "updated" || cleanupResult.internal.status === "partial")
                      ? "inactive"
                      : row.internal.status,
                  linkedExternalIds: nextLinks,
                },
              };
            }

            if (actions.external === "delete_selected") {
              for (const source of actions.sources) {
                const outcome = cleanupResult.externalBySource[source];
                if (!outcome) continue;
                if (outcome.status === "deleted" || outcome.status === "not_found") {
                  nextRow = {
                    ...nextRow,
                    [source]: null,
                  };
                }
              }
            }

            return recomputeRowState(nextRow, configured);
          }),
        };
      });
    },
    []
  );

  const runCleanupForScope = useCallback(async () => {
    if (cleanupRunning) return;
    if (cleanupSkuIds.length === 0) {
      setActionFeedback({
        type: "error",
        message: "No internal products are available for this cleanup scope.",
      });
      return;
    }
    if (cleanupActions.external === "delete_selected" && cleanupActions.sources.length === 0) {
      setActionFeedback({
        type: "error",
        message: "Select at least one external source when external cleanup is enabled.",
      });
      return;
    }
    if (cleanupConfirmInput.trim().toUpperCase() !== CLEANUP_CONFIRM_TEXT) {
      setActionFeedback({
        type: "error",
        message: `Type ${CLEANUP_CONFIRM_TEXT} to confirm this cleanup batch.`,
      });
      return;
    }

    const chunks: string[][] = [];
    for (let i = 0; i < cleanupSkuIds.length; i += CLEANUP_MAX_BATCH) {
      chunks.push(cleanupSkuIds.slice(i, i + CLEANUP_MAX_BATCH));
    }

    setCleanupRunning(true);
    setCleanupProgress({ completed: 0, total: chunks.length });
    setCleanupBatchResponses([]);
    setActionFeedback(null);

    const summary = {
      total: 0,
      succeeded: 0,
      partial: 0,
      failed: 0,
    };

    try {
      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index];

        const confirmationResponse = await fetch("/api/products/cleanup/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            internalSkuIds: chunk,
            actions: cleanupActions,
          }),
        });

        const confirmationPayload = (await confirmationResponse.json().catch(() => null)) as
          | ({ error?: string } & Partial<CleanupConfirmationResponse>)
          | null;
        if (!confirmationResponse.ok || !confirmationPayload?.token || typeof confirmationPayload.issuedAt !== "number") {
          throw new Error(
            confirmationPayload?.error ||
              `Failed to create cleanup confirmation token (${confirmationResponse.status}).`
          );
        }

        const cleanupResponse = await fetch("/api/products/cleanup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            internalSkuIds: chunk,
            actions: cleanupActions,
            dryRun: cleanupDryRun,
            confirmation: {
              token: confirmationPayload.token,
              issuedAt: confirmationPayload.issuedAt,
            },
          }),
        });

        const payload = (await cleanupResponse.json().catch(() => null)) as
          | ({ error?: string } & Partial<CleanupApiResponse>)
          | null;
        if (!cleanupResponse.ok || !payload || !payload.summary || !Array.isArray(payload.results)) {
          throw new Error(payload?.error || `Cleanup batch failed (${cleanupResponse.status}).`);
        }

        const typedPayload = payload as CleanupApiResponse;
        setCleanupBatchResponses((prev) => [...prev, typedPayload]);
        summary.total += typedPayload.summary.total;
        summary.succeeded += typedPayload.summary.succeeded;
        summary.partial += typedPayload.summary.partial;
        summary.failed += typedPayload.summary.failed;

        if (!cleanupDryRun) {
          applyCleanupResultsToLocalData(typedPayload.results, cleanupActions);
        }

        setCleanupProgress({ completed: index + 1, total: chunks.length });
      }

      if (!cleanupDryRun) {
        scheduleBackgroundRefresh(400);
      }

      setPinnedRowKeys((prev) => {
        const next = { ...prev };
        for (const row of cleanupCandidateRows) {
          next[row.key] = true;
        }
        return next;
      });

      setActionFeedback({
        type: summary.failed > 0 ? "error" : "success",
        message: `${cleanupDryRun ? "Dry-run complete" : "Cleanup complete"} for ${summary.total} product${summary.total === 1 ? "" : "s"} (${summary.succeeded} succeeded, ${summary.partial} partial, ${summary.failed} failed).`,
      });
      setCleanupConfirmInput("");
    } catch (error) {
      setActionFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Cleanup batch failed.",
      });
    } finally {
      setCleanupRunning(false);
      setCleanupProgress(null);
    }
  }, [
    applyCleanupResultsToLocalData,
    cleanupActions,
    cleanupCandidateRows,
    cleanupConfirmInput,
    cleanupDryRun,
    cleanupRunning,
    cleanupSkuIds,
    scheduleBackgroundRefresh,
  ]);

  const exportRows = useMemo(() => {
    return rows.map((row) => ({
      key: row.key,
      severity: severityLabel(row.severity),
      queue_states: row.queueStates.join(" | "),
      internal_duplicate_count: row.internalDuplicates?.length ?? 0,
      internal_duplicate_ids: (row.internalDuplicates || []).map((entry) => entry.id).join(" | "),
      reasons: row.reasons.join(" | "),
      best_match_confidence: row.bestMatchConfidence || "",
      possible_matches: row.possibleMatches
        .map((match) => `${formatSourceName(match.source)}:${match.product.name || "-"} (${formatPercent(match.score)})`)
        .join(" | "),
      internal_name: row.internal?.name || "",
      internal_sku: row.internal?.sku || "",
      internal_hubspot_link: row.internal?.linkedExternalIds?.hubspot || "",
      internal_zuper_link: row.internal?.linkedExternalIds?.zuper || "",
      internal_zoho_link: row.internal?.linkedExternalIds?.zoho || "",
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

  const hasDefaultQueueFilters =
    queueFilters.length === DEFAULT_QUEUE_FILTERS.length &&
    DEFAULT_QUEUE_FILTERS.every((value) => queueFilters.includes(value));

  const activeFilterCount =
    (search.trim() ? 1 : 0) +
    (rowViewModes.length === 1 && rowViewModes[0] === "mismatches" ? 0 : 1) +
    (visibleSources.length !== ACTIVE_SOURCES.length ? 1 : 0) +
    (hasDefaultQueueFilters ? 0 : 1) +
    (missingFilters.length ? 1 : 0) +
    (reasonFilters.length ? 1 : 0) +
    (confidenceFilters.length ? 1 : 0);

  const clearFilters = () => {
    setSearch("");
    setRowViewModes(["mismatches"]);
    setVisibleSources([...ACTIVE_SOURCES]);
    setQueueFilters([...DEFAULT_QUEUE_FILTERS]);
    setMissingFilters([]);
    setReasonFilters([]);
    setConfidenceFilters([]);
  };

  const clearPinnedRows = () => {
    setPinnedRowKeys({});
  };

  const toggleRowExpanded = useCallback((rowKey: string) => {
    setExpandedRowKeys((prev) => {
      if (prev[rowKey]) {
        const next = { ...prev };
        delete next[rowKey];
        return next;
      }
      return { ...prev, [rowKey]: true };
    });
  }, []);

  const lastUpdated = formatDateTime(data?.lastUpdated || null);
  const mergePreviewKey = mergePreview
    ? `${mergePreview.row.key}:${mergePreview.sourceDuplicate.id}:${mergePreview.targetPrimary.id}`
    : "";
  const isMergePreviewSaving = mergePreviewKey ? Boolean(mergingKeys[mergePreviewKey]) : false;
  const cleanupBatchSummary = cleanupBatchResponses.reduce(
    (acc, batch) => {
      acc.total += batch.summary.total;
      acc.succeeded += batch.summary.succeeded;
      acc.partial += batch.summary.partial;
      acc.failed += batch.summary.failed;
      return acc;
    },
    { total: 0, succeeded: 0, partial: 0, failed: 0 }
  );
  const cleanupCanRun =
    cleanupSkuIds.length > 0 &&
    (cleanupActions.external !== "delete_selected" || cleanupActions.sources.length > 0) &&
    cleanupConfirmInput.trim().toUpperCase() === CLEANUP_CONFIRM_TEXT &&
    !cleanupRunning;

  return (
    <DashboardShell
      title="Product Catalog Comparison"
      subtitle="Cross-check Internal, HubSpot, Zuper, and Zoho product data"
      accentColor="cyan"
      lastUpdated={lastUpdated}
      breadcrumbs={[{ label: "Operations", href: "/suites/operations" }]}
      exportData={{ data: exportRows, filename: "product-catalog-comparison" }}
      headerRight={
        <Link
          href="/dashboards/catalog/review"
          className="hidden sm:inline-flex px-2.5 py-1.5 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 text-xs hover:bg-cyan-500/20"
        >
          Match review queue
        </Link>
      }
    >
      {loading && <div className="bg-surface border border-t-border rounded-xl p-6 text-sm text-muted">Loading product comparison data...</div>}

      {!loading && error && <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-red-300">{error}</div>}

      {!loading && !error && data && (
        <div className="space-y-4">
          {actionFeedback && (
            <div
              className={`rounded-xl border p-3 text-sm ${
                actionFeedback.type === "success"
                  ? "border-green-500/30 bg-green-500/10 text-green-200"
                  : "border-red-500/30 bg-red-500/10 text-red-200"
              }`}
            >
              {actionFeedback.message}
            </div>
          )}

          {mergePreview && (
            <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[1px] p-4 md:p-8">
              <div className="mx-auto max-w-6xl rounded-xl border border-fuchsia-500/30 bg-surface shadow-2xl">
                <div className="flex items-center justify-between border-b border-t-border px-4 py-3">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-fuchsia-300">Merge Review</div>
                    <div className="text-sm text-foreground">Compare primary vs duplicate before merging</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMergePreview(null)}
                    className="px-2 py-1 rounded border border-t-border bg-background text-xs text-muted hover:text-foreground"
                  >
                    Close
                  </button>
                </div>

                <div className="p-4 space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3 space-y-2">
                      <div className="text-[11px] uppercase tracking-wide text-green-300">Primary (kept)</div>
                      <div className="text-sm font-medium text-foreground break-words">{mergePreview.targetPrimary.name || "—"}</div>
                      <div className="text-xs text-muted break-all">SKU: {mergePreview.targetPrimary.sku || "—"}</div>
                      <a
                        href={mergePreview.targetPrimary.url || `/dashboards/catalog/edit/${encodeURIComponent(mergePreview.targetPrimary.id)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-cyan-300 hover:text-cyan-200 underline underline-offset-2"
                      >
                        Open primary in new tab
                      </a>
                    </div>
                    <div className="rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/10 p-3 space-y-2">
                      <div className="text-[11px] uppercase tracking-wide text-fuchsia-200">Duplicate (merged in)</div>
                      <div className="text-sm font-medium text-foreground break-words">{mergePreview.sourceDuplicate.name || "—"}</div>
                      <div className="text-xs text-muted break-all">SKU: {mergePreview.sourceDuplicate.sku || "—"}</div>
                      <a
                        href={mergePreview.sourceDuplicate.url || `/dashboards/catalog/edit/${encodeURIComponent(mergePreview.sourceDuplicate.id)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-cyan-300 hover:text-cyan-200 underline underline-offset-2"
                      >
                        Open duplicate in new tab
                      </a>
                    </div>
                  </div>

                  <div className="rounded-lg border border-t-border overflow-hidden">
                    <div className="grid grid-cols-[160px_1fr_1fr] bg-background/60 border-b border-t-border text-[11px] uppercase tracking-wide text-muted">
                      <div className="px-3 py-2">Field</div>
                      <div className="px-3 py-2">Primary value</div>
                      <div className="px-3 py-2">Duplicate value</div>
                    </div>
                    {[
                      {
                        label: "Description",
                        primary: mergePreview.targetPrimary.description || "—",
                        duplicate: mergePreview.sourceDuplicate.description || "—",
                      },
                      {
                        label: "Price",
                        primary: formatCurrency(mergePreview.targetPrimary.price),
                        duplicate: formatCurrency(mergePreview.sourceDuplicate.price),
                      },
                      {
                        label: "Status",
                        primary: mergePreview.targetPrimary.status || "—",
                        duplicate: mergePreview.sourceDuplicate.status || "—",
                      },
                      {
                        label: "HubSpot ID",
                        primary: displayLinkValue(mergePreview.targetPrimary.linkedExternalIds?.hubspot),
                        duplicate: displayLinkValue(mergePreview.sourceDuplicate.linkedExternalIds?.hubspot),
                      },
                      {
                        label: "Zuper ID",
                        primary: displayLinkValue(mergePreview.targetPrimary.linkedExternalIds?.zuper),
                        duplicate: displayLinkValue(mergePreview.sourceDuplicate.linkedExternalIds?.zuper),
                      },
                      {
                        label: "Zoho ID",
                        primary: displayLinkValue(mergePreview.targetPrimary.linkedExternalIds?.zoho),
                        duplicate: displayLinkValue(mergePreview.sourceDuplicate.linkedExternalIds?.zoho),
                      },
                    ].map((field) => {
                      const differs = field.primary !== field.duplicate;
                      return (
                        <div
                          key={`merge-preview-field-${field.label}`}
                          className={`grid grid-cols-[160px_1fr_1fr] border-b border-t-border last:border-b-0 text-xs ${
                            differs ? "bg-amber-500/5" : "bg-transparent"
                          }`}
                        >
                          <div className="px-3 py-2 text-muted">{field.label}</div>
                          <div className="px-3 py-2 break-all text-foreground">{field.primary}</div>
                          <div className="px-3 py-2 break-all text-foreground">{field.duplicate}</div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                    Merge behavior: the primary product is kept. Missing fields on primary are filled from duplicate. If both have values and conflict, primary wins.
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setMergePreview(null)}
                      className="px-3 py-1.5 rounded border border-t-border bg-background text-xs text-muted hover:text-foreground"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await mergeDuplicateInternalIntoPrimary(mergePreview.row, mergePreview.sourceDuplicate.id);
                      }}
                      disabled={isMergePreviewSaving}
                      className="px-3 py-1.5 rounded border border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-200 text-xs hover:bg-fuchsia-500/20 disabled:opacity-50"
                    >
                      {isMergePreviewSaving ? "Merging..." : "Merge duplicate into primary"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {cleanupModalOpen && cleanupFeatureEnabled && (
            <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[1px] p-4 md:p-8">
              <div className="mx-auto max-w-4xl rounded-xl border border-amber-500/30 bg-surface shadow-2xl">
                <div className="flex items-center justify-between border-b border-t-border px-4 py-3">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-amber-300">Batch Cleanup</div>
                    <div className="text-sm text-foreground">
                      {cleanupDryRun ? "Preview" : "Execute"} cleanup actions on inventory-linked rows
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (cleanupRunning) return;
                      setCleanupModalOpen(false);
                    }}
                    className="px-2 py-1 rounded border border-t-border bg-background text-xs text-muted hover:text-foreground disabled:opacity-50"
                    disabled={cleanupRunning}
                  >
                    Close
                  </button>
                </div>

                <div className="p-4 space-y-4">
                  <div className="rounded-lg border border-t-border bg-background/40 p-3 space-y-2">
                    <div className="text-xs uppercase tracking-wide text-muted">Scope</div>
                    <div className="grid gap-2 md:grid-cols-3">
                      {CLEANUP_SCOPE_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setCleanupScope(option.value)}
                          className={`rounded border px-2 py-2 text-left ${
                            cleanupScope === option.value
                              ? "border-cyan-500/40 bg-cyan-500/10"
                              : "border-t-border bg-background/60"
                          }`}
                        >
                          <div className="text-xs font-medium text-foreground">{option.label}</div>
                          <div className="text-[11px] text-muted">{option.description}</div>
                        </button>
                      ))}
                    </div>
                    <div className="text-xs text-muted">
                      {cleanupScopeLabel}: {cleanupSkuIds.length} internal product{cleanupSkuIds.length === 1 ? "" : "s"} selected.
                    </div>
                  </div>

                  <div className="rounded-lg border border-t-border bg-background/40 p-3 space-y-3">
                    <div className="text-xs uppercase tracking-wide text-muted">Actions</div>
                    <div className="grid gap-2 md:grid-cols-2">
                      <label className="flex items-center gap-2 text-xs text-foreground">
                        <input
                          type="checkbox"
                          checked={cleanupActions.links === "unlink_selected"}
                          onChange={(event) =>
                            setCleanupActions((prev) => ({
                              ...prev,
                              links: event.target.checked ? "unlink_selected" : "none",
                            }))
                          }
                        />
                        Unlink selected source IDs on internal product
                      </label>
                      <label className="flex items-center gap-2 text-xs text-foreground">
                        <input
                          type="checkbox"
                          checked={cleanupActions.internal === "deactivate"}
                          onChange={(event) =>
                            setCleanupActions((prev) => ({
                              ...prev,
                              internal: event.target.checked ? "deactivate" : "none",
                            }))
                          }
                        />
                        Deactivate internal product
                      </label>
                      <label className="flex items-center gap-2 text-xs text-foreground md:col-span-2">
                        <input
                          type="checkbox"
                          checked={cleanupActions.external === "delete_selected"}
                          onChange={(event) =>
                            setCleanupActions((prev) => ({
                              ...prev,
                              external: event.target.checked ? "delete_selected" : "none",
                              deleteCachedProducts: event.target.checked ? prev.deleteCachedProducts : false,
                            }))
                          }
                        />
                        Run external cleanup for selected sources (HubSpot/Zuper/Zoho delete/archive)
                      </label>
                    </div>

                    <div className="grid gap-2 md:grid-cols-4">
                      {LINKABLE_SOURCES.map((source) => (
                        <label key={`cleanup-source-${source}`} className="flex items-center gap-2 text-xs text-foreground">
                          <input
                            type="checkbox"
                            checked={cleanupActions.sources.includes(source)}
                            disabled={cleanupActions.external !== "delete_selected"}
                            onChange={(event) =>
                              setCleanupActions((prev) => {
                                const nextSources = event.target.checked
                                  ? [...new Set([...prev.sources, source])]
                                  : prev.sources.filter((candidate) => candidate !== source);
                                return { ...prev, sources: nextSources };
                              })
                            }
                          />
                          {formatSourceName(source)}
                        </label>
                      ))}
                    </div>

                    <div className="grid gap-2 md:grid-cols-2">
                      <label className="flex items-center gap-2 text-xs text-foreground">
                        <input
                          type="checkbox"
                          checked={cleanupActions.deleteCachedProducts}
                          disabled={cleanupActions.external !== "delete_selected"}
                          onChange={(event) =>
                            setCleanupActions((prev) => ({
                              ...prev,
                              deleteCachedProducts: event.target.checked,
                            }))
                          }
                        />
                        Delete matching cached catalog rows when external cleanup succeeds
                      </label>
                      <label className="flex items-center gap-2 text-xs text-foreground">
                        <input
                          type="checkbox"
                          checked={cleanupDryRun}
                          onChange={(event) => setCleanupDryRun(event.target.checked)}
                        />
                        Dry-run only (no writes)
                      </label>
                    </div>
                  </div>

                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
                    <div className="text-xs text-amber-100">
                      Type <span className="font-semibold">{CLEANUP_CONFIRM_TEXT}</span> to confirm this batch.
                    </div>
                    <input
                      value={cleanupConfirmInput}
                      onChange={(event) => setCleanupConfirmInput(event.target.value)}
                      placeholder={CLEANUP_CONFIRM_TEXT}
                      className="w-full rounded border border-amber-500/30 bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:border-amber-400/60"
                      disabled={cleanupRunning}
                    />
                    {cleanupProgress && (
                      <div className="text-xs text-amber-200">
                        Running batch {cleanupProgress.completed} / {cleanupProgress.total}
                      </div>
                    )}
                  </div>

                  {cleanupBatchResponses.length > 0 && (
                    <div className="rounded-lg border border-t-border bg-background/40 p-3 space-y-2">
                      <div className="text-xs uppercase tracking-wide text-muted">Latest run summary</div>
                      <div className="text-xs text-foreground">
                        Total {cleanupBatchSummary.total} · Succeeded {cleanupBatchSummary.succeeded} · Partial{" "}
                        {cleanupBatchSummary.partial} · Failed {cleanupBatchSummary.failed}
                      </div>
                      <div className="max-h-36 overflow-y-auto space-y-1">
                        {cleanupBatchResponses.flatMap((batch) => batch.results).slice(0, 24).map((result) => (
                          <div
                            key={`cleanup-result-${result.internalSkuId}-${result.status}`}
                            className="rounded border border-t-border bg-background/70 px-2 py-1 text-[11px] text-muted"
                          >
                            {result.internalSkuId}: {result.status} ({result.message})
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (cleanupRunning) return;
                        setCleanupModalOpen(false);
                      }}
                      disabled={cleanupRunning}
                      className="px-3 py-1.5 rounded border border-t-border bg-background text-xs text-muted hover:text-foreground disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void runCleanupForScope()}
                      disabled={!cleanupCanRun}
                      className="px-3 py-1.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-200 text-xs hover:bg-amber-500/20 disabled:opacity-50"
                    >
                      {cleanupRunning ? "Running..." : cleanupDryRun ? "Run dry-run" : "Run cleanup"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

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

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[...ACTIVE_SOURCES].sort((a, b) => (a === "internal" ? -1 : b === "internal" ? 1 : 0)).map((source) => (
              <div key={source} className={`bg-surface border border-t-border rounded-xl p-4${source === "internal" ? " md:col-span-3" : ""}`}>
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
                  label="Queue"
                  options={QUEUE_FILTER_OPTIONS}
                  selected={queueFilters}
                  onChange={(selected) => setQueueFilters(selected as QueueFilter[])}
                  placeholder="All queue states"
                  accentColor="cyan"
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
                  onClick={() => setCompactCards((prev) => !prev)}
                  className={`px-3 py-1.5 rounded border text-xs transition-colors ${
                    compactCards
                      ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20"
                      : "border-t-border bg-background text-muted hover:text-foreground"
                  }`}
                >
                  Compact rows: {compactCards ? "On" : "Off"}
                </button>
                {cleanupFeatureEnabled && (
                  <button
                    type="button"
                    onClick={() => {
                      setCleanupScope("duplicates");
                      setCleanupActions({
                        internal: "none",
                        links: "unlink_selected",
                        external: "none",
                        sources: [],
                        deleteCachedProducts: false,
                      });
                      setCleanupDryRun(false);
                      setCleanupConfirmInput("");
                      setCleanupBatchResponses([]);
                      setCleanupModalOpen(true);
                    }}
                    className="px-3 py-1.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-200 text-xs hover:bg-amber-500/20 transition-colors"
                  >
                    Batch cleanup
                  </button>
                )}
                <button
                  onClick={clearFilters}
                  className="px-3 py-1.5 rounded border border-t-border bg-background text-xs text-muted hover:text-foreground transition-colors"
                >
                  Clear filters
                </button>
                {Object.keys(pinnedRowKeys).length > 0 && (
                  <button
                    onClick={clearPinnedRows}
                    className="px-3 py-1.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-200 text-xs hover:bg-amber-500/20 transition-colors"
                  >
                    Clear pinned rows ({Object.keys(pinnedRowKeys).length})
                  </button>
                )}
                <button
                  onClick={fetchData}
                  className="px-3 py-1.5 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 text-xs hover:bg-cyan-500/20 transition-colors"
                >
                  Refresh
                </button>
                {isBackgroundRefreshing && (
                  <span className="text-[11px] text-cyan-300">Syncing in background...</span>
                )}
              </div>
            </div>

            <div className="space-y-3 max-h-[72vh] overflow-y-auto pr-1">
              {rows.map((row, index) => {
                const isRowExpanded = !compactCards || Boolean(expandedRowKeys[row.key]);
                return (
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
                      {row.internal?.name && (
                        <div className="text-xs text-foreground font-medium truncate">{row.internal.name}</div>
                      )}
                      <div className="font-mono text-[11px] text-muted break-all">{row.key}</div>
                      <div className="flex flex-wrap gap-1">
                        <span className={`px-1.5 py-0.5 rounded border text-[10px] ${severityBadgeClass(row.severity)}`}>
                          {severityLabel(row.severity)}
                        </span>
                        {row.queueStates.map((queueState) => (
                          <span
                            key={`${row.key}:${queueState}`}
                            className={`px-1.5 py-0.5 rounded border text-[10px] ${queueBadgeClass(queueState)}`}
                          >
                            {queueBadgeLabel(queueState)}
                          </span>
                        ))}
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
                      {compactCards && (
                        <button
                          type="button"
                          onClick={() => toggleRowExpanded(row.key)}
                          className="px-1.5 py-0.5 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20"
                        >
                          {isRowExpanded ? "Collapse row" : "Expand row"}
                        </button>
                      )}
                    </div>
                  </div>

                  {compactCards && !isRowExpanded && (
                    <div className="mt-3 space-y-2">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-1.5">
                        {displayedSources.filter((s) => s !== "internal").map((source) => {
                          const sourceProduct = row[source];
                          const isMissing = !sourceProduct;
                          const supportsLinking = isLinkableSource(source);
                          const existingLinkId = supportsLinking ? getLinkedExternalId(row.internal, source) : null;
                          const linkMatchesCurrent = Boolean(sourceProduct && existingLinkId && existingLinkId === sourceProduct.id);
                          const statusLabel = isMissing
                            ? "Missing"
                            : supportsLinking
                              ? linkMatchesCurrent
                                ? "Linked"
                                : existingLinkId
                                  ? "Link mismatch"
                                  : "Unlinked"
                              : "Present";
                          const statusClass = isMissing
                            ? "border-red-500/35 bg-red-500/10 text-red-300"
                            : supportsLinking
                              ? linkMatchesCurrent
                                ? "border-green-500/35 bg-green-500/10 text-green-300"
                                : existingLinkId
                                  ? "border-amber-500/35 bg-amber-500/10 text-amber-300"
                                  : "border-blue-500/35 bg-blue-500/10 text-blue-300"
                              : "border-zinc-500/35 bg-zinc-500/10 text-zinc-300";
                          return (
                            <div
                              key={`${row.key}:compact:${source}`}
                              className="rounded border border-t-border bg-background/50 p-2 space-y-1 min-w-0"
                            >
                              <div className={`inline-flex px-1.5 py-0.5 rounded border text-[10px] ${sourceBadgeClass(source)}`}>
                                {formatSourceName(source)}
                              </div>
                              <div className="text-[11px] text-foreground break-words line-clamp-1">
                                {sourceProduct?.name || "—"}
                              </div>
                              <div className={`inline-flex px-1.5 py-0.5 rounded border text-[10px] ${statusClass}`}>
                                {statusLabel}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {row.reasons.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {row.reasons.slice(0, 4).map((reason) => (
                            <span key={`${row.key}:compact-reason:${reason}`} className={`px-1.5 py-0.5 rounded border text-[10px] ${reasonBadgeClass(reason)}`}>
                              {reason}
                            </span>
                          ))}
                          {row.reasons.length > 4 && (
                            <span className="px-1.5 py-0.5 rounded border border-t-border bg-background/70 text-[10px] text-muted">
                              +{row.reasons.length - 4} more
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {(!compactCards || isRowExpanded) && (
                    <>
                      <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2">
                    {/* Internal card spans full row, external catalogs fill the 3-col grid */}
                    {[...displayedSources].sort((a, b) => (a === "internal" ? -1 : b === "internal" ? 1 : 0)).map((source) => {
                      const sourceProduct = row[source];
                      const hasInternal = Boolean(row.internal);
                      const supportsLinking = isLinkableSource(source);
                      const existingLinkId = supportsLinking ? getLinkedExternalId(row.internal, source) : null;
                      const cardSearchKey = supportsLinking ? sourceSearchKey(row.key, source) : null;
                      const cardSearchState = cardSearchKey ? searchStateBySource[cardSearchKey] : null;
                      const isSearchOpen = Boolean(cardSearchState?.open);
                      const isSearchLoading = Boolean(cardSearchState?.loading);
                      const searchQuery = cardSearchState?.query ?? "";
                      const searchResults = cardSearchState?.results ?? [];
                      const searchError = cardSearchState?.error ?? null;
                      const hasSourceProduct = Boolean(sourceProduct);
                      const internalCreateDraft = source === "internal" ? internalCreateByRow[row.key] : null;
                      const isCreatingInternal = source === "internal" ? Boolean(creatingInternalKeys[row.key]) : false;
                      const isLinkedToShownProduct =
                        supportsLinking && hasSourceProduct && Boolean(existingLinkId) && existingLinkId === sourceProduct!.id;
                      const canConfirmLink = hasInternal && supportsLinking && hasSourceProduct && !isLinkedToShownProduct;
                      const canCreateMissingSource = hasInternal && supportsLinking && !hasSourceProduct && !existingLinkId;
                      const pendingLinkKey =
                        canConfirmLink && sourceProduct
                          ? `${row.key}:${source}:${sourceProduct.id}`
                          : "";
                      const isSavingLink = pendingLinkKey ? Boolean(linkingKeys[pendingLinkKey]) : false;
                      const createKey = supportsLinking ? `${row.key}:${source}:create` : "";
                      const isCreatingSource = createKey ? Boolean(creatingKeys[createKey]) : false;

                      return (
                        <div key={`${row.key}-${source}`} className={`rounded-md border border-t-border bg-background/40 p-2 min-w-0${source === "internal" ? " md:col-span-3" : ""}`}>
                          <div className="mb-2">
                            <span className={`inline-flex px-1.5 py-0.5 rounded border text-[10px] ${sourceBadgeClass(source)}`}>
                              {formatSourceName(source)}
                            </span>
                          </div>
                          <ProductCell source={source} product={sourceProduct} />

                          {source === "internal" && !hasSourceProduct && (
                            <div className="mt-2 border-t border-t-border pt-2 space-y-2">
                              <button
                                type="button"
                                onClick={() => toggleInternalCreate(row)}
                                className="px-2 py-1 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 text-[11px] hover:bg-emerald-500/20"
                              >
                                {internalCreateDraft?.open ? "Hide internal create" : "Create internal product from this row"}
                              </button>

                              {internalCreateDraft?.open && (
                                <div className="rounded border border-t-border bg-background/50 p-2 space-y-2">
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    <label className="text-[10px] text-muted uppercase tracking-wide">
                                      Category
                                      <select
                                        value={internalCreateDraft.category}
                                        onChange={(event) => updateInternalCreateField(row.key, "category", event.target.value)}
                                        className="mt-1 w-full rounded border border-t-border bg-background px-2 py-1 text-[11px] text-foreground focus:outline-none focus:border-cyan-500/50"
                                      >
                                        {FORM_CATEGORIES.map((category) => (
                                          <option key={category} value={category}>
                                            {getCategoryLabel(category)}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                    <label className="text-[10px] text-muted uppercase tracking-wide">
                                      SKU
                                      <input
                                        value={internalCreateDraft.sku}
                                        onChange={(event) => updateInternalCreateField(row.key, "sku", event.target.value)}
                                        className="mt-1 w-full rounded border border-t-border bg-background px-2 py-1 text-[11px] text-foreground focus:outline-none focus:border-cyan-500/50"
                                      />
                                    </label>
                                    <label className="text-[10px] text-muted uppercase tracking-wide">
                                      Brand
                                      <input
                                        value={internalCreateDraft.brand}
                                        onChange={(event) => updateInternalCreateField(row.key, "brand", event.target.value)}
                                        className="mt-1 w-full rounded border border-t-border bg-background px-2 py-1 text-[11px] text-foreground focus:outline-none focus:border-cyan-500/50"
                                      />
                                    </label>
                                    <label className="text-[10px] text-muted uppercase tracking-wide">
                                      Model
                                      <input
                                        value={internalCreateDraft.model}
                                        onChange={(event) => updateInternalCreateField(row.key, "model", event.target.value)}
                                        className="mt-1 w-full rounded border border-t-border bg-background px-2 py-1 text-[11px] text-foreground focus:outline-none focus:border-cyan-500/50"
                                      />
                                    </label>
                                    <label className="text-[10px] text-muted uppercase tracking-wide">
                                      Sell Price
                                      <input
                                        value={internalCreateDraft.sellPrice}
                                        onChange={(event) => updateInternalCreateField(row.key, "sellPrice", event.target.value)}
                                        placeholder="0.00"
                                        className="mt-1 w-full rounded border border-t-border bg-background px-2 py-1 text-[11px] text-foreground focus:outline-none focus:border-cyan-500/50"
                                      />
                                    </label>
                                    <label className="text-[10px] text-muted uppercase tracking-wide">
                                      Unit Cost
                                      <input
                                        value={internalCreateDraft.unitCost}
                                        onChange={(event) => updateInternalCreateField(row.key, "unitCost", event.target.value)}
                                        placeholder="0.00"
                                        className="mt-1 w-full rounded border border-t-border bg-background px-2 py-1 text-[11px] text-foreground focus:outline-none focus:border-cyan-500/50"
                                      />
                                    </label>
                                  </div>
                                  <label className="block text-[10px] text-muted uppercase tracking-wide">
                                    Description
                                    <textarea
                                      value={internalCreateDraft.description}
                                      onChange={(event) => updateInternalCreateField(row.key, "description", event.target.value)}
                                      rows={2}
                                      className="mt-1 w-full rounded border border-t-border bg-background px-2 py-1 text-[11px] text-foreground focus:outline-none focus:border-cyan-500/50"
                                    />
                                  </label>
                                  <button
                                    type="button"
                                    onClick={() => createInternalFromRow(row)}
                                    disabled={isCreatingInternal}
                                    className="px-2 py-1 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 text-[11px] hover:bg-emerald-500/20 disabled:opacity-50"
                                  >
                                    {isCreatingInternal ? "Creating..." : "Create Internal + link all present source IDs"}
                                  </button>
                                </div>
                              )}
                            </div>
                          )}

                          {source !== "internal" && (
                            <div className="mt-2 border-t border-t-border pt-2">
                              {!hasInternal ? (
                                <div className="text-[11px] text-amber-300">Add or match an internal product to enable link confirmation.</div>
                              ) : supportsLinking ? (
                                <div className="space-y-2">
                                  <div className="text-[11px] text-muted">
                                    Current link: {existingLinkId || "—"}
                                  </div>
                                  {existingLinkId && (
                                    <div className="text-[11px] text-green-300">Saved to inventory.</div>
                                  )}
                                  {isLinkedToShownProduct ? (
                                    <div className="inline-flex px-2 py-0.5 rounded border border-green-500/40 bg-green-500/10 text-[11px] text-green-300">
                                      Linked to this product
                                    </div>
                                  ) : canConfirmLink && sourceProduct ? (
                                    <button
                                      onClick={() => confirmSourceLink(row, source, sourceProduct.id)}
                                      disabled={isSavingLink}
                                      className="px-2 py-1 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 text-[11px] hover:bg-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                      {isSavingLink ? "Linking..." : "Confirm link to this product"}
                                    </button>
                                  ) : canCreateMissingSource ? (
                                    <div className="space-y-1.5">
                                      <div className="text-[11px] text-muted">No product available to link in this row.</div>
                                      <button
                                        type="button"
                                        onClick={() => createMissingSourceProduct(row, source)}
                                        disabled={isCreatingSource}
                                        className="px-2 py-1 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 text-[11px] hover:bg-emerald-500/20 disabled:opacity-50"
                                      >
                                        {isCreatingSource ? "Creating..." : `Create in ${formatSourceName(source)} + link`}
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="text-[11px] text-muted">No product available to link in this row.</div>
                                  )}

                                  <div className="flex flex-wrap items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => toggleSourceSearch(row, source)}
                                      className="px-2 py-1 rounded border border-t-border bg-background/70 text-[11px] text-cyan-300 hover:text-cyan-200"
                                    >
                                      {isSearchOpen ? "Hide catalog search" : `Find match in ${formatSourceName(source)}`}
                                    </button>
                                  </div>

                                  {isSearchOpen && (
                                    <div className="rounded border border-t-border bg-background/50 p-2 space-y-2">
                                      <div className="flex gap-2">
                                        <input
                                          value={searchQuery}
                                          onChange={(event) => updateSourceSearchQuery(row.key, source, event.target.value)}
                                          placeholder={`Search ${formatSourceName(source)} by SKU, name, or ID`}
                                          className="w-full rounded border border-t-border bg-background px-2 py-1 text-[11px] text-foreground focus:outline-none focus:border-cyan-500/50"
                                        />
                                        <button
                                          type="button"
                                          onClick={() => runSourceSearch(row, source, searchQuery)}
                                          disabled={isSearchLoading}
                                          className="px-2 py-1 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 text-[11px] hover:bg-cyan-500/20 disabled:opacity-50"
                                        >
                                          {isSearchLoading ? "..." : "Search"}
                                        </button>
                                      </div>
                                      {searchError && (
                                        <div className="text-[11px] text-red-300">{searchError}</div>
                                      )}
                                      {!searchError && !isSearchLoading && searchResults.length === 0 && searchQuery.trim() && (
                                        <div className="text-[11px] text-muted">No catalog products found for this query.</div>
                                      )}
                                      {searchResults.length > 0 && (
                                        <div className="max-h-48 overflow-y-auto space-y-1">
                                          {searchResults.map((candidate) => {
                                            const candidateLinkKey = `${row.key}:${source}:${candidate.externalId}`;
                                            const isCandidateSaving = Boolean(linkingKeys[candidateLinkKey]);
                                            const isCandidateLinked = existingLinkId === candidate.externalId;
                                            return (
                                              <div
                                                key={candidate.externalId}
                                                className="rounded border border-t-border bg-background/70 p-2"
                                              >
                                                <div className="text-[11px] text-foreground break-words">
                                                  {candidate.name || "Unnamed product"}
                                                </div>
                                                <div className="text-[10px] text-muted break-all">
                                                  SKU: {candidate.sku || "—"} · ID: {candidate.externalId}
                                                </div>
                                                <div className="mt-1 flex flex-wrap items-center gap-2">
                                                  {candidate.url && (
                                                    <a
                                                      href={candidate.url}
                                                      target="_blank"
                                                      rel="noreferrer"
                                                      className="text-[10px] text-cyan-300 hover:text-cyan-200 underline underline-offset-2"
                                                    >
                                                      Open
                                                    </a>
                                                  )}
                                                  {isCandidateLinked ? (
                                                    <span className="px-1.5 py-0.5 rounded border border-green-500/40 bg-green-500/10 text-[10px] text-green-300">
                                                      Linked
                                                    </span>
                                                  ) : (
                                                    <button
                                                      type="button"
                                                      onClick={() => confirmSourceLink(row, source, candidate.externalId)}
                                                      disabled={isCandidateSaving}
                                                      className="px-2 py-0.5 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 text-[10px] hover:bg-cyan-500/20 disabled:opacity-50"
                                                    >
                                                      {isCandidateSaving ? "Linking..." : "Use this match"}
                                                    </button>
                                                  )}
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div className="text-[11px] text-muted">Linking is not supported for this source.</div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
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

                        {(() => {
                          const primaryInternalId = row.internal?.id || null;
                          if (!primaryInternalId) return null;
                          const duplicateCandidates = (row.internalDuplicates || []).filter((entry) => entry.id !== primaryInternalId);
                          if (duplicateCandidates.length === 0) return null;

                          return (
                            <div className="rounded-md border border-fuchsia-500/30 bg-fuchsia-500/10 p-2 space-y-2">
                              <div className="text-[11px] text-fuchsia-200">
                                Merge duplicate internal products into this primary product to clean inventory links.
                              </div>
                              <div className="space-y-1.5">
                                {duplicateCandidates.map((candidate) => {
                                  const mergeKey = `${row.key}:${candidate.id}:${primaryInternalId}`;
                                  const isMerging = Boolean(mergingKeys[mergeKey]);
                                  return (
                                    <div
                                      key={`${row.key}:merge:${candidate.id}`}
                                      className="rounded border border-fuchsia-500/20 bg-background/60 p-2"
                                    >
                                      <div className="text-[11px] text-foreground break-words">
                                        {candidate.name || "Unnamed internal product"}
                                      </div>
                                      <div className="text-[10px] text-muted break-all">
                                        SKU: {candidate.sku || "—"} · ID: {candidate.id}
                                      </div>
                                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                                        <a
                                          href={`/dashboards/catalog/edit/${encodeURIComponent(candidate.id)}`}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="text-[10px] text-cyan-300 hover:text-cyan-200 underline underline-offset-2"
                                        >
                                          Open duplicate
                                        </a>
                                        {row.internal && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setMergePreview({
                                                row,
                                                sourceDuplicate: candidate,
                                                targetPrimary: row.internal!,
                                              })
                                            }
                                            className="px-2 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-200 text-[10px] hover:bg-amber-500/20"
                                          >
                                            Compare side-by-side
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          onClick={() => mergeDuplicateInternalIntoPrimary(row, candidate.id)}
                                          disabled={isMerging}
                                          className="px-2 py-0.5 rounded border border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-200 text-[10px] hover:bg-fuchsia-500/20 disabled:opacity-50"
                                        >
                                          {isMerging ? "Merging..." : "Merge into primary"}
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })()}

                        {row.possibleMatches.length > 0 ? (
                          <div className="space-y-1.5">
                            <div className="text-[10px] uppercase tracking-wide text-muted">Suggested matches</div>
                            {row.possibleMatches.slice(0, 6).map((match) => {
                              const bucket = confidenceBucket(match.score);
                              const matchLinkSource = isLinkableSource(match.source) ? match.source : null;
                              const existingLinkId = matchLinkSource ? getLinkedExternalId(row.internal, matchLinkSource) : null;
                              const alreadyLinked = Boolean(matchLinkSource && existingLinkId === match.product.id);
                              const canConfirmSuggestion = Boolean(row.internal && matchLinkSource && !alreadyLinked);
                              const pendingSuggestionKey = `${row.key}:${match.source}:${match.product.id}`;
                              const isSavingSuggestion = Boolean(linkingKeys[pendingSuggestionKey]);
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
                                  {row.internal && (
                                    <div className="mt-2 flex flex-wrap items-center gap-2">
                                      {matchLinkSource ? (
                                        alreadyLinked ? (
                                          <span className="px-1.5 py-0.5 rounded border border-green-500/40 bg-green-500/10 text-[10px] text-green-300">
                                            Already linked
                                          </span>
                                        ) : canConfirmSuggestion ? (
                                          <button
                                            onClick={() => confirmSourceLink(row, matchLinkSource, match.product.id)}
                                            disabled={isSavingSuggestion}
                                            className="px-2 py-1 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 text-[11px] hover:bg-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                                          >
                                            {isSavingSuggestion ? "Linking..." : "Confirm link"}
                                          </button>
                                        ) : (
                                          <span className="text-[10px] text-muted">Link already aligned for this source.</span>
                                        )
                                      ) : (
                                        <span className="text-[10px] text-muted">
                                          This source does not have an internal link field yet.
                                        </span>
                                      )}
                                      {matchLinkSource && (
                                        <span className="text-[10px] text-muted">
                                          Current link: {existingLinkId || "—"}
                                        </span>
                                      )}
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
                    </>
                  )}
                </article>
                );
              })}

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
