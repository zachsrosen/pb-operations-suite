/**
 * Sync 2026 Zoho SO items → InternalProduct → Zuper
 *
 * Phase 1: Create InternalProduct for any NOT_FOUND equipment items
 * Phase 2: Push all items to Zuper (create if missing)
 * Phase 3: Cross-link Zoho ↔ Zuper via InternalProduct
 *
 * Usage:
 *   npx tsx scripts/sync-2026-items-to-zuper.ts              # dry-run
 *   npx tsx scripts/sync-2026-items-to-zuper.ts --live        # execute
 */
// Load env BEFORE any app imports (ESM hoists static imports)
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import * as fs from "fs";
import type { EquipmentCategory } from "../src/generated/prisma/client.js";

// Lazy-loaded modules — resolved inside main() so dotenv runs first
let PrismaClient: typeof import("../src/generated/prisma/client.js").PrismaClient;
let PrismaNeon: typeof import("@prisma/adapter-neon").PrismaNeon;
let createOrUpdateZuperPart: typeof import("../src/lib/zuper-catalog.js").createOrUpdateZuperPart;
let updateZuperPart: typeof import("../src/lib/zuper-catalog.js").updateZuperPart;
let zohoInventory: typeof import("../src/lib/zoho-inventory.js").zohoInventory;
let canonicalToken: typeof import("../src/lib/canonical.js").canonicalToken;
let buildCanonicalKey: typeof import("../src/lib/canonical.js").buildCanonicalKey;
let getZuperCategoryValue: typeof import("../src/lib/catalog-fields.js").getZuperCategoryValue;

async function loadDeps() {
  ({ PrismaClient } = await import("../src/generated/prisma/client.js"));
  ({ PrismaNeon } = await import("@prisma/adapter-neon"));
  ({ createOrUpdateZuperPart, updateZuperPart } = await import("../src/lib/zuper-catalog.js"));
  ({ zohoInventory } = await import("../src/lib/zoho-inventory.js"));
  ({ canonicalToken, buildCanonicalKey } = await import("../src/lib/canonical.js"));
  ({ getZuperCategoryValue } = await import("../src/lib/catalog-fields.js"));
}

const LIVE = process.argv.includes("--live");

// ── Fee/service items to skip (not equipment) ────────────────────────
const SKIP_NAMES = new Set([
  "permit fees",
  "interconnection fees",
  "inventory-no po",
  "design & engineering",
]);

// ── Manual category/brand/model map for NOT_FOUND equipment items ────
// These are items that exist in Zoho SOs but have no InternalProduct.
// Parsed from the 27 NOT_FOUND items in the comparison.
interface ManualMapping {
  category: EquipmentCategory;
  brand: string;
  model: string;
}

const NOT_FOUND_MAP: Record<string, ManualMapping> = {
  // Key = lowercase SO item name. Only real equipment.
  "4 in. x 8 in. x 16 in. solid concrete block": {
    category: "RACKING" as EquipmentCategory,
    brand: "Generic",
    model: "Concrete Block 8x8x16",
  },
  "200 amp-csr bolt-on; 2 pole; toggle; 240 vac;": {
    category: "ELECTRICAL_BOS" as EquipmentCategory,
    brand: "CSR",
    model: "CSR2200N",
  },
  "insulation piercing connector, run 3 - 4/0 awg, tap 10": {
    category: "ELECTRICAL_BOS" as EquipmentCategory,
    brand: "IronRidge",
    model: "BIPC4/010S",
  },
  '3/4" emt': {
    category: "ELECTRICAL_BOS" as EquipmentCategory,
    brand: "Generic",
    model: "EMT 3/4in",
  },
  "k8180": {
    category: "ELECTRICAL_BOS" as EquipmentCategory,
    brand: "Generic",
    model: "K8180",
  },
  "43974": {
    category: "ELECTRICAL_BOS" as EquipmentCategory,
    brand: "Generic",
    model: "43974",
  },
  '2" pvc male terminal adapter': {
    category: "ELECTRICAL_BOS" as EquipmentCategory,
    brand: "Generic",
    model: "PVC-MTA-2in",
  },
  "100a 2p -sq d": {
    category: "ELECTRICAL_BOS" as EquipmentCategory,
    brand: "Square D",
    model: "HOM2100",
  },
  'pvc male terminal adaptor; 2"': {
    category: "ELECTRICAL_BOS" as EquipmentCategory,
    brand: "Generic",
    model: "PVC-TA-2in",
  },
  "homt1515": {
    category: "ELECTRICAL_BOS" as EquipmentCategory,
    brand: "Square D",
    model: "HOMT1515",
  },
  "4/0 ser": {
    category: "ELECTRICAL_BOS" as EquipmentCategory,
    brand: "Generic",
    model: "SER 4/0 3W/GRD",
  },
  "16 in. x 16 in. x 1.75 in. pecan square concrete step s": {
    category: "RACKING" as EquipmentCategory,
    brand: "Generic",
    model: "Paver 16x16",
  },
  "60 amp abb": {
    category: "ELECTRICAL_BOS" as EquipmentCategory,
    brand: "ABB",
    model: "ABB260",
  },
  '1.25" pvc ta': {
    category: "ELECTRICAL_BOS" as EquipmentCategory,
    brand: "Generic",
    model: "PVC-TA-1.25in",
  },
  "6x6x4 pvc jbox": {
    category: "ELECTRICAL_BOS" as EquipmentCategory,
    brand: "Generic",
    model: "JCT-BOX-6x6x4",
  },
  "neurio cts w2 2x 200a": {
    category: "MONITORING" as EquipmentCategory,
    brand: "Tesla",
    model: "1622277-01",
  },
  "12x12x6 pvc jct box": {
    category: "ELECTRICAL_BOS" as EquipmentCategory,
    brand: "Generic",
    model: "JCT-BOX-12x12x6",
  },
  "6x6x24 in. gutter outdoor": {
    category: "ELECTRICAL_BOS" as EquipmentCategory,
    brand: "Generic",
    model: "A6624RT",
  },
  "ge tqhl 15a 1p": {
    category: "ELECTRICAL_BOS" as EquipmentCategory,
    brand: "GE",
    model: "THQL1115",
  },
  '2" metal weatherhead': {
    category: "ELECTRICAL_BOS" as EquipmentCategory,
    brand: "Generic",
    model: "Weatherhead-2in",
  },
  "ceramic knob wire holder with rivet, 3/8 x 1/2\" match s": {
    category: "ELECTRICAL_BOS" as EquipmentCategory,
    brand: "Generic",
    model: "617-Knob-Holder",
  },
  "200 a amps, for use with homeline load center/qo load c": {
    category: "ELECTRICAL_BOS" as EquipmentCategory,
    brand: "Square D",
    model: "QOM2200VH",
  },
  "bipc4/010s": {
    category: "ELECTRICAL_BOS" as EquipmentCategory,
    brand: "IronRidge",
    model: "BIPC4-010S",
  },
  "neurio w2 ct extension": {
    category: "MONITORING" as EquipmentCategory,
    brand: "Tesla",
    model: "1622289-00-x",
  },
  "multi-tap connector, insulated, 10 awg - 250 mcm": {
    category: "ELECTRICAL_BOS" as EquipmentCategory,
    brand: "Generic",
    model: "BIT250",
  },
};

// ── Types ────────────────────────────────────────────────────────────
interface ComparisonItem {
  so_item_name: string;
  so_sku: string;
  times_used: number;
  total_qty: number;
  unique_sos: number;
  match_status: "MATCHED" | "NOT_FOUND";
  ip_id: string;
  ip_category: string;
  ip_brand: string;
  ip_model: string;
  ip_name: string;
  ip_zoho_linked: boolean;
  ip_hubspot_linked: boolean;
  ip_zuper_linked: boolean;
}

interface SOItemFreq {
  name: string;
  sku: string;
  times_used: number;
  total_qty: number;
  unique_sos: number;
  is_equipment: boolean;
}

type IPRow = {
  id: string;
  category: string;
  brand: string;
  model: string;
  name: string | null;
  sku: string | null;
  description: string | null;
  unitSpec: number | null;
  unitLabel: string | null;
  vendorName: string | null;
  vendorPartNumber: string | null;
  unitCost: number | null;
  sellPrice: number | null;
  zohoItemId: string | null;
  hubspotProductId: string | null;
  zuperItemId: string | null;
};

// ── Helpers ──────────────────────────────────────────────────────────
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function norm(s: string): string {
  return s.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  await loadDeps();
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  2026 SO Items → InternalProduct → Zuper Sync`);
  console.log(`  Mode: ${LIVE ? "🔴 LIVE" : "🔵 DRY RUN"}`);
  console.log(`${"=".repeat(60)}\n`);

  // Load comparison + source data
  const comparison = JSON.parse(
    fs.readFileSync("scripts/2026-so-inventory-comparison.json", "utf-8")
  );
  const soReview = JSON.parse(
    fs.readFileSync("scripts/2026-so-review.json", "utf-8")
  );
  const allSOItems: SOItemFreq[] = soReview.itemFrequency;
  const compItems: ComparisonItem[] = comparison.comparison;

  // Load all InternalProducts from DB
  const allIPs = await prisma.internalProduct.findMany({
    where: { isActive: true },
    select: {
      id: true, category: true, brand: true, model: true, name: true,
      sku: true, description: true, unitSpec: true, unitLabel: true,
      vendorName: true, vendorPartNumber: true, unitCost: true, sellPrice: true,
      zohoItemId: true, hubspotProductId: true, zuperItemId: true,
    },
  });
  console.log(`Loaded ${allIPs.length} active InternalProducts from DB`);

  // Index IPs by id
  const ipById = new Map<string, IPRow>(allIPs.map((p) => [p.id, p]));

  // Load Zoho items for zohoItemId lookup
  console.log("Fetching Zoho inventory items...");
  const zohoItems = await zohoInventory.getItemsForMatching();
  console.log(`Loaded ${zohoItems.length} Zoho items`);

  // Index Zoho items by normalized name and SKU
  const zohoByNormName = new Map<string, { item_id: string; name: string; sku?: string }>();
  const zohoByNormSku = new Map<string, { item_id: string; name: string; sku?: string }>();
  for (const zi of zohoItems) {
    zohoByNormName.set(norm(zi.name), { item_id: zi.item_id, name: zi.name, sku: zi.sku });
    if (zi.sku) {
      zohoByNormSku.set(norm(zi.sku), { item_id: zi.item_id, name: zi.name, sku: zi.sku });
    }
  }

  // ── Phase 1: Ensure InternalProducts ─────────────────────────────
  console.log(`\n${"─".repeat(50)}`);
  console.log("Phase 1: Ensure InternalProducts for NOT_FOUND items");
  console.log(`${"─".repeat(50)}`);

  const notFoundItems = compItems.filter((c) => c.match_status === "NOT_FOUND");
  let createdIPs = 0;
  let skippedFees = 0;
  let skippedUnmapped = 0;

  // Track newly created IPs so Phase 2 can use them
  const newIPsForSOItem = new Map<string, IPRow>();

  for (const item of notFoundItems) {
    const lowerName = item.so_item_name.toLowerCase().trim();

    // Skip fees/services
    if (SKIP_NAMES.has(lowerName) || !allSOItems.find((s) => s.name === item.so_item_name)?.is_equipment) {
      skippedFees++;
      continue;
    }

    // Look up manual mapping
    // Try exact match first, then prefix match (SO names get truncated in comparison)
    let mapping = NOT_FOUND_MAP[lowerName];
    if (!mapping) {
      for (const [key, val] of Object.entries(NOT_FOUND_MAP)) {
        if (lowerName.startsWith(key) || key.startsWith(lowerName)) {
          mapping = val;
          break;
        }
      }
    }

    if (!mapping) {
      console.log(`  ⚠ No manual mapping for: "${item.so_item_name}" (SKU: ${item.so_sku})`);
      skippedUnmapped++;
      continue;
    }

    // Check if IP already exists (may have been created since comparison ran)
    const ck = buildCanonicalKey(mapping.category, mapping.brand, mapping.model);
    const existing = allIPs.find(
      (p) =>
        p.category === mapping!.category &&
        canonicalToken(p.brand) === canonicalToken(mapping!.brand) &&
        canonicalToken(p.model) === canonicalToken(mapping!.model)
    );
    if (existing) {
      console.log(`  ✓ Already exists: ${existing.brand} ${existing.model} (${existing.id})`);
      newIPsForSOItem.set(item.so_item_name, existing);
      continue;
    }

    // Look up Zoho item for linking
    const soSku = item.so_sku || "";
    let zohoItemId: string | null = null;
    const zohoMatch =
      zohoByNormSku.get(norm(soSku)) ||
      zohoByNormName.get(norm(item.so_item_name));
    if (zohoMatch) {
      zohoItemId = zohoMatch.item_id;
    }

    const cb = canonicalToken(mapping.brand);
    const cm = canonicalToken(mapping.model);

    console.log(
      `  ${LIVE ? "→ Creating" : "Would create"}: [${mapping.category}] ${mapping.brand} ${mapping.model}` +
        (zohoItemId ? ` (Zoho: ${zohoItemId})` : " (no Zoho link)") +
        ` — used ${item.unique_sos}x`
    );

    if (LIVE) {
      try {
        const created = await prisma.internalProduct.upsert({
          where: {
            category_brand_model: {
              category: mapping.category,
              brand: mapping.brand,
              model: mapping.model,
            },
          },
          update: {
            isActive: true,
            ...(zohoItemId ? { zohoItemId } : {}),
          },
          create: {
            category: mapping.category,
            brand: mapping.brand,
            model: mapping.model,
            sku: soSku || null,
            canonicalBrand: cb,
            canonicalModel: cm,
            canonicalKey: ck,
            zohoItemId,
            isActive: true,
          },
          select: {
            id: true, category: true, brand: true, model: true, name: true,
            sku: true, description: true, unitSpec: true, unitLabel: true,
            vendorName: true, vendorPartNumber: true, unitCost: true, sellPrice: true,
            zohoItemId: true, hubspotProductId: true, zuperItemId: true,
          },
        });
        newIPsForSOItem.set(item.so_item_name, created);
        ipById.set(created.id, created);
        createdIPs++;
      } catch (err) {
        console.error(`  ✗ Failed to create IP for "${item.so_item_name}":`, err);
      }
    } else {
      createdIPs++;
    }
  }

  console.log(`\nPhase 1 summary:`);
  console.log(`  Created: ${createdIPs} InternalProducts`);
  console.log(`  Skipped fees/services: ${skippedFees}`);
  console.log(`  Skipped (no mapping): ${skippedUnmapped}`);

  // ── Phase 2: Push to Zuper ───────────────────────────────────────
  console.log(`\n${"─".repeat(50)}`);
  console.log("Phase 2: Create Zuper products for items missing zuperItemId");
  console.log(`${"─".repeat(50)}`);

  // Build the full list of IPs we need to process
  // (matched items from comparison + newly created items)
  const ipsToProcess: IPRow[] = [];

  for (const item of compItems) {
    if (item.match_status === "MATCHED" && item.ip_id) {
      const ip = ipById.get(item.ip_id);
      if (ip) ipsToProcess.push(ip);
    } else if (item.match_status === "NOT_FOUND") {
      const newIP = newIPsForSOItem.get(item.so_item_name);
      if (newIP) ipsToProcess.push(newIP);
    }
  }

  // Deduplicate by IP id (same IP can match multiple SO items)
  const seen = new Set<string>();
  const uniqueIPs = ipsToProcess.filter((ip) => {
    if (seen.has(ip.id)) return false;
    seen.add(ip.id);
    return true;
  });

  const needsZuper = uniqueIPs.filter((ip) => !ip.zuperItemId);
  const alreadyHasZuper = uniqueIPs.filter((ip) => !!ip.zuperItemId);

  console.log(`  Total unique IPs to process: ${uniqueIPs.length}`);
  console.log(`  Already have Zuper link: ${alreadyHasZuper.length}`);
  console.log(`  Need Zuper creation: ${needsZuper.length}`);

  let zuperCreated = 0;
  let zuperExisted = 0;
  let zuperFailed = 0;

  for (const ip of needsZuper) {
    const zuperCategory = getZuperCategoryValue(ip.category) || "Parts";
    const displayName = ip.name || `${ip.brand} ${ip.model}`;

    console.log(
      `  ${LIVE ? "→" : "Would"} push to Zuper: ${displayName} [${ip.category}]`
    );

    if (LIVE) {
      try {
        const result = await createOrUpdateZuperPart({
          brand: ip.brand,
          model: ip.model,
          name: displayName,
          description: ip.description,
          sku: ip.sku,
          unitLabel: ip.unitLabel,
          vendorName: ip.vendorName,
          vendorPartNumber: ip.vendorPartNumber,
          sellPrice: ip.sellPrice,
          unitCost: ip.unitCost,
          category: zuperCategory,
        });

        if (result.created) {
          zuperCreated++;
          console.log(`    ✓ Created Zuper item: ${result.zuperItemId}`);
        } else {
          zuperExisted++;
          console.log(`    ✓ Found existing Zuper item: ${result.zuperItemId}`);
        }

        // Save zuperItemId back to InternalProduct (guarded write)
        await prisma.internalProduct.updateMany({
          where: { id: ip.id, zuperItemId: null },
          data: { zuperItemId: result.zuperItemId },
        });
        ip.zuperItemId = result.zuperItemId;

        // Rate limit: Zuper API
        await sleep(300);
      } catch (err) {
        zuperFailed++;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`    ✗ Failed: ${msg.slice(0, 200)}`);
      }
    } else {
      zuperCreated++;
    }
  }

  console.log(`\nPhase 2 summary:`);
  console.log(`  Zuper created: ${zuperCreated}`);
  console.log(`  Zuper already existed: ${zuperExisted}`);
  console.log(`  Zuper failed: ${zuperFailed}`);

  // ── Phase 3: Cross-link Zoho ↔ Zuper ─────────────────────────────
  console.log(`\n${"─".repeat(50)}`);
  console.log("Phase 3: Cross-link Zoho items ↔ Zuper products");
  console.log(`${"─".repeat(50)}`);

  // Refresh IP data from DB to get latest zuperItemIds
  const freshIPs = LIVE
    ? await prisma.internalProduct.findMany({
        where: { id: { in: uniqueIPs.map((p) => p.id) } },
        select: {
          id: true, category: true, brand: true, model: true, name: true,
          sku: true, description: true, unitSpec: true, unitLabel: true,
          vendorName: true, vendorPartNumber: true, unitCost: true, sellPrice: true,
          zohoItemId: true, hubspotProductId: true, zuperItemId: true,
        },
      })
    : uniqueIPs;

  const crossLinkable = freshIPs.filter((ip) => ip.zohoItemId && ip.zuperItemId);
  console.log(`  Items with both Zoho + Zuper IDs: ${crossLinkable.length}`);

  let zohoUpdated = 0;
  let zohoFailed = 0;
  let zuperUpdated = 0;
  let zuperUpdateFailed = 0;

  for (const ip of crossLinkable) {
    const displayName = ip.name || `${ip.brand} ${ip.model}`;

    // Zoho → Zuper: set cf_zuper_product_id on the Zoho item
    console.log(
      `  ${LIVE ? "→" : "Would"} Zoho ${ip.zohoItemId} ← zuper_id ${ip.zuperItemId} (${displayName})`
    );

    if (LIVE) {
      try {
        const result = await zohoInventory.updateItem(ip.zohoItemId!, {
          cf_zuper_product_id: ip.zuperItemId,
        });
        if (result.status === "updated") {
          zohoUpdated++;
        } else {
          zohoFailed++;
          console.error(`    ✗ Zoho update: ${result.status} — ${result.message}`);
        }
        await sleep(200);
      } catch (err) {
        zohoFailed++;
        console.error(`    ✗ Zoho update failed:`, err instanceof Error ? err.message : err);
      }
    } else {
      zohoUpdated++;
    }

    // Zuper → Zoho: set zoho_item_id on the Zuper product
    if (LIVE) {
      try {
        const result = await updateZuperPart(ip.zuperItemId!, {
          zoho_item_id: ip.zohoItemId,
        });
        if (result.status === "updated") {
          zuperUpdated++;
        } else if (result.status === "unsupported") {
          // Zuper PUT may not support updates on some accounts — not fatal
          console.log(`    ⚠ Zuper update unsupported for ${ip.zuperItemId}`);
        } else {
          zuperUpdateFailed++;
          console.error(`    ✗ Zuper update: ${result.status} — ${result.message}`);
        }
        await sleep(200);
      } catch (err) {
        zuperUpdateFailed++;
        console.error(`    ✗ Zuper update failed:`, err instanceof Error ? err.message : err);
      }
    } else {
      zuperUpdated++;
    }
  }

  console.log(`\nPhase 3 summary:`);
  console.log(`  Zoho items updated with Zuper ID: ${zohoUpdated}`);
  console.log(`  Zoho update failures: ${zohoFailed}`);
  console.log(`  Zuper items updated with Zoho ID: ${zuperUpdated}`);
  console.log(`  Zuper update failures: ${zuperUpdateFailed}`);

  // ── Final Summary ────────────────────────────────────────────────
  console.log(`\n${"=".repeat(60)}`);
  console.log("  FINAL SUMMARY");
  console.log(`${"=".repeat(60)}`);
  console.log(`  Phase 1 — InternalProducts created: ${createdIPs}`);
  console.log(`  Phase 2 — Zuper products created: ${zuperCreated}, already existed: ${zuperExisted}, failed: ${zuperFailed}`);
  console.log(`  Phase 3 — Zoho↔Zuper cross-links: ${zohoUpdated} Zoho, ${zuperUpdated} Zuper`);

  if (!LIVE) {
    console.log(`\n  ⚡ This was a DRY RUN. Run with --live to execute.`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
