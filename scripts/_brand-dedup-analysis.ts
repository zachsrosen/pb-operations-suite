/**
 * Group InternalProduct.brand strings into canonical clusters to suggest
 * dedup candidates ahead of HubSpot manufacturer enum cleanup (Phase B).
 *
 * Read-only. Output: scripts/brand-dedup-suggestions.json
 *
 * Run: node --env-file=.env.local --import tsx scripts/_brand-dedup-analysis.ts
 */
import { prisma } from "../src/lib/db";

function canon(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s\-_.&,!]+/g, "")
    .trim();
}

async function main() {
  if (!prisma) {
    console.error("Prisma not configured");
    process.exit(1);
  }

  const products = await prisma.internalProduct.findMany({
    where: { isActive: true },
    select: { id: true, brand: true, model: true, category: true },
  });

  // Group by canonicalized brand
  const groups = new Map<string, { rawBrands: Map<string, number>; products: typeof products }>();
  for (const p of products) {
    const b = (p.brand || "").trim();
    if (!b) continue;
    const key = canon(b);
    if (!groups.has(key)) {
      groups.set(key, { rawBrands: new Map(), products: [] });
    }
    const g = groups.get(key)!;
    g.rawBrands.set(b, (g.rawBrands.get(b) || 0) + 1);
    g.products.push(p);
  }

  // Find clusters where multiple raw brands canonicalize the same way
  const dupes = [...groups.entries()]
    .filter(([, g]) => g.rawBrands.size > 1)
    .sort((a, b) => b[1].products.length - a[1].products.length);

  console.log("─".repeat(80));
  console.log(`BRAND CANONICALIZATION CONFLICTS (${dupes.length} clusters)`);
  console.log("─".repeat(80));
  console.log("These brand strings normalize to the same key — likely should merge:\n");
  for (const [key, g] of dupes) {
    console.log(`Cluster "${key}" (${g.products.length} products):`);
    for (const [raw, count] of [...g.rawBrands.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  - "${raw}" × ${count}`);
    }
    console.log();
  }

  // Likely test data
  const testish = products.filter((p) => {
    const b = (p.brand || "").toLowerCase();
    return /test|uibrand|^foo|^bar$|placeholder|sample/.test(b) ||
      /\d{10,}/.test(b);
  });
  if (testish.length > 0) {
    console.log("─".repeat(80));
    console.log(`LIKELY TEST DATA (${testish.length} products) — review for deletion`);
    console.log("─".repeat(80));
    for (const p of testish) {
      console.log(`  ${p.id}  brand="${p.brand}"  model="${p.model}"  category=${p.category}`);
    }
    console.log();
  }

  // Generic placeholder
  const generic = products.filter((p) => /^generic$/i.test(p.brand?.trim() || ""));
  if (generic.length > 0) {
    console.log("─".repeat(80));
    console.log(`"Generic" BRAND USAGE (${generic.length} products) — by category`);
    console.log("─".repeat(80));
    const byCat = new Map<string, number>();
    for (const p of generic) byCat.set(p.category, (byCat.get(p.category) || 0) + 1);
    for (const [c, n] of [...byCat.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${c.padEnd(28)} ${n} products`);
    }
    console.log("\n  These should likely be re-branded to actual manufacturers OR\n  HubSpot enum should accept 'Generic' as a valid value.\n");
  }

  const fs = await import("fs");
  fs.writeFileSync("scripts/brand-dedup-suggestions.json", JSON.stringify({
    pulled_at: new Date().toISOString(),
    total_products: products.length,
    distinct_brand_clusters: groups.size,
    duplicate_clusters: dupes.map(([key, g]) => ({
      canonical_key: key,
      raw_brand_variants: [...g.rawBrands.entries()].map(([raw, count]) => ({ raw, count })),
      total_products: g.products.length,
    })),
    likely_test_brands: testish.map((p) => ({ id: p.id, brand: p.brand, model: p.model })),
    generic_brand_count: generic.length,
  }, null, 2));
  console.log(`Wrote scripts/brand-dedup-suggestions.json`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
