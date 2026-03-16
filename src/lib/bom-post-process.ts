/**
 * BOM Post-Processor
 *
 * Normalizes extracted BOM data and suggests missing items before saving
 * the snapshot.  Runs server-side in /api/bom/history when
 * ENABLE_BOM_POST_PROCESS=true.
 *
 * Design:
 *  - Rules 1-3 NORMALIZE items[] in-place (category, brand, model).
 *    These are safe cosmetic/accuracy fixes — same items, cleaner data.
 *    PO still works because item count/identity/quantities don't change.
 *  - Rule 4 records SUGGESTED qty adjustments as informational corrections
 *    but does NOT mutate item.qty.  This prevents qty changes from silently
 *    propagating to PO/SO creation which reads snapshot items[].
 *  - Rule 5 returns suggestedAdditions[] as a SEPARATE array.  These are
 *    OPS_STANDARD items the planset doesn't include.  They get synced to
 *    internal inventory (EquipmentSku) but do NOT modify items[].
 *  - detectJobContext runs AFTER Rules 1-3 so it sees normalized categories
 *    and models (e.g. PV_MODULE→MODULE, description→model standardization).
 *  - Pure synchronous — no Zoho lookups, no external dependencies.
 */

import {
  type BomProject,
  type BomItem,
  type JobContext,
  detectJobContext,
  normalizedName,
} from "./bom-so-post-process";

// Re-export for convenience
export type { BomProject, BomItem, JobContext };

// ---------------------------------------------------------------------------
// Rules version — bump on every rule change
// ---------------------------------------------------------------------------
export const BOM_RULES_VERSION = "2026-02-27-v2";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BomCorrection {
  action:
    | "category_fix"
    | "brand_fill"
    | "model_standardize"
    | "qty_adjust"
    | "addition_suggested";
  description: string;
  field?: string;
  oldValue?: string | number;
  newValue?: string | number;
  reason: string;
}

export interface BomPostProcessResult {
  items: BomItem[];
  suggestedAdditions: BomItem[];
  corrections: BomCorrection[];
  jobContext: JobContext;
  rulesVersion: string;
}

// ---------------------------------------------------------------------------
// Lookup tables
// ---------------------------------------------------------------------------

const CATEGORY_ALIASES: Record<string, string> = {
  MOUNT: "RACKING",
  MOUNTING: "RACKING",
  ELECTRICAL: "ELECTRICAL_BOS",
  ELEC_BOS: "ELECTRICAL_BOS",
  ELEC: "ELECTRICAL_BOS",
  BOS: "ELECTRICAL_BOS",
  PV_MODULE: "MODULE",
  SOLAR_MODULE: "MODULE",
  STORAGE: "BATTERY",
  ESS: "BATTERY",
};

const MODEL_TO_BRAND: Array<{ pattern: RegExp; brand: string }> = [
  // ── Tesla part numbers ──
  { pattern: /^1707000/, brand: "Tesla" },
  { pattern: /^1807000/, brand: "Tesla" },
  { pattern: /^1624171/, brand: "Tesla" },
  { pattern: /^1841000/, brand: "Tesla" },
  { pattern: /^1978069|^1978070/, brand: "Tesla" },
  { pattern: /^1875157/, brand: "Tesla" },
  { pattern: /^1734411/, brand: "Tesla" },
  { pattern: /^2045796|^P2045794|^P2060713/, brand: "Tesla" },
  { pattern: /^MCI-2/i, brand: "Tesla" },
  // ── Enphase ──
  { pattern: /IQ8|Q-12-RAW|IQ-COMBINER/i, brand: "Enphase" },
  { pattern: /^Q-SEAL|^Q-TERM/i, brand: "Enphase" },
  // ── Panel manufacturers ──
  { pattern: /^JKM\d/i, brand: "Jinko" },
  { pattern: /^CS[67][NLR.]?[\d-]/i, brand: "Canadian Solar" },
  { pattern: /^TSM-/i, brand: "Trina" },
  { pattern: /^LR[567]-/i, brand: "LONGi" },
  { pattern: /^JAM\d/i, brand: "JA Solar" },
  { pattern: /^REC\d{3}/i, brand: "REC" },
  { pattern: /^HI[NE]-[A-Z]/i, brand: "Hyundai" },
  // ── SolarEdge inverters & optimizers ──
  { pattern: /^SE\d{3,5}H/i, brand: "SolarEdge" },
  { pattern: /^S[456]\d{2}$/i, brand: "SolarEdge" },
  { pattern: /^P[3456]\d{2}$/i, brand: "SolarEdge" },
  // ── Other inverter / hybrid manufacturers ──
  { pattern: /^SB\d+\.\d|^SBSE\d/i, brand: "SMA" },
  { pattern: /^Sol-?Ark/i, brand: "Sol-Ark" },
  { pattern: /^APKE\d/i, brand: "Generac" },
  // ── Optimizer / RSD manufacturers ──
  { pattern: /^TS4-/i, brand: "Tigo" },
  { pattern: /^RSD-[SDP]/i, brand: "APsmart" },
  { pattern: /SI16-PEL/i, brand: "IMO" },
  // ── Battery manufacturers ──
  { pattern: /^aPower|^aGate|^AGT-R/i, brand: "FranklinWH" },
  { pattern: /^eco[Ll]inx|^ECOLX/i, brand: "Sonnen" },
  // ── Racking ──
  { pattern: /^XR-?10|^XR-?100/i, brand: "IronRidge" },
  { pattern: /^UFO-|^CAMO-|^ATH-|^BHW-|^LFT-/i, brand: "IronRidge" },
  { pattern: /SBOXCOMP/i, brand: "Unirac" },
  { pattern: /^SFM|^FLASHKIT/i, brand: "Unirac" },
  // ── Electrical BOS ──
  { pattern: /TL270RCU|THQL21/i, brand: "GE" },
  { pattern: /DG222|TG3222|TGN3322/i, brand: "Eaton" },
  { pattern: /^HOM\d|HOMT\d/i, brand: "Square D" },
  { pattern: /^Q2\d{2}$|^Q1\d{2}$/i, brand: "Siemens" },
  { pattern: /^BR\d/i, brand: "Eaton" },
  { pattern: /^U4801|^U9701|^U9101/i, brand: "Milbank" },
  { pattern: /JB-1\.2|JB-2|JB-3/i, brand: "EZ Solar" },
  { pattern: /S6466|critter\s*guard/i, brand: "SolarEdge" },
  { pattern: /S6438|sunscreener/i, brand: "Heyco" },
  { pattern: /M3317GBZ/i, brand: "Arlington" },
];

const MODEL_STANDARDIZE: Array<{
  pattern: RegExp;
  model: string;
  description?: string;
}> = [
  {
    pattern: /powerwall\s*3(?!\s*expansion)/i,
    model: "1707000-XX-Y",
    description: "Tesla Powerwall 3, 13.5kWh Battery & Inverter",
  },
  {
    pattern: /pw3\s*expansion|powerwall\s*3\s*expansion/i,
    model: "1807000-XX-Y",
    description: "Tesla Powerwall 3 Expansion Unit",
  },
  {
    pattern: /backup\s*gateway\s*3|gateway[- ]?3/i,
    model: "1841000-X1-Y",
    description: "Tesla Backup Gateway 3, 200A, NEMA 3R",
  },
  {
    pattern: /backup\s*switch/i,
    model: "1624171-00-x",
    description: "Tesla Backup Switch",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Match a BomItem against a regex using description + model + brand. */
function matchesBom(item: BomItem, pattern: RegExp): boolean {
  const text = `${item.description ?? ""} ${item.model ?? ""} ${item.brand ?? ""}`;
  return pattern.test(text);
}

/** Check if any item in the list matches a model pattern. */
function hasItemWithModel(items: BomItem[], pattern: RegExp): boolean {
  return items.some(
    (i) =>
      pattern.test(i.model ?? "") || pattern.test(i.description ?? ""),
  );
}

// ---------------------------------------------------------------------------
// Main post-processor
// ---------------------------------------------------------------------------

export function postProcessBomItems(
  project: BomProject | undefined,
  items: BomItem[],
): BomPostProcessResult {
  const corrections: BomCorrection[] = [];

  // Deep clone items to avoid mutating caller's array (structuredClone preferred; JSON fallback for jsdom test env)
  const result: BomItem[] = typeof structuredClone === "function"
    ? structuredClone(items)
    : JSON.parse(JSON.stringify(items));

  // ── Rule 1: Category Standardization ────────────────────────────────────

  for (const item of result) {
    const upper = (item.category ?? "").toUpperCase().trim();
    const canonical = CATEGORY_ALIASES[upper];
    if (canonical && canonical !== upper) {
      corrections.push({
        action: "category_fix",
        description: item.description,
        field: "category",
        oldValue: item.category,
        newValue: canonical,
        reason: `Category alias "${item.category}" normalized to "${canonical}"`,
      });
      item.category = canonical;
    }
  }

  // ── Rule 2: Brand Inference ─────────────────────────────────────────────

  for (const item of result) {
    if (item.brand && item.brand.trim()) continue; // already has a brand
    const model = item.model ?? "";
    const desc = item.description ?? "";
    const searchText = `${model} ${desc}`;

    for (const { pattern, brand } of MODEL_TO_BRAND) {
      if (pattern.test(model) || pattern.test(searchText)) {
        corrections.push({
          action: "brand_fill",
          description: item.description,
          field: "brand",
          oldValue: item.brand ?? "(empty)",
          newValue: brand,
          reason: `Brand inferred from model/description pattern`,
        });
        item.brand = brand;
        break;
      }
    }
  }

  // ── Rule 3: Model Standardization ───────────────────────────────────────

  for (const item of result) {
    const desc = item.description ?? "";
    const currentModel = item.model ?? "";

    for (const { pattern, model, description } of MODEL_STANDARDIZE) {
      // Only standardize if description matches but model doesn't have the
      // canonical part number yet
      if (
        pattern.test(desc) &&
        !currentModel.includes(model.split("-")[0])
      ) {
        corrections.push({
          action: "model_standardize",
          description: item.description,
          field: "model",
          oldValue: currentModel || "(empty)",
          newValue: model,
          reason: `Model standardized from description match`,
        });
        item.model = model;
        if (description && !item.description) {
          item.description = description;
        }
        break;
      }
    }
  }

  // ── Detect job context AFTER normalization ──────────────────────────────
  // Rules 1-3 have now normalized categories (PV_MODULE→MODULE, STORAGE→BATTERY)
  // and models (description→canonical part numbers), so detectJobContext sees
  // the correct category=MODULE/BATTERY and model=1707000/1807000 patterns.
  const ctx = detectJobContext(project, result);

  // ── Rule 4: Quantity Corrections (informational only) ──────────────────
  // Records suggested qty adjustments in corrections[] but does NOT mutate
  // item.qty.  This prevents qty changes from silently propagating to PO/SO
  // creation which reads snapshot bomData.items directly.

  const mc = ctx.moduleCount;

  for (const item of result) {
    const qty = Math.round(Number(item.qty));
    if (!Number.isFinite(qty) || qty <= 0) continue;

    // Snow dogs
    if (matchesBom(item, /snow\s*dog/i) && ctx.jobType !== "battery_only") {
      let target: number;
      if (ctx.roofType === "standing_seam_metal") target = 0;
      else if (mc <= 10) target = 2;
      else if (mc <= 12) target = 4;
      else if (mc <= 13) target = 6;
      else if (mc <= 15) target = 8;
      else target = 10;

      if (qty !== target) {
        corrections.push({
          action: "qty_adjust",
          description: item.description,
          field: "qty",
          oldValue: qty,
          newValue: target,
          reason: target === 0
            ? `Snow dogs not applicable for standing seam metal roof — suggest removing`
            : `Snow dogs should be ${target} for ${mc}-module job`,
        });
      }
    }

    // Critter guard
    if (matchesBom(item, /critter\s*guard|S6466/i)) {
      const target = mc <= 10 ? 1 : mc <= 20 ? 2 : 4;
      if (qty !== target) {
        corrections.push({
          action: "qty_adjust",
          description: item.description,
          field: "qty",
          oldValue: qty,
          newValue: target,
          reason: `Critter guard should be ${target} for ${mc}-module job`,
        });
      }
    }

    // SunScreener
    if (matchesBom(item, /sunscreener|S6438/i)) {
      const target = mc <= 10 ? 1 : mc <= 20 ? 2 : 4;
      if (qty !== target) {
        corrections.push({
          action: "qty_adjust",
          description: item.description,
          field: "qty",
          oldValue: qty,
          newValue: target,
          reason: `SunScreener should be ${target} for ${mc}-module job`,
        });
      }
    }

    // Strain relief
    if (matchesBom(item, /strain\s*relief|M3317GBZ/i)) {
      const target = mc <= 25 ? 2 : 3;
      if (qty !== target) {
        corrections.push({
          action: "qty_adjust",
          description: item.description,
          field: "qty",
          oldValue: qty,
          newValue: target,
          reason: `Strain relief should be ${target} for ${mc}-module job`,
        });
      }
    }

    // SOLOBOX
    if (matchesBom(item, /solobox|SBOXCOMP/i)) {
      const target = mc <= 10 ? 1 : mc <= 20 ? 2 : 3;
      if (qty !== target) {
        corrections.push({
          action: "qty_adjust",
          description: item.description,
          field: "qty",
          oldValue: qty,
          newValue: target,
          reason: `SOLOBOX should be ${target} for ${mc}-module job`,
        });
      }
    }

    // RD Structural Screws
    if (matchesBom(item, /2101175|HW-RD|rd\s*structural\s*screw/i)) {
      const target = mc <= 25 ? 120 : 240;
      if (qty !== target) {
        corrections.push({
          action: "qty_adjust",
          description: item.description,
          field: "qty",
          oldValue: qty,
          newValue: target,
          reason: `RD screws should be ${target} for ${mc}-module job`,
        });
      }
    }
  }

  // ── Rule 5: Suggest Missing Items (separate array) ──────────────────────

  const suggestedAdditions: BomItem[] = [];

  /** Add a suggested item if not already present in items or suggestions. */
  function suggestIfMissing(
    item: Omit<BomItem, "source" | "flags">,
    reason: string,
  ): void {
    const key = normalizedName(item.model ?? item.description);
    // Check if already in main items
    const inItems = result.some(
      (i) =>
        normalizedName(i.model ?? "") === key ||
        normalizedName(i.description) === key,
    );
    // Check if already in suggestions
    const inSuggestions = suggestedAdditions.some(
      (i) =>
        normalizedName(i.model ?? "") === key ||
        normalizedName(i.description) === key,
    );
    if (inItems || inSuggestions) return;

    suggestedAdditions.push({
      ...item,
      source: "OPS_STANDARD",
      flags: ["AUTO_ADDED"],
    });
    corrections.push({
      action: "addition_suggested",
      description: item.description,
      newValue: item.model ?? item.description,
      reason,
    });
  }

  // Solar + PW3: TL270RCU + THQL2160
  if (ctx.jobType !== "battery_only" && ctx.hasPowerwall) {
    suggestIfMissing(
      {
        category: "ELECTRICAL_BOS",
        brand: "GE",
        model: "TL270RCU",
        description: "GE TL270RCU 70A 2-Pole Load Center",
        qty: 1,
      },
      "OPS_STANDARD: Load center always needed for PW3 solar jobs",
    );
    suggestIfMissing(
      {
        category: "ELECTRICAL_BOS",
        brand: "GE",
        model: "THQL2160",
        description: "GE THQL2160 60A 2-Pole Breaker",
        qty: 1,
      },
      "OPS_STANDARD: 60A 2P GE breaker always needed for PW3 solar jobs",
    );
  }

  // Service tap (fused disconnect): fuses
  if (ctx.serviceTapType === "fused_disconnect") {
    suggestIfMissing(
      {
        category: "ELECTRICAL_BOS",
        brand: "Bussman",
        model: "46201",
        description: "Bussman 60A Fuses",
        qty: 2,
      },
      "Bussman 60A fuses always needed with fusible disconnect on service tap jobs",
    );
  }

  // Service tap (breaker enclosure): TL270RCU + THQL2160 as tap equipment
  if (ctx.serviceTapType === "breaker_enclosure") {
    suggestIfMissing(
      {
        category: "ELECTRICAL_BOS",
        brand: "GE",
        model: "TL270RCU",
        description: "GE TL270RCU 70A 2-Pole Load Center",
        qty: 1,
      },
      "Breaker enclosure for service tap: GE load center (TL270RCU)",
    );
    suggestIfMissing(
      {
        category: "ELECTRICAL_BOS",
        brand: "GE",
        model: "THQL2160",
        description: "GE THQL2160 60A 2-Pole Breaker",
        qty: 1,
      },
      "Breaker enclosure for service tap: 60A 2P GE breaker (THQL2160)",
    );
  }

  // Expansion accessories
  if (ctx.hasExpansion) {
    if (ctx.isStackedExpansion) {
      suggestIfMissing(
        {
          category: "BATTERY",
          brand: "Tesla",
          model: "1978070-00-x",
          description: "Tesla PW3 Expansion Stacking Kit",
          qty: 1,
        },
        "Expansion stacking kit for stacked configuration (detected from planset)",
      );
    } else {
      suggestIfMissing(
        {
          category: "BATTERY",
          brand: "Tesla",
          model: "1978069-00-x",
          description: "Tesla PW3 Expansion Wall Mount Kit",
          qty: 1,
        },
        "Expansion wall mount kit for wall-mount configuration (default)",
      );
    }
    suggestIfMissing(
      {
        category: "BATTERY",
        brand: "Tesla",
        model: "1875157-20-y",
        description: "Tesla Expansion Harness 2.0m",
        qty: 1,
      },
      "Expansion harness (default 2.0m) always needed with PW3 Expansion unit",
    );
  }

  // Tile roof items
  if (ctx.roofType === "tile" && ctx.jobType !== "battery_only") {
    const tileHookQty = mc > 0 ? mc * 4 : 20;
    suggestIfMissing(
      {
        category: "RACKING",
        brand: "IronRidge",
        model: "ATH-01-M1",
        description: "IronRidge Tile Hook",
        qty: tileHookQty,
      },
      "Tile hooks required for tile roof installation",
    );
    suggestIfMissing(
      {
        category: "RACKING",
        brand: "IronRidge",
        model: "BHW-TB-03-A1",
        description: "IronRidge T-Bolt Bonding Hardware",
        qty: tileHookQty,
      },
      "T-bolt bonding hardware required for tile roof",
    );
    suggestIfMissing(
      {
        category: "ELECTRICAL_BOS",
        brand: "EZ Solar",
        model: "JB-2",
        description: "EZ Solar JB-2 Tile J-Box (Soladeck)",
        qty: 2,
      },
      "Tile J-box (Soladeck JB-2) required for tile roof",
    );
  }

  // Standing seam S-5!/L-Foot: L-Foot mounts
  if (ctx.isStandingSeamS5 && ctx.jobType !== "battery_only") {
    const lFootQty = mc > 0 ? mc * 3 : 30;
    suggestIfMissing(
      {
        category: "RACKING",
        brand: "IronRidge",
        model: "LFT-03-M1",
        description: "IronRidge L-Foot Mount",
        qty: lFootQty,
      },
      "L-Foot mounts required for standing seam S-5! system",
    );
  }

  // IMO Rapid Shutdown Unit — commonly missed from PV-4 SLD scan
  if (
    ctx.jobType !== "battery_only" &&
    !hasItemWithModel(result, /SI16-PEL|IMO/i)
  ) {
    suggestIfMissing(
      {
        category: "RAPID_SHUTDOWN",
        brand: "IMO",
        model: "SI16-PEL64R-2",
        description: "IMO Rapid Shutdown Device, SI16-PEL64R-2",
        qty: 1,
      },
      "IMO RSU commonly missing from PV-4 SLD extraction — needed for all solar jobs",
    );
  }

  return {
    items: result,
    suggestedAdditions,
    corrections,
    jobContext: ctx,
    rulesVersion: BOM_RULES_VERSION,
  };
}
