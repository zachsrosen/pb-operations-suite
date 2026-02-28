#!/usr/bin/env npx tsx
/**
 * Parse a QuickBooks product export (.xls/.xlsx) and seed into CatalogProduct cache.
 *
 * Usage:
 *   npx tsx scripts/seed-qb-products.ts path/to/ProductServiceList.xls
 *
 * Requires:
 *   API_SECRET_TOKEN env var (or pass via --token flag)
 *   API base URL defaults to http://localhost:3000 (or pass via --url flag)
 */

import * as XLSX from "xlsx";
import { resolve } from "path";

interface QBProduct {
  name: string;
  sku?: string;
  type?: string;
  price?: number;
  description?: string;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let filePath = "";
  let apiUrl = process.env.API_BASE_URL || "http://localhost:3000";
  let token = process.env.API_SECRET_TOKEN || "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--url" && args[i + 1]) {
      apiUrl = args[++i];
    } else if (args[i] === "--token" && args[i + 1]) {
      token = args[++i];
    } else if (!args[i].startsWith("--")) {
      filePath = args[i];
    }
  }

  if (!filePath) {
    console.error("Usage: npx tsx scripts/seed-qb-products.ts <path-to-xls> [--url http://...] [--token ...]");
    process.exit(1);
  }
  if (!token) {
    console.error("Error: API_SECRET_TOKEN env var or --token flag is required");
    process.exit(1);
  }

  return { filePath: resolve(filePath), apiUrl: apiUrl.replace(/\/$/, ""), token };
}

/** Strip $, commas, whitespace from price strings before parsing. */
function parsePrice(raw: unknown): number | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "number") return Number.isNaN(raw) ? undefined : raw;
  const cleaned = String(raw).replace(/[$,\s]/g, "").trim();
  if (!cleaned) return undefined;
  const num = Number(cleaned);
  return Number.isNaN(num) ? undefined : num;
}

function parseXls(filePath: string): QBProduct[] {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    console.error("Error: No sheets found in workbook");
    process.exit(1);
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName]);
  console.log(`Parsed ${rows.length} rows from sheet "${sheetName}"`);

  const products: QBProduct[] = [];
  let skippedNoName = 0;

  for (const row of rows) {
    // QuickBooks XLS column names (may vary slightly)
    const name = String(
      row["Product/Service"] || row["Product/Service Name"] || row["Name"] || ""
    ).trim();

    if (!name) {
      skippedNoName++;
      continue;
    }

    const sku = String(row["SKU"] || row["Sku"] || "").trim() || undefined;
    const type = String(row["Type"] || "").trim() || undefined;
    const priceRaw = row["Sales Price/Rate"] ?? row["Sales Price"] ?? row["Rate"];
    const price = parsePrice(priceRaw);
    const description = String(
      row["Sales Description"] || row["Description"] || ""
    ).trim() || undefined;

    products.push({
      name,
      sku,
      type,
      price,
      description,
    });
  }

  if (skippedNoName > 0) {
    console.log(`Skipped ${skippedNoName} rows with no product name`);
  }

  return products;
}

async function seedProducts(products: QBProduct[], apiUrl: string, token: string) {
  console.log(`Seeding ${products.length} products to ${apiUrl}/api/products/seed ...`);

  const res = await fetch(`${apiUrl}/api/products/seed`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ products }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Seed request failed (${res.status}): ${text}`);
    process.exit(1);
  }

  const result = await res.json();
  console.log("\n=== Seed Results ===");
  console.log(`  Total:      ${result.total}`);
  console.log(`  Unique:     ${result.uniqueTotal}`);
  console.log(`  Inserted:   ${result.inserted}`);
  console.log(`  Updated:    ${result.updated}`);
  console.log(`  Skipped:    ${result.skipped}`);
  if (result.duplicates?.length) {
    console.log(`\n  Duplicate externalIds (${result.duplicates.length}):`);
    for (const dup of result.duplicates) {
      console.log(`    - "${dup.name}" (${dup.externalId}) appeared ${dup.occurrences}x`);
    }
  }
  if (result.errors?.length) {
    console.log(`\n  Errors:`);
    for (const err of result.errors) {
      console.log(`    - ${err}`);
    }
  }
}

async function main() {
  const { filePath, apiUrl, token } = parseArgs();
  console.log(`Reading: ${filePath}`);

  const products = parseXls(filePath);
  console.log(`Found ${products.length} valid products`);

  if (products.length === 0) {
    console.log("Nothing to seed.");
    return;
  }

  // Show a few examples
  console.log("\nSample products:");
  for (const p of products.slice(0, 3)) {
    console.log(`  ${p.name} | SKU: ${p.sku || "(none)"} | $${p.price ?? "?"} | ${p.type || "?"}`);
  }
  console.log("");

  await seedProducts(products, apiUrl, token);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
