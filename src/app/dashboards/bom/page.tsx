"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import DashboardShell from "@/components/DashboardShell";
import { exportToCSV } from "@/lib/export";
import { useToast } from "@/contexts/ToastContext";

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

export default function BomDashboard() {
  const { addToast } = useToast();

  // BOM state
  const [bom, setBom] = useState<BomData | null>(null);
  const [items, setItems] = useState<BomItem[]>([]);

  // Import
  const [jsonInput, setJsonInput] = useState("");
  const [importError, setImportError] = useState<string | null>(null);

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

  /* ---- Import ---- */
  const handleImport = useCallback(() => {
    setImportError(null);
    try {
      const parsed = JSON.parse(jsonInput.trim()) as BomData;
      if (!parsed.items || !Array.isArray(parsed.items)) {
        throw new Error('JSON must have an "items" array');
      }
      setBom(parsed);
      setItems(assignIds(parsed.items));
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Invalid JSON");
    }
  }, [jsonInput]);

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
          <div className="rounded-xl bg-surface border border-t-border p-6 shadow-card">
            <h2 className="text-lg font-semibold text-foreground mb-1">Import BOM</h2>
            <p className="text-sm text-muted mb-4">
              Run the{" "}
              <code className="bg-surface-2 px-1.5 py-0.5 rounded text-xs">planset-bom</code>{" "}
              skill on a PDF in Claude, then paste the JSON output below. Each line item will be
              checked against HubSpot, Zuper, and Zoho product catalogs.
            </p>
            <textarea
              className="w-full h-48 rounded-lg bg-surface-2 border border-t-border text-foreground text-sm font-mono p-3 resize-y focus:outline-none focus:ring-2 focus:ring-cyan-500"
              placeholder='{ "project": { ... }, "items": [ ... ], "validation": { ... } }'
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
            />
            {importError && (
              <p className="mt-2 text-sm text-red-500">{importError}</p>
            )}
            <button
              onClick={handleImport}
              disabled={!jsonInput.trim()}
              className="mt-3 px-5 py-2 rounded-lg bg-cyan-600 text-white text-sm font-medium hover:bg-cyan-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Load BOM
            </button>
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
