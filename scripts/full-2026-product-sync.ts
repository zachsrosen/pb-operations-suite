/**
 * Full 2026 product sync: Zoho ↔ InternalProduct ↔ Zuper (1:1:1)
 *
 * Phase 1: Create InternalProducts for Zoho items that don't have one
 * Phase 2: Push all IPs to Zuper (create where missing)
 * Phase 3: Cross-link Zoho items with cf_zuper_product_id
 *
 * Usage:
 *   npx tsx scripts/full-2026-product-sync.ts              # dry-run
 *   npx tsx scripts/full-2026-product-sync.ts --live        # execute
 *   npx tsx scripts/full-2026-product-sync.ts --live --phase=1  # only phase 1
 *   npx tsx scripts/full-2026-product-sync.ts --live --phase=2  # only phase 2
 *   npx tsx scripts/full-2026-product-sync.ts --live --phase=3  # only phase 3
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { readFileSync, writeFileSync } from "fs";

const LIVE = process.argv.includes("--live");
const phaseArg = process.argv.find(a => a.startsWith("--phase="));
const PHASE_FILTER = phaseArg ? parseInt(phaseArg.split("=")[1]) : null;

// ─── Category auto-detection ─────────────────────────────────────────────

const KNOWN_BRANDS: Record<string, string> = {
  "tesla": "Tesla",
  "enphase": "Enphase",
  "solaredge": "SolarEdge",
  "solar edge": "SolarEdge",
  "ironridge": "IronRidge",
  "iron ridge": "IronRidge",
  "siemens": "Siemens",
  "eaton": "Eaton",
  "ge ": "GE",
  "square d": "Square D",
  "sqd": "Square D",
  "rec": "REC",
  "rec ": "REC",
  "qcell": "QCell",
  "q.cell": "QCell",
  "q cell": "QCell",
  "silfab": "Silfab",
  "hyundai": "Hyundai",
  "alpine": "Alpine",
  "s-5!": "S-5!",
  "s-5": "S-5!",
  "heyco": "Heyco",
  "arlington": "Arlington",
  "unirac": "Unirac",
  "polaris": "Polaris",
  "quickbolt": "QuickBolt",
  "ez solar": "EZ Solar",
  "imo": "IMO",
  "seg solar": "SEG Solar",
  "seg ": "SEG Solar",
  "cutlerhammer": "CutlerHammer",
  "buchanan": "Buchanan",
  "abb": "ABB",
  "lightspeed": "Lightspeed",
  "xcel": "Xcel Energy",
  "hanwha": "Hanwha",
};

type EquipmentCategory =
  | "MODULE" | "INVERTER" | "BATTERY" | "EV_CHARGER" | "RAPID_SHUTDOWN"
  | "RACKING" | "ELECTRICAL_BOS" | "MONITORING" | "BATTERY_EXPANSION"
  | "OPTIMIZER" | "GATEWAY" | "D_AND_R" | "SERVICE" | "ADDER_SERVICES"
  | "TESLA_SYSTEM_COMPONENTS" | "PROJECT_MILESTONES";

function autoCategory(name: string, sku: string, groupName?: string): EquipmentCategory {
  const nl = name.toLowerCase();
  const sl = sku.toLowerCase();
  const combined = `${nl} ${sl}`;

  // Fee / service items
  if (/\b(permit|interconnection|design & engineering|inventory-no po|contractor|test$)/i.test(name))
    return "PROJECT_MILESTONES";

  // Modules (solar panels)
  if (/\b(\d{3,4}\s*w\b|module|solar panel)/i.test(name) && !/charger|disconnect|inverter/i.test(name))
    return "MODULE";
  if (/^(rec|sil-|seg-|seg solar|q\.peak|qcell|hyundai|hanwha|lightspeed)/i.test(name))
    return "MODULE";
  if (/seg-\d{3}/i.test(combined)) return "MODULE";

  // Inverters
  if (/\binverter\b/i.test(combined)) return "INVERTER";
  if (/\b(kw|kva)\b/i.test(name) && /\b(solaredge|se\d)/i.test(combined)) return "INVERTER";

  // Batteries
  if (/\b(powerwall|battery|expansion harness|pw3)\b/i.test(combined)) return "BATTERY";

  // EV Chargers
  if (/\b(ev charger|wall connector|j1772|charger.*ev|magic dock)\b/i.test(combined)) return "EV_CHARGER";

  // Rapid shutdown
  if (/\b(imo|rapid shutdown|pel64r)\b/i.test(combined)) return "RAPID_SHUTDOWN";

  // Monitoring
  if (/\b(monitor|combiner|gateway|neurio|ct unit|ct extension|sense|enlighten|xcel.*pvm)\b/i.test(combined))
    return "MONITORING";

  // Optimizer
  if (/\b(optimizer|p\d{3,4}\b)/i.test(combined) && /solaredge/i.test(combined)) return "OPTIMIZER";

  // Racking
  if (/\b(clamp|rail|ufo|boss|l-?foot|bracket|flashing|mount|tile|strut|snow|camo|roof boot)\b/i.test(combined))
    return "RACKING";
  if (/\b(ironridge|alpine|s-5|quickbolt)\b/i.test(combined)) return "RACKING";
  if (/\b(xr[\s-]?\d|ath-|kob-|kof-|lft-|bhw-|ssm-)/i.test(combined)) return "RACKING";

  // Critter guard / adders
  if (/\b(critter guard|surge|spd)\b/i.test(combined)) return "ADDER_SERVICES";

  // Tesla system components
  if (/\btesla\b/i.test(name) && /\b(harness|bracket|cover|hub|conduit)\b/i.test(name))
    return "TESLA_SYSTEM_COMPONENTS";

  // Default: electrical BOS (breakers, wire, conduit, disconnects, junction boxes, etc.)
  return "ELECTRICAL_BOS";
}

function extractBrand(name: string, sku: string): string {
  const nl = name.toLowerCase();
  for (const [pattern, brand] of Object.entries(KNOWN_BRANDS)) {
    if (nl.startsWith(pattern) || nl.includes(` ${pattern}`) || nl.includes(`${pattern} `)) {
      return brand;
    }
  }
  // Check SKU prefix
  const sl = sku.toLowerCase();
  for (const [pattern, brand] of Object.entries(KNOWN_BRANDS)) {
    if (sl.startsWith(pattern)) return brand;
  }
  return "Generic";
}

function extractModel(name: string, sku: string, brand: string): string {
  // If SKU looks like a model number, prefer it
  if (sku && sku !== name && sku.length < 50 && !/\s{2,}/.test(sku)) {
    // Clean up compound SKUs (take first part)
    const cleaned = sku.split("/")[0].trim().split("|")[0].trim();
    if (cleaned.length > 2) return cleaned;
  }
  // Strip brand prefix from name
  let model = name;
  if (brand !== "Generic") {
    const re = new RegExp(`^${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "i");
    model = model.replace(re, "");
  }
  // Truncate long descriptions
  if (model.length > 60) model = model.substring(0, 60).trim();
  return model || name.substring(0, 60);
}

// ─── Zuper category mapping ─────────────────────────────────────────────

const ZUPER_CATEGORY_MAP: Record<string, string> = {
  MODULE: "Module",
  INVERTER: "Inverter",
  BATTERY: "Battery",
  BATTERY_EXPANSION: "Battery Expansion",
  EV_CHARGER: "EV Charger",
  RACKING: "Mounting Hardware",
  ELECTRICAL_BOS: "Electrical Hardwire",
  MONITORING: "Relay Device",
  RAPID_SHUTDOWN: "Relay Device",
  OPTIMIZER: "Optimizer",
  GATEWAY: "Relay Device",
  D_AND_R: "D&R",
  SERVICE: "Service",
  ADDER_SERVICES: "Service",
  TESLA_SYSTEM_COMPONENTS: "Tesla System Components",
  PROJECT_MILESTONES: "Service",
};

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const { createOrUpdateZuperPart } = await import("../src/lib/zuper-catalog.js");
  const { zohoInventory } = await import("../src/lib/zoho-inventory.js");

  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  console.log(`\n${"=".repeat(70)}`);
  console.log(`  Full 2026 Product Sync: Zoho ↔ InternalProduct ↔ Zuper`);
  console.log(`  Mode: ${LIVE ? "🔴 LIVE" : "🔵 DRY RUN"}${PHASE_FILTER ? ` (Phase ${PHASE_FILTER} only)` : ""}`);
  console.log(`${"=".repeat(70)}\n`);

  // Load the pre-computed SO items with Zoho IDs
  const soData = JSON.parse(readFileSync("scripts/2026-so-items-with-ids.json", "utf-8"));

  // Fetch fresh Zoho items to get full details (brand, group_name, etc.)
  console.log("Fetching Zoho items...");
  const allZohoItems = await zohoInventory.listItems();
  const zohoById = new Map(allZohoItems.map(z => [z.item_id, z]));
  console.log(`Loaded ${allZohoItems.length} Zoho items\n`);

  // Get unique Zoho item IDs that need new InternalProducts
  const needsIP = new Map<string, { zohoItemId: string; soName: string; soSku: string }>();
  for (const item of soData.items as Array<Record<string, unknown>>) {
    if (item.zohoItemId && !item.ipId) {
      const zid = item.zohoItemId as string;
      if (!needsIP.has(zid)) {
        needsIP.set(zid, {
          zohoItemId: zid,
          soName: item.soName as string,
          soSku: item.soSku as string,
        });
      }
    }
  }

  // Also collect already-covered Zoho IDs (have an IP)
  const coveredZohoIds = new Set<string>();
  for (const item of soData.items as Array<Record<string, unknown>>) {
    if (item.zohoItemId && item.ipId) {
      coveredZohoIds.add(item.zohoItemId as string);
    }
  }

  console.log(`Zoho items needing new InternalProduct: ${needsIP.size}`);
  console.log(`Zoho items already covered: ${coveredZohoIds.size}\n`);

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 1: Create InternalProducts
  // ═══════════════════════════════════════════════════════════════════════
  if (!PHASE_FILTER || PHASE_FILTER === 1) {
    console.log("─".repeat(70));
    console.log("PHASE 1: Create InternalProducts for unmatched Zoho items");
    console.log("─".repeat(70));

    let created = 0;
    let skipped = 0;
    let errors = 0;
    const newIPs: Array<{ zohoItemId: string; category: string; brand: string; model: string; name: string }> = [];

    for (const [zohoItemId, entry] of needsIP) {
      const zohoItem = zohoById.get(zohoItemId);
      const itemName = zohoItem?.name || entry.soName;
      const itemSku = zohoItem?.sku || entry.soSku;
      const groupName = zohoItem?.group_name;

      const category = autoCategory(itemName, itemSku, groupName);
      const brand = extractBrand(itemName, itemSku);
      const model = extractModel(itemName, itemSku, brand);

      // Check if IP already exists with this category+brand+model (unique constraint)
      const existing = await prisma.internalProduct.findFirst({
        where: { category, brand, model, isActive: true },
      });

      if (existing) {
        // Link it to this Zoho item if not already linked
        if (!existing.zohoItemId) {
          if (LIVE) {
            await prisma.internalProduct.update({
              where: { id: existing.id },
              data: { zohoItemId },
            });
          }
          console.log(`  → LINKED existing IP [${category}] ${brand} ${model} to Zoho ${zohoItemId}`);
        } else {
          console.log(`  → SKIP: IP already exists [${category}] ${brand} ${model} (zoho: ${existing.zohoItemId})`);
        }
        skipped++;
        continue;
      }

      newIPs.push({ zohoItemId, category, brand, model, name: itemName });

      if (LIVE) {
        try {
          await prisma.internalProduct.create({
            data: {
              category: category as never,
              brand,
              model,
              name: itemName,
              sku: itemSku || undefined,
              zohoItemId,
              isActive: true,
            },
          });
          created++;
          console.log(`  ✓ CREATED [${category.padEnd(22)}] ${brand.padEnd(14)} ${model.substring(0, 40)}`);
        } catch (err) {
          errors++;
          const msg = err instanceof Error ? err.message : String(err);
          console.log(`  ✗ ERROR  [${category.padEnd(22)}] ${brand.padEnd(14)} ${model.substring(0, 40)} — ${msg.substring(0, 60)}`);
        }
      } else {
        console.log(`  + WOULD CREATE [${category.padEnd(22)}] ${brand.padEnd(14)} ${model.substring(0, 40)}`);
      }
    }

    // Category breakdown
    const catCounts: Record<string, number> = {};
    for (const ip of newIPs) catCounts[ip.category] = (catCounts[ip.category] || 0) + 1;
    console.log(`\nPhase 1 summary:`);
    console.log(`  Created: ${LIVE ? created : `(would create ${newIPs.length})`}`);
    console.log(`  Skipped (already exist): ${skipped}`);
    if (errors > 0) console.log(`  Errors: ${errors}`);
    console.log(`  By category:`);
    for (const [cat, count] of Object.entries(catCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${cat}: ${count}`);
    }

    // Save preview
    if (!LIVE) {
      writeFileSync("scripts/phase1-preview.json", JSON.stringify(newIPs, null, 2));
      console.log(`  Saved preview to scripts/phase1-preview.json`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 2: Push all IPs to Zuper
  // ═══════════════════════════════════════════════════════════════════════
  if (!PHASE_FILTER || PHASE_FILTER === 2) {
    console.log(`\n${"─".repeat(70)}`);
    console.log("PHASE 2: Push InternalProducts to Zuper (create where missing)");
    console.log("─".repeat(70));

    // Re-fetch IPs with Zoho links (including newly created ones)
    const allIPs = await prisma.internalProduct.findMany({
      where: {
        isActive: true,
        zohoItemId: { not: null },
      },
      select: {
        id: true, category: true, brand: true, model: true, name: true,
        sku: true, zohoItemId: true, zuperItemId: true,
      },
    });

    const needsZuper = allIPs.filter(p => !p.zuperItemId);
    const alreadyHasZuper = allIPs.filter(p => p.zuperItemId);

    console.log(`IPs with Zoho link: ${allIPs.length}`);
    console.log(`Already have Zuper link: ${alreadyHasZuper.length}`);
    console.log(`Need Zuper creation: ${needsZuper.length}\n`);

    let pushed = 0;
    let pushErrors = 0;
    let pushSkipped = 0;

    for (const ip of needsZuper) {
      const zuperCategory = ZUPER_CATEGORY_MAP[ip.category] || "General";
      const displayName = ip.name || `${ip.brand} ${ip.model}`;

      if (LIVE) {
        try {
          const result = await createOrUpdateZuperPart({
            brand: ip.brand,
            model: ip.model,
            name: displayName,
            sku: ip.sku || ip.model,
            category: zuperCategory,
          });

          // Update IP with Zuper link
          await prisma.internalProduct.update({
            where: { id: ip.id },
            data: { zuperItemId: result.zuperItemId },
          });

          pushed++;
          const verb = result.created ? "CREATED" : "FOUND";
          console.log(`  ✓ ${verb} Zuper: ${displayName.substring(0, 45).padEnd(47)} → ${result.zuperItemId}`);

          // Rate limit: be gentle with Zuper API
          if (pushed % 10 === 0) {
            await new Promise(r => setTimeout(r, 1000));
          }
        } catch (err) {
          pushErrors++;
          const msg = err instanceof Error ? err.message : String(err);
          console.log(`  ✗ ERROR: ${displayName.substring(0, 45)} — ${msg.substring(0, 60)}`);
        }
      } else {
        console.log(`  + WOULD PUSH [${ip.category.padEnd(22)}] ${displayName.substring(0, 50)} → Zuper (${zuperCategory})`);
        pushed++;
      }
    }

    console.log(`\nPhase 2 summary:`);
    console.log(`  Pushed to Zuper: ${LIVE ? pushed : `(would push ${needsZuper.length})`}`);
    console.log(`  Already had Zuper link: ${alreadyHasZuper.length}`);
    if (pushErrors > 0) console.log(`  Errors: ${pushErrors}`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 3: Cross-link Zoho items with cf_zuper_product_id
  // ═══════════════════════════════════════════════════════════════════════
  if (!PHASE_FILTER || PHASE_FILTER === 3) {
    console.log(`\n${"─".repeat(70)}`);
    console.log("PHASE 3: Set cf_zuper_product_id on Zoho items");
    console.log("─".repeat(70));

    // Re-fetch all IPs that now have both Zoho + Zuper links
    const linkedIPs = await prisma.internalProduct.findMany({
      where: {
        isActive: true,
        zohoItemId: { not: null },
        zuperItemId: { not: null },
      },
      select: { id: true, zohoItemId: true, zuperItemId: true, brand: true, model: true },
    });

    console.log(`IPs with both Zoho + Zuper links: ${linkedIPs.length}\n`);

    let updated = 0;
    let updateErrors = 0;
    let alreadySet = 0;

    for (const ip of linkedIPs) {
      // Check if Zoho item already has the Zuper link
      const zohoItem = zohoById.get(ip.zohoItemId!);
      // We don't have cf_zuper_product_id in the listItems response, so just set it
      // (Zoho partial update is idempotent)

      if (LIVE) {
        try {
          const result = await zohoInventory.updateItem(ip.zohoItemId!, {
            cf_zuper_product_id: ip.zuperItemId!,
          });

          if (result.status === "updated") {
            updated++;
            if (updated % 20 === 0) {
              console.log(`  ... updated ${updated}/${linkedIPs.length}`);
            }
          } else {
            updateErrors++;
            console.log(`  ✗ Zoho update failed for ${ip.brand} ${ip.model}: ${result.message}`);
          }

          // Rate limit Zoho
          if (updated % 5 === 0) {
            await new Promise(r => setTimeout(r, 500));
          }
        } catch (err) {
          updateErrors++;
          const msg = err instanceof Error ? err.message : String(err);
          console.log(`  ✗ ERROR: ${ip.brand} ${ip.model} — ${msg.substring(0, 60)}`);
        }
      } else {
        console.log(`  + WOULD SET Zoho ${ip.zohoItemId} → cf_zuper_product_id = ${ip.zuperItemId}`);
        updated++;
      }
    }

    console.log(`\nPhase 3 summary:`);
    console.log(`  Zoho items updated: ${LIVE ? updated : `(would update ${linkedIPs.length})`}`);
    if (updateErrors > 0) console.log(`  Errors: ${updateErrors}`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // FINAL SUMMARY
  // ═══════════════════════════════════════════════════════════════════════
  console.log(`\n${"=".repeat(70)}`);
  console.log("FINAL STATE");
  console.log("=".repeat(70));

  const finalIPs = await prisma.internalProduct.findMany({
    where: { isActive: true },
    select: { zohoItemId: true, zuperItemId: true, hubspotProductId: true },
  });

  console.log(`Active InternalProducts: ${finalIPs.length}`);
  console.log(`  With Zoho link:    ${finalIPs.filter(p => p.zohoItemId).length}`);
  console.log(`  With Zuper link:   ${finalIPs.filter(p => p.zuperItemId).length}`);
  console.log(`  With HubSpot link: ${finalIPs.filter(p => p.hubspotProductId).length}`);
  console.log(`  Full trio (Z+Z+H): ${finalIPs.filter(p => p.zohoItemId && p.zuperItemId && p.hubspotProductId).length}`);
  console.log(`  Zoho + Zuper:      ${finalIPs.filter(p => p.zohoItemId && p.zuperItemId).length}`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
