/**
 * Analyze Zoho Inventory products — list all items with properties
 * and identify potential duplicates.
 *
 * Usage: npx tsx scripts/analyze-zoho-products.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config(); // also load .env as fallback

const BASE_URL =
  process.env.ZOHO_INVENTORY_API_BASE_URL ||
  "https://www.zohoapis.com/inventory/v1";
const ORG_ID = process.env.ZOHO_INVENTORY_ORG_ID!;

// ---------- Token management ----------

let currentToken = process.env.ZOHO_INVENTORY_ACCESS_TOKEN || "";

async function refreshToken(): Promise<string> {
  const refreshTok = process.env.ZOHO_INVENTORY_REFRESH_TOKEN;
  const clientId = process.env.ZOHO_INVENTORY_CLIENT_ID;
  const clientSecret = process.env.ZOHO_INVENTORY_CLIENT_SECRET;
  if (!refreshTok || !clientId || !clientSecret) {
    throw new Error("Missing refresh token credentials");
  }
  const accountsUrl =
    process.env.ZOHO_ACCOUNTS_BASE_URL || "https://accounts.zoho.com";
  const params = new URLSearchParams({
    refresh_token: refreshTok,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });
  const res = await fetch(`${accountsUrl}/oauth/v2/token?${params}`, {
    method: "POST",
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Token refresh failed");
  currentToken = data.access_token;
  return currentToken;
}

async function zohoFetch(path: string, attempt = 0): Promise<any> {
  if (!currentToken) await refreshToken();
  const url = `${BASE_URL}${path}${path.includes("?") ? "&" : "?"}organization_id=${ORG_ID}`;
  const res = await fetch(url, {
    headers: { Authorization: `Zoho-oauthtoken ${currentToken}` },
  });
  if (res.status === 401 && attempt === 0) {
    await refreshToken();
    return zohoFetch(path, 1);
  }
  if (res.status === 429 && attempt < 3) {
    const wait = Math.pow(2, attempt) * 1000;
    console.log(`  Rate limited, waiting ${wait}ms...`);
    await new Promise((r) => setTimeout(r, wait));
    return zohoFetch(path, attempt + 1);
  }
  if (!res.ok) throw new Error(`Zoho ${res.status}: ${await res.text()}`);
  return res.json();
}

// ---------- Fetch all items ----------

interface ZohoItem {
  item_id: string;
  name: string;
  sku: string;
  description: string;
  status: string;
  stock_on_hand: number;
  available_stock: number;
  rate: number;
  purchase_rate: number;
  part_number: string;
  vendor_id: string;
  vendor_name: string;
  unit: string;
  group_id?: string;
  group_name?: string;
  brand?: string;
  manufacturer?: string;
  category_id?: string;
  category_name?: string;
  item_type?: string;
  product_type?: string;
  is_combo_product?: boolean;
  reorder_level?: number;
  // Additional fields from API
  created_time?: string;
  last_modified_time?: string;
  upc?: string | number;
  ean?: string | number;
  isbn?: string | number;
  has_attachment?: boolean;
  image_name?: string;
  image_document_id?: string;
  source?: string;
  purchase_description?: string;
  purchase_account_name?: string;
  account_name?: string;
  is_returnable?: boolean;
  is_taxable?: boolean;
  tax_name?: string;
  tax_percentage?: number;
  purchase_tax_name?: string;
  purchase_tax_percentage?: number;
  item_tax_preferences?: any[];
  actual_available_stock?: number;
  committed_stock?: number;
  actual_committed_stock?: number;
}

async function fetchAllItems(): Promise<ZohoItem[]> {
  const all: ZohoItem[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    process.stdout.write(`  Fetching page ${page}...`);
    const data = await zohoFetch(`/items?page=${page}&per_page=200`);
    const items = data.items || [];
    all.push(...items);
    process.stdout.write(` ${items.length} items\n`);
    hasMore = data.page_context?.has_more_page === true;
    page++;
  }

  return all;
}

// ---------- Duplicate detection ----------

function normalize(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, " ")  // keep underscores for preserved compound tokens
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pre-process a product name to preserve compound sizes as single tokens
 * BEFORE generic normalization strips the special characters.
 *
 * Examples:
 *   '1-1/2"'  → 'SIZE_1_1o2'
 *   '2-1/2"'  → 'SIZE_2_1o2'
 *   '3/4"'    → 'SIZE_3o4'
 *   '1/2'     → 'SIZE_1o2'
 *   '#10'     → 'GAUGE_10'
 *   '20A'     → 'AMP_20'
 *   '240V'    → 'VOLT_240'
 */
function preserveCompoundTokens(name: string): string {
  let s = name;

  // ── Compound terms (must come before fraction/size processing) ──

  // Non-fusible / nonfusible / non-fused → NONFUSED (so "non" doesn't float as separate token)
  s = s.replace(/\bnon[\s-]*fus(?:ible|ed)\b/gi, "NONFUSED");

  // "Set Screw" → SET_SCREW (to distinguish from "compression" couplings)
  s = s.replace(/\bset[\s-]*screw\b/gi, "SET_SCREW");

  // Box Adapter → BOX_ADAPTER (to distinguish from plain "adapter")
  s = s.replace(/\bbox\s+adapt[eo]r\b/gi, "BOX_ADAPTER");

  // Angle degrees: 45°, 90°, 45 Deg, 90D → ANGLE_45, ANGLE_90
  s = s.replace(/\b(\d+)\s*[°]\s*/g, "ANGLE_$1 ");
  s = s.replace(/\b(\d+)\s*(?:deg(?:ree)?s?|[Dd](?=[^a-zA-Z]))\b/gi, "ANGLE_$1");

  // Model series: XR10, XR 100, XR1000 → MODEL_XR10, MODEL_XR100 (handles optional space)
  s = s.replace(/\bXR\s*(\d+)\b/gi, (_, n) => `MODEL_XR${n}`);
  s = s.replace(/\bPW\s*(\d+)\b/gi, (_, n) => `MODEL_PW${n}`);
  s = s.replace(/\bIQ\s*(\d+[A-Z]*)\b/gi, (_, n) => `MODEL_IQ${n.toUpperCase()}`);

  // ── Sizes & measurements ──

  // Compound fractions with whole part: 1-1/2", 2-1/2, 3-3/4"
  s = s.replace(/(\d+)\s*-\s*(\d+)\s*\/\s*(\d+)\s*["'""]?/g, "SIZE_$1_$2o$3");

  // Simple fractions: 3/4", 1/2, 1/2"
  s = s.replace(/(\d+)\s*\/\s*(\d+)\s*["'""]?/g, "SIZE_$1o$2");

  // Bare dimension with inch/foot mark: 1", 2", 10', but NOT in the middle of a word
  s = s.replace(/\b(\d+(?:\.\d+)?)\s*["'""](?=[^a-z]|$)/gi, "SIZE_$1");

  // ── Electrical measurements ──

  // Wire gauge: #10, #6, #12
  s = s.replace(/#(\d+)\b/g, "GAUGE_$1");

  // Amperage: 20A, 30A, 200A (but not "A" as part of a word)
  s = s.replace(/\b(\d+)\s*[Aa](?:mp)?s?\b/g, "AMP_$1");

  // Voltage: 120V, 240V, 600V
  s = s.replace(/\b(\d+)\s*[Vv](?:olt)?s?\b/g, "VOLT_$1");

  // Wattage: 300W, 400W
  s = s.replace(/\b(\d+)\s*[Ww](?:att)?s?\b/g, "WATT_$1");

  // AWG: 10AWG, 6AWG
  s = s.replace(/\b(\d+)\s*(?:AWG|awg|ga|gauge)\b/gi, "GAUGE_$1");

  return s;
}

// Stop words: only truly meaningless filler words
const STOP_WORDS = new Set([
  "with", "for", "and", "the", "set", "kit", "type", "series",
  "each", "per", "pcs", "piece", "box", "bag", "pack",
]);

/** Get all tokens from a name (keep sizes, colors, model numbers — skip only filler) */
function meaningfulTokens(name: string): string[] {
  // First preserve compound sizes/gauges/amps as single tokens, then normalize
  const preserved = preserveCompoundTokens(name);
  return normalize(preserved)
    .split(" ")
    .filter((t) => t.length >= 1 && !STOP_WORDS.has(t));
}

/** Token overlap similarity between two names */
function tokenSimilarity(nameA: string, nameB: string): number {
  const tokA = meaningfulTokens(nameA);
  const tokB = meaningfulTokens(nameB);
  if (tokA.length === 0 || tokB.length === 0) return 0;
  const setA = new Set(tokA);
  const shared = tokB.filter((t) => setA.has(t)).length;
  const maxLen = Math.max(tokA.length, tokB.length);
  return shared / maxLen;
}

// ---------- Critical differentiator logic ----------
// If two product names differ ONLY by a size, color, wire gauge, or amperage,
// they are different products regardless of overall token similarity.

/** Patterns that indicate a token is a critical differentiator */
const SIZE_PATTERNS = [
  // Fractional sizes: 1/2, 3/4, 1-1/4, etc.
  /^\d+\/\d+$/,
  /^\d+\s*\d+\/\d+$/,
  // Dimension with unit: 1", 2', 3ft, 10mm, 4in, etc.
  /^\d+(\.\d+)?("|'|ft|in|mm|cm|m)$/i,
  // Bare dimensions that are common sizes: 1, 2, 3, 4, 6, 8, 10, 12, etc.
  // (handled contextually below)
];

const WIRE_GAUGE_PATTERN = /^(\d+)\s*(awg|ga|gauge)$/i;
const WIRE_GAUGE_BARE = /^#?\d{1,2}$/; // bare number in wire context

const AMPERAGE_PATTERNS = [
  /^(\d+)\s*a(mp)?s?$/i,      // 20A, 30amp, 200amps
  /^(\d+)\s*amp$/i,
];

const VOLTAGE_PATTERNS = [
  /^(\d+)\s*v(olt)?s?$/i,     // 120V, 240volt, 600V
  /^(\d+)\s*kv$/i,
];

const WATTAGE_PATTERNS = [
  /^(\d+)\s*w(att)?s?$/i,     // 300W, 400watt
  /^(\d+)\s*kw$/i,
];

const COLOR_WORDS = new Set([
  "black", "white", "red", "green", "blue", "gray", "grey",
  "brown", "orange", "yellow", "purple", "pink", "clear",
  "copper", "silver", "gold",
]);

// Finish variants (mill vs dark vs clear) — critical differentiators
const FINISH_WORDS = new Set([
  "mill", "clr", "dark", "drk", "blk", "anodized", "galvanized",
  "stainless", "painted", "raw", "bronze",
]);

// Part-type words: if one item has "connector" and the other has "coupling", they're different parts
const PART_TYPE_WORDS = new Set([
  "connector", "conn", "coupling", "coup", "adapter", "adaptor",
  "mount", "bracket", "strap", "clamp", "bushing", "nipple",
  "hub", "locknut", "reducer",
  "assembly", "fasteners", "fastener",  // different part types
]);

// Position/orientation words: front vs rear, mids vs ends, etc.
const POSITION_WORDS = new Set([
  "front", "rear", "back",
  "left", "right",
  "top", "bottom",
  "mids", "mid", "ends", "end",        // IronRidge clamp positions
  "upper", "lower",
]);

// Conduit body direction types: LL, LR, LB, T, C, X — these are all different pull directions
const CONDUIT_BODY_TYPES = new Set([
  "ll", "lr", "lb", "lt", "lc",
]);

// Material types: EMT vs Rigid vs PVC vs FMC (flex) — different conduit types
const MATERIAL_TYPE_WORDS = new Set([
  "emt", "rigid", "fmc", "lfmc", "flex", "imc",
]);

// Configuration words: if items differ by these, they're different products
const CONFIG_WORDS = new Set([
  "fusible", "fused", "nonfused",   // fusible vs non-fusible/non-fused
  "indoor", "outdoor",              // installation location
  "single", "twin", "dual", "double", "triple", "tandem", // pole configuration
  "slim", "thin",                   // breaker form factor (slim/thin vs full size)
  "straight",                       // connector orientation (90d handled by ANGLE_ prefix)
  "lug",                            // panel type: main lug vs main breaker
  "compression", "set_screw",       // coupling subtypes
]);

// Model number series: XR10 vs XR100 vs XR1000 (IronRidge), etc.
const MODEL_SERIES_PATTERNS = [
  /^xr(\d+)$/i,        // IronRidge: XR10, XR100, XR1000
  /^pw(\d+)$/i,        // Tesla Powerwall: PW2, PW3
  /^iq(\d+)$/i,        // Enphase: IQ7, IQ8
  /^hom(\d+)/i,        // Square D Homeline models
  /^qo(\d+)/i,         // Square D QO models
];

// Angle variants: 45° vs 90° are different products (elbows, sweeps, connectors)
const ANGLE_PATTERN = /^(\d+)(d|deg|°)?$/i;  // 45, 90, 45d, 90d
const KNOWN_ANGLES = new Set(["45", "90", "22", "30", "60"]);

const CONDUIT_SIZE_CONTEXT = new Set([
  "pvc", "emt", "conduit", "pipe", "coupling", "connector",
  "elbow", "adapter", "fitting", "bushing", "nipple", "strap",
  "hub", "bell", "sweep",
]);

const WIRE_CONTEXT = new Set([
  "wire", "cable", "thhn", "thwn", "xhhw", "use", "nm",
  "romex", "mc", "uf", "ser", "seu", "conductor", "ground",
  "grounding", "awg",
]);

const BREAKER_CONTEXT = new Set([
  "breaker", "circuit", "gfci", "afci", "disconnect", "fuse",
  "switch", "panel", "subpanel", "load", "main",
]);

/**
 * Check if the DIFFERING tokens between two names contain critical
 * differentiators (size, color, gauge, amperage). If so, these items
 * are NOT duplicates even if overall similarity is high.
 */
function hasCriticalDifference(nameA: string, nameB: string): boolean {
  const tokA = meaningfulTokens(nameA);
  const tokB = meaningfulTokens(nameB);
  const setA = new Set(tokA);
  const setB = new Set(tokB);

  // Tokens unique to each name
  const onlyA = tokA.filter((t) => !setB.has(t));
  const onlyB = tokB.filter((t) => !setA.has(t));

  if (onlyA.length === 0 && onlyB.length === 0) return false; // identical tokens

  // Check what context words are present (shared tokens give us context)
  const allTokens = new Set([...tokA, ...tokB]);
  const hasConduitContext = [...allTokens].some((t) => CONDUIT_SIZE_CONTEXT.has(t));
  const hasWireContext = [...allTokens].some((t) => WIRE_CONTEXT.has(t));
  const hasBreakerContext = [...allTokens].some((t) => BREAKER_CONTEXT.has(t));

  function isCriticalToken(tok: string): string | null {
    // Preserved compound tokens from preserveCompoundTokens()
    if (tok.startsWith("size_")) return "size";
    if (tok.startsWith("gauge_")) return "wire_gauge";
    if (tok.startsWith("amp_")) return "amperage";
    if (tok.startsWith("volt_")) return "voltage";
    if (tok.startsWith("watt_")) return "wattage";
    if (tok.startsWith("angle_")) return "angle";
    if (tok.startsWith("model_")) return "model_series";
    if (tok === "nonfused") return "configuration";
    if (tok === "box_adapter") return "part_type";
    if (tok === "set_screw") return "configuration";

    // Color
    if (COLOR_WORDS.has(tok)) return "color";

    // Finish: mill vs dark vs clr
    if (FINISH_WORDS.has(tok)) return "finish";

    // Part type: connector vs coupling vs adapter vs mount
    if (PART_TYPE_WORDS.has(tok)) return "part_type";

    // Conduit body direction: LL vs LR vs LB
    if (CONDUIT_BODY_TYPES.has(tok)) return "conduit_body_dir";

    // Material type: EMT vs Rigid vs FMC
    if (MATERIAL_TYPE_WORDS.has(tok)) return "material_type";

    // Configuration: fusible/non-fusible, indoor/outdoor, single/twin/dual, slim/full, straight/90d
    if (CONFIG_WORDS.has(tok)) return "configuration";

    // Position/orientation: front vs rear, mids vs ends
    if (POSITION_WORDS.has(tok)) return "position";

    // Model number series: XR10 vs XR100 vs XR1000, PW2 vs PW3, etc.
    if (MODEL_SERIES_PATTERNS.some((p) => p.test(tok))) return "model_series";

    // Angle variants: 45 vs 90 (when in conduit/elbow context)
    const angleMatch = ANGLE_PATTERN.exec(tok);
    if (angleMatch && KNOWN_ANGLES.has(angleMatch[1]) && hasConduitContext) return "angle";

    // Amperage: 20a, 30amp, 200a (if not caught by preserveCompoundTokens)
    if (AMPERAGE_PATTERNS.some((p) => p.test(tok))) return "amperage";

    // Voltage: 120v, 240v
    if (VOLTAGE_PATTERNS.some((p) => p.test(tok))) return "voltage";

    // Wattage: 300w, 400w
    if (WATTAGE_PATTERNS.some((p) => p.test(tok))) return "wattage";

    // Wire gauge: 10awg, #6, 12ga
    if (WIRE_GAUGE_PATTERN.test(tok)) return "wire_gauge";

    // Bare numbers in size/gauge context
    if (/^\d+$/.test(tok)) {
      if (hasConduitContext) return "size";
      if (hasWireContext) return "wire_gauge";
      if (hasBreakerContext) return "amperage";
    }

    return null;
  }

  // Check if differing tokens contain critical differentiators
  const criticalA = onlyA.map((t) => isCriticalToken(t)).filter(Boolean);
  const criticalB = onlyB.map((t) => isCriticalToken(t)).filter(Boolean);

  // If both sides have the same type of critical differentiator → NOT a dupe
  // e.g., SIZE_1 on one side, SIZE_2 on the other → different sizes
  const typesA = new Set(criticalA);
  const typesB = new Set(criticalB);
  for (const typeA of typesA) {
    if (typesB.has(typeA)) return true;
  }

  // If ANY unique token on either side is a critical differentiator, these
  // are different products. E.g., one has "slim" and the other doesn't —
  // a slim breaker is NOT the same as a full-size breaker.
  if (criticalA.length > 0 || criticalB.length > 0) return true;

  return false;
}

interface DuplicateGroup {
  reason: string;
  items: ZohoItem[];
}

function findDuplicates(items: ZohoItem[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];

  // 1. Exact name duplicates
  const byName = new Map<string, ZohoItem[]>();
  for (const item of items) {
    const key = normalize(item.name);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(item);
  }
  for (const [name, group] of byName) {
    if (group.length > 1) {
      groups.push({
        reason: `Exact name match: "${name}"`,
        items: group,
      });
    }
  }

  // 2. Same SKU (non-empty)
  const bySku = new Map<string, ZohoItem[]>();
  for (const item of items) {
    if (!item.sku) continue;
    const key = normalize(item.sku);
    if (!key) continue;
    if (!bySku.has(key)) bySku.set(key, []);
    bySku.get(key)!.push(item);
  }
  for (const [sku, group] of bySku) {
    if (group.length > 1) {
      const nameKeys = group.map((i) => normalize(i.name));
      const allSameName = nameKeys.every((n) => n === nameKeys[0]);
      if (!allSameName) {
        groups.push({
          reason: `Same SKU: "${sku}"`,
          items: group,
        });
      }
    }
  }

  // 3. Same part_number (non-empty)
  const byPartNum = new Map<string, ZohoItem[]>();
  for (const item of items) {
    if (!item.part_number) continue;
    const key = normalize(item.part_number);
    if (!key) continue;
    if (!byPartNum.has(key)) byPartNum.set(key, []);
    byPartNum.get(key)!.push(item);
  }
  for (const [pn, group] of byPartNum) {
    if (group.length > 1) {
      const nameKeys = group.map((i) => normalize(i.name));
      const allSameName = nameKeys.every((n) => n === nameKeys[0]);
      if (!allSameName) {
        groups.push({
          reason: `Same part number: "${pn}"`,
          items: group,
        });
      }
    }
  }

  return groups;
}

// ---------- Fuzzy duplicate detection (per-item, best match) ----------

interface FuzzyDupeResult {
  bestMatchName: string;
  bestMatchId: string;
  similarity: number;
  matchReason: string;
}

/**
 * For each item, find its best fuzzy match among other items.
 * Returns a map of item_id → best fuzzy match info.
 * Only includes matches with 65%+ meaningful token overlap
 * that aren't already caught by exact matching.
 */
function buildFuzzyDupeMap(
  items: ZohoItem[],
  exactDupeIds: Set<string>,
): Map<string, FuzzyDupeResult> {
  const results = new Map<string, FuzzyDupeResult>();
  const active = items.filter((i) => i.status === "active");

  // Build inverted index of meaningful tokens → item indices
  const tokenIndex = new Map<string, Set<number>>();
  const itemTokens: string[][] = [];
  for (let i = 0; i < active.length; i++) {
    const toks = meaningfulTokens(active[i].name);
    itemTokens.push(toks);
    for (const tok of toks) {
      if (!tokenIndex.has(tok)) tokenIndex.set(tok, new Set());
      tokenIndex.get(tok)!.add(i);
    }
  }

  // For each item, find candidates that share at least one meaningful token
  for (let i = 0; i < active.length; i++) {
    if (itemTokens[i].length < 3) continue; // need 3+ meaningful tokens to avoid short-name false positives

    let bestSim = 0;
    let bestIdx = -1;

    const candidates = new Set<number>();
    for (const tok of itemTokens[i]) {
      const peers = tokenIndex.get(tok);
      if (peers) for (const j of peers) if (j !== i) candidates.add(j);
    }

    for (const j of candidates) {
      // Skip if both are already in the same exact dupe group
      const nI = normalize(active[i].name);
      const nJ = normalize(active[j].name);
      if (nI === nJ) continue; // exact match, already handled

      const setI = new Set(itemTokens[i]);
      const shared = itemTokens[j].filter((t) => setI.has(t)).length;
      const maxLen = Math.max(itemTokens[i].length, itemTokens[j].length);
      const sim = shared / maxLen;

      if (sim > bestSim && sim >= 0.80) {
        // Check critical differentiators — reject if items differ by size/color/gauge/amp
        if (hasCriticalDifference(active[i].name, active[j].name)) continue;
        bestSim = sim;
        bestIdx = j;
      }
    }

    if (bestIdx >= 0) {
      results.set(active[i].item_id, {
        bestMatchName: active[bestIdx].name,
        bestMatchId: active[bestIdx].item_id,
        similarity: bestSim,
        matchReason: `${Math.round(bestSim * 100)}% token overlap`,
      });
    }
  }

  return results;
}

// ---------- CSV helpers ----------

function csvEsc(val: string | number | undefined | null): string {
  const s = String(val ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(cells: (string | number | undefined | null)[]): string {
  return cells.map(csvEsc).join(",");
}

// ---------- QuickBooks matching ----------

interface QBMatch {
  qbName: string;
  qbSku: string;
  qbExternalId: string;
  qbPrice: number | null;
  matchType: string; // "SKU" | "Name"
}

async function fetchQBProducts(): Promise<Map<string, QBMatch>> {
  try {
    const { PrismaClient } = await import("../src/generated/prisma/client");
    const { PrismaNeon } = await import("@prisma/adapter-neon");
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      console.log("  DATABASE_URL not set — skipping QB matching");
      return new Map();
    }
    const adapter = new PrismaNeon({ connectionString });
    const prisma = new PrismaClient({ adapter });

    const qbProducts = await prisma.catalogProduct.findMany({
      where: { source: "QUICKBOOKS" },
    });
    await prisma.$disconnect();

    console.log(`  Loaded ${qbProducts.length} QB products from database`);

    // Build indexes: normalized name → QB product, normalized SKU → QB product
    const byName = new Map<string, typeof qbProducts[0][]>();
    const bySku = new Map<string, typeof qbProducts[0][]>();
    for (const qb of qbProducts) {
      const nn = normalize(qb.name || "");
      if (nn) {
        if (!byName.has(nn)) byName.set(nn, []);
        byName.get(nn)!.push(qb);
      }
      const ns = normalize(qb.sku || "");
      if (ns) {
        if (!bySku.has(ns)) bySku.set(ns, []);
        bySku.get(ns)!.push(qb);
      }
    }

    return { byName, bySku } as any; // pass both maps via closure below
  } catch (err) {
    console.log(`  QB matching failed: ${err}`);
    return new Map();
  }
}

interface FuzzyQBMatch extends QBMatch {
  similarity: number;
}

function matchZohoToQB(
  zohoItem: ZohoItem,
  qbByName: Map<string, any[]>,
  qbBySku: Map<string, any[]>,
  allQBProducts?: any[],
): { exact: QBMatch | null; fuzzy: FuzzyQBMatch | null } {
  // --- Exact matching ---
  let exact: QBMatch | null = null;
  const zohoSku = normalize(zohoItem.sku || "");
  if (zohoSku) {
    const skuMatches = qbBySku.get(zohoSku);
    if (skuMatches?.length === 1) {
      exact = {
        qbName: skuMatches[0].name || "",
        qbSku: skuMatches[0].sku || "",
        qbExternalId: skuMatches[0].externalId,
        qbPrice: skuMatches[0].price,
        matchType: "SKU",
      };
    }
  }
  if (!exact) {
    const zohoName = normalize(zohoItem.name || "");
    if (zohoName) {
      const nameMatches = qbByName.get(zohoName);
      if (nameMatches?.length === 1) {
        exact = {
          qbName: nameMatches[0].name || "",
          qbSku: nameMatches[0].sku || "",
          qbExternalId: nameMatches[0].externalId,
          qbPrice: nameMatches[0].price,
          matchType: "Name",
        };
      }
    }
  }

  // --- Fuzzy matching (only if no exact match and QB products available) ---
  let fuzzy: FuzzyQBMatch | null = null;
  if (!exact && allQBProducts && allQBProducts.length > 0) {
    const zohoTokens = meaningfulTokens(zohoItem.name);
    if (zohoTokens.length >= 3) {
      let bestSim = 0;
      let bestQB: any = null;
      for (const qb of allQBProducts) {
        const sim = tokenSimilarity(zohoItem.name, qb.name || "");
        if (sim > bestSim && sim >= 0.55) {
          // Check critical differentiators — reject if items differ by size/color/gauge/amp
          if (hasCriticalDifference(zohoItem.name, qb.name || "")) continue;
          bestSim = sim;
          bestQB = qb;
        }
      }
      if (bestQB) {
        fuzzy = {
          qbName: bestQB.name || "",
          qbSku: bestQB.sku || "",
          qbExternalId: bestQB.externalId,
          qbPrice: bestQB.price,
          matchType: `Fuzzy (${Math.round(bestSim * 100)}%)`,
          similarity: bestSim,
        };
      }
    }
  }

  return { exact, fuzzy };
}

// ---------- Main ----------

async function main() {
  console.log("Fetching all Zoho Inventory items...\n");
  const items = await fetchAllItems();

  const active = items.filter((i) => i.status === "active");
  console.log(`\nTotal: ${items.length} (${active.length} active, ${items.length - active.length} inactive)`);

  // ── Fetch QB products for cross-reference ──
  console.log("\nLoading QuickBooks products...");
  let qbByName = new Map<string, any[]>();
  let qbBySku = new Map<string, any[]>();
  let allQBProducts: any[] = [];
  try {
    const { PrismaClient } = await import("../src/generated/prisma/client");
    const { PrismaNeon } = await import("@prisma/adapter-neon");
    const connectionString = process.env.DATABASE_URL;
    if (connectionString) {
      const adapter = new PrismaNeon({ connectionString });
      const prisma = new PrismaClient({ adapter });
      allQBProducts = await prisma.catalogProduct.findMany({
        where: { source: "QUICKBOOKS" },
      });
      await prisma.$disconnect();
      console.log(`  Loaded ${allQBProducts.length} QB products`);

      for (const qb of allQBProducts) {
        const nn = normalize(qb.name || "");
        if (nn) {
          if (!qbByName.has(nn)) qbByName.set(nn, []);
          qbByName.get(nn)!.push(qb);
        }
        const ns = normalize(qb.sku || "");
        if (ns) {
          if (!qbBySku.has(ns)) qbBySku.set(ns, []);
          qbBySku.get(ns)!.push(qb);
        }
      }
    } else {
      console.log("  DATABASE_URL not set — skipping QB matching");
    }
  } catch (err) {
    console.log(`  QB matching unavailable: ${err}`);
  }

  // ── Build duplicate lookup ──
  const dupes = findDuplicates(items);

  // Map item_id → duplicate group info (only exact name + same SKU + same PN)
  const highConfDupes = dupes.filter(
    (d) => !d.reason.startsWith("Similar")
  );

  // ── Build fuzzy dupe map (per-item best fuzzy match) ──
  console.log("\nBuilding fuzzy duplicate map...");
  const exactDupeIds = new Set<string>();
  for (const group of highConfDupes) {
    for (const item of group.items) exactDupeIds.add(item.item_id);
  }
  const fuzzyDupeMap = buildFuzzyDupeMap(items, exactDupeIds);
  console.log(`  Found ${fuzzyDupeMap.size} fuzzy duplicate candidates`);
  const itemDupeMap = new Map<string, { groupId: number; reason: string }>();
  highConfDupes.forEach((group, idx) => {
    for (const item of group.items) {
      // If already in a group, append
      const existing = itemDupeMap.get(item.item_id);
      if (existing) {
        itemDupeMap.set(item.item_id, {
          groupId: existing.groupId,
          reason: existing.reason + " + " + group.reason,
        });
      } else {
        itemDupeMap.set(item.item_id, { groupId: idx + 1, reason: group.reason });
      }
    }
  });

  // ── Pre-compute recommendations so we can use them for sort order ──
  const itemRecommendation = new Map<string, string>();
  for (const [itemId, dupe] of itemDupeMap) {
    const group = highConfDupes[dupe.groupId - 1];
    if (!group) continue;
    const item = group.items.find((gi) => gi.item_id === itemId)!;
    const activeItems = group.items.filter((gi) => gi.status === "active");
    if (item.status !== "active" && activeItems.length > 0) {
      itemRecommendation.set(itemId, "Remove (inactive duplicate)");
    } else if (activeItems.length > 1) {
      const highestStock = [...activeItems].sort(
        (x, y) => (Number(y.stock_on_hand) || 0) - (Number(x.stock_on_hand) || 0)
      )[0];
      itemRecommendation.set(
        itemId,
        item.item_id === highestStock.item_id ? "KEEP (highest stock)" : "Merge into other"
      );
    }
  }

  // ── Build sort order: duplicates grouped together at top, KEEP first within each group ──
  const sorted = [...items].sort((a, b) => {
    const dupeA = itemDupeMap.get(a.item_id);
    const dupeB = itemDupeMap.get(b.item_id);
    const groupA = dupeA ? dupeA.groupId : Infinity;
    const groupB = dupeB ? dupeB.groupId : Infinity;

    // Dupes first, grouped together
    if (groupA !== groupB) return groupA - groupB;

    // Within same dupe group: KEEP item always first
    if (groupA !== Infinity && groupA === groupB) {
      const recA = itemRecommendation.get(a.item_id) || "";
      const recB = itemRecommendation.get(b.item_id) || "";
      const keepA = recA.startsWith("KEEP") ? 0 : recA.startsWith("Merge") ? 1 : 2;
      const keepB = recB.startsWith("KEEP") ? 0 : recB.startsWith("Merge") ? 1 : 2;
      if (keepA !== keepB) return keepA - keepB;
    }

    // Active before inactive
    if (a.status !== b.status) return a.status === "active" ? -1 : 1;

    // Then by category
    const catA = (a.category_name || "zzz").toLowerCase();
    const catB = (b.category_name || "zzz").toLowerCase();
    if (catA !== catB) return catA.localeCompare(catB);

    return a.name.localeCompare(b.name);
  });

  // ── Count filled properties per item for a "data completeness" score ──
  const completenessFields = [
    "description", "part_number", "vendor_name", "brand",
    "manufacturer", "category_name", "rate", "purchase_rate",
  ] as const;

  function dataCompleteness(i: ZohoItem): number {
    let filled = 0;
    for (const f of completenessFields) {
      const v = (i as any)[f];
      if (v !== undefined && v !== null && v !== "" && v !== 0) filled++;
    }
    return filled;
  }

  // ── Single sheet: All Products with dupes grouped at top ──
  const header = csvRow([
    "Duplicate Group",
    "Match Type",
    "Recommendation",
    "Zoho Item ID",
    "Name",
    "SKU",
    "Part Number",
    "Status",
    "Category",
    "Brand",
    "Manufacturer",
    "Sell Price",
    "Cost",
    "Stock On Hand",
    "Available Stock",
    "Committed Stock",
    "Actual Available Stock",
    "Unit",
    "Description",
    "Purchase Description",
    "Item Type",
    "Product Type",
    "Reorder Level",
    "Is Combo",
    "Group Name",
    // IDs & barcodes
    "UPC",
    "EAN",
    "ISBN",
    // Tax & accounting
    "Is Taxable",
    "Tax Name",
    "Tax %",
    "Purchase Tax Name",
    "Purchase Tax %",
    "Sales Account",
    "Purchase Account",
    "Is Returnable",
    // Metadata
    "Source",
    "Has Attachment",
    "Image",
    "Created",
    "Last Modified",
    // Fuzzy Zoho duplicate
    "Fuzzy Dupe?",
    "Fuzzy Dupe Match",
    "Fuzzy Dupe Similarity",
    // QuickBooks cross-reference (exact)
    "QB Exact Match",
    "QB Exact Type",
    "QB Exact Name",
    "QB Exact SKU",
    "QB Exact ID",
    "QB Exact Price",
    // QuickBooks cross-reference (fuzzy)
    "QB Fuzzy Match",
    "QB Fuzzy Name",
    "QB Fuzzy SKU",
    "QB Fuzzy ID",
    "QB Fuzzy Similarity",
    // Data quality
    "Data Completeness",
    "Has Description",
    "Has Part #",
    "Has Brand",
    "Has Manufacturer",
    "Has Cost",
    "Has Sell Price",
    "Has Vendor",
    // Action columns for team
    "Action (team)",
    "Keep? (team)",
    "Notes (team)",
  ]);

  const rows = sorted.map((i) => {
    const dupe = itemDupeMap.get(i.item_id);
    const recommendation = dupe ? (itemRecommendation.get(i.item_id) || "") : "";

    let matchType = "";
    if (dupe) {
      if (dupe.reason.includes("Exact")) matchType = "Exact Name";
      else if (dupe.reason.includes("SKU")) matchType = "Same SKU";
      else if (dupe.reason.includes("part")) matchType = "Same Part #";
      if (dupe.reason.includes(" + ")) matchType = "Multiple";
    }

    const score = dataCompleteness(i);
    const yesNo = (v: any) => (v !== undefined && v !== null && v !== "" && v !== 0) ? "YES" : "";
    const { exact: qbExact, fuzzy: qbFuzzy } = matchZohoToQB(i, qbByName, qbBySku, allQBProducts);
    const fuzzyDupe = fuzzyDupeMap.get(i.item_id);

    return csvRow([
      dupe ? `Group ${dupe.groupId}` : "",
      matchType,
      recommendation,
      i.item_id,
      i.name,
      i.sku,
      i.part_number || "",
      i.status,
      i.category_name || "",
      i.brand || "",
      i.manufacturer || "",
      i.rate || "",
      i.purchase_rate || "",
      i.stock_on_hand || "",
      i.available_stock || "",
      i.committed_stock || "",
      i.actual_available_stock || "",
      i.unit || "",
      (i.description || "").slice(0, 300),
      (i.purchase_description || "").slice(0, 300),
      i.item_type || "",
      i.product_type || "",
      i.reorder_level || "",
      i.is_combo_product ? "YES" : "",
      i.group_name || "",
      // IDs & barcodes
      i.upc || "",
      i.ean || "",
      i.isbn || "",
      // Tax & accounting
      i.is_taxable ? "YES" : "",
      i.tax_name || "",
      i.tax_percentage || "",
      i.purchase_tax_name || "",
      i.purchase_tax_percentage || "",
      i.account_name || "",
      i.purchase_account_name || "",
      i.is_returnable ? "YES" : "",
      // Metadata
      i.source || "",
      i.has_attachment ? "YES" : "",
      i.image_name || "",
      i.created_time || "",
      i.last_modified_time || "",
      // Fuzzy Zoho duplicate
      fuzzyDupe ? "YES" : "",
      fuzzyDupe?.bestMatchName || "",
      fuzzyDupe ? `${Math.round(fuzzyDupe.similarity * 100)}%` : "",
      // QuickBooks exact
      qbExact ? "YES" : "",
      qbExact?.matchType || "",
      qbExact?.qbName || "",
      qbExact?.qbSku || "",
      qbExact?.qbExternalId || "",
      qbExact?.qbPrice || "",
      // QuickBooks fuzzy
      qbFuzzy ? "YES" : "",
      qbFuzzy?.qbName || "",
      qbFuzzy?.qbSku || "",
      qbFuzzy?.qbExternalId || "",
      qbFuzzy ? `${Math.round(qbFuzzy.similarity * 100)}%` : "",
      // Data quality
      `${score}/${completenessFields.length}`,
      yesNo(i.description),
      yesNo(i.part_number),
      yesNo(i.brand),
      yesNo(i.manufacturer),
      yesNo(i.purchase_rate && Number(i.purchase_rate) > 0 ? i.purchase_rate : ""),
      yesNo(i.rate && Number(i.rate) > 0 ? i.rate : ""),
      yesNo(i.vendor_name),
      "", // Action — blank for team
      "", // Keep? — blank for team
      "", // Notes — blank for team
    ]);
  });

  // ── Sheet 3: Data Quality Summary ──
  const qualityHeader = csvRow(["Property", "Filled", "Total", "Coverage %", "Notes"]);
  const propChecks: [string, (i: ZohoItem) => boolean, string][] = [
    ["name", (i) => !!i.name, "Always present"],
    ["sku", (i) => !!i.sku, "Always present"],
    ["category_name", (i) => !!i.category_name, "Good — most items categorized"],
    ["purchase_rate (cost)", (i) => !!(i.purchase_rate && Number(i.purchase_rate) > 0), "~500 items missing cost"],
    ["rate (sell price)", (i) => !!(i.rate && Number(i.rate) > 0), "40% items missing sell price"],
    ["stock_on_hand", (i) => !!(i.stock_on_hand && Number(i.stock_on_hand) > 0), ""],
    ["manufacturer", (i) => !!i.manufacturer, "Very sparse"],
    ["brand", (i) => !!i.brand, "Very sparse"],
    ["description", (i) => !!i.description, "Almost empty — only 7%"],
    ["part_number", (i) => !!i.part_number, "Only 85 items"],
    ["vendor_name", (i) => !!i.vendor_name, "ZERO items have vendor assigned"],
    ["unit", (i) => !!i.unit, "Nearly universal"],
  ];
  const qualityRows = propChecks.map(([name, check, notes]) => {
    const filled = items.filter(check).length;
    return csvRow([name, filled, items.length, ((filled / items.length) * 100).toFixed(1) + "%", notes]);
  });

  // ── Sheet 4: Category Breakdown ──
  const catHeader = csvRow(["Category", "Active Items", "Inactive Items", "Total", "Has Cost %", "Has Sell Price %"]);
  const catMap = new Map<string, ZohoItem[]>();
  for (const item of items) {
    const cat = item.category_name || "(uncategorized)";
    if (!catMap.has(cat)) catMap.set(cat, []);
    catMap.get(cat)!.push(item);
  }
  const catRows = [...catMap.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([cat, catItems]) => {
      const activeCount = catItems.filter((i) => i.status === "active").length;
      const inactiveCount = catItems.length - activeCount;
      const hasCost = catItems.filter((i) => i.purchase_rate && Number(i.purchase_rate) > 0).length;
      const hasPrice = catItems.filter((i) => i.rate && Number(i.rate) > 0).length;
      return csvRow([
        cat,
        activeCount,
        inactiveCount,
        catItems.length,
        ((hasCost / catItems.length) * 100).toFixed(0) + "%",
        ((hasPrice / catItems.length) * 100).toFixed(0) + "%",
      ]);
    });

  // ── Question-format CSV: Present fuzzy matches as yes/no decisions ──
  console.log("\nBuilding match review questionnaire...");

  const questionHeader = csvRow([
    "#",
    "Question Type",
    "Question",
    "Item A — Name",
    "Item A — SKU",
    "Item A — Category",
    "Item A — Cost",
    "Item A — Sell Price",
    "Item A — Stock",
    "Item A — Status",
    "Item A — ID",
    "Item B — Name",
    "Item B — SKU",
    "Item B — Category",
    "Item B — Cost",
    "Item B — Sell Price",
    "Item B — Stock",
    "Item B — Status",
    "Item B — ID",
    "Similarity",
    "Match Reason",
    "Same Item? (YES/NO)",
    "Action If Same",
    "Notes (team)",
  ]);

  // Build rows into separate arrays for ops vs accounting split files
  const opsRows: string[] = [];       // Zoho dupes + confirmed dupes (for ops)
  const acctRows: string[] = [];      // QB fuzzy matches (for accounting)
  const allQuestionRows: string[] = []; // Combined for the full review sheet
  let qNum = 0;
  let opsNum = 0;
  let acctNum = 0;

  // ── Pre-confirmed fuzzy duplicate pairs (from previous human review) ──
  // Map of sorted item_id pair key → "YES" | "NO"
  const confirmedPairs = new Map<string, { answer: string; note: string }>([
    // Previously reviewed YES — confirmed same product
    [["5385454000002448249", "5385454000003063851"].sort().join("|"), { answer: "YES", note: "Confirmed: reordered name tokens" }],   // 2" PVC Coupling = PVC COUPLING 2''
    [["5385454000006134529", "5385454000003063893"].sort().join("|"), { answer: "YES", note: "Confirmed: reordered name tokens" }],   // 2'' SLIP METER RISER = SLIP METER RISER 2''
    [["5385454000002603009", "5385454000003124634"].sort().join("|"), { answer: "YES", note: "Confirmed: brand placement differs" }],  // 2-1/2" Diamond Plus Hole Saw
    [["5385454000000932755", "5385454000003068385"].sort().join("|"), { answer: "YES", note: "Confirmed: reordered name" }],           // 2.5" Plastic Bushing
    [["5385454000001286105", "5385454000009527149"].sort().join("|"), { answer: "YES", note: "Confirmed: name formatting differs" }],  // Eaton 200A LOADCENTER
    [["5385454000000167254", "5385454000001104083"].sort().join("|"), { answer: "YES", note: "Confirmed: reordered name tokens" }],    // 3/4" 1 hole EMT Strap
    [["5385454000007436154", "5385454000002818378"].sort().join("|"), { answer: "YES", note: "Confirmed: reordered name tokens" }],    // 3/4" Rigid 1-Hole Strap
    [["5385454000005637491", "5385454000000167574"].sort().join("|"), { answer: "YES", note: "Confirmed: spool info differs" }],       // #10 THHN STR RED 500R
    [["5385454000001869019", "5385454000006136646"].sort().join("|"), { answer: "YES", note: "Confirmed: formatting differs" }],       // 1.25" SCH 40 PVC
    [["5385454000002499119", "5385454000006136667"].sort().join("|"), { answer: "YES", note: "Confirmed: formatting differs" }],       // 1.25" SCH 80 PVC
    [["5385454000002452109", "5385454000009527278"].sort().join("|"), { answer: "YES", note: "Confirmed: reordered + extra word" }],   // 2 In.; Threaded; Locknut
  ]);

  // Helper to build a question row (returns raw cell array)
  function questionCells(
    num: number, type: string, question: string,
    a: { name: string; sku?: string; category_name?: string; purchase_rate?: number; rate?: number; stock_on_hand?: number; status: string; item_id: string },
    b: { name: string; sku?: string; category_name?: string; purchase_rate?: number | string; rate?: number | string; stock_on_hand?: number | string; status: string; item_id: string },
    similarity: string, matchReason: string,
    prefill?: { answer: string; note: string },
  ) {
    return [
      num, type, question,
      a.name, a.sku || "", a.category_name || "", a.purchase_rate || "", a.rate || "", a.stock_on_hand || "", a.status, a.item_id,
      b.name, b.sku || "", b.category_name || "", b.purchase_rate || "", b.rate || "", b.stock_on_hand || "", b.status, b.item_id,
      similarity, matchReason,
      prefill?.answer || "", // YES/NO pre-filled or blank
      prefill ? "Merge → keep higher stock" : "", // Action
      prefill?.note || "", // Notes
    ];
  }

  // Section 1: Zoho-to-Zoho fuzzy duplicates (deduplicate bidirectional pairs)
  const sortedFuzzy = [...fuzzyDupeMap.entries()]
    .sort((a, b) => b[1].similarity - a[1].similarity);
  const seenPairs = new Set<string>();

  for (const [itemId, match] of sortedFuzzy) {
    const pairKey = [itemId, match.bestMatchId].sort().join("|");
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);

    const itemA = items.find((i) => i.item_id === itemId);
    const itemB = items.find((i) => i.item_id === match.bestMatchId);
    if (!itemA || !itemB) continue;

    qNum++;
    opsNum++;
    const q = `Is "${itemA.name}" the same product as "${itemB.name}"?`;
    const sim = `${Math.round(match.similarity * 100)}%`;
    const prefill = confirmedPairs.get(pairKey);
    allQuestionRows.push(csvRow(questionCells(qNum, "Zoho Duplicate?", q, itemA, itemB, sim, match.matchReason, prefill)));
    opsRows.push(csvRow(questionCells(opsNum, "Zoho Duplicate?", q, itemA, itemB, sim, match.matchReason, prefill)));
  }

  // Section 2: Zoho-to-QB fuzzy matches
  for (const item of items) {
    if (item.status !== "active") continue;
    const { exact, fuzzy } = matchZohoToQB(item, qbByName, qbBySku, allQBProducts);
    if (exact || !fuzzy) continue;

    qNum++;
    acctNum++;
    const q = `Is Zoho "${item.name}" the same as QB "${fuzzy.qbName}"?`;
    const sim = `${Math.round(fuzzy.similarity * 100)}%`;
    const bSide = { name: fuzzy.qbName, sku: fuzzy.qbSku, category_name: "(QuickBooks)", purchase_rate: "", rate: fuzzy.qbPrice || "", stock_on_hand: "", status: "", item_id: fuzzy.qbExternalId };
    allQuestionRows.push(csvRow(questionCells(qNum, "QB Match?", q, item, bSide, sim, fuzzy.matchType)));
    acctRows.push(csvRow(questionCells(acctNum, "QB Match?", q, item, bSide, sim, fuzzy.matchType)));
  }

  // Section 3: Exact Zoho duplicates (for confirmation) → goes to ops file
  for (const group of highConfDupes) {
    if (group.items.length < 2) continue;
    const keep = group.items.find((gi) =>
      (itemRecommendation.get(gi.item_id) || "").startsWith("KEEP")
    ) || group.items[0];
    for (const other of group.items) {
      if (other.item_id === keep.item_id) continue;
      qNum++;
      opsNum++;
      const q = `"${keep.name}" and "${other.name}" appear to be exact duplicates. Merge?`;
      allQuestionRows.push(csvRow(questionCells(qNum, "Confirmed Duplicate", q, keep, other, "100%", group.reason)));
      opsRows.push(csvRow(questionCells(opsNum, "Confirmed Duplicate", q, keep, other, "100%", group.reason)));
    }
  }

  console.log(`  Generated ${qNum} review questions (${seenPairs.size} fuzzy dupes, ${acctNum} QB matches, ${opsNum - seenPairs.size} confirmed dupes)`);

  // ── Write files ──
  const { writeFileSync } = await import("fs");
  const outDir = "/Users/zach/Downloads";

  // Main products sheet (dupes grouped at top)
  writeFileSync(
    `${outDir}/zoho-products-all.csv`,
    [header, ...rows].join("\n")
  );

  // Data quality sheet
  writeFileSync(
    `${outDir}/zoho-products-data-quality.csv`,
    [qualityHeader, ...qualityRows].join("\n")
  );

  // Category breakdown sheet
  writeFileSync(
    `${outDir}/zoho-products-categories.csv`,
    [catHeader, ...catRows].join("\n")
  );

  // Question-format review sheet (combined)
  writeFileSync(
    `${outDir}/zoho-products-match-review.csv`,
    [questionHeader, ...allQuestionRows].join("\n")
  );

  // Split files with independent numbering
  writeFileSync(
    `${outDir}/zoho-duplicate-review-ops.csv`,
    [questionHeader, ...opsRows].join("\n")
  );
  writeFileSync(
    `${outDir}/zoho-qb-match-review-accounting.csv`,
    [questionHeader, ...acctRows].join("\n")
  );

  const dupeItemCount = [...itemDupeMap.keys()].length;
  const exactQBCount = sorted.filter((i) => matchZohoToQB(i, qbByName, qbBySku, allQBProducts).exact).length;
  const fuzzyQBCount = sorted.filter((i) => {
    const r = matchZohoToQB(i, qbByName, qbBySku, allQBProducts);
    return !r.exact && r.fuzzy;
  }).length;

  console.log(`\n✅ Exported 6 CSV files to ${outDir}/:`);
  console.log(`   zoho-products-all.csv              — ${sorted.length} items, ${highConfDupes.length} dupe groups, ${fuzzyDupeMap.size} fuzzy dupes`);
  console.log(`   zoho-products-match-review.csv      — ${qNum} questions for team review (combined)`);
  console.log(`   zoho-duplicate-review-ops.csv       — ${opsNum} questions for ops (Zoho dupes + confirmed)`);
  console.log(`   zoho-qb-match-review-accounting.csv — ${acctNum} questions for accounting (QB matches)`);
  console.log(`   zoho-products-data-quality.csv      — Property coverage summary`);
  console.log(`   zoho-products-categories.csv        — ${catMap.size} categories breakdown`);
  console.log(`\n  QB matching: ${exactQBCount} exact, ${fuzzyQBCount} fuzzy, ${sorted.length - exactQBCount - fuzzyQBCount} no match`);
  console.log(`\nImport each as a tab in Google Sheets.`);
  console.log(`Fill in "Same Item? (YES/NO)" in the match-review sheet to confirm or reject matches.`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
