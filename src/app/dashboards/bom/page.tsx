"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import DashboardShell from "@/components/DashboardShell";
import { exportToCSV } from "@/lib/export";
import { useToast } from "@/contexts/ToastContext";
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
  hubspot: ComparableProduct | null;
  zuper: ComparableProduct | null;
  zoho: ComparableProduct | null;
  reasons: string[];
  isMismatch: boolean;
}

interface ProductComparisonResponse {
  rows: ComparisonRow[];
  health: Record<"hubspot" | "zuper" | "zoho", { configured: boolean; count: number; error: string | null }>;
}

// Per-BOM-item catalog presence
interface CatalogStatus {
  hubspot: boolean;
  zuper: boolean;
  zoho: boolean;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                           */
/* ------------------------------------------------------------------ */

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

/** Build a map of BOM item id → CatalogStatus from the comparison rows */
function buildCatalogStatus(
  items: BomItem[],
  rows: ComparisonRow[]
): Map<string, CatalogStatus> {
  const result = new Map<string, CatalogStatus>();

  for (const item of items) {
    let inHubSpot = false;
    let inZuper = false;
    let inZoho = false;

    for (const row of rows) {
      const hsMatch = row.hubspot && productMatchesBomItem(row.hubspot, item);
      const zuMatch = row.zuper && productMatchesBomItem(row.zuper, item);
      const zoMatch = row.zoho && productMatchesBomItem(row.zoho, item);
      if (hsMatch) inHubSpot = true;
      if (zuMatch) inZuper = true;
      if (zoMatch) inZoho = true;
      if (inHubSpot && inZuper && inZoho) break;
    }

    result.set(item.id, { hubspot: inHubSpot, zuper: inZuper, zoho: inZoho });
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
/*  Component                                                           */
/* ------------------------------------------------------------------ */

type ImportTab = "upload" | "drive" | "paste";

export default function BomDashboard() {
  const { addToast } = useToast();

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

  // Product catalog comparison data
  const [comparisonRows, setComparisonRows] = useState<ComparisonRow[]>([]);
  const [catalogHealth, setCatalogHealth] = useState<ProductComparisonResponse["health"] | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  // Derived catalog status per BOM item
  const [catalogStatus, setCatalogStatus] = useState<Map<string, CatalogStatus>>(new Map());

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
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setExtracting(false);
      setUploadProgress("");
    }
  }, [uploadFile, loadBomData, safeFetchBom, addToast]);

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
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Drive extraction failed");
    } finally {
      setExtracting(false);
    }
  }, [driveUrl, loadBomData, safeFetchBom, addToast]);

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
          const data = await res.json();
          setProjectResults(data.projects || []);
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
        in_hubspot: status?.hubspot ? "yes" : "no",
        in_zuper: status?.zuper ? "yes" : "no",
        in_zoho: status?.zoho ? "yes" : "no",
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
      lines.push("| Brand | Model | Description | Qty | Spec | HubSpot | Zuper | Zoho |");
      lines.push("|-------|-------|-------------|-----|------|---------|-------|------|");
      for (const item of catItems) {
        const flags = item.flags?.length ? ` ⚠️ ${item.flags.join(", ")}` : "";
        const status = catalogStatus.get(item.id);
        const hs = status?.hubspot ? "✅" : "—";
        const zu = status?.zuper ? "✅" : "—";
        const zo = status?.zoho ? "✅" : "—";
        lines.push(
          `| ${item.brand || "—"} | ${item.model || "—"} | ${item.description}${flags} | ${item.qty} | ${item.unitSpec || ""} ${item.unitLabel || ""} | ${hs} | ${zu} | ${zo} |`
        );
      }
      lines.push("");
    }

    await navigator.clipboard.writeText(lines.join("\n"));
    addToast({ type: "success", title: "Markdown copied to clipboard" });
  }, [items, bom, catalogStatus, addToast]);

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
    return s && (!s.hubspot || !s.zuper || !s.zoho);
  }).length;

  return (
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
                    {(["hubspot", "zuper", "zoho"] as const).map((src) => {
                      const health = catalogHealth[src];
                      const found = items.filter((i) => catalogStatus.get(i.id)?.[src]).length;
                      return (
                        <div key={src} className="flex items-center justify-between gap-2 text-sm">
                          <span className="text-muted capitalize">{src === "hubspot" ? "HubSpot" : src === "zoho" ? "Zoho" : "Zuper"}</span>
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
                <div className="flex items-center gap-3">
                  <span className="text-sm text-foreground">
                    ✅ <span className="font-medium">{linkedProject.dealname}</span>
                  </span>
                  <button
                    onClick={() => setLinkedProject(null)}
                    className="text-xs text-muted hover:text-foreground"
                  >
                    Unlink
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search by project name or address…"
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
                            setProjectSearch("");
                            setProjectResults([]);
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
            </div>

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
                        <th className="text-left px-4 py-2 font-medium w-32" colSpan={3}>
                          Catalogs
                        </th>
                        <th className="px-3 py-2 w-10"></th>
                      </tr>
                      <tr className="text-xs text-muted border-b border-t-border bg-surface-2/50">
                        <th colSpan={6} />
                        <th className="px-2 py-1 font-normal text-center w-10">HS</th>
                        <th className="px-2 py-1 font-normal text-center w-10">ZU</th>
                        <th className="px-2 py-1 font-normal text-center w-10">ZO</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[color:var(--border)]">
                      {grouped[cat]!.map((item) => {
                        const status = catalogStatus.get(item.id);
                        const missing = status && (!status.hubspot || !status.zuper || !status.zoho);
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
                            <td className="px-2 py-1.5 text-center">
                              <CatalogDot present={status?.hubspot} loading={catalogLoading} />
                            </td>
                            <td className="px-2 py-1.5 text-center">
                              <CatalogDot present={status?.zuper} loading={catalogLoading} />
                            </td>
                            <td className="px-2 py-1.5 text-center">
                              <CatalogDot present={status?.zoho} loading={catalogLoading} />
                            </td>
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
