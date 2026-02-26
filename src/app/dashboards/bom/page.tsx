"use client";

import React, { useState, useCallback, useRef, useEffect, useMemo, Suspense } from "react";
import DashboardShell from "@/components/DashboardShell";
import { exportToCSV } from "@/lib/export";
import { useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/contexts/ToastContext";
import { useSession } from "next-auth/react";
import BomHistoryDrawer from "@/components/BomHistoryDrawer";
import type { BomSnapshot as BomSnapshotGlobal } from "@/lib/bom-history";
import PushToSystemsModal, { type PushItem } from "@/components/PushToSystemsModal";
// PDF upload uses chunked /api/bom/chunk — stays on our domain, no CORS issues

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

type BomCategory =
  | "MODULE"
  | "BATTERY"
  | "INVERTER"
  | "EV_CHARGER"
  | "RAPID_SHUTDOWN"
  | "RACKING"
  | "ELECTRICAL_BOS"
  | "MONITORING";

interface BomItem {
  id: string; // client-side only
  category: BomCategory;
  brand: string | null;
  model: string | null;
  description: string;
  aiFeedbackNotes?: string | null;
  qty: number | string;
  unitSpec?: string | number | null;
  unitLabel?: string | null;
  source: string;
  flags?: string[];
}

interface BomData {
  project: {
    customer?: string;
    address?: string;
    aiFeedbackOverall?: string;
    systemSizeKwdc?: number | string;
    systemSizeKwac?: number | string;
    moduleCount?: number | string;
    plansetRev?: string;
    stampDate?: string;
    utility?: string;
    ahj?: string;
    apn?: string;
  };
  items: Omit<BomItem, "id">[];
  validation?: {
    moduleCountMatch?: boolean | null;
    batteryCapacityMatch?: boolean | null;
    ocpdMatch?: boolean | null;
    warnings?: string[];
  };
}

interface ProjectResult {
  hs_object_id: string;
  dealname: string;
  address?: string;
  designFolderUrl?: string | null;
  driveUrl?: string | null;
  openSolarUrl?: string | null;
  zuperUid?: string | null;
}

interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
  size: string;
}

// From /api/products/comparison
interface ComparableProduct {
  id: string;
  name: string | null;
  sku: string | null;
  price: number | null;
  status: string | null;
  description: string | null;
}

interface ComparisonRow {
  key: string;
  reasons: string[];
  isMismatch: boolean;
  [source: string]: ComparableProduct | string | string[] | boolean | null;
}

interface SourceHealth {
  configured: boolean;
  count: number;
  error: string | null;
}

interface ProductComparisonResponse {
  rows: ComparisonRow[];
  health: Record<string, SourceHealth>;
}

interface InternalCatalogSku {
  id: string;
  category: string;
  brand: string;
  model: string;
  description: string | null;
  vendorPartNumber: string | null;
  unitCost: number | null;
  sellPrice: number | null;
  zohoItemId: string | null;
  hubspotProductId: string | null;
  zuperItemId: string | null;
}

// Per-BOM-item catalog presence — keyed by source name
type CatalogStatus = Record<string, boolean>;

interface PricingMatch {
  sellPrice: number | null;
}

interface LinkedBomProduct {
  id: string;
  hubspotProductId?: string | null;
  name: string;
  sku: string | null;
  description: string | null;
  manufacturer: string | null;
  productCategory: string | null;
  quantity: number;
  zohoItemId: string | null;
  zohoName: string | null;
  zohoSku: string | null;
  zohoDescription: string | null;
}

/* Saved snapshot row from /api/bom/history */
interface BomSnapshot {
  id: string;
  dealId: string;
  dealName: string;
  version: number;
  bomData: BomData;
  sourceFile: string | null;
  blobUrl: string | null;
  savedBy: string | null;
  createdAt: string;
  zohoPoId: string | null;
  zohoSoId: string | null;
}

/* One row in the diff view */
type DiffStatus = "added" | "removed" | "changed" | "unchanged";
interface DiffRow {
  status: DiffStatus;
  category: string;
  brand: string | null;
  model: string | null;
  description: string;
  qtyA?: number | string;
  qtyB?: number | string;
  specA?: string | number | null;
  specB?: string | number | null;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                           */
/* ------------------------------------------------------------------ */

// Display labels for catalog sources — extend as new sources are added to the comparison API
const SOURCE_DISPLAY_LABELS: Record<string, string> = {
  hubspot: "HubSpot",
  zuper: "Zuper",
  zoho: "Zoho",
  opensolar: "OpenSolar",
  quickbooks: "QuickBooks",
};

// Short column headers for the BOM table
const SOURCE_SHORT_LABELS: Record<string, string> = {
  hubspot: "HS",
  zuper: "ZU",
  zoho: "ZO",
  opensolar: "OS",
  quickbooks: "QB",
};

const CATEGORY_ORDER: BomCategory[] = [
  "MODULE",
  "BATTERY",
  "INVERTER",
  "EV_CHARGER",
  "RAPID_SHUTDOWN",
  "RACKING",
  "ELECTRICAL_BOS",
  "MONITORING",
];

const CATEGORY_LABELS: Record<BomCategory, string> = {
  MODULE: "Modules",
  BATTERY: "Storage & Inverter",
  INVERTER: "Inverter",
  EV_CHARGER: "EV Charger",
  RAPID_SHUTDOWN: "Rapid Shutdown",
  RACKING: "Racking & Mounting",
  ELECTRICAL_BOS: "Electrical BOS",
  MONITORING: "Monitoring & Controls",
};

const CATEGORY_COLORS: Record<BomCategory, string> = {
  MODULE: "text-yellow-600 dark:text-yellow-400",
  BATTERY: "text-green-600 dark:text-green-400",
  INVERTER: "text-blue-600 dark:text-blue-400",
  EV_CHARGER: "text-purple-600 dark:text-purple-400",
  RAPID_SHUTDOWN: "text-red-600 dark:text-red-400",
  RACKING: "text-orange-600 dark:text-orange-400",
  ELECTRICAL_BOS: "text-cyan-600 dark:text-cyan-400",
  MONITORING: "text-indigo-600 dark:text-indigo-400",
};

/* ------------------------------------------------------------------ */
/*  Matching helpers (mirrors the API's normalizeText + token logic)    */
/* ------------------------------------------------------------------ */

function normalizeText(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string | null | undefined): Set<string> {
  return new Set(
    normalizeText(value)
      .split(" ")
      .filter((t) => t.length >= 3)
  );
}

function tokenSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const t of a) if (b.has(t)) overlap++;
  const union = new Set([...a, ...b]).size;
  return union > 0 ? overlap / union : 0;
}

/** Returns true if a catalog product is a plausible match for a BOM item */
function productMatchesBomItem(product: ComparableProduct, item: BomItem): boolean {
  const model = item.model;
  const brand = item.brand;
  if (!model && !brand) return false;

  // Check by model name match first (most reliable)
  const modelNorm = normalizeText(model);
  const productNameNorm = normalizeText(product.name);
  const productSkuNorm = normalizeText(product.sku);

  if (modelNorm && (productNameNorm.includes(modelNorm) || productSkuNorm.includes(modelNorm))) {
    return true;
  }

  // Token similarity fallback
  const bomTokens = new Set([...tokenize(brand), ...tokenize(model)]);
  const catalogTokens = new Set([...tokenize(product.name), ...tokenize(product.sku)]);
  return tokenSimilarity(bomTokens, catalogTokens) >= 0.5;
}

/** Returns a numeric similarity score for internal SKU ↔ BOM item matching. */
function scoreSkuMatch(sku: InternalCatalogSku, item: BomItem): number {
  const modelNorm = normalizeText(item.model);
  const skuModelNorm = normalizeText(sku.model);
  const skuBrandNorm = normalizeText(sku.brand);
  const itemBrandNorm = normalizeText(item.brand);

  // Strong score for direct model inclusion/equality.
  if (modelNorm && (skuModelNorm === modelNorm || skuModelNorm.includes(modelNorm) || modelNorm.includes(skuModelNorm))) {
    return 1;
  }

  const bomTokens = new Set([...tokenize(item.brand), ...tokenize(item.model)]);
  const skuTokens = new Set([...tokenize(sku.brand), ...tokenize(sku.model), ...tokenize(sku.description)]);
  const similarity = tokenSimilarity(bomTokens, skuTokens);

  // Brand boost when both are available and align.
  if (itemBrandNorm && skuBrandNorm && (itemBrandNorm === skuBrandNorm || skuBrandNorm.includes(itemBrandNorm))) {
    return Math.min(1, similarity + 0.15);
  }

  return similarity;
}

function parsePositiveQty(value: number | string | null | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return parsed;
}

function isBlankText(value: string | null | undefined): boolean {
  return !value || value.trim().length === 0;
}

function inferLinkedBrand(product: LinkedBomProduct): string | null {
  return product.manufacturer?.trim() || null;
}

function inferLinkedModel(product: LinkedBomProduct): string | null {
  const sku = product.sku?.trim() || product.zohoSku?.trim();
  if (sku) return sku;

  const rawName = product.name?.trim() || product.zohoName?.trim() || "";
  if (!rawName) return null;

  const maker = inferLinkedBrand(product);
  if (maker) {
    const makerNorm = normalizeText(maker);
    const nameNorm = normalizeText(rawName);
    if (nameNorm.startsWith(makerNorm)) {
      const parts = rawName.split(" ");
      if (parts.length > 1) {
        const trimmed = parts.slice(1).join(" ").trim();
        if (trimmed) return trimmed;
      }
    }
  }

  return rawName;
}

function inferLinkedDescription(product: LinkedBomProduct): string | null {
  return (
    product.description?.trim() ||
    product.zohoDescription?.trim() ||
    product.name?.trim() ||
    product.zohoName?.trim() ||
    null
  );
}

function mapLinkedCategoryToBomCategory(rawCategory: string | null | undefined): BomCategory | null {
  const normalized = normalizeText(rawCategory);
  if (!normalized) return null;
  if (normalized.includes("module")) return "MODULE";
  if (normalized.includes("battery")) return "BATTERY";
  if (normalized.includes("inverter")) return "INVERTER";
  if (normalized.includes("ev")) return "EV_CHARGER";
  if (normalized.includes("charger")) return "EV_CHARGER";
  if (normalized.includes("rack")) return "RACKING";
  if (normalized.includes("rail")) return "RACKING";
  if (normalized.includes("rapid")) return "RAPID_SHUTDOWN";
  if (normalized.includes("shutdown")) return "RAPID_SHUTDOWN";
  if (normalized.includes("monitor")) return "MONITORING";
  if (normalized.includes("gateway")) return "MONITORING";
  if (normalized.includes("electrical")) return "ELECTRICAL_BOS";
  if (normalized.includes("bos")) return "ELECTRICAL_BOS";
  return null;
}

function scoreLinkedMatch(item: BomItem, product: LinkedBomProduct): number {
  const itemTokens = new Set([
    ...tokenize(item.brand),
    ...tokenize(item.model),
    ...tokenize(item.description),
  ]);
  const productTokens = new Set([
    ...tokenize(product.name),
    ...tokenize(product.description),
    ...tokenize(product.sku),
    ...tokenize(product.zohoName),
    ...tokenize(product.zohoDescription),
    ...tokenize(product.zohoSku),
    ...tokenize(product.manufacturer),
  ]);

  const tokenScore = tokenSimilarity(itemTokens, productTokens);
  let score = tokenScore * 0.8;

  const linkedCategory = mapLinkedCategoryToBomCategory(product.productCategory);
  if (linkedCategory && linkedCategory === item.category) {
    score += 0.2;
  }

  const itemModelNorm = normalizeText(item.model);
  const productSkuNorm = normalizeText(product.sku || product.zohoSku);
  const productNameNorm = normalizeText(product.name || product.zohoName);
  if (
    itemModelNorm &&
    ((productSkuNorm && productSkuNorm.includes(itemModelNorm)) ||
      (productNameNorm && productNameNorm.includes(itemModelNorm)))
  ) {
    score += 0.15;
  }

  return Math.min(1, score);
}

function findBestLinkedProduct(item: BomItem, products: LinkedBomProduct[]): LinkedBomProduct | null {
  if (!products.length) return null;

  let best: LinkedBomProduct | null = null;
  let bestScore = 0;

  for (const product of products) {
    const score = scoreLinkedMatch(item, product);
    if (score > bestScore) {
      best = product;
      bestScore = score;
    }
  }

  if (bestScore < 0.35) return null;
  return best;
}

function hasLinkedProductIdentity(product: LinkedBomProduct): boolean {
  return Boolean(
    normalizeText(product.name) ||
    normalizeText(product.sku) ||
    normalizeText(product.description) ||
    normalizeText(product.zohoName) ||
    normalizeText(product.zohoSku)
  );
}

function findFallbackLinkedProductForSparseItem(
  item: BomItem,
  products: LinkedBomProduct[]
): LinkedBomProduct | null {
  if (!products.length) return null;

  const itemQty = parsePositiveQty(item.qty);
  let best: LinkedBomProduct | null = null;
  let bestScore = 0;

  for (const product of products) {
    if (!hasLinkedProductIdentity(product)) continue;

    const linkedCategory = mapLinkedCategoryToBomCategory(product.productCategory);
    if (linkedCategory && linkedCategory !== item.category) {
      // Avoid cross-category fills when HubSpot gives us a known category.
      continue;
    }

    const productQty = Number(product.quantity) > 0 ? Number(product.quantity) : 1;
    const qtyDiff = Math.abs(productQty - itemQty);
    const qtyScore = qtyDiff === 0 ? 0.3 : qtyDiff <= 1 ? 0.2 : qtyDiff <= 2 ? 0.1 : 0;
    const categoryScore = linkedCategory === item.category ? 0.6 : 0.2;
    const signalScore = product.zohoItemId ? 0.05 : 0;
    const score = categoryScore + qtyScore + signalScore;

    if (score > bestScore) {
      best = product;
      bestScore = score;
    }
  }

  if (bestScore < 0.5) return null;
  return best;
}

// Non-product keys in a ComparisonRow that should be ignored when iterating sources
const ROW_META_KEYS = new Set(["key", "reasons", "isMismatch", "possibleMatches"]);

/** Derive source names from comparison rows (any key that isn't metadata). */
function sourcesFromRows(rows: ComparisonRow[]): string[] {
  if (!rows.length) return [];
  return Object.keys(rows[0]).filter((k) => !ROW_META_KEYS.has(k));
}

/** Build a map of BOM item id → CatalogStatus from the comparison rows */
function buildCatalogStatus(
  items: BomItem[],
  rows: ComparisonRow[]
): Map<string, CatalogStatus> {
  const result = new Map<string, CatalogStatus>();
  const sources = sourcesFromRows(rows);

  for (const item of items) {
    const status: CatalogStatus = {};
    for (const src of sources) status[src] = false;

    for (const row of rows) {
      for (const src of sources) {
        if (!status[src]) {
          const product = row[src] as ComparableProduct | null;
          if (product && productMatchesBomItem(product, item)) status[src] = true;
        }
      }
      if (sources.every((s) => status[s])) break;
    }

    result.set(item.id, status);
  }

  return result;
}

/* ------------------------------------------------------------------ */
/*  ID helper                                                           */
/* ------------------------------------------------------------------ */

let nextId = 1;
function assignIds(items: Omit<BomItem, "id">[]): BomItem[] {
  return items.map((item) => ({ ...item, id: String(nextId++) }));
}

/* ------------------------------------------------------------------ */
/*  BOM diff helper                                                     */
/* ------------------------------------------------------------------ */

/** Compare two BomData item arrays, matching by (category, brand, model). */
function diffBoms(itemsA: Omit<BomItem, "id">[], itemsB: Omit<BomItem, "id">[]): DiffRow[] {
  const key = (i: Omit<BomItem, "id">) =>
    `${i.category}||${(i.brand || "").trim().toLowerCase()}||${(i.model || "").trim().toLowerCase()}`;

  const mapA = new Map<string, Omit<BomItem, "id">>();
  const mapB = new Map<string, Omit<BomItem, "id">>();
  for (const i of itemsA) mapA.set(key(i), i);
  for (const i of itemsB) mapB.set(key(i), i);

  const rows: DiffRow[] = [];
  const allKeys = new Set([...mapA.keys(), ...mapB.keys()]);

  for (const k of allKeys) {
    const a = mapA.get(k);
    const b = mapB.get(k);
    if (a && !b) {
      rows.push({ status: "removed", category: a.category, brand: a.brand, model: a.model, description: a.description, qtyA: a.qty, specA: a.unitSpec });
    } else if (!a && b) {
      rows.push({ status: "added", category: b.category, brand: b.brand, model: b.model, description: b.description, qtyB: b.qty, specB: b.unitSpec });
    } else if (a && b) {
      const qtyChanged = String(a.qty) !== String(b.qty);
      const specChanged = String(a.unitSpec ?? "") !== String(b.unitSpec ?? "");
      rows.push({
        status: qtyChanged || specChanged ? "changed" : "unchanged",
        category: b.category,
        brand: b.brand,
        model: b.model,
        description: b.description,
        qtyA: a.qty, qtyB: b.qty,
        specA: a.unitSpec, specB: b.unitSpec,
      });
    }
  }

  // Sort: changed first, then added, removed, unchanged; within each group by category order
  const statusOrder: Record<DiffStatus, number> = { changed: 0, added: 1, removed: 2, unchanged: 3 };
  const catOrder = (c: string) => CATEGORY_ORDER.indexOf(c as BomCategory) ?? 99;
  rows.sort((a, b) =>
    statusOrder[a.status] - statusOrder[b.status] ||
    catOrder(a.category) - catOrder(b.category) ||
    (a.model || "").localeCompare(b.model || "")
  );
  return rows;
}

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

type ImportTab = "upload" | "drive" | "paste" | "project-files";

function BomDashboardInner() {
  const { addToast } = useToast();
  const { data: session } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();

  // BOM state
  const [bom, setBom] = useState<BomData | null>(null);
  const [items, setItems] = useState<BomItem[]>([]);

  // Import panel
  const [importTab, setImportTab] = useState<ImportTab>("upload");
  const [jsonInput, setJsonInput] = useState("");
  const [importError, setImportError] = useState<string | null>(null);

  // PDF upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string>("");

  // Drive link
  const [driveUrl, setDriveUrl] = useState("");

  // Project link
  const [projectSearch, setProjectSearch] = useState("");
  const [projectResults, setProjectResults] = useState<ProjectResult[]>([]);
  const [linkedProject, setLinkedProject] = useState<ProjectResult | null>(null);
  const [autoLinkSuggestion, setAutoLinkSuggestion] = useState<ProjectResult | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // History / snapshots
  const [snapshots, setSnapshots] = useState<BomSnapshot[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [dealLoading, setDealLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedVersion, setSavedVersion] = useState<number | null>(null);
  // Zoho PO state
  const [zohoVendors, setZohoVendors] = useState<{ contact_id: string; contact_name: string }[] | null>(null);
  const [vendorsLoading, setVendorsLoading] = useState(false);
  const [selectedVendorId, setSelectedVendorId] = useState<string>("");
  const [zohoPoId, setZohoPoId] = useState<string | null>(null);
  const [creatingPo, setCreatingPo] = useState(false);
  // Zoho SO state
  const [zohoCustomers, setZohoCustomers] = useState<{ contact_id: string; contact_name: string }[] | null>(null);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [zohoSoId, setZohoSoId] = useState<string | null>(null);
  const [creatingSo, setCreatingSo] = useState(false);
  // Diff / compare
  const [compareA, setCompareA] = useState<BomSnapshot | null>(null);
  const [compareB, setCompareB] = useState<BomSnapshot | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [pushItem, setPushItem] = useState<PushItem | null>(null);
  const diffRows = compareA && compareB ? diffBoms(compareA.bomData.items, compareB.bomData.items) : [];

  // Product catalog comparison data
  const [comparisonRows, setComparisonRows] = useState<ComparisonRow[]>([]);
  const [catalogHealth, setCatalogHealth] = useState<ProductComparisonResponse["health"] | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [internalSkus, setInternalSkus] = useState<InternalCatalogSku[]>([]);
  const [backfillingLinkedProducts, setBackfillingLinkedProducts] = useState(false);
  const [rowActionBusyKey, setRowActionBusyKey] = useState<string | null>(null);

  // Derived source list — updates automatically when comparison data arrives
  const catalogSources = sourcesFromRows(comparisonRows);

  // Derived catalog status per BOM item
  const [catalogStatus, setCatalogStatus] = useState<Map<string, CatalogStatus>>(new Map());
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
  const [driveFilesLoading, setDriveFilesLoading] = useState(false);
  const [driveFilesError, setDriveFilesError] = useState<string | null>(null);
  const [extractingDriveFileId, setExtractingDriveFileId] = useState<string | null>(null);

  /* ---- Fetch catalog when BOM is loaded ---- */
  useEffect(() => {
    if (!bom) return;
    setCatalogLoading(true);
    setCatalogError(null);

    Promise.all([
      fetch("/api/products/comparison").then((res) => {
        if (!res.ok) throw new Error(`Catalog fetch failed (${res.status})`);
        return res.json() as Promise<ProductComparisonResponse>;
      }),
      fetch("/api/inventory/skus?active=false")
        .then((res) => {
          if (!res.ok) throw new Error(`Inventory SKU fetch failed (${res.status})`);
          return res.json() as Promise<{ skus?: InternalCatalogSku[] }>;
        })
        .catch(() => ({ skus: [] })),
    ])
      .then(([comparisonData, skuData]) => {
        setComparisonRows(comparisonData.rows);
        setCatalogHealth(comparisonData.health);
        setInternalSkus(skuData.skus ?? []);
      })
      .catch((e) => {
        setCatalogError(e instanceof Error ? e.message : "Failed to load catalog");
      })
      .finally(() => setCatalogLoading(false));
  }, [bom]);

  /* ---- Rebuild catalog status whenever items or rows change ---- */
  useEffect(() => {
    if (!comparisonRows.length || !items.length) {
      setCatalogStatus(new Map());
      return;
    }
    setCatalogStatus(buildCatalogStatus(items, comparisonRows));
  }, [items, comparisonRows]);

  /* ---- Load deal from ?deal= URL param on mount ---- */
  useEffect(() => {
    const dealId = searchParams.get("deal");
    if (!dealId) return;
    // Always fetch fresh from HubSpot — the search-results cache may have
    // stale data (e.g. designFolderUrl: null) if the deal was updated recently.
    // The optimistic setLinkedProject() in dropdown click handlers prevents any
    // UI flash while this fetch is in flight.
    setDealLoading(true);
    fetch(`/api/projects/${encodeURIComponent(dealId)}`)
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((data: { project: { id: number; name: string; address: string; designFolderUrl: string | null; driveUrl: string | null; openSolarUrl: string | null; zuperUid: string | null } }) => {
        const p = data.project;
        setLinkedProject({
          hs_object_id: String(p.id),
          dealname: p.name,
          address: p.address,
          designFolderUrl: p.designFolderUrl,
          driveUrl: p.driveUrl,
          openSolarUrl: p.openSolarUrl,
          zuperUid: p.zuperUid,
        });
      })
      .catch(() => {/* silent — bad param, just ignore */})
      .finally(() => setDealLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  /* ---- Load history when a project is linked ---- */
  useEffect(() => {
    if (!linkedProject) { setSnapshots([]); setSavedVersion(null); setZohoPoId(null); return; }
    setHistoryLoading(true);
    const autoLoad = searchParams.get("load") === "latest";
    fetch(`/api/bom/history?dealId=${encodeURIComponent(linkedProject.hs_object_id)}`)
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((data: { snapshots: BomSnapshot[] }) => {
        setSnapshots(data.snapshots);
        // If arriving from BOM History page, auto-load the most recent snapshot
        if (autoLoad && data.snapshots.length > 0) {
          const latest = data.snapshots[0]; // newest-first from API
          loadBomData(latest.bomData);
          setSavedVersion(latest.version);
          setZohoPoId(latest.zohoPoId ?? null);
          setZohoSoId(latest.zohoSoId ?? null);
        }
      })
      .catch(() => {/* silent */})
      .finally(() => setHistoryLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedProject]);

  /* ---- Fetch Zoho vendors when BOM is saved + project linked ---- */
  useEffect(() => {
    if (!savedVersion || !linkedProject || zohoVendors !== null) return;
    setVendorsLoading(true);
    fetch("/api/bom/zoho-vendors")
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((data: { vendors: { contact_id: string; contact_name: string }[] }) => {
        setZohoVendors(data.vendors ?? []);
      })
      .catch(() => {
        setZohoVendors([]); // empty = Zoho not configured or unavailable; hide section
      })
      .finally(() => setVendorsLoading(false));
  }, [savedVersion, linkedProject, zohoVendors]);

  /* ---- Fetch Zoho customers when BOM is saved + project linked ---- */
  useEffect(() => {
    if (!savedVersion || !linkedProject || zohoCustomers !== null) return;
    setCustomersLoading(true);
    fetch("/api/bom/zoho-customers")
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((data: { customers: { contact_id: string; contact_name: string }[] }) => {
        setZohoCustomers(data.customers ?? []);
      })
      .catch(() => {
        setZohoCustomers([]); // empty = Zoho not configured or unavailable; hide section
      })
      .finally(() => setCustomersLoading(false));
  }, [savedVersion, linkedProject, zohoCustomers]);

  /* ---- Load Drive design files when project has a design folder ---- */
  useEffect(() => {
    const folderId = linkedProject?.designFolderUrl;
    if (!folderId) { setDriveFiles([]); return; }
    setDriveFilesLoading(true);
    setDriveFilesError(null);
    fetch(`/api/bom/drive-files?folderId=${encodeURIComponent(folderId)}`)
      .then((r) => r.json())
      .then((data: { files: DriveFile[]; error?: string; debug?: Record<string, unknown> }) => {
        if (data.debug) console.log("[drive-files debug]", data.debug);
        const files = data.files ?? [];
        setDriveFiles(files);
        if (data.error) setDriveFilesError(`${data.error}${data.debug ? ` | token: ${data.debug.tokenSource}` : ""}`);
        if (files.length > 0) {
          setImportTab("project-files");
        }
      })
      .catch(() => setDriveFilesError("Failed to load design files"))
      .finally(() => setDriveFilesLoading(false));
  }, [linkedProject?.designFolderUrl]);

  // If the linked deal has a design folder, lock import UI to that flow.
  useEffect(() => {
    if (!linkedProject?.designFolderUrl) return;
    setImportTab("project-files");
    setImportError(null);
  }, [linkedProject?.designFolderUrl]);

  // If deal context is cleared, reset away from the design-folder tab.
  useEffect(() => {
    if (!linkedProject?.designFolderUrl && importTab === "project-files") {
      setImportTab("upload");
    }
  }, [linkedProject?.designFolderUrl, importTab]);

  /* ---- Auto-link: search HubSpot when BOM loads and no project is linked ---- */
  useEffect(() => {
    if (linkedProject || !bom?.project?.address) {
      setAutoLinkSuggestion(null);
      return;
    }
    // Build a short search query: street number + first word of street name
    const rawAddress = bom.project.address.trim();
    const parts = rawAddress.split(/[,\s]+/);
    const queryParts = parts.slice(0, 2).filter(Boolean);
    const query = queryParts.join(" ");
    if (!query) return;

    let cancelled = false;
    fetch(`/api/projects?search=${encodeURIComponent(query)}&limit=5`)
      .then((r) => r.json())
      .then((data: { projects?: ProjectResult[] }) => {
        if (cancelled) return;
        const results: ProjectResult[] = data.projects ?? [];
        // Normalize BOM address to street-only, e.g. "1617 rancho way"
        const bomStreet = rawAddress.split(",")[0].trim().toLowerCase();
        // Last name from BOM customer, e.g. "SILFVEN, ERIK" → "silfven"
        const bomLastName = (bom.project.customer ?? "").split(/[,\s]+/)[0].trim().toLowerCase();
        let best: ProjectResult | null = null;
        let bestScore = 0;
        for (const p of results) {
          if (!p.address) continue;
          const hsStreet = p.address.split(",")[0].trim().toLowerCase();
          const addressMatch =
            bomStreet === hsStreet ||
            bomStreet.startsWith(hsStreet) ||
            hsStreet.startsWith(bomStreet);
          // Address match is required — never suggest on name alone
          if (!addressMatch) continue;
          let score = 2; // address match baseline
          // Bonus point if customer last name appears in the deal name
          if (bomLastName && p.dealname.toLowerCase().includes(bomLastName)) score += 1;
          if (score > bestScore) { bestScore = score; best = p; }
        }
        if (best) setAutoLinkSuggestion(best);
      })
      .catch(() => { /* silently ignore auto-link errors */ });
    return () => { cancelled = true; };
  }, [bom, linkedProject]);

  /* ---- Clear auto-link suggestion when a project is manually linked ---- */
  useEffect(() => {
    if (linkedProject) setAutoLinkSuggestion(null);
  }, [linkedProject]);


  /* ---- Save snapshot helper ---- */
  const saveSnapshot = useCallback(async (
    bomData: BomData,
    sourceFile?: string,
    blobUrl?: string,
    projectOverride?: ProjectResult | null
  ) => {
    const targetProject = projectOverride ?? linkedProject;
    if (!targetProject) return;
    setSaving(true);
    try {
      const res = await fetch("/api/bom/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId: targetProject.hs_object_id,
          dealName: targetProject.dealname,
          bomData,
          sourceFile,
          blobUrl,
        }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      const saved = await res.json() as { id: string; version: number; createdAt: string };
      setSavedVersion(saved.version);
      setZohoPoId(null);         // New save = no PO yet
      setZohoSoId(null);         // New save = no SO yet
      setZohoVendors(null);      // Re-fetch vendors for this project on next render
      setZohoCustomers(null);    // Re-fetch customers for this project on next render
      setSelectedVendorId("");   // Clear stale vendor selection
      setSelectedCustomerId(""); // Clear stale customer selection
      // Reload history list
      const histRes = await fetch(`/api/bom/history?dealId=${encodeURIComponent(targetProject.hs_object_id)}`);
      if (histRes.ok) {
        const histData = await histRes.json() as { snapshots: BomSnapshot[] };
        setSnapshots(histData.snapshots);
      }
      addToast({ type: "success", title: `BOM v${saved.version} saved to ${targetProject.dealname}` });
      // Fire-and-forget email notification
      if (session?.user?.email) {
        fetch("/api/bom/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userEmail: session.user.email,
            dealName: targetProject.dealname,
            dealId: targetProject.hs_object_id,
            version: saved.version,
            sourceFile,
            itemCount: bomData.items.length,
            projectInfo: {
              customer: bomData.project?.customer,
              address: bomData.project?.address,
              aiFeedbackOverall: bomData.project?.aiFeedbackOverall,
              systemSizeKwdc: bomData.project?.systemSizeKwdc,
              moduleCount: bomData.project?.moduleCount,
            },
            items: bomData.items.map(item => ({
              lineItem: item.description,
              category: item.category,
              brand: item.brand,
              model: item.model,
              description: item.description,
              qty: Number(item.qty),
              unitSpec: item.unitSpec != null ? String(item.unitSpec) : null,
            })),
            hubspotUrl: `https://app.hubspot.com/contacts/21710069/deal/${targetProject.hs_object_id}`,
            designFolderUrl: targetProject.designFolderUrl,
            zuperUrl: targetProject.zuperUid ? `https://web.zuperpro.com/jobs/${targetProject.zuperUid}/details` : null,
          }),
        }).catch(() => {/* silent */});
      }
    } catch (e) {
      addToast({ type: "error", title: e instanceof Error ? e.message : "Save failed" });
    } finally {
      setSaving(false);
    }
  }, [linkedProject, addToast, session]);

  /* ---- Create Zoho PO ---- */
  const createPo = useCallback(async () => {
    if (!linkedProject || !savedVersion || !selectedVendorId) return;
    setCreatingPo(true);
    try {
      const res = await fetch("/api/bom/create-po", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId: linkedProject.hs_object_id,
          version: savedVersion,
          vendorId: selectedVendorId,
        }),
      });
      const data = await res.json() as {
        purchaseorder_id?: string;
        purchaseorder_number?: string;
        unmatchedCount?: number;
        error?: string;
      };
      if (!res.ok || !data.purchaseorder_id) {
        addToast({ type: "error", title: data.error ?? "Failed to create PO" });
        return;
      }
      setZohoPoId(data.purchaseorder_id);
      const unmatch = data.unmatchedCount ?? 0;
      addToast({
        type: "success",
        title: `PO ${data.purchaseorder_number ?? ""} created in Zoho`,
        ...(unmatch > 0 ? { description: `${unmatch} item${unmatch === 1 ? "" : "s"} had no Zoho SKU match — added as description-only lines` } : {}),
      });
    } catch {
      addToast({ type: "error", title: "Network error creating PO" });
    } finally {
      setCreatingPo(false);
    }
  }, [linkedProject, savedVersion, selectedVendorId, addToast]);

  /* ---- Create Zoho SO ---- */
  const createSo = useCallback(async () => {
    if (!linkedProject || !savedVersion || !selectedCustomerId) return;
    setCreatingSo(true);
    try {
      const res = await fetch("/api/bom/create-so", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId: linkedProject.hs_object_id,
          version: savedVersion,
          customerId: selectedCustomerId,
        }),
      });
      const data = await res.json() as {
        salesorder_id?: string;
        salesorder_number?: string;
        unmatchedCount?: number;
        error?: string;
      };
      if (!res.ok || !data.salesorder_id) {
        addToast({ type: "error", title: data.error ?? "Failed to create SO" });
        return;
      }
      setZohoSoId(data.salesorder_id);
      const unmatch = data.unmatchedCount ?? 0;
      addToast({
        type: "success",
        title: `SO ${data.salesorder_number ?? ""} created in Zoho`,
        ...(unmatch > 0 ? { description: `${unmatch} item${unmatch === 1 ? "" : "s"} had no Zoho SKU match — added as description-only lines` } : {}),
      });
    } catch {
      addToast({ type: "error", title: "Network error creating SO" });
    } finally {
      setCreatingSo(false);
    }
  }, [linkedProject, savedVersion, selectedCustomerId, addToast]);

  /* ---- Load BOM helper ---- */
  // freshExtract=true when loading a newly extracted PDF (not a saved snapshot).
  // Pass preserveProject to keep the BOM tied to the current HubSpot deal.
  const loadBomData = useCallback((data: BomData, freshExtract = false, preserveProject: ProjectResult | null = null) => {
    if (!data.items || !Array.isArray(data.items)) {
      throw new Error('Response must have an "items" array');
    }
    setBom(data);
    setItems(assignIds(data.items));
    if (freshExtract) {
      if (preserveProject) {
        setLinkedProject(preserveProject);
        setImportTab(preserveProject.designFolderUrl ? "project-files" : "upload");
        const url = new URL(window.location.href);
        url.searchParams.set("deal", preserveProject.hs_object_id);
        url.searchParams.delete("load");
        window.history.replaceState({}, "", url.toString());
      } else {
        setLinkedProject(null);
        setImportTab("upload");
        setDriveFiles([]);
        setSnapshots([]);
        setSavedVersion(null);
        setZohoPoId(null);
        setZohoSoId(null);
        setZohoVendors(null);
        setZohoCustomers(null);
        setSelectedVendorId("");
        setSelectedCustomerId("");
        setAutoLinkSuggestion(null);
        // Remove stale ?deal= param from URL without a navigation
        const url = new URL(window.location.href);
        url.searchParams.delete("deal");
        url.searchParams.delete("load");
        window.history.replaceState({}, "", url.toString());
      }
    }
  }, []);

  /* ---- Safe fetch helper — handles non-JSON error responses ---- */
  const safeFetchBom = useCallback(async (res: Response): Promise<BomData> => {
    const text = await res.text();
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text);
    } catch {
      // Server returned HTML (e.g. "Request Entity Too Large", Vercel timeout)
      if (res.status === 413) throw new Error("PDF is too large — try a smaller file.");
      if (res.status === 504) throw new Error("Extraction timed out. Try again.");
      throw new Error(`Server error ${res.status}: ${text.slice(0, 120)}`);
    }
    if (!res.ok) throw new Error((data.error as string) || `Server error ${res.status}`);
    return data as unknown as BomData;
  }, []);

  /* ---- Extract from PDF upload ---- */
  // Chunks the PDF into 1MB slices (→ ~1.4MB base64 JSON each, safely under
  // Vercel's 4.5MB serverless body limit) and POSTs each to /api/bom/chunk.
  // All requests stay on our domain — no cross-origin CORS issues.
  // The server reassembles chunks in Vercel Blob and returns the final URL
  // for BOM Tool extraction server-side.
  const handleExtractUpload = useCallback(async () => {
    if (!uploadFile) return;
    const projectAtExtractStart = linkedProject;
    setExtracting(true);
    setImportError(null);
    setUploadProgress("");
    try {
      const CHUNK_SIZE = 1 * 1024 * 1024; // 1MB raw → ~1.4MB base64 JSON
      const uploadId = crypto.randomUUID();
      const totalChunks = Math.ceil(uploadFile.size / CHUNK_SIZE);

      let blobUrl = "";
      for (let i = 0; i < totalChunks; i++) {
        setUploadProgress(
          totalChunks === 1
            ? "Uploading PDF…"
            : `Uploading part ${i + 1} of ${totalChunks}…`
        );

        const start = i * CHUNK_SIZE;
        const slice = uploadFile.slice(start, start + CHUNK_SIZE);
        const arrayBuf = await slice.arrayBuffer();

        // Safe base64 — explicit loop avoids call-stack overflow on large chunks
        const bytes = new Uint8Array(arrayBuf);
        let binary = "";
        for (let j = 0; j < bytes.length; j++) binary += String.fromCharCode(bytes[j]);
        const base64 = btoa(binary);

        const chunkRes = await fetch("/api/bom/chunk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            uploadId,
            chunkIndex: i,
            totalChunks,
            data: base64,
            filename: uploadFile.name,
          }),
        });

        if (!chunkRes.ok) {
          const err = await chunkRes.json().catch(() => ({ error: `Part ${i + 1} upload failed (${chunkRes.status})` }));
          throw new Error((err as { error?: string }).error ?? `Part ${i + 1} failed (${chunkRes.status})`);
        }

        const result = await chunkRes.json() as { status: string; blobUrl?: string };
        if (result.status === "complete" && result.blobUrl) {
          blobUrl = result.blobUrl;
        }
      }

      if (!blobUrl) throw new Error("Upload completed but no blob URL returned — try again");

      setUploadProgress("Extracting BOM with BOM Tool — this takes 30–60 seconds…");
      const res = await fetch("/api/bom/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blobUrl }),
      });
      const data = await safeFetchBom(res);
      loadBomData(data, true, projectAtExtractStart);
      addToast({ type: "success", title: `BOM extracted from ${uploadFile.name}` });
      // Auto-save snapshot if a project was linked at extract time
      if (projectAtExtractStart) {
        await saveSnapshot(data, uploadFile.name, blobUrl, projectAtExtractStart);
      }
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setExtracting(false);
      setUploadProgress("");
    }
  }, [uploadFile, loadBomData, safeFetchBom, addToast, linkedProject, saveSnapshot]);

  /* ---- Extract from Google Drive URL ---- */
  const handleExtractDrive = useCallback(async () => {
    const url = driveUrl.trim();
    if (!url) return;
    const projectAtExtractStart = linkedProject;

    // Convert Drive share URL → direct download URL
    // https://drive.google.com/file/d/FILE_ID/view → /uc?export=download&id=FILE_ID
    const fileIdMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (!fileIdMatch) {
      setImportError("Couldn't parse a Google Drive file ID from that URL. Make sure it's a /file/d/... share link.");
      return;
    }
    const fileId = fileIdMatch[1];
    const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

    setExtracting(true);
    setImportError(null);
    try {
      // Fetch the PDF via a server-side proxy to avoid CORS issues
      const proxyRes = await fetch("/api/bom/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driveUrl: downloadUrl, fileId }),
      });
      const data = await safeFetchBom(proxyRes);
      loadBomData(data, true, projectAtExtractStart);
      addToast({ type: "success", title: "BOM extracted from Google Drive" });
      if (projectAtExtractStart) {
        await saveSnapshot(data, driveUrl, undefined, projectAtExtractStart);
      }
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Drive extraction failed");
    } finally {
      setExtracting(false);
    }
  }, [driveUrl, loadBomData, safeFetchBom, addToast, linkedProject, saveSnapshot]);

  /* ---- Extract from a Drive file ID directly (from design files picker) ---- */
  const handleExtractDriveFile = useCallback(async (file: DriveFile) => {
    const projectAtExtractStart = linkedProject;
    setExtractingDriveFileId(file.id);
    setImportError(null);
    const downloadUrl = `https://drive.google.com/uc?export=download&id=${file.id}`;
    try {
      const proxyRes = await fetch("/api/bom/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driveUrl: downloadUrl, fileId: file.id }),
      });
      const data = await safeFetchBom(proxyRes);
      loadBomData(data, true, projectAtExtractStart);
      addToast({ type: "success", title: `BOM extracted from ${file.name}` });
      if (projectAtExtractStart) await saveSnapshot(data, file.name, downloadUrl, projectAtExtractStart);
    } catch (e) {
      addToast({ type: "error", title: e instanceof Error ? e.message : "Extraction failed" });
    } finally {
      setExtractingDriveFileId(null);
    }
  }, [safeFetchBom, loadBomData, addToast, linkedProject, saveSnapshot]);

  /* ---- Paste JSON import ---- */
  const handleImport = useCallback(() => {
    setImportError(null);
    try {
      const parsed = JSON.parse(jsonInput.trim()) as BomData;
      loadBomData(parsed);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Invalid JSON");
    }
  }, [jsonInput, loadBomData]);

  /* ---- Backfill empty BOM fields from linked HubSpot/Zoho products ---- */
  const handleBackfillFromLinkedProducts = useCallback(async () => {
    if (!linkedProject) {
      addToast({ type: "error", title: "Link a HubSpot project first" });
      return;
    }

    setBackfillingLinkedProducts(true);
    try {
      const res = await fetch(`/api/bom/linked-products?dealId=${encodeURIComponent(linkedProject.hs_object_id)}`);
      const data = await res.json() as {
        products?: LinkedBomProduct[];
        error?: string;
        summary?: { hubspotLinkedCount: number; zohoMatchedCount: number };
      };

      if (!res.ok) {
        throw new Error(data.error || `Backfill failed (${res.status})`);
      }

      const linkedProducts = Array.isArray(data.products) ? data.products : [];
      if (!linkedProducts.length) {
        addToast({ type: "error", title: "No linked products found for this deal" });
        return;
      }

      let rowsUpdated = 0;
      let fieldsFilled = 0;
      let fallbackMatchedRows = 0;
      const remainingLinkedProducts = [...linkedProducts];

      const nextItems = items.map((item) => {
        let usedFallback = false;
        let best = findBestLinkedProduct(item, remainingLinkedProducts);

        const missingIdentity = isBlankText(item.brand) && isBlankText(item.model);
        if (!best && missingIdentity) {
          best = findFallbackLinkedProductForSparseItem(item, remainingLinkedProducts);
          usedFallback = Boolean(best);
        }

        if (!best) return item;

        const usedIndex = remainingLinkedProducts.findIndex((p) => p.id === best?.id);
        if (usedIndex >= 0) {
          remainingLinkedProducts.splice(usedIndex, 1);
        }

        let changed = false;
        const next: BomItem = { ...item };

        if (isBlankText(next.brand)) {
          const inferredBrand = inferLinkedBrand(best);
          if (inferredBrand) {
            next.brand = inferredBrand;
            changed = true;
            fieldsFilled += 1;
          }
        }

        if (isBlankText(next.model)) {
          const inferredModel = inferLinkedModel(best);
          if (inferredModel) {
            next.model = inferredModel;
            changed = true;
            fieldsFilled += 1;
          }
        }

        if (isBlankText(next.description)) {
          const inferredDescription = inferLinkedDescription(best);
          if (inferredDescription) {
            next.description = inferredDescription;
            changed = true;
            fieldsFilled += 1;
          }
        }

        if (!changed) return item;
        rowsUpdated += 1;
        if (usedFallback) fallbackMatchedRows += 1;
        return next;
      });

      if (fieldsFilled === 0) {
        addToast({ type: "success", title: "No empty BOM fields needed backfill" });
        return;
      }

      setItems(nextItems);
      const zohoSummary = data.summary
        ? ` (Zoho matches: ${data.summary.zohoMatchedCount}/${data.summary.hubspotLinkedCount})`
        : "";
      addToast({
        type: "success",
        title: `Backfilled ${fieldsFilled} field${fieldsFilled === 1 ? "" : "s"} across ${rowsUpdated} item${rowsUpdated === 1 ? "" : "s"}${zohoSummary}${fallbackMatchedRows > 0 ? ` | fallback matched: ${fallbackMatchedRows}` : ""}`,
      });
    } catch (e) {
      addToast({ type: "error", title: e instanceof Error ? e.message : "Failed to backfill linked products" });
    } finally {
      setBackfillingLinkedProducts(false);
    }
  }, [linkedProject, items, addToast]);

  /* ---- Editable table ---- */
  const updateItem = useCallback(
    (id: string, field: keyof BomItem, value: string | number | null) => {
      setItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
      );
    },
    []
  );

  const updateItemFlags = useCallback((id: string, value: string) => {
    const nextFlags = value
      .split(",")
      .map((flag) => flag.trim())
      .filter(Boolean);
    setItems((prev) =>
      prev.map((item) => (
        item.id === id
          ? { ...item, flags: nextFlags.length ? nextFlags : undefined }
          : item
      ))
    );
  }, []);

  const deleteItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const addRow = useCallback((category: BomCategory) => {
    const newItem: BomItem = {
      id: String(nextId++),
      category,
      brand: "",
      model: "",
      description: "",
      qty: 1,
      unitSpec: null,
      unitLabel: null,
      source: "manual",
    };
    setItems((prev) => {
      const lastIdx = prev.reduce(
        (acc, item, idx) => (item.category === category ? idx : acc),
        -1
      );
      if (lastIdx === -1) return [...prev, newItem];
      const next = [...prev];
      next.splice(lastIdx + 1, 0, newItem);
      return next;
    });
  }, []);

  /* ---- Project search ---- */
  const handleProjectSearch = useCallback((query: string) => {
    setProjectSearch(query);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!query.trim()) {
      setProjectResults([]);
      return;
    }
    searchTimeout.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await fetch(`/api/projects?search=${encodeURIComponent(query)}&limit=8`);
        if (res.ok) {
          const data = await res.json() as { projects: Array<{ id: number; name: string; address: string; designFolderUrl: string | null; driveUrl: string | null; openSolarUrl: string | null; zuperUid: string | null }> };
          setProjectResults((data.projects || []).map((p) => ({
            hs_object_id: String(p.id),
            dealname: p.name,
            address: p.address,
            designFolderUrl: p.designFolderUrl,
            driveUrl: p.driveUrl,
            openSolarUrl: p.openSolarUrl,
            zuperUid: p.zuperUid,
          })));
        }
      } catch {
        // silently ignore
      } finally {
        setSearchLoading(false);
      }
    }, 300);
  }, []);

  /* ---- Internal SKU best match per BOM item (token-based) ---- */
  const bestSkuByItem = useMemo(() => {
    const map = new Map<string, InternalCatalogSku>();
    if (!items.length || !internalSkus.length) return map;

    for (const item of items) {
      const candidates = internalSkus.filter((sku) => sku.category === item.category);
      let best: InternalCatalogSku | null = null;
      let bestScore = 0;

      for (const sku of candidates) {
        const score = scoreSkuMatch(sku, item);
        if (score >= 0.5 && score > bestScore) {
          best = sku;
          bestScore = score;
        }
      }

      if (best) {
        map.set(item.id, best);
      }
    }

    return map;
  }, [items, internalSkus]);

  /* ---- Internal SKU pricing map ---- */
  const pricingByItem = useMemo(() => {
    const map = new Map<string, PricingMatch>();
    for (const item of items) {
      const sku = bestSkuByItem.get(item.id);
      const sellPrice = sku?.sellPrice ?? null;
      map.set(item.id, { sellPrice });
    }
    return map;
  }, [items, bestSkuByItem]);

  /* ---- Per-row push actions: HubSpot deal line item / Zuper job part ---- */
  const handleAddHubspotDealLineItem = useCallback(async (item: BomItem) => {
    if (!linkedProject?.hs_object_id) {
      addToast({ type: "error", title: "Link a HubSpot project first" });
      return;
    }

    const actionKey = `hs:${item.id}`;
    setRowActionBusyKey(actionKey);
    try {
      const sku = bestSkuByItem.get(item.id);
      const quantity = parsePositiveQty(item.qty);
      const pricing = pricingByItem.get(item.id);
      const res = await fetch("/api/bom/linked-products/add-hubspot-line-item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId: linkedProject.hs_object_id,
          skuId: sku?.id || null,
          category: item.category,
          brand: item.brand,
          model: item.model,
          name: [item.brand || "", item.model || ""].filter(Boolean).join(" ").trim() || item.description,
          description: item.description,
          quantity,
          unitPrice: pricing?.sellPrice ?? null,
          sku: sku?.vendorPartNumber || item.model || null,
          hubspotProductId: sku?.hubspotProductId || null,
        }),
      });
      const data = await res.json() as { error?: string; lineItemId?: string };
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      addToast({
        type: "success",
        title: `Added HubSpot line item${data.lineItemId ? ` (${data.lineItemId})` : ""}`,
      });
    } catch (e) {
      addToast({ type: "error", title: e instanceof Error ? e.message : "Failed to add HubSpot line item" });
    } finally {
      setRowActionBusyKey((current) => (current === actionKey ? null : current));
    }
  }, [linkedProject, bestSkuByItem, pricingByItem, addToast]);

  const handleAddZuperJobPart = useCallback(async (item: BomItem) => {
    if (!linkedProject?.zuperUid) {
      addToast({ type: "error", title: "Linked project has no Zuper job UID" });
      return;
    }

    const actionKey = `zu:${item.id}`;
    setRowActionBusyKey(actionKey);
    try {
      const sku = bestSkuByItem.get(item.id);
      const quantity = parsePositiveQty(item.qty);
      const pricing = pricingByItem.get(item.id);
      const res = await fetch("/api/bom/linked-products/add-zuper-part", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobUid: linkedProject.zuperUid,
          skuId: sku?.id || null,
          category: item.category,
          brand: item.brand,
          model: item.model,
          name: [item.brand || "", item.model || ""].filter(Boolean).join(" ").trim() || item.description,
          description: item.description,
          quantity,
          unitPrice: pricing?.sellPrice ?? null,
          sku: sku?.vendorPartNumber || item.model || null,
          zuperItemId: sku?.zuperItemId || null,
        }),
      });
      const data = await res.json() as { error?: string; mode?: "part_added" | "note_fallback"; warning?: string };
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      if (data.mode === "note_fallback") {
        addToast({
          type: "error",
          title: data.warning || "Zuper part endpoint unavailable; part request added as job note",
        });
      } else {
        addToast({ type: "success", title: "Added Zuper part to job" });
      }
    } catch (e) {
      addToast({ type: "error", title: e instanceof Error ? e.message : "Failed to add Zuper part" });
    } finally {
      setRowActionBusyKey((current) => (current === actionKey ? null : current));
    }
  }, [linkedProject, bestSkuByItem, pricingByItem, addToast]);

  /* ---- Export CSV ---- */
  const handleExportCsv = useCallback(() => {
    if (!items.length) return;
    const rows = items.map((item) => {
      const status = catalogStatus.get(item.id);
      const pricing = pricingByItem.get(item.id);
      const catalogCols: Record<string, string> = {};
      for (const src of catalogSources) {
        catalogCols[`in_${src}`] = status?.[src] ? "yes" : "no";
      }
      return {
        category: item.category,
        brand: item.brand || "",
        model: item.model || "",
        description: item.description,
        qty: String(item.qty),
        unitSpec: item.unitSpec != null ? String(item.unitSpec) : "",
        unitLabel: item.unitLabel || "",
        source: item.source,
        flags: item.flags?.join(", ") || "",
        ...catalogCols,
      };
    });
    const customer = bom?.project?.customer || "bom";
    exportToCSV(rows, `${customer.replace(/\s+/g, "_")}_BOM`);
  }, [items, bom, catalogStatus, catalogSources, pricingByItem]);

  /* ---- Copy Markdown ---- */
  const handleCopyMarkdown = useCallback(async () => {
    if (!items.length) return;
    const grouped: Partial<Record<BomCategory, BomItem[]>> = {};
    for (const item of items) {
      if (!grouped[item.category]) grouped[item.category] = [];
      grouped[item.category]!.push(item);
    }

    const lines: string[] = [];
    if (bom?.project?.customer) {
      lines.push(`# BOM — ${bom.project.customer}`);
      if (bom.project.address) lines.push(`**Address:** ${bom.project.address}  `);
      if (bom.project.moduleCount)
        lines.push(
          `**System:** ${bom.project.moduleCount} modules | ${bom.project.systemSizeKwdc} kWdc / ${bom.project.systemSizeKwac} kWac  `
        );
      lines.push("");
    }

    const overallNotes = String(bom?.project?.aiFeedbackOverall || "").trim();
    if (overallNotes) {
      lines.push("## Overall AI Feedback");
      lines.push(overallNotes);
      lines.push("");
    }

    for (const cat of CATEGORY_ORDER) {
      const catItems = grouped[cat];
      if (!catItems?.length) continue;
      lines.push(`## ${CATEGORY_LABELS[cat]}`);
      lines.push("");
      const srcHeaders = catalogSources.map((s) => SOURCE_DISPLAY_LABELS[s] ?? s).join(" | ");
      const srcSeps = catalogSources.map(() => "------").join("|");
      lines.push(`| Brand | Model | Description | Qty | Spec |${srcHeaders ? ` ${srcHeaders} |` : ""}`);
      lines.push(`|-------|-------|-------------|-----|------|${srcSeps ? `${srcSeps}|` : ""}`);
      for (const item of catItems) {
        const flags = item.flags?.length ? ` ⚠️ ${item.flags.join(", ")}` : "";
        const status = catalogStatus.get(item.id);
        const srcCols = catalogSources.map((s) => status?.[s] ? "✅" : "—").join(" | ");
        lines.push(
          `| ${item.brand || "—"} | ${item.model || "—"} | ${item.description}${flags} | ${item.qty} | ${item.unitSpec || ""} ${item.unitLabel || ""} |${srcCols ? ` ${srcCols} |` : ""}`
        );
      }
      lines.push("");
    }

    await navigator.clipboard.writeText(lines.join("\n"));
    addToast({ type: "success", title: "Markdown copied to clipboard" });
  }, [items, bom, catalogStatus, addToast, catalogSources]);

  /* ---- Copy BOM Tool feedback notes ---- */
  const handleCopyBomToolNotes = useCallback(async () => {
    const overallNotes = String(bom?.project?.aiFeedbackOverall || "").trim();
    if (!overallNotes) {
      addToast({
        type: "error",
        title: "Add overall BOM Tool notes first",
      });
      return;
    }

    const lines: string[] = [
      "# BOM Tool Feedback",
      "",
      `Date: ${new Date().toLocaleDateString()}`,
      `Deal: ${linkedProject?.dealname || bom?.project?.customer || "Unknown"}`,
      `Deal ID: ${linkedProject?.hs_object_id || "N/A"}`,
      "",
      "## Feedback",
      overallNotes,
      "",
      "## Requested outcome",
      "- Update BOM extraction prompt/parsing behavior to address this recurring issue.",
      "- Keep existing category taxonomy and output schema stable.",
      "- Prefer deterministic extraction where possible over ambiguous inference.",
    ];

    await navigator.clipboard.writeText(lines.join("\n"));
    addToast({ type: "success", title: "BOM Tool notes copied" });
  }, [bom, linkedProject, addToast]);

  /* ---- Save to Inventory ---- */
  const handleSaveInventory = useCallback(async () => {
    if (!items.length || !bom) return;
    try {
      const res = await fetch("/api/bom/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        body: JSON.stringify({ bom: { ...bom, items: items.map(({ id: _bomId, ...rest }) => rest) } }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      const data = await res.json() as { created: number; updated: number; skipped: number };
      addToast({ type: "success", title: `Inventory updated — ${data.created} created, ${data.updated} updated, ${data.skipped} skipped` });
    } catch (e) {
      addToast({ type: "error", title: e instanceof Error ? e.message : "Save to inventory failed" });
    }
  }, [items, bom, addToast]);

  /* ---- Export PDF ---- */
  const handleExportPdf = useCallback(async () => {
    if (!bom) return;
    try {
      const res = await fetch("/api/bom/export-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          bomData: { ...bom, items: items.map(({ id: _bomId, ...rest }) => rest) },
          dealName: linkedProject?.dealname,
          version: savedVersion ?? undefined,
        }),
      });
      if (!res.ok) throw new Error(`PDF export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `BOM-${(bom.project?.customer ?? linkedProject?.dealname ?? "export").replace(/\s+/g, "_")}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      addToast({ type: "error", title: e instanceof Error ? e.message : "PDF export failed" });
    }
  }, [bom, items, linkedProject, savedVersion, addToast]);

  /* ---- Grouped items for render ---- */
  const grouped = CATEGORY_ORDER.reduce<Partial<Record<BomCategory, BomItem[]>>>(
    (acc, cat) => {
      const catItems = items.filter((i) => i.category === cat);
      if (catItems.length) acc[cat] = catItems;
      return acc;
    },
    {}
  );

  const validation = bom?.validation;

  // Summary counts
  const totalItems = items.length;
  const missingAny = items.filter((i) => {
    const s = catalogStatus.get(i.id);
    return s && catalogSources.some((src) => !s[src]);
  }).length;
  const designFolderOnlyMode = !!linkedProject?.designFolderUrl;

  return (
    <>
      <style>{`
        @media print {
          nav, header, [data-dashboard-shell-header], [data-dashboard-shell-nav],
          .action-bar, .history-panel, .diff-panel, .import-panel,
          .quick-links-panel, .design-files-panel {
            display: none !important;
          }
          body { background: white !important; }
          .bom-table-section { page-break-inside: avoid; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #e5e7eb; padding: 4px 8px; font-size: 11px; }
        }
      `}</style>
      <DashboardShell title="Planset BOM" accentColor="cyan">
      <div className="space-y-6 px-4 pb-10">

        {/* ---- Import Panel ---- */}
        {/* Full-panel spinner: only when we have NO project info yet.
            If an optimistic linkedProject is set, show the panel instead
            so the user sees the project name while fresh data loads. */}
        {!bom && (historyLoading || (dealLoading && !linkedProject)) && (
          <div className="rounded-xl bg-surface border border-t-border shadow-card p-12 flex flex-col items-center gap-3 text-muted">
            <div className="w-8 h-8 border-2 border-t-foreground border-surface rounded-full animate-spin" />
            <p className="text-sm">{dealLoading ? "Loading project…" : "Loading BOM…"}</p>
          </div>
        )}

        {!bom && !(historyLoading || (dealLoading && !linkedProject)) && (
          <div className="rounded-xl bg-surface border border-t-border shadow-card overflow-hidden">

            {/* ---- Project link strip (pre-extraction) ---- */}
            <div className="px-5 pt-4 pb-3 border-b border-t-border bg-surface-2 flex items-center gap-3">
              {linkedProject ? (
                <>
                  <span className="text-sm text-foreground">
                    🔗 <span className="font-medium">{linkedProject.dealname}</span>
                  </span>
                  {linkedProject.address && (
                    <span className="text-xs text-muted truncate hidden sm:inline">{linkedProject.address}</span>
                  )}
                  {linkedProject.designFolderUrl && (
                    <span className="text-xs text-cyan-500">📁 Design Folder available</span>
                  )}
                  <button
                    onClick={() => { setLinkedProject(null); setImportTab("upload"); setDriveFiles([]); setSnapshots([]); }}
                    className="ml-auto text-xs text-muted hover:text-foreground transition-colors"
                  >
                    Unlink
                  </button>
                </>
              ) : (
                <div className="relative flex-1">
                  <input
                    type="text"
                    placeholder="🔍 Link to HubSpot project (optional — enables Design Folder)…"
                    value={projectSearch}
                    onChange={(e) => handleProjectSearch(e.target.value)}
                    className="w-full rounded-lg bg-surface border border-t-border text-sm text-foreground px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 placeholder:text-muted"
                  />
                  {searchLoading && (
                    <span className="absolute right-3 top-2.5 text-xs text-muted">searching…</span>
                  )}
                  {projectResults.length > 0 && (
                    <div className="absolute z-20 mt-1 w-full rounded-lg bg-surface-elevated border border-t-border shadow-card-lg overflow-hidden">
                      {projectResults.map((p) => (
                        <button
                          key={p.hs_object_id}
                          onClick={() => {
                            // Set optimistically so the panel doesn't blank out while
                            // the URL effect fetches fresh data (which may update
                            // designFolderUrl from null → correct value).
                            setLinkedProject(p);
                            router.replace(`/dashboards/bom?deal=${encodeURIComponent(p.hs_object_id)}`);
                            setProjectSearch("");
                            setProjectResults([]);
                          }}
                          className="w-full text-left px-4 py-2.5 text-sm text-foreground hover:bg-surface-2 transition-colors border-b border-t-border last:border-b-0"
                        >
                          <span className="font-medium">{p.dealname}</span>
                          {p.address && (
                            <span className="text-muted ml-2 text-xs">{p.address}</span>
                          )}
                          {p.designFolderUrl && (
                            <span className="ml-1.5 text-xs text-cyan-500" title="Has design folder">📁</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <button
                onClick={() => setHistoryDrawerOpen(true)}
                className="shrink-0 text-xs text-muted hover:text-foreground transition-colors flex items-center gap-1 px-2 py-1.5 rounded border border-t-border bg-surface hover:bg-surface-2"
              >
                ⏱ History
              </button>
            </div>

            {/* Tab bar */}
            <div className="flex border-b border-t-border">
              {!designFolderOnlyMode && (["upload", "drive", "paste"] as ImportTab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => { setImportTab(tab); setImportError(null); }}
                  className={`px-5 py-3 text-sm font-medium transition-colors ${
                    importTab === tab
                      ? "text-cyan-500 border-b-2 border-cyan-500 bg-surface"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  {tab === "upload" && "📄 Upload PDF"}
                  {tab === "drive" && "☁️ Google Drive"}
                  {tab === "paste" && "{ } Paste JSON"}
                </button>
              ))}
              {designFolderOnlyMode && (
                <button
                  onClick={() => { setImportTab("project-files"); setImportError(null); }}
                  className={`px-5 py-3 text-sm font-medium transition-colors whitespace-nowrap ${
                    importTab === "project-files"
                      ? "text-cyan-500 border-b-2 border-cyan-500 bg-surface"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  📁 Design Folder
                  {driveFiles.length > 0 && (
                    <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-cyan-500/20 text-cyan-400 text-xs px-1.5 py-0.5">
                      {driveFiles.length}
                    </span>
                  )}
                </button>
              )}
            </div>

            <div className="p-6">
              {/* ---- Upload PDF tab ---- */}
              {importTab === "upload" && (
                <div className="space-y-4">
                  <p className="text-sm text-muted">
                    Upload a PB stamped planset PDF. BOM Tool will read all sheets and extract the full BOM automatically.
                  </p>

                  {/* Drop zone */}
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const dropped = e.dataTransfer.files[0];
                      if (dropped?.name.toLowerCase().endsWith(".pdf")) {
                        setUploadFile(dropped);
                        setImportError(null);
                      }
                    }}
                    className="flex flex-col items-center justify-center gap-2 h-36 rounded-xl border-2 border-dashed border-t-border hover:border-cyan-500 cursor-pointer transition-colors bg-surface-2 hover:bg-surface-elevated"
                  >
                    {uploadFile ? (
                      <>
                        <span className="text-2xl">📄</span>
                        <span className="text-sm font-medium text-foreground">{uploadFile.name}</span>
                        <span className="text-xs text-muted">
                          {(uploadFile.size / 1024 / 1024).toFixed(1)} MB
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); setUploadFile(null); }}
                          className="text-xs text-muted hover:text-red-500 transition-colors"
                        >
                          ✕ Remove
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="text-3xl opacity-40">☁️</span>
                        <span className="text-sm text-muted">Drop planset PDF here or click to browse</span>
                        <span className="text-xs text-muted opacity-60">Max 32 MB · PDF only</span>
                      </>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,application/pdf"
                    className="hidden"
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      const f = e.target.files?.[0];
                      if (f) { setUploadFile(f); setImportError(null); }
                    }}
                  />

                  {importError && <p className="text-sm text-red-500">{importError}</p>}

                  <button
                    onClick={handleExtractUpload}
                    disabled={!uploadFile || extracting}
                    className="px-5 py-2 rounded-lg bg-cyan-600 text-white text-sm font-medium hover:bg-cyan-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                  >
                    {extracting ? (
                      <>
                        <span className="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        {uploadProgress ? uploadProgress.split("—")[0].trim() : "Extracting…"}
                      </>
                    ) : (
                      "Extract BOM"
                    )}
                  </button>
                  {extracting && uploadProgress && (
                    <p className="text-xs text-muted animate-pulse">
                      {uploadProgress}
                    </p>
                  )}
                </div>
              )}

              {/* ---- Google Drive tab ---- */}
              {importTab === "drive" && (
                <div className="space-y-4">
                  <p className="text-sm text-muted">
                    Paste a Google Drive share link to a planset PDF. The file must be shared with &quot;Anyone with the link&quot;.
                  </p>
                  <input
                    type="url"
                    placeholder="https://drive.google.com/file/d/ABC123/view?usp=sharing"
                    value={driveUrl}
                    onChange={(e) => { setDriveUrl(e.target.value); setImportError(null); }}
                    className="w-full rounded-lg bg-surface-2 border border-t-border text-foreground text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  />

                  {importError && <p className="text-sm text-red-500">{importError}</p>}

                  <button
                    onClick={handleExtractDrive}
                    disabled={!driveUrl.trim() || extracting}
                    className="px-5 py-2 rounded-lg bg-cyan-600 text-white text-sm font-medium hover:bg-cyan-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                  >
                    {extracting ? (
                      <>
                        <span className="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Fetching & Extracting…
                      </>
                    ) : (
                      "Extract from Drive"
                    )}
                  </button>
                  {extracting && (
                    <p className="text-xs text-muted animate-pulse">
                      Downloading from Drive then extracting with BOM Tool — allow 30–60 seconds.
                    </p>
                  )}
                </div>
              )}

              {/* ---- Paste JSON tab ---- */}
              {importTab === "paste" && (
                <div className="space-y-3">
                  <p className="text-sm text-muted">
                    Run the{" "}
                    <code className="bg-surface-2 px-1.5 py-0.5 rounded text-xs">planset-bom</code>{" "}
                    skill in BOM Tool, then paste the JSON output below.
                  </p>
                  <textarea
                    className="w-full h-48 rounded-lg bg-surface-2 border border-t-border text-foreground text-sm font-mono p-3 resize-y focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    placeholder='{ "project": { ... }, "items": [ ... ], "validation": { ... } }'
                    value={jsonInput}
                    onChange={(e) => setJsonInput(e.target.value)}
                  />
                  {importError && <p className="text-sm text-red-500">{importError}</p>}
                  <button
                    onClick={handleImport}
                    disabled={!jsonInput.trim()}
                    className="px-5 py-2 rounded-lg bg-cyan-600 text-white text-sm font-medium hover:bg-cyan-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Load BOM
                  </button>
                </div>
              )}

              {importTab === "project-files" && (
                <div className="space-y-3">
                  <p className="text-sm text-muted">
                    Planset PDFs in{" "}
                    <span className="text-foreground font-medium">{linkedProject?.dealname}</span>
                    &apos;s design folder. Click a file to extract the BOM.
                  </p>

                  {driveFilesLoading && (
                    <p className="text-sm text-muted animate-pulse py-4 text-center">Loading design files…</p>
                  )}
                  {driveFilesError && (
                    <p className="text-sm text-red-500">{driveFilesError}</p>
                  )}
                  {!driveFilesLoading && !driveFilesError && driveFiles.length === 0 && (
                    <p className="text-sm text-muted py-4 text-center">No PDFs found in this project&apos;s design folder.</p>
                  )}

                  {driveFiles.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-t-border bg-surface-2 px-4 py-3 hover:bg-surface-elevated transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">{file.name}</div>
                        <div className="text-xs text-muted mt-0.5">
                          {file.size ? `${(parseInt(file.size) / 1024 / 1024).toFixed(1)} MB · ` : ""}
                          Modified {new Date(file.modifiedTime).toLocaleDateString()}
                        </div>
                      </div>
                      <button
                        onClick={() => handleExtractDriveFile(file)}
                        disabled={extracting}
                        className="flex-shrink-0 px-4 py-1.5 rounded-lg bg-cyan-600 text-white text-sm font-medium hover:bg-cyan-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                      >
                        {extractingDriveFileId === file.id ? (
                          <>
                            <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Extracting…
                          </>
                        ) : (
                          "Extract BOM"
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {bom && (
          <>
            {/* ---- Header row: project info + validation + catalog health ---- */}
            <div className="flex flex-col sm:flex-row gap-4">
              {/* Project info */}
              <div className="flex-1 rounded-xl bg-surface border border-t-border p-5 shadow-card">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-xl font-bold text-foreground">
                      {bom.project.customer || "Unknown Customer"}
                    </h2>
                    <p className="text-sm text-muted mt-0.5">{bom.project.address}</p>
                  </div>
                  <button
                    onClick={() => {
                      setBom(null);
                      setItems([]);
                      setJsonInput("");
                      setLinkedProject(null);
                      setAutoLinkSuggestion(null);
                      setComparisonRows([]);
                      setCatalogStatus(new Map());
                      setSnapshots([]);
                      setSavedVersion(null);
                      setZohoPoId(null);
                      setCompareA(null);
                      setCompareB(null);
                      setShowDiff(false);
                    }}
                    className="text-xs text-muted hover:text-foreground px-2 py-1 rounded hover:bg-surface-2 transition-colors"
                  >
                    ✕ Clear
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
                  {bom.project.moduleCount && (
                    <span>
                      <span className="text-foreground font-medium">{bom.project.moduleCount}</span> modules
                    </span>
                  )}
                  {bom.project.systemSizeKwdc && (
                    <span>
                      <span className="text-foreground font-medium">{bom.project.systemSizeKwdc}</span> kWdc
                    </span>
                  )}
                  {bom.project.systemSizeKwac && (
                    <span>
                      <span className="text-foreground font-medium">{bom.project.systemSizeKwac}</span> kWac
                    </span>
                  )}
                  {bom.project.utility && <span>Utility: {bom.project.utility}</span>}
                  {bom.project.ahj && <span>AHJ: {bom.project.ahj}</span>}
                  {bom.project.plansetRev && <span>Rev {bom.project.plansetRev}</span>}
                  {bom.project.stampDate && <span>Stamped {bom.project.stampDate}</span>}
                </div>
              </div>

              {/* Planset validation */}
              {validation && (
                <div className="rounded-xl bg-surface border border-t-border p-5 shadow-card min-w-[180px]">
                  <h3 className="text-sm font-semibold text-foreground mb-3">Planset</h3>
                  <div className="space-y-1.5 text-sm">
                    <ValidationBadge value={validation.moduleCountMatch ?? null} label="Module count" />
                    <ValidationBadge value={validation.batteryCapacityMatch ?? null} label="Battery kWh" />
                    <ValidationBadge value={validation.ocpdMatch ?? null} label="OCPD rating" />
                  </div>
                  {validation.warnings?.map((w, i) => (
                    <p key={i} className="mt-2 text-xs text-yellow-600 dark:text-yellow-400">⚠️ {w}</p>
                  ))}
                </div>
              )}

              {/* Catalog coverage summary */}
              <div className="rounded-xl bg-surface border border-t-border p-5 shadow-card min-w-[180px]">
                <h3 className="text-sm font-semibold text-foreground mb-3">Catalog Coverage</h3>
                {catalogLoading ? (
                  <p className="text-xs text-muted animate-pulse">Loading catalogs…</p>
                ) : catalogError ? (
                  <p className="text-xs text-red-500">{catalogError}</p>
                ) : catalogHealth ? (
                  <div className="space-y-2">
                    {Object.keys(catalogHealth).map((src) => {
                      const health = catalogHealth[src];
                      const found = items.filter((i) => catalogStatus.get(i.id)?.[src]).length;
                      return (
                        <div key={src} className="flex items-center justify-between gap-2 text-sm">
                          <span className="text-muted">{SOURCE_DISPLAY_LABELS[src] ?? src}</span>
                          {health.configured ? (
                            <span className="font-medium text-foreground">
                              {found}/{totalItems}
                            </span>
                          ) : (
                            <span className="text-xs text-muted">not configured</span>
                          )}
                        </div>
                      );
                    })}
                    {missingAny > 0 && (
                      <p className="mt-1 text-xs text-yellow-600 dark:text-yellow-400">
                        {missingAny} item{missingAny !== 1 ? "s" : ""} missing from at least one catalog
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted">—</p>
                )}
              </div>
            </div>

            {/* Auto-link suggestion banner */}
            {autoLinkSuggestion !== null && linkedProject === null && (
              <div className="rounded-xl bg-cyan-500/10 border border-cyan-500/30 px-5 py-3 flex items-center gap-3 text-sm">
                <span className="text-cyan-700 dark:text-cyan-300 font-medium">Auto-matched:</span>
                <span className="text-foreground font-medium">{autoLinkSuggestion.dealname}</span>
                {autoLinkSuggestion.address && (
                  <span className="text-muted hidden sm:inline">{autoLinkSuggestion.address}</span>
                )}
                <div className="ml-auto flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => {
                      // Navigate via URL so the effect fetches fresh HubSpot data
                      router.replace(`/dashboards/bom?deal=${encodeURIComponent(autoLinkSuggestion.hs_object_id)}`);
                      setAutoLinkSuggestion(null);
                    }}
                    className="text-xs bg-cyan-600 text-white px-3 py-1 rounded-lg hover:bg-cyan-700 transition-colors"
                  >
                    Link ✓
                  </button>
                  <button
                    onClick={() => setAutoLinkSuggestion(null)}
                    className="text-xs text-muted hover:text-foreground transition-colors"
                  >
                    Dismiss ✗
                  </button>
                </div>
              </div>
            )}


            {/* Project Link */}
            <div className="rounded-xl bg-surface border border-t-border p-5 shadow-card">
              <h3 className="text-sm font-semibold text-foreground mb-3">Link to HubSpot Project</h3>
              {linkedProject ? (
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-sm text-foreground">
                    ✅ <span className="font-medium">{linkedProject.dealname}</span>
                  </span>
                  {saving && (
                    <span className="text-xs text-muted animate-pulse">Saving…</span>
                  )}
                  {savedVersion && !saving && (
                    <span className="text-xs text-green-600 dark:text-green-400">v{savedVersion} saved</span>
                  )}
                  {!saving && bom && (
                    <button
                      onClick={() => {
                        // eslint-disable-next-line @typescript-eslint/no-unused-vars
                        const stripped = items.map(({ id: _bomId, ...rest }) => rest);
                        saveSnapshot({ ...bom, items: stripped });
                      }}
                      className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline"
                    >
                      Save current BOM
                    </button>
                  )}
                  {!savedVersion && !saving && (
                    <span className="text-xs text-amber-600 dark:text-amber-400">
                      Save current BOM to enable Zoho PO/SO actions.
                    </span>
                  )}
                  {/* Zoho PO — only show when saved + vendors available */}
                  {savedVersion && zohoVendors && zohoVendors.length > 0 && (
                    zohoPoId ? (
                      <a
                        href={`https://inventory.zoho.com/app#/purchaseorders/${zohoPoId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline"
                      >
                        View PO in Zoho →
                      </a>
                    ) : (
                      <div className="flex items-center gap-2">
                        <select
                          value={selectedVendorId}
                          onChange={(e) => setSelectedVendorId(e.target.value)}
                          className="text-xs rounded bg-surface-2 border border-t-border text-foreground px-2 py-1 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                        >
                          <option value="">Select vendor…</option>
                          {zohoVendors.map((v) => (
                            <option key={v.contact_id} value={v.contact_id}>
                              {v.contact_name}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={createPo}
                          disabled={!selectedVendorId || creatingPo}
                          title={!selectedVendorId ? "Select a vendor first" : "Create draft PO in Zoho Inventory"}
                          className="text-xs rounded bg-cyan-600 text-white px-3 py-1 hover:bg-cyan-700 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {creatingPo ? "Creating…" : "Create PO in Zoho"}
                        </button>
                      </div>
                    )
                  )}
                  {vendorsLoading && (
                    <span className="text-xs text-muted animate-pulse">Loading vendors…</span>
                  )}
                  {savedVersion && !vendorsLoading && zohoVendors && zohoVendors.length === 0 && (
                    <span className="text-xs text-amber-600 dark:text-amber-400">
                      Zoho vendors unavailable (or none found). Check `/api/bom/zoho-vendors`.
                    </span>
                  )}
                  {/* Zoho SO — only show when saved + customers available */}
                  {savedVersion && zohoCustomers && zohoCustomers.length > 0 && (
                    zohoSoId ? (
                      <a
                        href={`https://inventory.zoho.com/app#/salesorders/${zohoSoId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline"
                      >
                        View SO in Zoho →
                      </a>
                    ) : (
                      <div className="flex items-center gap-2">
                        <select
                          value={selectedCustomerId}
                          onChange={(e) => setSelectedCustomerId(e.target.value)}
                          className="text-xs rounded bg-surface-2 border border-t-border text-foreground px-2 py-1 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                        >
                          <option value="">Select customer…</option>
                          {zohoCustomers.map((c) => (
                            <option key={c.contact_id} value={c.contact_id}>
                              {c.contact_name}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={createSo}
                          disabled={!selectedCustomerId || creatingSo}
                          title={!selectedCustomerId ? "Select a customer first" : "Create draft SO in Zoho Inventory"}
                          className="text-xs rounded bg-cyan-600 text-white px-3 py-1 hover:bg-cyan-700 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {creatingSo ? "Creating…" : "Create SO in Zoho"}
                        </button>
                      </div>
                    )
                  )}
                  {customersLoading && (
                    <span className="text-xs text-muted animate-pulse">Loading customers…</span>
                  )}
                  {savedVersion && !customersLoading && zohoCustomers && zohoCustomers.length === 0 && (
                    <span className="text-xs text-amber-600 dark:text-amber-400">
                      Zoho customers unavailable (or none found). Check `/api/bom/zoho-customers`.
                    </span>
                  )}
                  {savedVersion && !vendorsLoading && !customersLoading && (
                    <button
                      onClick={() => {
                        setZohoVendors(null);
                        setZohoCustomers(null);
                      }}
                      className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline"
                    >
                      Retry Zoho lists
                    </button>
                  )}
                  <button
                    onClick={() => { setLinkedProject(null); setImportTab("upload"); setDriveFiles([]); setSnapshots([]); setSavedVersion(null); setZohoPoId(null); setZohoVendors(null); setZohoSoId(null); setZohoCustomers(null); setSelectedVendorId(""); setSelectedCustomerId(""); router.replace("/dashboards/bom"); }}
                    className="text-xs text-muted hover:text-foreground"
                  >
                    Unlink
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search by name, address, or project number…"
                    value={projectSearch}
                    onChange={(e) => handleProjectSearch(e.target.value)}
                    className="w-full max-w-md rounded-lg bg-surface-2 border border-t-border text-sm text-foreground px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  />
                  {searchLoading && (
                    <span className="absolute right-3 top-2.5 text-xs text-muted">searching…</span>
                  )}
                  {projectResults.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full max-w-md rounded-lg bg-surface-elevated border border-t-border shadow-card-lg overflow-hidden">
                      {projectResults.map((p) => (
                        <button
                          key={p.hs_object_id}
                          onClick={() => {
                            // Navigate via URL — the ?deal= effect fetches fresh HubSpot
                            // data so designFolderUrl is always up-to-date.
                            router.replace(`/dashboards/bom?deal=${encodeURIComponent(p.hs_object_id)}`);
                            setProjectSearch("");
                            setProjectResults([]);
                            setSavedVersion(null);
                            setZohoPoId(null);
                            setZohoSoId(null);
                            setZohoVendors(null);
                            setZohoCustomers(null);
                            setSelectedVendorId("");
                            setSelectedCustomerId("");
                          }}
                          className="w-full text-left px-4 py-2.5 text-sm text-foreground hover:bg-surface-2 transition-colors"
                        >
                          <span className="font-medium">{p.dealname}</span>
                          {p.address && (
                            <span className="text-muted ml-2 text-xs">{p.address}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>


            {/* Quick Links */}
            {linkedProject && (
              <div className="quick-links-panel rounded-xl bg-surface border border-t-border p-4 shadow-card">
                <h3 className="text-xs font-semibold text-muted mb-2 uppercase tracking-wide">Quick Links</h3>
                <QuickLinks project={linkedProject} />
              </div>
            )}

            {/* Overall AI feedback for skill updates */}
            <div className="rounded-xl bg-surface border border-t-border p-4 shadow-card">
              <div className="flex items-center justify-between gap-2 mb-2">
                <h3 className="text-sm font-semibold text-foreground">Overall AI Feedback</h3>
                <button
                  onClick={handleCopyBomToolNotes}
                  className="px-3 py-1.5 rounded-lg bg-surface-2 border border-t-border text-xs text-foreground hover:bg-surface transition-colors"
                >
                  ⎘ Copy BOM Tool Notes
                </button>
              </div>
              <p className="text-xs text-muted mb-2">
                Capture global extraction feedback for BOM Tool behavior and parsing quality.
              </p>
              <textarea
                value={bom.project.aiFeedbackOverall || ""}
                onChange={(e) => {
                  const next = e.target.value;
                  setBom((prev) => (
                    prev
                      ? {
                        ...prev,
                        project: {
                          ...prev.project,
                          aiFeedbackOverall: next,
                        },
                      }
                      : prev
                  ));
                }}
                rows={4}
                placeholder="Example: BOM Tool keeps missing EV charger breaker size and often confuses racking rail model names with module model names..."
                className="w-full rounded-lg bg-surface-2 border border-t-border text-sm text-foreground px-3 py-2 focus:outline-none focus:ring-1 focus:ring-cyan-500 placeholder:text-muted resize-y"
              />
            </div>

            {/* Action Bar */}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleExportCsv}
                className="px-4 py-2 rounded-lg bg-surface border border-t-border text-sm text-foreground hover:bg-surface-2 transition-colors"
              >
                ↓ Export CSV
              </button>
              <button
                onClick={handleCopyMarkdown}
                className="px-4 py-2 rounded-lg bg-surface border border-t-border text-sm text-foreground hover:bg-surface-2 transition-colors"
              >
                ⎘ Copy Markdown
              </button>
              <button
                onClick={handleCopyBomToolNotes}
                className="px-4 py-2 rounded-lg bg-surface border border-t-border text-sm text-foreground hover:bg-surface-2 transition-colors"
              >
                ⎘ Copy BOM Tool Notes
              </button>
              <button
                onClick={handleSaveInventory}
                className="px-4 py-2 rounded-lg bg-cyan-600 text-white text-sm font-medium hover:bg-cyan-700 transition-colors"
              >
                ↑ Save to Inventory
              </button>
              <button
                onClick={handleBackfillFromLinkedProducts}
                disabled={!linkedProject || backfillingLinkedProducts}
                className="px-4 py-2 rounded-lg bg-surface border border-t-border text-sm text-foreground hover:bg-surface-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title={!linkedProject ? "Link a HubSpot project first" : "Fill blank BOM fields from linked HubSpot/Zoho products"}
              >
                {backfillingLinkedProducts ? "⟳ Backfilling…" : "⇄ Fill Empty from Linked Products"}
              </button>
              <button
                onClick={handleExportPdf}
                disabled={!bom}
                className="px-4 py-2 rounded-lg bg-surface border border-t-border text-sm text-foreground hover:bg-surface-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ↓ Export PDF
              </button>
              <button
                onClick={() => window.print()}
                disabled={!bom}
                className="px-4 py-2 rounded-lg bg-surface border border-t-border text-sm text-foreground hover:bg-surface-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                🖨 Print
              </button>
              <button
                onClick={() => setHistoryDrawerOpen(true)}
                className="px-4 py-2 rounded-lg bg-surface border border-t-border text-sm text-foreground hover:bg-surface-2 transition-colors"
              >
                ⏱ BOM History
              </button>
            </div>

            {/* ---- History Panel ---- */}
            {linkedProject && (snapshots.length > 0 || historyLoading) && (
              <div className="rounded-xl bg-surface border border-t-border shadow-card overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-t-border bg-surface-2">
                  <h3 className="text-sm font-semibold text-foreground">
                    Extraction History
                    <span className="ml-2 text-xs text-muted font-normal">
                      {snapshots.length} version{snapshots.length !== 1 ? "s" : ""}
                    </span>
                  </h3>
                  {snapshots.length >= 2 && (
                    <button
                      onClick={() => {
                        if (showDiff) {
                          setShowDiff(false); setCompareA(null); setCompareB(null);
                        } else {
                          setCompareA(snapshots[0]);
                          setCompareB(snapshots[1]);
                          setShowDiff(true);
                        }
                      }}
                      className={`text-xs px-3 py-1 rounded-lg transition-colors ${showDiff ? "bg-cyan-600 text-white" : "bg-surface border border-t-border text-foreground hover:bg-surface-2"}`}
                    >
                      {showDiff ? "Hide Compare" : "Compare Versions"}
                    </button>
                  )}
                </div>

                {historyLoading ? (
                  <p className="text-xs text-muted px-5 py-4 animate-pulse">Loading history…</p>
                ) : (
                  <div className="divide-y divide-[color:var(--border)]">
                    {snapshots.map((snap) => (
                      <div key={snap.id} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2 transition-colors group">
                        <div className="w-8 h-8 rounded-lg bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 flex items-center justify-center text-xs font-bold flex-shrink-0">
                          v{snap.version}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-foreground font-medium truncate">
                            {snap.sourceFile || "Manual save"}
                          </div>
                          <div className="text-xs text-muted">
                            {new Date(snap.createdAt).toLocaleString()} · {snap.bomData.items.length} items
                            {snap.savedBy && ` · ${snap.savedBy}`}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => {
                              loadBomData(snap.bomData);
                              setSavedVersion(snap.version);
                              setZohoPoId(snap.zohoPoId ?? null);
                              setZohoSoId(snap.zohoSoId ?? null);
                              setZohoVendors(null);      // re-fetch vendors for this version
                              setZohoCustomers(null);    // re-fetch customers for this version
                              setSelectedVendorId("");   // clear stale selection
                              setSelectedCustomerId(""); // clear stale selection
                              addToast({ type: "success", title: `Loaded v${snap.version}` });
                            }}
                            className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline"
                          >
                            Load
                          </button>
                          {showDiff && (
                            <>
                              <button
                                onClick={() => setCompareA(snap)}
                                className={`text-xs px-2 py-0.5 rounded transition-colors ${compareA?.id === snap.id ? "bg-blue-500 text-white" : "bg-surface border border-t-border text-muted hover:text-foreground"}`}
                              >
                                A
                              </button>
                              <button
                                onClick={() => setCompareB(snap)}
                                className={`text-xs px-2 py-0.5 rounded transition-colors ${compareB?.id === snap.id ? "bg-orange-500 text-white" : "bg-surface border border-t-border text-muted hover:text-foreground"}`}
                              >
                                B
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ---- Diff View ---- */}
            {showDiff && compareA && compareB && (
              <div className="rounded-xl bg-surface border border-t-border shadow-card overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-t-border bg-surface-2">
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-semibold text-foreground">BOM Comparison</h3>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400">
                      A · v{compareA.version} — {new Date(compareA.createdAt).toLocaleDateString()}
                    </span>
                    <span className="text-xs text-muted">vs</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-600 dark:text-orange-400">
                      B · v{compareB.version} — {new Date(compareB.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex gap-3 text-xs text-muted">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Added</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> Removed</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" /> Changed</span>
                  </div>
                </div>

                {/* Project-level diff */}
                {(() => {
                  const pa = compareA.bomData.project;
                  const pb = compareB.bomData.project;
                  const fields: Array<{ label: string; key: keyof typeof pa }> = [
                    { label: "Customer", key: "customer" },
                    { label: "Address", key: "address" },
                    { label: "kWdc", key: "systemSizeKwdc" },
                    { label: "kWac", key: "systemSizeKwac" },
                    { label: "Modules", key: "moduleCount" },
                    { label: "Rev", key: "plansetRev" },
                    { label: "Stamp", key: "stampDate" },
                  ];
                  const changed = fields.filter((f) => String(pa[f.key] ?? "") !== String(pb[f.key] ?? ""));
                  if (!changed.length) return null;
                  return (
                    <div className="px-5 py-3 border-b border-t-border bg-yellow-50/20 dark:bg-yellow-900/10">
                      <p className="text-xs font-semibold text-muted mb-2">Project fields changed</p>
                      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
                        {changed.map(({ label, key }) => (
                          <span key={key}>
                            <span className="text-muted">{label}: </span>
                            <span className="line-through text-red-500">{String(pa[key] ?? "—")}</span>
                            {" → "}
                            <span className="text-green-600 dark:text-green-400">{String(pb[key] ?? "—")}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Summary counts */}
                {(() => {
                  const counts = { added: 0, removed: 0, changed: 0, unchanged: 0 };
                  for (const r of diffRows) counts[r.status]++;
                  return (
                    <div className="flex gap-6 px-5 py-2 border-b border-t-border bg-surface-2 text-xs text-muted">
                      {counts.changed > 0 && <span className="text-yellow-600 dark:text-yellow-400 font-medium">{counts.changed} changed</span>}
                      {counts.added > 0 && <span className="text-green-600 dark:text-green-400 font-medium">{counts.added} added</span>}
                      {counts.removed > 0 && <span className="text-red-500 font-medium">{counts.removed} removed</span>}
                      <span>{counts.unchanged} unchanged</span>
                    </div>
                  );
                })()}

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-muted border-b border-t-border bg-surface-2/50">
                        <th className="text-left px-4 py-2 font-medium w-4"></th>
                        <th className="text-left px-4 py-2 font-medium w-28">Category</th>
                        <th className="text-left px-4 py-2 font-medium w-28">Brand</th>
                        <th className="text-left px-4 py-2 font-medium w-36">Model</th>
                        <th className="text-left px-4 py-2 font-medium">Description</th>
                        <th className="text-left px-4 py-2 font-medium w-20">Qty A→B</th>
                        <th className="text-left px-4 py-2 font-medium w-24">Spec A→B</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[color:var(--border)]">
                      {diffRows.filter((r) => r.status !== "unchanged").map((row, i) => {
                        const bg =
                          row.status === "added" ? "bg-green-50/40 dark:bg-green-900/10" :
                          row.status === "removed" ? "bg-red-50/40 dark:bg-red-900/10" :
                          "bg-yellow-50/30 dark:bg-yellow-900/10";
                        const dot =
                          row.status === "added" ? "bg-green-500" :
                          row.status === "removed" ? "bg-red-400" :
                          "bg-yellow-500";
                        return (
                          <tr key={i} className={bg}>
                            <td className="px-3 py-2">
                              <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />
                            </td>
                            <td className="px-4 py-2 text-xs text-muted">{CATEGORY_LABELS[row.category as BomCategory] ?? row.category}</td>
                            <td className="px-4 py-2">{row.brand || "—"}</td>
                            <td className="px-4 py-2 font-medium">{row.model || "—"}</td>
                            <td className="px-4 py-2 text-muted text-xs">{row.description}</td>
                            <td className="px-4 py-2 text-xs">
                              {row.status === "unchanged" ? String(row.qtyB ?? "—") :
                               row.status === "added" ? <span className="text-green-600 dark:text-green-400">{String(row.qtyB ?? "—")}</span> :
                               row.status === "removed" ? <span className="text-red-500">{String(row.qtyA ?? "—")}</span> : (
                                <span>
                                  <span className={String(row.qtyA) !== String(row.qtyB) ? "line-through text-red-500" : ""}>{String(row.qtyA ?? "—")}</span>
                                  {String(row.qtyA) !== String(row.qtyB) && <>{" "}<span className="text-green-600 dark:text-green-400">{String(row.qtyB ?? "—")}</span></>}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-xs">
                              {row.status === "unchanged" ? String(row.specB ?? "—") :
                               row.status === "added" ? <span className="text-green-600 dark:text-green-400">{String(row.specB ?? "—")}</span> :
                               row.status === "removed" ? <span className="text-red-500">{String(row.specA ?? "—")}</span> : (
                                <span>
                                  <span className={String(row.specA ?? "") !== String(row.specB ?? "") ? "line-through text-red-500" : ""}>{String(row.specA ?? "—")}</span>
                                  {String(row.specA ?? "") !== String(row.specB ?? "") && <>{" "}<span className="text-green-600 dark:text-green-400">{String(row.specB ?? "—")}</span></>}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {diffRows.every((r) => r.status === "unchanged") && (
                        <tr>
                          <td colSpan={7} className="px-5 py-6 text-center text-sm text-muted">
                            No differences — these two BOMs are identical.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Unchanged items (collapsed) */}
                {diffRows.some((r) => r.status === "unchanged") && (
                  <details className="border-t border-t-border">
                    <summary className="px-5 py-2 text-xs text-muted cursor-pointer hover:text-foreground select-none">
                      {diffRows.filter((r) => r.status === "unchanged").length} unchanged items (click to expand)
                    </summary>
                    <table className="w-full text-sm opacity-50">
                      <tbody className="divide-y divide-[color:var(--border)]">
                        {diffRows.filter((r) => r.status === "unchanged").map((row, i) => (
                          <tr key={i} className="hover:bg-surface-2">
                            <td className="px-3 py-1.5 w-4"><span className="inline-block w-2 h-2 rounded-full bg-surface-2" /></td>
                            <td className="px-4 py-1.5 text-xs text-muted w-28">{CATEGORY_LABELS[row.category as BomCategory] ?? row.category}</td>
                            <td className="px-4 py-1.5 w-28">{row.brand || "—"}</td>
                            <td className="px-4 py-1.5 w-36 font-medium">{row.model || "—"}</td>
                            <td className="px-4 py-1.5 text-muted text-xs">{row.description}</td>
                            <td className="px-4 py-1.5 text-xs">{String(row.qtyB ?? "—")}</td>
                            <td className="px-4 py-1.5 text-xs">{String(row.specB ?? "—")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                )}
              </div>
            )}

            {/* BOM Table — grouped by category */}
            {CATEGORY_ORDER.filter((cat) => grouped[cat]?.length).map((cat) => (
              <div key={cat} className="rounded-xl bg-surface border border-t-border shadow-card overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-t-border bg-surface-2">
                  <h3 className={`text-sm font-semibold ${CATEGORY_COLORS[cat]}`}>
                    {CATEGORY_LABELS[cat]}
                  </h3>
                  <button
                    onClick={() => addRow(cat)}
                    className="text-xs text-muted hover:text-foreground px-2 py-1 rounded hover:bg-surface transition-colors"
                  >
                    + Add row
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px] text-sm">
                    <thead>
                      <tr className="text-xs text-muted border-b border-t-border">
                        <th className="text-left px-4 py-2 font-medium w-44">Item</th>
                        <th className="text-left px-4 py-2 font-medium w-[22rem]">Details</th>
                        <th className="text-left px-4 py-2 font-medium w-48">Qty / Spec</th>
                        <th className="text-left px-4 py-2 font-medium w-48">Item Meta</th>
                        <th className="text-left px-3 py-2 font-medium w-32">Deal / Job</th>
                        {catalogSources.length > 0 && (
                          <th className="text-left px-2 py-2 font-medium" colSpan={catalogSources.length}>
                            Catalogs
                          </th>
                        )}
                        <th className="px-3 py-2 w-10"></th>
                      </tr>
                      {catalogSources.length > 0 && (
                        <tr className="text-xs text-muted border-b border-t-border bg-surface-2/50">
                          <th colSpan={5} />
                          {catalogSources.map((src) => (
                            <th key={src} className="px-1 py-1 font-normal text-center w-7" title={SOURCE_DISPLAY_LABELS[src] ?? src}>
                              {SOURCE_SHORT_LABELS[src] ?? src.slice(0, 2).toUpperCase()}
                            </th>
                          ))}
                          <th />
                        </tr>
                      )}
                    </thead>
                    <tbody className="divide-y divide-[color:var(--border)]">
                      {grouped[cat]!.map((item) => {
                        const status = catalogStatus.get(item.id);
                        const missing = status && catalogSources.some((s) => !status[s]);
                        return (
                          <tr
                            key={item.id}
                            className={`hover:bg-surface-2 transition-colors group ${missing ? "bg-yellow-50/30 dark:bg-yellow-900/10" : ""}`}
                          >
                            <td className="px-4 py-1.5">
                              <div className="space-y-1.5">
                                <div className="text-[11px] uppercase tracking-wide text-muted">Category</div>
                                <select
                                  value={item.category}
                                  onChange={(e) => updateItem(item.id, "category", e.target.value as BomCategory)}
                                  className="w-full bg-transparent text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500 rounded px-1 py-0.5 hover:bg-surface-2 focus:bg-surface-2 transition-colors"
                                >
                                  {CATEGORY_ORDER.map((option) => (
                                    <option key={option} value={option} className="bg-surface text-foreground">
                                      {CATEGORY_LABELS[option]}
                                    </option>
                                  ))}
                                </select>
                                <div className="text-[11px] uppercase tracking-wide text-muted">Brand</div>
                                <EditableCell
                                  value={item.brand || ""}
                                  onChange={(v) => updateItem(item.id, "brand", v)}
                                  placeholder="Brand"
                                />
                                <div className="text-[11px] uppercase tracking-wide text-muted">Model</div>
                                <EditableCell
                                  value={item.model || ""}
                                  onChange={(v) => updateItem(item.id, "model", v)}
                                  placeholder="Model"
                                />
                              </div>
                            </td>
                            <td className="px-4 py-1.5">
                              <div className="space-y-2">
                                <div>
                                  <div className="text-[11px] uppercase tracking-wide text-muted mb-1">Description</div>
                                  <EditableTextAreaCell
                                    value={item.description}
                                    onChange={(v) => updateItem(item.id, "description", v)}
                                    placeholder="Description"
                                    className="min-h-[48px]"
                                  />
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-1.5">
                              <div className="grid grid-cols-3 gap-2 items-end">
                                <div>
                                  <div className="text-[11px] uppercase tracking-wide text-muted mb-1">Qty</div>
                                  <EditableCell
                                    value={String(item.qty)}
                                    onChange={(v) => updateItem(item.id, "qty", v)}
                                    placeholder="Qty"
                                    className="w-14"
                                  />
                                </div>
                                <div>
                                  <div className="text-[11px] uppercase tracking-wide text-muted mb-1">Spec</div>
                                  <EditableCell
                                    value={item.unitSpec != null ? String(item.unitSpec) : ""}
                                    onChange={(v) => updateItem(item.id, "unitSpec", v)}
                                    placeholder="—"
                                    className="w-20"
                                  />
                                </div>
                                <div>
                                  <div className="text-[11px] uppercase tracking-wide text-muted mb-1">Label</div>
                                  <EditableCell
                                    value={item.unitLabel ?? ""}
                                    onChange={(v) => updateItem(item.id, "unitLabel", v)}
                                    placeholder="Unit"
                                    className="w-16"
                                  />
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-1.5 text-xs text-muted">
                                <div className="space-y-1.5">
                                <div>
                                  <div className="text-[11px] uppercase tracking-wide text-muted mb-1">Source</div>
                                  <EditableCell
                                    value={item.source || ""}
                                    onChange={(v) => updateItem(item.id, "source", v)}
                                    placeholder="source"
                                  />
                                </div>
                                <div>
                                  <div className="text-[11px] uppercase tracking-wide text-muted mb-1">Flags</div>
                                  <EditableCell
                                    value={item.flags?.join(", ") || ""}
                                    onChange={(v) => updateItemFlags(item.id, v)}
                                    placeholder="comma,separated"
                                  />
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-1.5">
                              <div className="flex items-center gap-1.5">
                                <button
                                  onClick={() => handleAddHubspotDealLineItem(item)}
                                  disabled={!linkedProject?.hs_object_id || rowActionBusyKey === `hs:${item.id}`}
                                  className="text-[11px] px-2 py-1 rounded border border-t-border text-foreground hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed"
                                  title={linkedProject?.hs_object_id ? "Add line item to linked HubSpot deal" : "Link a HubSpot project first"}
                                >
                                  {rowActionBusyKey === `hs:${item.id}` ? "Adding…" : "HS +"}
                                </button>
                                <button
                                  onClick={() => handleAddZuperJobPart(item)}
                                  disabled={!linkedProject?.zuperUid || rowActionBusyKey === `zu:${item.id}`}
                                  className="text-[11px] px-2 py-1 rounded border border-t-border text-foreground hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed"
                                  title={linkedProject?.zuperUid ? "Add part to linked Zuper job" : "Linked project has no Zuper job"}
                                >
                                  {rowActionBusyKey === `zu:${item.id}` ? "Adding…" : "ZU +"}
                                </button>
                              </div>
                            </td>
                            {catalogSources.map((src) => (
                              <td key={src} className="px-1 py-1.5 text-center w-7">
                                <span className="relative inline-flex items-center justify-center w-5 h-5">
                                  <CatalogDot present={status?.[src]} loading={catalogLoading} />
                                  {!status?.[src] && !catalogLoading && (
                                    <button
                                      onClick={() => setPushItem({
                                        brand: item.brand ?? "",
                                        model: item.model ?? "",
                                        description: item.description,
                                        category: item.category,
                                        unitSpec: item.unitSpec,
                                        unitLabel: item.unitLabel,
                                        dealId: linkedProject?.hs_object_id,
                                      })}
                                      className="absolute -top-1.5 -right-1.5 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] leading-none font-semibold text-cyan-600 dark:text-cyan-400 hover:text-cyan-500 bg-surface border border-t-border rounded px-0.5"
                                      title="Add to missing catalog"
                                    >
                                      +
                                    </button>
                                  )}
                                </span>
                              </td>
                            ))}
                            <td className="px-3 py-1.5">
                              <button
                                onClick={() => deleteItem(item.id)}
                                className="opacity-0 group-hover:opacity-100 text-muted hover:text-red-500 transition-all text-xs p-1 rounded"
                                aria-label="Delete row"
                              >
                                ✕
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}

            {items.some((i) => !CATEGORY_ORDER.includes(i.category as BomCategory)) && (
              <div className="text-xs text-muted">
                ⚠️ Some items have unrecognized categories and are not shown.
              </div>
            )}
          </>
        )}
      </div>
      <PushToSystemsModal
        item={pushItem}
        onClose={() => setPushItem(null)}
      />
      <BomHistoryDrawer
        open={historyDrawerOpen}
        onClose={() => setHistoryDrawerOpen(false)}
        onSelect={(snap: BomSnapshotGlobal) => {
          if (linkedProject?.hs_object_id === snap.dealId) {
            // Already on this deal — directly reload history and load the latest snapshot
            setHistoryLoading(true);
            fetch(`/api/bom/history?dealId=${encodeURIComponent(snap.dealId)}`)
              .then((r) => r.ok ? r.json() : Promise.reject(r.status))
              .then((data: { snapshots: BomSnapshot[] }) => {
                setSnapshots(data.snapshots);
                if (data.snapshots.length > 0) {
                  const latest = data.snapshots[0];
                  loadBomData(latest.bomData);
                  setSavedVersion(latest.version);
                  setZohoPoId(latest.zohoPoId ?? null);
                  setZohoSoId(latest.zohoSoId ?? null);
                }
              })
              .catch(() => {/* silent */})
              .finally(() => setHistoryLoading(false));
          } else {
            // Different deal — navigate and let the history useEffect auto-load
            router.push(`/dashboards/bom?deal=${snap.dealId}&load=latest`);
          }
        }}
      />
      </DashboardShell>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                      */
/* ------------------------------------------------------------------ */

function EditableCell({
  value,
  onChange,
  placeholder,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full bg-transparent text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500 rounded px-1 py-0.5 hover:bg-surface-2 focus:bg-surface-2 transition-colors ${className}`}
    />
  );
}

function EditableTextAreaCell({
  value,
  onChange,
  placeholder,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={2}
      className={`w-full min-h-[56px] bg-transparent text-foreground text-sm leading-5 focus:outline-none focus:ring-1 focus:ring-cyan-500 rounded px-1.5 py-1 hover:bg-surface-2 focus:bg-surface-2 transition-colors resize-y ${className}`}
    />
  );
}

function ValidationBadge({ value, label }: { value: boolean | null; label: string }) {
  if (value === true) {
    return (
      <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
        <span>✅</span>
        <span>{label}</span>
      </div>
    );
  }
  if (value === false) {
    return (
      <div className="flex items-center gap-1.5 text-red-500">
        <span>❌</span>
        <span>{label}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 text-muted">
      <span>⚪</span>
      <span>{label}</span>
    </div>
  );
}

function QuickLinks({ project }: { project: ProjectResult }) {
  const links: Array<{ label: string; href: string; color: string }> = [
    {
      label: "HubSpot",
      href: `https://app.hubspot.com/contacts/21710069/deal/${project.hs_object_id}`,
      color: "text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-800",
    },
  ];

  if (project.driveUrl) {
    links.push({ label: "G-Drive", href: project.driveUrl, color: "text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800" });
  }
  if (project.designFolderUrl) {
    const raw = project.designFolderUrl.trim();
    let designHref = raw;
    const folderMatch = raw.match(/\/folders\/([a-zA-Z0-9_-]{10,})/);
    if (folderMatch?.[1]) {
      designHref = `https://drive.google.com/drive/folders/${folderMatch[1]}`;
    } else if (/^[a-zA-Z0-9_-]{10,}$/.test(raw)) {
      designHref = `https://drive.google.com/drive/folders/${raw}`;
    } else if (raw.startsWith("drive.google.com/")) {
      designHref = `https://${raw}`;
    }
    links.push({
      label: "Design Folder",
      href: designHref,
      color: "text-sky-600 dark:text-sky-400 border-sky-200 dark:border-sky-800",
    });
  }
  if (project.openSolarUrl) {
    links.push({ label: "OpenSolar", href: project.openSolarUrl, color: "text-yellow-600 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800" });
  }
  if (project.zuperUid) {
    links.push({ label: "Zuper", href: `https://web.zuperpro.com/jobs/${project.zuperUid}/details`, color: "text-cyan-600 dark:text-cyan-400 border-cyan-200 dark:border-cyan-800" });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {links.map(({ label, href, color }) => (
        <a
          key={label}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center gap-1 px-3 py-1 rounded-lg border text-xs font-medium bg-surface hover:bg-surface-2 transition-colors ${color}`}
        >
          {label} ↗
        </a>
      ))}
    </div>
  );
}

function CatalogDot({ present, loading }: { present?: boolean; loading?: boolean }) {
  if (loading) {
    return <span className="inline-block w-1.5 h-1.5 rounded-full bg-surface-2 animate-pulse" />;
  }
  if (present === undefined) {
    return <span className="text-muted text-xs">—</span>;
  }
  return present ? (
    <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" title="In catalog" />
  ) : (
    <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-400" title="Not in catalog" />
  );
}

export default function BomDashboard() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64 text-muted text-sm">Loading…</div>}>
      <BomDashboardInner />
    </Suspense>
  );
}
