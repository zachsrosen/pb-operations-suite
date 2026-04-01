/**
 * Step 1: Deactivate InternalProducts with zero external links
 * Step 2: Rematch all 344 Zoho 2026 SO items against remaining products
 *
 * Usage:
 *   npx tsx scripts/cleanup-unlinked-products.ts              # dry-run
 *   npx tsx scripts/cleanup-unlinked-products.ts --live        # execute
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import * as fs from "fs";

const LIVE = process.argv.includes("--live");

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const { canonicalToken } = await import("../src/lib/canonical.js");

  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Cleanup Unlinked Products + Rematch 2026 SO Items`);
  console.log(`  Mode: ${LIVE ? "🔴 LIVE" : "🔵 DRY RUN"}`);
  console.log(`${"=".repeat(60)}\n`);

  // ── Step 1: Find and deactivate unlinked products ────────────────
  const all = await prisma.internalProduct.findMany({
    where: { isActive: true },
    select: {
      id: true, category: true, brand: true, model: true, name: true,
      sku: true, vendorPartNumber: true,
      zohoItemId: true, hubspotProductId: true, zuperItemId: true,
    },
  });

  const noLinks = all.filter(p => !p.zohoItemId && !p.hubspotProductId && !p.zuperItemId);
  const hasLinks = all.filter(p => p.zohoItemId || p.hubspotProductId || p.zuperItemId);

  console.log(`Total active InternalProducts: ${all.length}`);
  console.log(`With at least one external link: ${hasLinks.length}`);
  console.log(`With ZERO links (to deactivate): ${noLinks.length}`);
  console.log();

  // Show categories
  const keepCats: Record<string, number> = {};
  for (const p of hasLinks) keepCats[p.category] = (keepCats[p.category] || 0) + 1;
  console.log("KEEPING (has links) by category:");
  for (const [c, n] of Object.entries(keepCats).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c}: ${n}`);
  }

  const delCats: Record<string, number> = {};
  for (const p of noLinks) delCats[p.category] = (delCats[p.category] || 0) + 1;
  console.log("\nDEACTIVATING (zero links) by category:");
  for (const [c, n] of Object.entries(delCats).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c}: ${n}`);
  }

  console.log("\nFull deactivation list:");
  for (const p of noLinks.sort((a, b) => a.category.localeCompare(b.category) || a.brand.localeCompare(b.brand))) {
    console.log(`  [${p.category.substring(0, 15).padEnd(15)}] ${p.brand.padEnd(14)} ${p.model}`);
  }

  if (LIVE) {
    const ids = noLinks.map(p => p.id);
    const result = await prisma.internalProduct.updateMany({
      where: { id: { in: ids } },
      data: { isActive: false },
    });
    console.log(`\n✓ Deactivated ${result.count} products`);
  } else {
    console.log(`\n(Dry run — would deactivate ${noLinks.length} products)`);
  }

  // ── Step 2: Rematch all 344 SO items against remaining products ──
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Rematching all 2026 SO items against ${hasLinks.length} linked products`);
  console.log(`${"=".repeat(60)}\n`);

  const soReview = JSON.parse(fs.readFileSync("scripts/2026-so-review.json", "utf-8"));
  const allSOItems: Array<{
    name: string; sku: string; times_used: number;
    total_qty: number; unique_sos: number; is_equipment: boolean;
  }> = soReview.itemFrequency;

  // Matching helpers
  function norm(s: string): string {
    return s.replace(/[^a-z0-9]/gi, "").toLowerCase();
  }
  function normLoose(s: string): string {
    return s.toLowerCase().replace(/\b(the|a|an|for|with|and|or|in|of|to|by)\b/g, "").replace(/[^a-z0-9]/g, "");
  }
  function extractModelNumbers(s: string): string[] {
    const models: string[] = [];
    const re = /[A-Z0-9][A-Z0-9._/-]{3,}[A-Z0-9]/gi;
    let m;
    while ((m = re.exec(s)) !== null) models.push(m[0]);
    return models;
  }

  type Product = typeof hasLinks[number];

  // Build indexes
  const skuIndex = new Map<string, Product>();
  const modelIndex = new Map<string, Product>();
  for (const p of hasLinks) {
    if (p.sku) skuIndex.set(norm(p.sku), p);
    if (p.vendorPartNumber) skuIndex.set(norm(p.vendorPartNumber), p);
    modelIndex.set(norm(p.model), p);
  }

  const BRAND_ALIASES: Record<string, string[]> = {
    tesla: ["tesla", "powerwall", "pw3", "pw", "gateway", "neurio"],
    ironridge: ["ironridge", "iron ridge", "iridg"],
    hyundai: ["hyundai"],
    alpine: ["alpine", "alpine snowguards", "snowmax"],
    enphase: ["enphase", "enp"],
    imo: ["imo"],
    unirac: ["unirac"],
    heyco: ["heyco", "sunscreener"],
    solaredge: ["solaredge", "solar edge"],
    siemens: ["siemens"],
    ge: ["ge"],
    eaton: ["eaton", "cutlerhammer", "cutler"],
    "square d": ["square d", "sqd", "schneider", "hom"],
    "s-5!": ["s-5!", "s-5"],
    seg: ["seg solar", "seg", "silfab", "lightspeed"],
    milbank: ["milbank"],
    arlington: ["arlington", "myers hub"],
    "ez solar": ["ez solar", "ezslr", "soladeck"],
    "xcel energy": ["xcel energy", "xcel"],
    rec: ["rec"],
    ilsco: ["ilsco"],
    "generic": ["generic"],
  };

  function extractBrand(soName: string): string | null {
    const lower = soName.toLowerCase();
    for (const [canonical, aliases] of Object.entries(BRAND_ALIASES)) {
      for (const alias of aliases) {
        if (lower.startsWith(alias + " ") || lower.includes(alias)) return canonical;
      }
    }
    return null;
  }

  interface MatchResult {
    so_item_name: string;
    so_sku: string;
    times_used: number;
    total_qty: number;
    unique_sos: number;
    is_equipment: boolean;
    match_status: "MATCHED" | "NOT_FOUND";
    match_method: string;
    ip_id: string;
    ip_category: string;
    ip_brand: string;
    ip_model: string;
    ip_name: string;
    ip_zoho_linked: boolean;
    ip_hubspot_linked: boolean;
    ip_zuper_linked: boolean;
  }

  const results: MatchResult[] = [];
  let matched = 0;
  let notFound = 0;

  for (const soItem of allSOItems) {
    const soSku = soItem.sku || "";
    const soName = soItem.name;
    let best: Product | null = null;
    let method = "";

    // Strategy 1: Exact SKU match
    if (soSku) {
      best = skuIndex.get(norm(soSku)) || null;
      if (best) method = "Exact SKU";
    }

    // Strategy 2: Compound SKU parts (e.g. "2101175/ HW-RD1430-01-M1")
    if (!best && soSku.includes("/")) {
      for (const part of soSku.split("/")) {
        const np = norm(part.trim());
        if (np.length >= 4) {
          best = skuIndex.get(np) || modelIndex.get(np) || null;
          if (best) { method = "SKU part"; break; }
        }
      }
    }

    // Strategy 3: SO SKU as IP model
    if (!best && soSku) {
      const ns = norm(soSku);
      if (ns.length >= 4) {
        best = modelIndex.get(ns) || null;
        if (best) method = "SKU as model";
      }
    }

    // Strategy 4: Model numbers extracted from SO name
    if (!best) {
      for (const m of extractModelNumbers(soName)) {
        const nm = norm(m);
        if (nm.length >= 4) {
          best = modelIndex.get(nm) || null;
          if (best) { method = "Model # extract"; break; }
          // Fuzzy: placeholder-stripped match
          for (const p of hasLinks) {
            const pm = norm(p.model);
            const stripped = (s: string) => s.replace(/xx/g, "").replace(/yy/g, "").replace(/[xy]/g, "").replace(/[^a-z0-9]/g, "");
            if (pm.length >= 5 && (stripped(nm).includes(stripped(pm)) || stripped(pm).includes(stripped(nm)))) {
              best = p; method = "Model # fuzzy"; break;
            }
          }
          if (best) break;
        }
      }
    }

    // Strategy 5: Model numbers from SO SKU
    if (!best && soSku) {
      for (const m of extractModelNumbers(soSku)) {
        const nm = norm(m);
        if (nm.length >= 4) {
          best = modelIndex.get(nm) || null;
          if (best) { method = "SKU model exact"; break; }
          for (const p of hasLinks) {
            const pm = norm(p.model);
            const stripped = (s: string) => s.replace(/xx/g, "").replace(/yy/g, "").replace(/[xy]/g, "").replace(/[^a-z0-9]/g, "");
            if (pm.length >= 5 && (stripped(nm).includes(stripped(pm)) || stripped(pm).includes(stripped(nm)))) {
              best = p; method = "SKU model fuzzy"; break;
            }
          }
          if (best) break;
        }
      }
    }

    // Strategy 6: Brand + model keyword match
    if (!best) {
      const brand = extractBrand(soName) || extractBrand(soSku);
      if (brand) {
        const bp = hasLinks.filter(
          p => p.brand.toLowerCase().includes(brand!) ||
               (p.name || "").toLowerCase().includes(brand!)
        );
        if (bp.length > 0) {
          const soWords = (soName + " " + soSku).toLowerCase().split(/[\s,;()]+/).filter(w => w.length >= 3);
          for (const p of bp) {
            const pm = p.model.toLowerCase();
            const pn = (p.name || "").toLowerCase();
            for (const word of soWords) {
              if (pm.includes(word) || pn.includes(word)) {
                best = p; method = "Brand + keyword"; break;
              }
            }
            if (best) break;
          }
        }
      }
    }

    // Strategy 7: SO name contains canonical model
    if (!best) {
      const nn = normLoose(soName + " " + soSku);
      for (const p of hasLinks) {
        const cm = canonicalToken(p.model);
        if (cm.length >= 5 && nn.includes(cm)) {
          best = p; method = "Canonical in name"; break;
        }
      }
    }

    // Strategy 8: SO SKU substring in any IP field
    if (!best && soSku) {
      const ns = norm(soSku);
      if (ns.length >= 6) {
        for (const p of hasLinks) {
          const fields = [p.model, p.sku || "", p.vendorPartNumber || "", p.name || ""];
          if (fields.some(f => {
            const nf = norm(f);
            return nf.length >= 5 && (nf.includes(ns) || ns.includes(nf));
          })) {
            best = p; method = "SKU substring"; break;
          }
        }
      }
    }

    if (best) {
      matched++;
      results.push({
        so_item_name: soName, so_sku: soSku,
        times_used: soItem.times_used, total_qty: soItem.total_qty,
        unique_sos: soItem.unique_sos, is_equipment: soItem.is_equipment,
        match_status: "MATCHED", match_method: method,
        ip_id: best.id, ip_category: best.category, ip_brand: best.brand,
        ip_model: best.model, ip_name: best.name || `${best.brand} ${best.model}`,
        ip_zoho_linked: !!best.zohoItemId, ip_hubspot_linked: !!best.hubspotProductId,
        ip_zuper_linked: !!best.zuperItemId,
      });
    } else {
      notFound++;
      results.push({
        so_item_name: soName, so_sku: soSku,
        times_used: soItem.times_used, total_qty: soItem.total_qty,
        unique_sos: soItem.unique_sos, is_equipment: soItem.is_equipment,
        match_status: "NOT_FOUND", match_method: "",
        ip_id: "", ip_category: "", ip_brand: "", ip_model: "", ip_name: "",
        ip_zoho_linked: false, ip_hubspot_linked: false, ip_zuper_linked: false,
      });
    }
  }

  results.sort((a, b) => {
    if (a.match_status !== b.match_status) return a.match_status === "MATCHED" ? -1 : 1;
    return b.times_used - a.times_used;
  });

  // Count unique IPs
  const uniqueIPids = new Set(results.filter(r => r.ip_id).map(r => r.ip_id));

  console.log(`Match results for ${allSOItems.length} SO items:`);
  console.log(`  MATCHED:   ${matched} (${(matched / allSOItems.length * 100).toFixed(1)}%)`);
  console.log(`  NOT_FOUND: ${notFound} (${(notFound / allSOItems.length * 100).toFixed(1)}%)`);
  console.log(`  Unique InternalProducts matched: ${uniqueIPids.size}`);

  // Method breakdown
  const methodCounts = new Map<string, number>();
  for (const r of results) {
    if (r.match_method) methodCounts.set(r.match_method, (methodCounts.get(r.match_method) || 0) + 1);
  }
  console.log("\nMatch methods:");
  for (const [m, c] of [...methodCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${m}: ${c}`);
  }

  // Show collisions (IPs matching many SO items)
  const ipMatchCount = new Map<string, { name: string; count: number; soItems: string[] }>();
  for (const r of results) {
    if (!r.ip_id) continue;
    const entry = ipMatchCount.get(r.ip_id) || { name: r.ip_name, count: 0, soItems: [] };
    entry.count++;
    entry.soItems.push(r.so_item_name.substring(0, 50));
    ipMatchCount.set(r.ip_id, entry);
  }
  const collisions = [...ipMatchCount.entries()]
    .filter(([, v]) => v.count >= 4)
    .sort((a, b) => b[1].count - a[1].count);
  if (collisions.length > 0) {
    console.log(`\n⚠ Products matching 4+ SO items (potential over-matching):`);
    for (const [, v] of collisions) {
      console.log(`  ${v.name.substring(0, 50).padEnd(52)} → ${v.count} SO items`);
      for (const s of v.soItems) console.log(`    - ${s}`);
    }
  }

  // Show NOT_FOUND
  const notFoundList = results.filter(r => r.match_status === "NOT_FOUND");
  console.log(`\n=== NOT FOUND (${notFoundList.length}) ===`);
  for (const r of notFoundList) {
    const e = r.is_equipment ? "Y" : "-";
    console.log(`  [${e}] ${r.so_item_name.substring(0, 55).padEnd(57)} SKU: ${(r.so_sku || "-").substring(0, 25).padEnd(27)} SOs: ${r.unique_sos}`);
  }

  // Write output
  const output = {
    summary: {
      totalSOItems: allSOItems.length,
      matched,
      notFound,
      matchRate: (matched / allSOItems.length * 100).toFixed(1) + "%",
      uniqueIPsMatched: uniqueIPids.size,
      productsWithLinks: hasLinks.length,
      productsDeactivated: noLinks.length,
    },
    comparison: results,
  };
  fs.writeFileSync("scripts/2026-so-rematch.json", JSON.stringify(output, null, 2));
  console.log("\nResults written to scripts/2026-so-rematch.json");

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
