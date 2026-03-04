/**
 * Compare QuickBooks products (from CatalogProduct DB) with Zoho Inventory items.
 * Shows which QB products have Zoho matches and vice versa.
 *
 * Usage: npx tsx scripts/compare-qb-zoho.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config();

// ---------- Zoho API ----------

const BASE_URL = process.env.ZOHO_INVENTORY_API_BASE_URL || "https://www.zohoapis.com/inventory/v1";
const ORG_ID = process.env.ZOHO_INVENTORY_ORG_ID!;
let currentToken = process.env.ZOHO_INVENTORY_ACCESS_TOKEN || "";

async function refreshToken(): Promise<string> {
  const params = new URLSearchParams({
    refresh_token: process.env.ZOHO_INVENTORY_REFRESH_TOKEN!,
    client_id: process.env.ZOHO_INVENTORY_CLIENT_ID!,
    client_secret: process.env.ZOHO_INVENTORY_CLIENT_SECRET!,
    grant_type: "refresh_token",
  });
  const res = await fetch(
    `${process.env.ZOHO_ACCOUNTS_BASE_URL || "https://accounts.zoho.com"}/oauth/v2/token?${params}`,
    { method: "POST" }
  );
  const data = await res.json();
  if (!data.access_token) throw new Error("Token refresh failed");
  currentToken = data.access_token;
  return currentToken;
}

async function zohoFetch(path: string, attempt = 0): Promise<any> {
  if (!currentToken) await refreshToken();
  const url = `${BASE_URL}${path}${path.includes("?") ? "&" : "?"}organization_id=${ORG_ID}`;
  const res = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${currentToken}` } });
  if (res.status === 401 && attempt === 0) { await refreshToken(); return zohoFetch(path, 1); }
  if (res.status === 429 && attempt < 3) {
    await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
    return zohoFetch(path, attempt + 1);
  }
  if (!res.ok) throw new Error(`Zoho ${res.status}: ${await res.text()}`);
  return res.json();
}

// ---------- DB ----------

async function getQBProducts() {
  const { PrismaClient } = await import("../src/generated/prisma/client");
  const { PrismaNeon } = await import("@prisma/adapter-neon");

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL not set");

  const adapter = new PrismaNeon({ connectionString });
  const prisma = new PrismaClient({ adapter });

  try {
    const qbProducts = await prisma.catalogProduct.findMany({
      where: { source: "QUICKBOOKS" },
      orderBy: { name: "asc" },
    });
    // Also get EquipmentSku with quickbooksItemId set
    const linkedSkus = await prisma.equipmentSku.findMany({
      where: {
        NOT: [
          { quickbooksItemId: null },
          { quickbooksItemId: "" },
        ],
      },
      select: {
        id: true,
        brand: true,
        model: true,
        sku: true,
        quickbooksItemId: true,
        zohoItemId: true,
      },
    });
    return { qbProducts, linkedSkus, prisma };
  } catch (err) {
    await prisma.$disconnect();
    throw err;
  }
}

// ---------- Helpers ----------

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

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

// ---------- Main ----------

async function main() {
  // 1. Fetch all Zoho items
  console.log("Fetching Zoho Inventory items...");
  const zohoItems: any[] = [];
  let page = 1;
  let hasMore = true;
  while (hasMore) {
    process.stdout.write(`  Page ${page}...`);
    const data = await zohoFetch(`/items?page=${page}&per_page=200`);
    zohoItems.push(...(data.items || []));
    process.stdout.write(` ${(data.items || []).length} items\n`);
    hasMore = data.page_context?.has_more_page === true;
    page++;
  }
  console.log(`  Total Zoho items: ${zohoItems.length}`);

  // 2. Fetch QB products from DB
  console.log("\nFetching QuickBooks products from database...");
  const { qbProducts, linkedSkus, prisma } = await getQBProducts();
  console.log(`  QB CatalogProducts: ${qbProducts.length}`);
  console.log(`  EquipmentSkus with QB link: ${linkedSkus.length}`);

  // 3. Build indexes for matching
  const zohoByNormalizedName = new Map<string, any[]>();
  const zohoByNormalizedSku = new Map<string, any[]>();
  for (const z of zohoItems) {
    const nn = normalize(z.name || "");
    if (nn) {
      if (!zohoByNormalizedName.has(nn)) zohoByNormalizedName.set(nn, []);
      zohoByNormalizedName.get(nn)!.push(z);
    }
    const ns = normalize(z.sku || "");
    if (ns) {
      if (!zohoByNormalizedSku.has(ns)) zohoByNormalizedSku.set(ns, []);
      zohoByNormalizedSku.get(ns)!.push(z);
    }
  }

  // 4. Try to match QB → Zoho
  console.log("\n=== MATCHING QB → ZOHO ===\n");

  const matches: Array<{
    qb: typeof qbProducts[0];
    zoho: any;
    matchType: string;
  }> = [];
  const noMatch: typeof qbProducts = [];
  const ambiguous: Array<{
    qb: typeof qbProducts[0];
    zohoMatches: any[];
    matchType: string;
  }> = [];

  for (const qb of qbProducts) {
    const qbName = normalize(qb.name || "");
    const qbSku = normalize(qb.sku || "");

    // Try SKU match first
    if (qbSku) {
      const skuMatches = zohoByNormalizedSku.get(qbSku);
      if (skuMatches?.length === 1) {
        matches.push({ qb, zoho: skuMatches[0], matchType: "SKU" });
        continue;
      }
      if (skuMatches && skuMatches.length > 1) {
        ambiguous.push({ qb, zohoMatches: skuMatches, matchType: "SKU" });
        continue;
      }
    }

    // Try name match
    if (qbName) {
      const nameMatches = zohoByNormalizedName.get(qbName);
      if (nameMatches?.length === 1) {
        matches.push({ qb, zoho: nameMatches[0], matchType: "Name" });
        continue;
      }
      if (nameMatches && nameMatches.length > 1) {
        ambiguous.push({ qb, zohoMatches: nameMatches, matchType: "Name" });
        continue;
      }
    }

    noMatch.push(qb);
  }

  console.log(`  Matched:   ${matches.length}`);
  console.log(`  Ambiguous: ${ambiguous.length}`);
  console.log(`  No match:  ${noMatch.length}`);

  // 5. Check reverse — Zoho items NOT in QB
  const matchedZohoIds = new Set(matches.map((m) => m.zoho.item_id));
  const ambiguousZohoIds = new Set(ambiguous.flatMap((a) => a.zohoMatches.map((z: any) => z.item_id)));
  const zohoNotInQB = zohoItems.filter(
    (z) => z.status === "active" && !matchedZohoIds.has(z.item_id) && !ambiguousZohoIds.has(z.item_id)
  );
  console.log(`\n  Active Zoho items NOT in QB: ${zohoNotInQB.length}`);

  // 6. Write CSV with full cross-reference
  const { writeFileSync } = await import("fs");
  const outDir = "/Users/zach/Downloads";

  // CSV 1: QB Products with Zoho match status
  const qbHeader = csvRow([
    "QB External ID",
    "QB Name",
    "QB SKU",
    "QB Type",
    "QB Price",
    "QB Description",
    "Match Status",
    "Match Type",
    "Zoho Item ID",
    "Zoho Name",
    "Zoho SKU",
    "Zoho Category",
    "Zoho Stock",
    "Zoho Cost",
    "Zoho Sell Price",
    "Zoho Status",
    "Notes (team)",
  ]);

  const qbRows: string[] = [];

  // Matched items first
  for (const m of matches) {
    qbRows.push(csvRow([
      m.qb.externalId,
      m.qb.name || "",
      m.qb.sku || "",
      m.qb.status || "",
      m.qb.price || "",
      (m.qb.description || "").slice(0, 200),
      "MATCHED",
      m.matchType,
      m.zoho.item_id,
      m.zoho.name,
      m.zoho.sku || "",
      m.zoho.category_name || "",
      m.zoho.stock_on_hand || "",
      m.zoho.purchase_rate || "",
      m.zoho.rate || "",
      m.zoho.status,
      "",
    ]));
  }

  // Ambiguous
  for (const a of ambiguous) {
    const zohoNames = a.zohoMatches.map((z: any) => z.name).join(" | ");
    qbRows.push(csvRow([
      a.qb.externalId,
      a.qb.name || "",
      a.qb.sku || "",
      a.qb.status || "",
      a.qb.price || "",
      (a.qb.description || "").slice(0, 200),
      "AMBIGUOUS",
      a.matchType,
      a.zohoMatches.map((z: any) => z.item_id).join(" | "),
      zohoNames,
      a.zohoMatches.map((z: any) => z.sku || "").join(" | "),
      "",
      "",
      "",
      "",
      "",
      "",
    ]));
  }

  // No match
  for (const qb of noMatch) {
    qbRows.push(csvRow([
      qb.externalId,
      qb.name || "",
      qb.sku || "",
      qb.status || "",
      qb.price || "",
      (qb.description || "").slice(0, 200),
      "NO MATCH",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ]));
  }

  writeFileSync(`${outDir}/qb-zoho-comparison.csv`, [qbHeader, ...qbRows].join("\n"));

  // CSV 2: Zoho items NOT in QB
  const zohoOnlyHeader = csvRow([
    "Zoho Item ID",
    "Zoho Name",
    "Zoho SKU",
    "Zoho Category",
    "Zoho Brand",
    "Zoho Manufacturer",
    "Zoho Stock",
    "Zoho Cost",
    "Zoho Sell Price",
    "Zoho Status",
    "Zoho Created",
    "Action (team)",
    "Notes (team)",
  ]);

  const zohoOnlyRows = zohoNotInQB.map((z) =>
    csvRow([
      z.item_id,
      z.name,
      z.sku || "",
      z.category_name || "",
      z.brand || "",
      z.manufacturer || "",
      z.stock_on_hand || "",
      z.purchase_rate || "",
      z.rate || "",
      z.status,
      z.created_time || "",
      "",
      "",
    ])
  );

  writeFileSync(`${outDir}/zoho-only-not-in-qb.csv`, [zohoOnlyHeader, ...zohoOnlyRows].join("\n"));

  // Summary
  console.log(`\n✅ Exported to ${outDir}/:`);
  console.log(`   qb-zoho-comparison.csv      — ${qbProducts.length} QB products with Zoho match status`);
  console.log(`   zoho-only-not-in-qb.csv     — ${zohoNotInQB.length} active Zoho items with no QB match`);

  console.log(`\n=== SUMMARY ===`);
  console.log(`  QB products total:             ${qbProducts.length}`);
  console.log(`  QB → Zoho matched:             ${matches.length} (${(matches.length / qbProducts.length * 100).toFixed(1)}%)`);
  console.log(`  QB → Zoho ambiguous:           ${ambiguous.length}`);
  console.log(`  QB → Zoho no match:            ${noMatch.length}`);
  console.log(`  Active Zoho not in QB:         ${zohoNotInQB.length}`);
  console.log(`  EquipmentSkus with QB link:    ${linkedSkus.length}`);

  // Show some interesting no-match examples
  if (noMatch.length > 0) {
    console.log(`\n  Sample QB items with NO Zoho match:`);
    for (const qb of noMatch.slice(0, 15)) {
      console.log(`    - ${qb.name} (SKU: ${qb.sku || "none"})`);
    }
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
