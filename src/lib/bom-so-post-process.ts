/**
 * BOM → SO Post-Processor
 *
 * Applies job-type-aware corrections to matched SO line items before
 * creating the Zoho Sales Order.  Reads project metadata and BOM items
 * from the snapshot to detect roof type, service type, solar-vs-battery,
 * etc., then adjusts SKUs, quantities, removes wrong items, and adds
 * missing OPS_STANDARD items.
 *
 * Designed to run after the item-matching loop in create-so/route.ts
 * and before the Zoho createSalesOrder call.
 */

// ---------------------------------------------------------------------------
// Rules version — bump on every rule change for audit traceability
// ---------------------------------------------------------------------------
export const RULES_VERSION = "2026-02-27-v1";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BomProject {
  customer?: string;
  address?: string;
  utility?: string | null;
  moduleCount?: number | string | null;
  roofType?: string | null;
  systemSizeKwdc?: number | string | null;
  systemSizeKwac?: number | string | null;
}

export interface BomItem {
  lineItem?: string;
  category: string;
  brand?: string | null;
  model?: string | null;
  description: string;
  qty: number | string;
  unitSpec?: number | string | null;
  unitLabel?: string | null;
  source?: string;
  flags?: string[];
}

export interface SoLineItem {
  item_id: string;
  name: string;
  quantity: number;
  description: string;
  sku?: string;
  bomCategory?: string;
}

export interface JobContext {
  jobType: "solar" | "battery_only" | "hybrid";
  roofType: "asphalt_shingle" | "standing_seam_metal" | "tile" | "trapezoidal_metal" | "unknown";
  isStandingSeamS5: boolean;
  hasExpansion: boolean;
  hasPowerwall: boolean;
  hasBackupSwitch: boolean;
  hasGateway3: boolean;
  hasRemoteMeter: boolean;
  hasProductionMeter: boolean;
  hasServiceTap: boolean;
  hasEnphase: boolean;
  hasEvCharger: boolean;
  moduleCount: number;
  utility: string | null;
}

export interface SoCorrection {
  action: "sku_swap" | "qty_adjust" | "item_removed" | "item_added";
  itemName: string;
  oldSku?: string;
  newSku?: string;
  oldQty?: number;
  newQty?: number;
  reason: string;
}

export interface PostProcessResult {
  lineItems: SoLineItem[];
  corrections: SoCorrection[];
  jobContext: JobContext;
  rulesVersion: string;
}

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

/** Normalize a name for stable-key comparison: lowercase, trim,
 *  collapse whitespace, strip non-alphanumeric. */
export function normalizedName(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Stable key for idempotent item deduplication. */
function stableKey(item: SoLineItem): string {
  if (item.sku && item.sku.trim()) return normalizedName(item.sku);
  if (item.item_id && item.item_id.trim()) return item.item_id.trim();
  return normalizedName(item.name);
}

// Item-matching helpers (by name/description/sku patterns)
function matchesSku(item: SoLineItem, pattern: RegExp): boolean {
  if (item.sku && pattern.test(item.sku)) return true;
  if (pattern.test(item.name)) return true;
  if (pattern.test(item.description)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Job Context Detection
// ---------------------------------------------------------------------------

export function detectJobContext(
  project: BomProject | undefined,
  items: BomItem[],
): JobContext {
  const hasModules = items.some(i => i.category === "MODULE");
  const hasBattery = items.some(i => i.category === "BATTERY");

  let jobType: JobContext["jobType"];
  if (hasModules && hasBattery) jobType = "hybrid";
  else if (hasModules) jobType = "solar";
  else jobType = "battery_only";

  // Roof type from project metadata + item descriptions
  const roofStr = (project?.roofType ?? "").toLowerCase();
  const allDescriptions = items.map(i => `${i.description ?? ""} ${i.model ?? ""} ${i.brand ?? ""}`).join(" ").toLowerCase();

  let roofType: JobContext["roofType"] = "unknown";
  if (/standing\s*seam|s-?5|l-?foot|protea/i.test(roofStr) || /standing\s*seam|s-?5|l-?foot|protea/i.test(allDescriptions)) {
    roofType = "standing_seam_metal";
  } else if (/\btile\b/i.test(roofStr) || /\btile\s*hook|ath-01/i.test(allDescriptions)) {
    roofType = "tile";
  } else if (/trap|corrugated/i.test(roofStr) || /xr-?100|xr100/i.test(allDescriptions)) {
    roofType = "trapezoidal_metal";
  } else if (hasModules) {
    // Default for solar jobs with modules: asphalt shingle (most common)
    roofType = "asphalt_shingle";
  }

  const isStandingSeamS5 = roofType === "standing_seam_metal" &&
    /s-?5|l-?foot|protea/i.test(allDescriptions);

  const hasPowerwall = items.some(i => /1707000/i.test(i.model ?? ""));
  const hasExpansion = items.some(i => /1807000/i.test(i.model ?? ""));
  const hasBackupSwitch = items.some(i =>
    /1624171/i.test(i.model ?? "") || /backup\s*switch/i.test(i.description));
  const hasGateway3 = items.some(i => /1841000/i.test(i.model ?? ""));
  const hasRemoteMeter = items.some(i =>
    /2045796|P2045794|remote\s*meter/i.test(`${i.model ?? ""} ${i.description}`));
  const hasProductionMeter = items.some(i =>
    /production\s*meter|pv\s*meter|U4801|U9701|U9101/i.test(`${i.model ?? ""} ${i.description}`));
  const hasServiceTap = items.some(i =>
    /DG222NRB|TG3222R|TGN3322R/i.test(i.model ?? "") ||
    /service\s*tap|fusible/i.test(i.description));
  const hasEnphase = items.some(i =>
    /enphase/i.test(i.brand ?? "") || /IQ8|Q-12-RAW/i.test(i.model ?? ""));
  const hasEvCharger = items.some(i =>
    /ev\s*charger|1734411/i.test(`${i.model ?? ""} ${i.description}`));

  let moduleCount = 0;
  const projCount = Number(project?.moduleCount);
  if (Number.isFinite(projCount) && projCount > 0) {
    moduleCount = projCount;
  } else {
    moduleCount = items
      .filter(i => i.category === "MODULE")
      .reduce((sum, i) => sum + (Number(i.qty) || 0), 0);
  }

  return {
    jobType,
    roofType,
    isStandingSeamS5,
    hasExpansion,
    hasPowerwall,
    hasBackupSwitch,
    hasGateway3,
    hasRemoteMeter,
    hasProductionMeter,
    hasServiceTap,
    hasEnphase,
    hasEvCharger,
    moduleCount,
    utility: project?.utility ?? null,
  };
}

// ---------------------------------------------------------------------------
// Post-processing rules
// ---------------------------------------------------------------------------

type FindItemFn = (query: string) => Promise<{ item_id: string; zohoName: string; zohoSku?: string } | null>;

/** Main post-processor. Applies rules in fixed order, returns corrected
 *  line items plus an ordered audit trail. */
export async function postProcessSoItems(
  lineItems: SoLineItem[],
  bomData: { project?: BomProject; items?: BomItem[] },
  findItemIdByName: FindItemFn,
): Promise<PostProcessResult> {
  const project = bomData.project;
  const bomItems = Array.isArray(bomData.items) ? bomData.items : [];
  const ctx = detectJobContext(project, bomItems);
  const corrections: SoCorrection[] = [];

  // Clone line items for mutation
  let items = lineItems.map(item => ({ ...item }));

  // Track which items have had their SKU locked (Rule 1 swaps)
  const skuLocked = new Set<number>();

  // ── Rule 1: SKU Swaps by Roof Type ──────────────────────────────────────

  if (ctx.isStandingSeamS5) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      // Mid clamp: B1 → A1 for standing seam (skip if already A1)
      if (matchesSku(item, /UFO-CL-01-B1|mid\s+clamp/i) && item.sku !== "UFO-CL-01-A1") {
        const replacement = await findItemIdByName("UFO-CL-01-A1");
        if (replacement) {
          corrections.push({
            action: "sku_swap",
            itemName: item.name,
            oldSku: item.sku,
            newSku: replacement.zohoSku ?? "UFO-CL-01-A1",
            reason: "Standing seam S-5!/L-Foot uses Mill finish mid clamp (A1), not Black (B1)",
          });
          items[i] = {
            ...item,
            item_id: replacement.item_id,
            sku: replacement.zohoSku,
            name: replacement.zohoName,
            description: replacement.zohoName,
          };
          skuLocked.add(i);
        }
      }

      // End clamp: UFO-END → CAMO for standing seam (skip if already CAMO)
      if (matchesSku(item, /UFO-END-01-B1|end\s+clamp/i) && item.sku !== "CAMO-01-M1") {
        const replacement = await findItemIdByName("CAMO-01-M1");
        if (replacement) {
          corrections.push({
            action: "sku_swap",
            itemName: item.name,
            oldSku: item.sku,
            newSku: replacement.zohoSku ?? "CAMO-01-M1",
            reason: "Standing seam S-5!/L-Foot uses Camo End (CAMO-01-M1), not standard end clamp",
          });
          items[i] = {
            ...item,
            item_id: replacement.item_id,
            sku: replacement.zohoSku,
            name: replacement.zohoName,
            description: replacement.zohoName,
          };
          skuLocked.add(i);
        }
      }
    }
  }

  // ── Rule 2: Remove Wrong Items ──────────────────────────────────────────

  const toRemove: Set<number> = new Set();

  if (ctx.isStandingSeamS5) {
    for (let i = 0; i < items.length; i++) {
      if (matchesSku(items[i], /snow\s*dog/i)) {
        corrections.push({ action: "item_removed", itemName: items[i].name, reason: "Snow dogs not used on standing seam S-5!/L-Foot metal" });
        toRemove.add(i);
      }
      if (matchesSku(items[i], /\b2101151\b|\bhug\s+attach/i) && !matchesSku(items[i], /screw/i)) {
        corrections.push({ action: "item_removed", itemName: items[i].name, reason: "HUG attachment not used on standing seam (uses L-Foot instead)" });
        toRemove.add(i);
      }
      if (matchesSku(items[i], /2101175|HW-RD|rd\s*structural\s*screw/i)) {
        corrections.push({ action: "item_removed", itemName: items[i].name, reason: "RD structural screws not used on standing seam (no shingle penetration)" });
        toRemove.add(i);
      }
    }
  }

  if (ctx.roofType === "tile") {
    for (let i = 0; i < items.length; i++) {
      if (matchesSku(items[i], /\b2101151\b|\bhug\s+attach/i) && !matchesSku(items[i], /screw/i)) {
        corrections.push({ action: "item_removed", itemName: items[i].name, reason: "HUG attachment not used on tile roof (uses tile hooks instead)" });
        toRemove.add(i);
      }
      if (matchesSku(items[i], /2101175|HW-RD|rd\s*structural\s*screw/i)) {
        corrections.push({ action: "item_removed", itemName: items[i].name, reason: "RD structural screws not used on tile roof (tile hooks replace)" });
        toRemove.add(i);
      }
    }
  }

  if (ctx.jobType === "battery_only") {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (matchesSku(item, /TL270RCU/i)) {
        corrections.push({ action: "item_removed", itemName: item.name, reason: "TL270RCU load center not used on battery-only jobs" });
        toRemove.add(i);
      }
      if (matchesSku(item, /THQL2160/i)) {
        corrections.push({ action: "item_removed", itemName: item.name, reason: "THQL2160 breaker not used on battery-only jobs" });
        toRemove.add(i);
      }
      if (matchesSku(item, /snow\s*dog/i)) {
        corrections.push({ action: "item_removed", itemName: item.name, reason: "Snow dogs not used on battery-only jobs (no roof-mounted PV)" });
        toRemove.add(i);
      }
      if (matchesSku(item, /critter\s*guard|S6466/i)) {
        corrections.push({ action: "item_removed", itemName: item.name, reason: "Critter guard not used on battery-only jobs" });
        toRemove.add(i);
      }
      if (matchesSku(item, /sunscreener|S6438/i)) {
        corrections.push({ action: "item_removed", itemName: item.name, reason: "SunScreener not used on battery-only jobs" });
        toRemove.add(i);
      }
      if (matchesSku(item, /strain\s*relief|M3317GBZ/i)) {
        corrections.push({ action: "item_removed", itemName: item.name, reason: "Strain relief not used on battery-only jobs" });
        toRemove.add(i);
      }
      if (matchesSku(item, /solobox|SBOXCOMP/i)) {
        corrections.push({ action: "item_removed", itemName: item.name, reason: "SOLOBOX not used on battery-only jobs" });
        toRemove.add(i);
      }
    }
  }

  // Apply removals
  items = items.filter((_, i) => !toRemove.has(i));

  // Re-map skuLocked set after removals
  const lockedSkuValues = new Set<string>();
  for (const idx of skuLocked) {
    if (!toRemove.has(idx)) {
      const item = lineItems[idx];
      if (item?.sku) lockedSkuValues.add(normalizedName(item.sku));
    }
  }
  // Rebuild locked set based on actual remaining items
  const newSkuLocked = new Set<number>();
  for (let i = 0; i < items.length; i++) {
    if (items[i].sku && lockedSkuValues.has(normalizedName(items[i].sku!))) {
      newSkuLocked.add(i);
    }
  }

  // ── Rule 3: Qty Adjustments ─────────────────────────────────────────────

  const mc = ctx.moduleCount;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    // Snow dogs (only if not already removed)
    if (matchesSku(item, /snow\s*dog/i)) {
      let target: number;
      if (ctx.roofType === "standing_seam_metal" || ctx.roofType === "tile") {
        target = 0;
      } else if (mc <= 10) target = 2;
      else if (mc <= 12) target = 4;
      else if (mc <= 13) target = 6;
      else if (mc <= 15) target = 8;
      else target = 10;

      if (target === 0) {
        corrections.push({ action: "item_removed", itemName: item.name, oldQty: item.quantity, reason: "Snow dogs qty 0 for this roof type" });
        items.splice(i, 1);
        i--;
        continue;
      }
      if (item.quantity !== target) {
        corrections.push({ action: "qty_adjust", itemName: item.name, oldQty: item.quantity, newQty: target, reason: `Snow dogs scaled to ${target} for ${mc}-module job` });
        items[i] = { ...item, quantity: target };
      }
    }

    // Critter guard
    if (matchesSku(item, /critter\s*guard|S6466/i)) {
      const target = mc <= 15 ? 1 : mc <= 25 ? 2 : 4;
      if (item.quantity !== target) {
        corrections.push({ action: "qty_adjust", itemName: item.name, oldQty: item.quantity, newQty: target, reason: `Critter guard scaled to ${target} for ${mc}-module job` });
        items[i] = { ...item, quantity: target };
      }
    }

    // SunScreener
    if (matchesSku(item, /sunscreener|S6438/i)) {
      const target = mc <= 15 ? 1 : mc <= 25 ? 2 : 4;
      if (item.quantity !== target) {
        corrections.push({ action: "qty_adjust", itemName: item.name, oldQty: item.quantity, newQty: target, reason: `SunScreener scaled to ${target} for ${mc}-module job` });
        items[i] = { ...item, quantity: target };
      }
    }

    // Strain relief
    if (matchesSku(item, /strain\s*relief|M3317GBZ/i)) {
      const target = mc <= 15 ? 1 : 2;
      if (item.quantity !== target) {
        corrections.push({ action: "qty_adjust", itemName: item.name, oldQty: item.quantity, newQty: target, reason: `Strain relief scaled to ${target} for ${mc}-module job` });
        items[i] = { ...item, quantity: target };
      }
    }

    // SOLOBOX
    if (matchesSku(item, /solobox|SBOXCOMP/i)) {
      const target = mc <= 12 ? 1 : mc <= 20 ? 2 : 3;
      if (item.quantity !== target) {
        corrections.push({ action: "qty_adjust", itemName: item.name, oldQty: item.quantity, newQty: target, reason: `SOLOBOX scaled to ${target} for ${mc}-module job` });
        items[i] = { ...item, quantity: target };
      }
    }

    // RD Structural Screws
    if (matchesSku(item, /2101175|HW-RD|rd\s*structural\s*screw/i)) {
      const target = mc <= 18 ? 120 : 240;
      if (item.quantity !== target) {
        corrections.push({ action: "qty_adjust", itemName: item.name, oldQty: item.quantity, newQty: target, reason: `RD screws standardized to ${target} for ${mc}-module job` });
        items[i] = { ...item, quantity: target };
      }
    }
  }

  // ── Rule 4: Add Missing OPS_STANDARD Items ──────────────────────────────

  // Build dedup set: primary stableKey + normalizedName for all items
  const existingKeys = new Set<string>();
  for (const item of items) {
    existingKeys.add(stableKey(item));
    existingKeys.add(normalizedName(item.name));
  }

  async function addIfMissing(
    searchQuery: string,
    expectedSku: string,
    qty: number,
    reason: string,
  ): Promise<void> {
    // Check by SKU first, then by normalizedName
    const skuKey = normalizedName(expectedSku);
    if (existingKeys.has(skuKey)) return;

    const match = await findItemIdByName(searchQuery);
    if (!match) return;

    // Also check matched item's SKU/id against existing
    const matchKey = match.zohoSku ? normalizedName(match.zohoSku) : match.item_id;
    if (existingKeys.has(matchKey)) return;
    if (existingKeys.has(normalizedName(match.zohoName))) return;

    const newItem: SoLineItem = {
      item_id: match.item_id,
      name: match.zohoName,
      quantity: qty,
      description: match.zohoName,
      sku: match.zohoSku,
    };

    items.push(newItem);
    existingKeys.add(stableKey(newItem));

    corrections.push({
      action: "item_added",
      itemName: match.zohoName,
      newSku: match.zohoSku ?? expectedSku,
      newQty: qty,
      reason,
    });
  }

  // Solar PW3 jobs: add TL270RCU + THQL2160
  if (ctx.jobType !== "battery_only" && ctx.hasPowerwall) {
    await addIfMissing("TL270RCU", "TL270RCU", 1, "OPS_STANDARD: Load center always needed for PW3 solar jobs");
    await addIfMissing("THQL2160", "THQL2160", 1, "OPS_STANDARD: 60A 2P GE breaker always needed for PW3 solar jobs");
  }

  // Expansion accessories
  if (ctx.hasExpansion) {
    await addIfMissing("1978069-00-x", "1978069-00-x", 1, "Expansion wall mount kit always needed with PW3 Expansion unit");
    await addIfMissing("1875157-20-y", "1875157-20-y", 1, "Expansion harness (default 2.0m) always needed with PW3 Expansion unit");
  }

  // Tile roof items
  if (ctx.roofType === "tile" && ctx.jobType !== "battery_only") {
    const tileHookQty = ctx.moduleCount > 0 ? ctx.moduleCount * 4 : 20; // ~4 hooks per module
    await addIfMissing("ATH-01-M1", "ATH-01-M1", tileHookQty, "Tile hooks required for tile roof installation");
    await addIfMissing("BHW-TB-03-A1", "BHW-TB-03-A1", tileHookQty, "T-bolt bonding hardware required for tile roof");
    await addIfMissing("JB-2", "JB-2", 2, "Tile J-box (Soladeck JB-2) required for tile roof");
  }

  // Standing seam S-5!/L-Foot: add L-Foot if missing
  if (ctx.isStandingSeamS5 && ctx.jobType !== "battery_only") {
    // Default qty: ~3 per module (observed from ops data)
    const lFootQty = ctx.moduleCount > 0 ? ctx.moduleCount * 3 : 30;
    await addIfMissing("LFT-03-M1", "LFT-03-M1", lFootQty, "L-Foot mounts required for standing seam S-5! system");
  }

  return {
    lineItems: items,
    corrections,
    jobContext: ctx,
    rulesVersion: RULES_VERSION,
  };
}
