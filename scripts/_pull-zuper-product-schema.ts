/**
 * Inspect existing Zuper Product custom fields to verify proposed `pb_*` keys
 * don't collide and to understand the custom_fields payload structure.
 *
 * Read-only. Output: scripts/zuper-product-schema.json
 *
 * Run: node --env-file=.env.local --import tsx scripts/_pull-zuper-product-schema.ts
 */
const API_KEY = process.env.ZUPER_API_KEY;
const API_URL = process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";

if (!API_KEY) {
  console.error("ZUPER_API_KEY not set");
  process.exit(1);
}

async function fetchProducts(): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${API_URL}/product?count=10&page=1`, {
    headers: { "x-api-key": API_KEY!, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    console.error(`Product list failed: ${res.status} ${await res.text()}`);
    return [];
  }
  const data = await res.json();
  return data.data || data.products || [];
}

async function fetchSingleProduct(id: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${API_URL}/product/${encodeURIComponent(id)}`, {
    headers: { "x-api-key": API_KEY!, "Content-Type": "application/json" },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.data || data.product || data;
}

async function main() {
  console.log("Fetching first 10 Zuper products...");
  const products = await fetchProducts();
  console.log(`Got ${products.length} products.\n`);

  if (products.length === 0) {
    console.log("Empty result. Possible: API endpoint differs, or org has no products.");
    return;
  }

  const first = products[0];
  console.log("Top-level keys on a Product record:");
  for (const k of Object.keys(first).sort()) {
    const val = first[k];
    const t = Array.isArray(val) ? `array[${val.length}]` : typeof val;
    console.log(`  ${k.padEnd(28)} ${t}`);
  }

  // Inspect meta_data — likely where custom fields actually live in Zuper
  console.log("\nmeta_data on first product:");
  console.log(JSON.stringify(first.meta_data, null, 2));

  // Also check option, tax structures
  console.log("\noption on first product:");
  console.log(JSON.stringify(first.option, null, 2));

  // Look for custom fields specifically
  const cf = first.custom_fields || (first as Record<string, unknown>).customFields;
  if (cf) {
    console.log("\nCustom fields on first product:");
    if (Array.isArray(cf)) {
      for (const entry of cf) console.log(`  ${JSON.stringify(entry)}`);
    } else {
      console.log(JSON.stringify(cf, null, 2));
    }
  } else {
    console.log("\n(no custom_fields key — Zuper Product may use meta_data instead)");
  }

  // Search for any pb_ prefixed fields to detect collisions
  console.log("\n─".repeat(80));
  console.log("Scanning all 10 products for any field key matching /^pb_/...");
  const pbKeys = new Set<string>();
  for (const p of products) {
    const cfArr = (p.custom_fields || p.customFields) as unknown;
    const collect = (key: string) => {
      if (key.toLowerCase().startsWith("pb_")) pbKeys.add(key);
    };
    if (Array.isArray(cfArr)) {
      for (const entry of cfArr as Array<Record<string, unknown>>) {
        for (const k of ["name", "label", "key", "field"]) {
          const v = entry[k];
          if (typeof v === "string") collect(v);
        }
      }
    } else if (cfArr && typeof cfArr === "object") {
      for (const k of Object.keys(cfArr)) collect(k);
    }
  }
  if (pbKeys.size > 0) {
    console.log(`  ⚠ Found ${pbKeys.size} pre-existing pb_* keys (potential collision):`);
    for (const k of pbKeys) console.log(`    - ${k}`);
  } else {
    console.log("  ✓ No pre-existing pb_* keys — proposed names are safe");
  }

  const fs = await import("fs");
  fs.writeFileSync("scripts/zuper-product-schema.json", JSON.stringify({
    pulled_at: new Date().toISOString(),
    sample_count: products.length,
    top_level_keys: Object.keys(first).sort(),
    sample_custom_fields_first_product: cf || null,
    pb_prefixed_keys_found: [...pbKeys],
  }, null, 2));
  console.log("\nWrote scripts/zuper-product-schema.json");
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
