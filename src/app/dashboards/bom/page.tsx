"use client";

import React, { useState, useCallback, useRef, useEffect, Suspense } from "react";
import DashboardShell from "@/components/DashboardShell";
import { exportToCSV } from "@/lib/export";
import { useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/contexts/ToastContext";
import { useSession } from "next-auth/react";
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

// Per-BOM-item catalog presence — keyed by source name
type CatalogStatus = Record<string, boolean>;

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

type ImportTab = "upload" | "drive" | "paste";

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
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // History / snapshots
  const [snapshots, setSnapshots] = useState<BomSnapshot[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedVersion, setSavedVersion] = useState<number | null>(null);
  // Diff / compare
  const [compareA, setCompareA] = useState<BomSnapshot | null>(null);
  const [compareB, setCompareB] = useState<BomSnapshot | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const diffRows = compareA && compareB ? diffBoms(compareA.bomData.items, compareB.bomData.items) : [];

  // Product catalog comparison data
  const [comparisonRows, setComparisonRows] = useState<ComparisonRow[]>([]);
  const [catalogHealth, setCatalogHealth] = useState<ProductComparisonResponse["health"] | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);

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

    fetch("/api/products/comparison")
      .then((res) => {
        if (!res.ok) throw new Error(`Catalog fetch failed (${res.status})`);
        return res.json() as Promise<ProductComparisonResponse>;
      })
      .then((data) => {
        setComparisonRows(data.rows);
        setCatalogHealth(data.health);
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
    if (!dealId || linkedProject) return;
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
      .catch(() => {/* silent — bad param, just ignore */});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  /* ---- Load history when a project is linked ---- */
  useEffect(() => {
    if (!linkedProject) { setSnapshots([]); setSavedVersion(null); return; }
    setHistoryLoading(true);
    fetch(`/api/bom/history?dealId=${encodeURIComponent(linkedProject.hs_object_id)}`)
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((data: { snapshots: BomSnapshot[] }) => setSnapshots(data.snapshots))
      .catch(() => {/* silent */})
      .finally(() => setHistoryLoading(false));
  }, [linkedProject]);

  /* ---- Load Drive design files when project has a design folder ---- */
  useEffect(() => {
    const folderId = linkedProject?.designFolderUrl;
    if (!folderId) { setDriveFiles([]); return; }
    setDriveFilesLoading(true);
    setDriveFilesError(null);
    fetch(`/api/bom/drive-files?folderId=${encodeURIComponent(folderId)}`)
      .then((r) => r.json())
      .then((data: { files: DriveFile[]; error?: string }) => {
        setDriveFiles(data.files ?? []);
        if (data.error) setDriveFilesError(data.error);
      })
      .catch(() => setDriveFilesError("Failed to load design files"))
      .finally(() => setDriveFilesLoading(false));
  }, [linkedProject?.designFolderUrl]);

  /* ---- Save snapshot helper ---- */
  const saveSnapshot = useCallback(async (bomData: BomData, sourceFile?: string, blobUrl?: string) => {
    if (!linkedProject) return;
    setSaving(true);
    try {
      const res = await fetch("/api/bom/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId: linkedProject.hs_object_id,
          dealName: linkedProject.dealname,
          bomData,
          sourceFile,
          blobUrl,
        }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      const saved = await res.json() as { id: string; version: number; createdAt: string };
      setSavedVersion(saved.version);
      // Reload history list
      const histRes = await fetch(`/api/bom/history?dealId=${encodeURIComponent(linkedProject.hs_object_id)}`);
      if (histRes.ok) {
        const histData = await histRes.json() as { snapshots: BomSnapshot[] };
        setSnapshots(histData.snapshots);
      }
      addToast({ type: "success", title: `BOM v${saved.version} saved to ${linkedProject.dealname}` });
      // Fire-and-forget email notification
      if (session?.user?.email) {
        fetch("/api/bom/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userEmail: session.user.email,
            dealName: linkedProject.dealname,
            dealId: linkedProject.hs_object_id,
            version: saved.version,
            sourceFile,
            itemCount: bomData.items.length,
            projectInfo: {
              customer: bomData.project?.customer,
              address: bomData.project?.address,
              systemSizeKwdc: bomData.project?.systemSizeKwdc,
              moduleCount: bomData.project?.moduleCount,
            },
          }),
        }).catch(() => {/* silent */});
      }
    } catch (e) {
      addToast({ type: "error", title: e instanceof Error ? e.message : "Save failed" });
    } finally {
      setSaving(false);
    }
  }, [linkedProject, addToast, session]);

  /* ---- Load BOM helper ---- */
  const loadBomData = useCallback((data: BomData) => {
    if (!data.items || !Array.isArray(data.items)) {
      throw new Error('Response must have an "items" array');
    }
    setBom(data);
    setItems(assignIds(data.items));
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
  // for Claude to fetch server-side.
  const handleExtractUpload = useCallback(async () => {
    if (!uploadFile) return;
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

      setUploadProgress("Extracting BOM with Claude — this takes 30–60 seconds…");
      const res = await fetch("/api/bom/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blobUrl }),
      });
      const data = await safeFetchBom(res);
      loadBomData(data);
      addToast({ type: "success", title: `BOM extracted from ${uploadFile.name}` });
      // Auto-save snapshot if a project is linked
      if (linkedProject) {
        await saveSnapshot(data, uploadFile.name, blobUrl);
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
      loadBomData(data);
      addToast({ type: "success", title: "BOM extracted from Google Drive" });
      // Auto-save snapshot if a project is linked
      if (linkedProject) {
        await saveSnapshot(data, driveUrl);
      }
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Drive extraction failed");
    } finally {
      setExtracting(false);
    }
  }, [driveUrl, loadBomData, safeFetchBom, addToast, linkedProject, saveSnapshot]);

  /* ---- Extract from a Drive file ID directly (from design files picker) ---- */
  const handleExtractDriveFile = useCallback(async (file: DriveFile) => {
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
      loadBomData(data);
      addToast({ type: "success", title: `BOM extracted from ${file.name}` });
      if (linkedProject) await saveSnapshot(data, file.name, downloadUrl);
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

  /* ---- Editable table ---- */
  const updateItem = useCallback(
    (id: string, field: keyof BomItem, value: string | number | null) => {
      setItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
      );
    },
    []
  );

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

  /* ---- Export CSV ---- */
  const handleExportCsv = useCallback(() => {
    if (!items.length) return;
    const rows = items.map((item) => {
      const status = catalogStatus.get(item.id);
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
  }, [items, bom, catalogStatus]);

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
  }, [items, bom, catalogStatus, addToast]);

  /* ---- Save to Inventory ---- */
  const handleSaveInventory = useCallback(async () => {
    if (!items.length || !bom) return;
    try {
      const res = await fetch("/api/bom/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bom: { ...bom, items: items.map(({ id: _id, ...rest }) => rest) } }),
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
          bomData: { ...bom, items: items.map(({ id: _id, ...rest }) => rest) },
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
        {!bom && (
          <div className="rounded-xl bg-surface border border-t-border shadow-card overflow-hidden">
            {/* Tab bar */}
            <div className="flex border-b border-t-border">
              {(["upload", "drive", "paste"] as ImportTab[]).map((tab) => (
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
            </div>

            <div className="p-6">
              {/* ---- Upload PDF tab ---- */}
              {importTab === "upload" && (
                <div className="space-y-4">
                  <p className="text-sm text-muted">
                    Upload a PB stamped planset PDF. Claude will read all sheets and extract the full BOM automatically.
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
                      Downloading from Drive then extracting with Claude — allow 30–60 seconds.
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
                    skill in Claude Code, then paste the JSON output below.
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
                      setComparisonRows([]);
                      setCatalogStatus(new Map());
                      setSnapshots([]);
                      setSavedVersion(null);
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
                      onClick={() => saveSnapshot({ ...bom, items: items.map(({ id: _id, ...rest }) => rest) })}
                      className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline"
                    >
                      Save current BOM
                    </button>
                  )}
                  <button
                    onClick={() => { setLinkedProject(null); setSnapshots([]); setSavedVersion(null); router.replace("/dashboards/bom"); }}
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
                            setLinkedProject(p);
                            router.replace(`/dashboards/bom?deal=${encodeURIComponent(p.hs_object_id)}`);
                            setProjectSearch("");
                            setProjectResults([]);
                            setSavedVersion(null);
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

            {/* Design Files — from HubSpot design_document_folder_id */}
            {linkedProject?.designFolderUrl && (
              <div className="design-files-panel rounded-xl bg-surface border border-t-border shadow-card overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-t-border bg-surface-2">
                  <h3 className="text-sm font-semibold text-foreground">
                    Design Files
                    {!driveFilesLoading && driveFiles.length > 0 && (
                      <span className="ml-2 text-xs text-muted font-normal">{driveFiles.length} PDF{driveFiles.length !== 1 ? "s" : ""}</span>
                    )}
                  </h3>
                </div>
                {driveFilesLoading ? (
                  <p className="px-5 py-4 text-xs text-muted animate-pulse">Loading files…</p>
                ) : driveFilesError ? (
                  <p className="px-5 py-4 text-xs text-red-500">{driveFilesError}</p>
                ) : driveFiles.length === 0 ? (
                  <p className="px-5 py-4 text-xs text-muted">No PDFs found in design folder.</p>
                ) : (
                  <div className="divide-y divide-[color:var(--border)]">
                    {driveFiles.map((file) => {
                      const isExtracting = extractingDriveFileId === file.id;
                      const anyExtracting = extractingDriveFileId !== null;
                      const sizeKb = file.size ? Math.round(Number(file.size) / 1024) : null;
                      return (
                        <button
                          key={file.id}
                          onClick={() => handleExtractDriveFile(file)}
                          disabled={anyExtracting}
                          className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-surface-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed group"
                        >
                          <span className="text-lg flex-shrink-0">{isExtracting ? "⏳" : "📄"}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-foreground font-medium truncate">{file.name}</p>
                            <p className="text-xs text-muted">
                              {new Date(file.modifiedTime).toLocaleDateString()}
                              {sizeKb && ` · ${sizeKb > 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb} KB`}`}
                            </p>
                          </div>
                          {isExtracting ? (
                            <span className="text-xs text-cyan-500 animate-pulse">Extracting…</span>
                          ) : (
                            <span className="text-xs text-muted opacity-0 group-hover:opacity-100 transition-opacity">Extract →</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

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
                onClick={handleSaveInventory}
                className="px-4 py-2 rounded-lg bg-cyan-600 text-white text-sm font-medium hover:bg-cyan-700 transition-colors"
              >
                ↑ Save to Inventory
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
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-muted border-b border-t-border">
                        <th className="text-left px-4 py-2 font-medium w-32">Brand</th>
                        <th className="text-left px-4 py-2 font-medium w-44">Model</th>
                        <th className="text-left px-4 py-2 font-medium">Description</th>
                        <th className="text-left px-4 py-2 font-medium w-16">Qty</th>
                        <th className="text-left px-4 py-2 font-medium w-24">Spec</th>
                        <th className="text-left px-4 py-2 font-medium w-20">Source</th>
                        {catalogSources.length > 0 && (
                          <th className="text-left px-4 py-2 font-medium" colSpan={catalogSources.length}>
                            Catalogs
                          </th>
                        )}
                        <th className="px-3 py-2 w-10"></th>
                      </tr>
                      {catalogSources.length > 0 && (
                        <tr className="text-xs text-muted border-b border-t-border bg-surface-2/50">
                          <th colSpan={6} />
                          {catalogSources.map((src) => (
                            <th key={src} className="px-2 py-1 font-normal text-center w-10" title={SOURCE_DISPLAY_LABELS[src] ?? src}>
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
                              <EditableCell
                                value={item.brand || ""}
                                onChange={(v) => updateItem(item.id, "brand", v)}
                                placeholder="Brand"
                              />
                            </td>
                            <td className="px-4 py-1.5">
                              <EditableCell
                                value={item.model || ""}
                                onChange={(v) => updateItem(item.id, "model", v)}
                                placeholder="Model"
                              />
                            </td>
                            <td className="px-4 py-1.5">
                              <EditableCell
                                value={item.description}
                                onChange={(v) => updateItem(item.id, "description", v)}
                                placeholder="Description"
                              />
                            </td>
                            <td className="px-4 py-1.5">
                              <EditableCell
                                value={String(item.qty)}
                                onChange={(v) => updateItem(item.id, "qty", v)}
                                placeholder="Qty"
                                className="w-12"
                              />
                            </td>
                            <td className="px-4 py-1.5">
                              <EditableCell
                                value={item.unitSpec != null ? String(item.unitSpec) : ""}
                                onChange={(v) => updateItem(item.id, "unitSpec", v)}
                                placeholder="—"
                              />
                            </td>
                            <td className="px-4 py-1.5 text-muted text-xs">{item.source}</td>
                            {catalogSources.map((src) => (
                              <td key={src} className="px-2 py-1.5 text-center">
                                <CatalogDot present={status?.[src]} loading={catalogLoading} />
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
  if (project.openSolarUrl) {
    links.push({ label: "OpenSolar", href: project.openSolarUrl, color: "text-yellow-600 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800" });
  }
  if (project.zuperUid) {
    links.push({ label: "Zuper", href: `https://app.zuper.co/jobs/${project.zuperUid}`, color: "text-cyan-600 dark:text-cyan-400 border-cyan-200 dark:border-cyan-800" });
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
    return <span className="inline-block w-2 h-2 rounded-full bg-surface-2 animate-pulse" />;
  }
  if (present === undefined) {
    return <span className="text-muted text-xs">—</span>;
  }
  return present ? (
    <span className="inline-block w-2 h-2 rounded-full bg-green-500" title="In catalog" />
  ) : (
    <span className="inline-block w-2 h-2 rounded-full bg-red-400" title="Not in catalog" />
  );
}

export default function BomDashboard() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64 text-muted text-sm">Loading…</div>}>
      <BomDashboardInner />
    </Suspense>
  );
}
