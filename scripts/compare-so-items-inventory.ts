import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaNeon } from "@prisma/adapter-neon";
import * as fs from "fs";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

interface SOItemFreq {
  name: string;
  sku: string;
  times_used: number;
  total_qty: number;
  unique_sos: number;
  is_equipment: boolean;
  so_numbers: string;
}

type IPRecord = {
  id: string;
  category: string;
  brand: string;
  model: string;
  name: string | null;
  sku: string | null;
  zohoItemId: string | null;
  hubspotProductId: string | null;
  zuperItemId: string | null;
  vendorPartNumber: string | null;
  canonicalBrand: string | null;
  canonicalModel: string | null;
  unitCost: number | null;
  sellPrice: number | null;
};

function norm(s: string): string {
  return s.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function normLoose(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(the|a|an|for|with|and|or|in|of|to|by)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function extractModelNumbers(s: string): string[] {
  const models: string[] = [];
  const re = /[A-Z0-9][A-Z0-9._-]{3,}[A-Z0-9]/gi;
  let m;
  while ((m = re.exec(s)) !== null) {
    models.push(m[0]);
  }
  return models;
}

function modelsMatch(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (na === nb) return true;
  const normPlaceholder = (s: string) =>
    s.replace(/xx/g, "").replace(/yy/g, "").replace(/[xy]/g, "").replace(/[^a-z0-9]/g, "");
  const pa = normPlaceholder(a.toLowerCase());
  const pb = normPlaceholder(b.toLowerCase());
  if (pa.length >= 5 && pb.length >= 5 && (pa.includes(pb) || pb.includes(pa))) return true;
  return false;
}

const BRAND_ALIASES: Record<string, string[]> = {
  tesla: ["tesla", "powerwall", "pw3", "pw", "gateway"],
  ironridge: ["ironridge", "iron ridge", "iridg"],
  hyundai: ["hyundai"],
  alpine: ["alpine", "alpine snowguards"],
  enphase: ["enphase", "enp"],
  imo: ["imo"],
  unirac: ["unirac"],
  heyco: ["heyco", "sunscreener"],
  solaredge: ["solaredge", "solar edge"],
  siemens: ["siemens"],
  ge: ["ge"],
  eaton: ["eaton"],
  "square d": ["square d", "sqd", "schneider"],
  "s-5!": ["s-5!", "s-5"],
  seg: ["seg solar", "seg", "silfab"],
  milbank: ["milbank"],
  arlington: ["arlington", "myers hub"],
  "ez solar": ["ez solar", "ezslr", "soladeck"],
  "xcel energy": ["xcel energy", "xcel"],
  rec: ["rec"],
};

function extractBrand(soName: string): string | null {
  const lower = soName.toLowerCase();
  for (const [canonical, aliases] of Object.entries(BRAND_ALIASES)) {
    for (const alias of aliases) {
      if (lower.startsWith(alias + " ") || lower.includes(alias)) {
        return canonical;
      }
    }
  }
  return null;
}

const STATIC_MATCHES: Record<string, { brand: string; modelContains: string }[]> = {
  "powerwall 3": [{ brand: "tesla", modelContains: "powerwall-3" }, { brand: "tesla", modelContains: "1707000" }],
  "backup switch": [{ brand: "tesla", modelContains: "1624171" }, { brand: "tesla", modelContains: "backup" }],
  "mci-2": [{ brand: "tesla", modelContains: "mci-2" }, { brand: "tesla", modelContains: "mci2" }],
  "gateway 3": [{ brand: "tesla", modelContains: "gateway" }, { brand: "tesla", modelContains: "1841000" }],
  "halo ultragrip": [{ brand: "ironridge", modelContains: "hug" }, { brand: "ironridge", modelContains: "qm-hug" }],
  "ultragrip": [{ brand: "ironridge", modelContains: "hug" }],
  "snow dog": [{ brand: "alpine", modelContains: "snow" }, { brand: "ironridge", modelContains: "snow" }],
  "critter guard": [{ brand: "sunscreener", modelContains: "critter" }],
  "expansion harness": [{ brand: "tesla", modelContains: "1875157" }],
  "remote meter energy": [{ brand: "tesla", modelContains: "2045796" }],
  "remote meter hardwire": [{ brand: "tesla", modelContains: "p2045794" }],
  "expansion wall mount": [{ brand: "tesla", modelContains: "1978069" }],
  "expansion stacking": [{ brand: "tesla", modelContains: "1978070" }],
  "solar inverter 7.6": [{ brand: "tesla", modelContains: "1538" }],
  "t-bolt bonding": [{ brand: "ironridge", modelContains: "bhw-tb" }],
  "structural screw": [{ brand: "ironridge", modelContains: "hw-rd1430" }],
  "grounding lug": [{ brand: "ironridge", modelContains: "gbl" }, { brand: "ilsco", modelContains: "gbl" }],
  "module clamp": [{ brand: "ironridge", modelContains: "ufo" }],
  "end clamp": [{ brand: "ironridge", modelContains: "ufo-end" }, { brand: "ironridge", modelContains: "end" }],
  "mid clamp": [{ brand: "ironridge", modelContains: "ufo-mid" }, { brand: "ironridge", modelContains: "mid" }],
  "rail splice": [{ brand: "ironridge", modelContains: "boss" }, { brand: "ironridge", modelContains: "splice" }],
  "strain relief": [{ brand: "arlington", modelContains: "m3317" }, { brand: "myers hub", modelContains: "m3317" }],
  "solobox": [{ brand: "unirac", modelContains: "sbox" }],
  "camo end": [{ brand: "ironridge", modelContains: "camo" }],
  "ev charger": [{ brand: "tesla", modelContains: "1734" }, { brand: "generic", modelContains: "ev" }],
  "wall connector": [{ brand: "tesla", modelContains: "1734" }],
  "insulation piercing": [{ brand: "ironridge", modelContains: "bipc" }],
  "meter housing": [{ brand: "milbank", modelContains: "" }, { brand: "xcel energy", modelContains: "meter" }],
  "production meter": [{ brand: "xcel energy", modelContains: "" }],
  "pv junction box": [{ brand: "ez solar", modelContains: "jb" }],
  "jb-3": [{ brand: "ez solar", modelContains: "jb" }],
  "jb 1.2": [{ brand: "ez solar", modelContains: "jb-1.2" }],
  "proteabracket": [{ brand: "s-5!", modelContains: "protea" }],
  "s-5-u": [{ brand: "s-5!", modelContains: "s-5-u" }],
};

function findStaticMatch(soName: string, products: IPRecord[]): IPRecord | null {
  const lower = soName.toLowerCase();
  for (const [keyword, candidates] of Object.entries(STATIC_MATCHES)) {
    if (lower.includes(keyword)) {
      for (const { brand, modelContains } of candidates) {
        const match = products.find(
          (p) =>
            p.brand.toLowerCase().includes(brand) &&
            (modelContains === "" || p.model.toLowerCase().includes(modelContains))
        );
        if (match) return match;
      }
    }
  }
  return null;
}

async function main() {
  const raw = JSON.parse(fs.readFileSync("scripts/2026-so-review.json", "utf-8"));
  const allItems: SOItemFreq[] = raw.itemFrequency;
  const multiSOItems = allItems.filter((i) => i.unique_sos >= 2);
  console.log("Items on 2+ SOs: " + multiSOItems.length);

  const products = await prisma.internalProduct.findMany({
    where: { isActive: true },
    select: {
      id: true, category: true, brand: true, model: true, name: true, sku: true,
      zohoItemId: true, hubspotProductId: true, zuperItemId: true,
      vendorPartNumber: true, canonicalBrand: true, canonicalModel: true,
      unitCost: true, sellPrice: true,
    },
  });
  console.log("Active InternalProducts: " + products.length);

  const skuIndex = new Map<string, IPRecord>();
  const modelIndex = new Map<string, IPRecord>();

  for (const p of products) {
    if (p.sku) skuIndex.set(norm(p.sku), p);
    if (p.vendorPartNumber) skuIndex.set(norm(p.vendorPartNumber), p);
    modelIndex.set(norm(p.model), p);
  }

  const results: Array<{
    so_item_name: string;
    so_sku: string;
    times_used: number;
    total_qty: number;
    unique_sos: number;
    match_status: "MATCHED" | "NOT_FOUND";
    match_method: string;
    ip_id: string;
    ip_category: string;
    ip_brand: string;
    ip_model: string;
    ip_name: string;
    ip_sku: string;
    ip_zoho_linked: boolean;
    ip_hubspot_linked: boolean;
    ip_zuper_linked: boolean;
    ip_unit_cost: number | null;
    ip_sell_price: number | null;
  }> = [];

  let matched = 0;
  let notFound = 0;

  for (const soItem of multiSOItems) {
    const soSku = soItem.sku || "";
    const soName = soItem.name;
    let best: IPRecord | null = null;
    let method = "";

    // Strategy 1: Exact SKU
    if (soSku) {
      best = skuIndex.get(norm(soSku)) || null;
      if (best) method = "Exact SKU";
    }

    // Strategy 2: Compound SKU parts
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

    // Strategy 4: Static keyword aliases
    if (!best) {
      best = findStaticMatch(soName, products);
      if (best) method = "Keyword alias";
    }

    // Strategy 5: Model numbers from SO name
    if (!best) {
      for (const m of extractModelNumbers(soName)) {
        if (norm(m).length >= 4) {
          best = modelIndex.get(norm(m)) || null;
          if (!best) {
            for (const p of products) {
              if (modelsMatch(m, p.model)) { best = p; method = "Model # fuzzy"; break; }
            }
          } else { method = "Model # extract"; }
          if (best) break;
        }
      }
    }

    // Strategy 6: Model numbers from SO SKU
    if (!best && soSku) {
      for (const m of extractModelNumbers(soSku)) {
        for (const p of products) {
          if (modelsMatch(m, p.model)) { best = p; method = "SKU model fuzzy"; break; }
        }
        if (best) break;
      }
    }

    // Strategy 7: Brand + keyword
    if (!best) {
      const brand = extractBrand(soName);
      if (brand) {
        const bp = products.filter(
          (p) => p.brand.toLowerCase().includes(brand) || (p.canonicalBrand || "").includes(brand.replace(/[^a-z]/g, ""))
        );
        if (bp.length > 0) {
          const soWords = soName.toLowerCase().split(/[\s,;()]+/).filter((w) => w.length >= 3);
          for (const p of bp) {
            const pm = p.model.toLowerCase();
            for (const word of soWords) {
              if (pm.includes(word) || norm(word) === norm(pm)) { best = p; method = "Brand + keyword"; break; }
            }
            if (best) break;
          }
          if (!best && bp.length <= 3) { best = bp[0]; method = "Brand only"; }
        }
      }
    }

    // Strategy 8: Canonical model in name
    if (!best) {
      const nn = normLoose(soName);
      for (const p of products) {
        const cm = p.canonicalModel || norm(p.model);
        if (cm.length >= 5 && nn.includes(cm)) { best = p; method = "Canonical in name"; break; }
      }
    }

    // Strategy 9: SO SKU substring in any IP field
    if (!best && soSku) {
      const ns = norm(soSku);
      if (ns.length >= 6) {
        for (const p of products) {
          const fields = [p.model, p.sku || "", p.vendorPartNumber || "", p.name || ""];
          if (fields.some((f) => { const nf = norm(f); return nf.length >= 5 && (nf.includes(ns) || ns.includes(nf)); })) {
            best = p; method = "SKU substring"; break;
          }
        }
      }
    }

    if (best) {
      matched++;
      results.push({
        so_item_name: soName, so_sku: soSku,
        times_used: soItem.times_used, total_qty: soItem.total_qty, unique_sos: soItem.unique_sos,
        match_status: "MATCHED", match_method: method,
        ip_id: best.id, ip_category: best.category, ip_brand: best.brand, ip_model: best.model,
        ip_name: best.name || best.brand + " " + best.model, ip_sku: best.sku || "",
        ip_zoho_linked: !!best.zohoItemId, ip_hubspot_linked: !!best.hubspotProductId, ip_zuper_linked: !!best.zuperItemId,
        ip_unit_cost: best.unitCost, ip_sell_price: best.sellPrice,
      });
    } else {
      notFound++;
      results.push({
        so_item_name: soName, so_sku: soSku,
        times_used: soItem.times_used, total_qty: soItem.total_qty, unique_sos: soItem.unique_sos,
        match_status: "NOT_FOUND", match_method: "",
        ip_id: "", ip_category: "", ip_brand: "", ip_model: "", ip_name: "", ip_sku: "",
        ip_zoho_linked: false, ip_hubspot_linked: false, ip_zuper_linked: false,
        ip_unit_cost: null, ip_sell_price: null,
      });
    }
  }

  results.sort((a, b) => {
    if (a.match_status !== b.match_status) return a.match_status === "MATCHED" ? -1 : 1;
    return b.times_used - a.times_used;
  });

  console.log("\nMatch results for " + multiSOItems.length + " items on 2+ SOs:");
  console.log("  MATCHED:   " + matched + " (" + (matched / multiSOItems.length * 100).toFixed(1) + "%)");
  console.log("  NOT_FOUND: " + notFound + " (" + (notFound / multiSOItems.length * 100).toFixed(1) + "%)");

  const methodCounts = new Map<string, number>();
  for (const r of results) {
    if (r.match_method) methodCounts.set(r.match_method, (methodCounts.get(r.match_method) || 0) + 1);
  }
  console.log("\nMatch methods:");
  for (const [m, c] of [...methodCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log("  " + m + ": " + c);
  }

  const matchedIpIds = new Set(results.filter((r) => r.ip_id).map((r) => r.ip_id));
  const allSOSkus = new Set(allItems.map((i) => norm(i.sku || "")).filter(Boolean));
  const unusedProducts = products.filter((p) => {
    if (matchedIpIds.has(p.id)) return false;
    const pSku = norm(p.sku || "");
    if (pSku && allSOSkus.has(pSku)) return false;
    return true;
  });
  console.log("\nUnused InternalProducts: " + unusedProducts.length + " of " + products.length);

  const output = {
    summary: {
      soItemsOn2PlusSOs: multiSOItems.length,
      matched,
      notFound,
      matchRate: (matched / multiSOItems.length * 100).toFixed(1) + "%",
      totalInternalProducts: products.length,
      unusedInternalProducts: unusedProducts.length,
    },
    comparison: results,
    unusedProducts: unusedProducts.map((p) => ({
      id: p.id, category: p.category, brand: p.brand, model: p.model,
      name: p.name || p.brand + " " + p.model, sku: p.sku || "",
      zoho_linked: !!p.zohoItemId, hubspot_linked: !!p.hubspotProductId, zuper_linked: !!p.zuperItemId,
    })),
  };

  fs.writeFileSync("scripts/2026-so-inventory-comparison.json", JSON.stringify(output, null, 2));
  console.log("\nData written to scripts/2026-so-inventory-comparison.json");

  const notFoundItems = results.filter((r) => r.match_status === "NOT_FOUND");
  if (notFoundItems.length > 0) {
    console.log("\n=== Still NOT Found (" + notFoundItems.length + ") ===");
    for (const item of notFoundItems) {
      console.log("  " + item.so_item_name.substring(0, 55).padEnd(57) + "SKU: " + (item.so_sku || "-").substring(0, 25).padEnd(27) + "Used: " + item.times_used);
    }
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
