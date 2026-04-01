/**
 * Inspect Zuper products to understand their structure,
 * especially custom fields and how hubspot_product_id might be stored.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const ZUPER_API_URL = process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";
  const ZUPER_API_KEY = process.env.ZUPER_API_KEY!;

  // Fetch first page of products
  const res = await fetch(`${ZUPER_API_URL}/product?count=5&page=1`, {
    headers: { "x-api-key": ZUPER_API_KEY },
  });
  const data = await res.json() as Record<string, unknown>;

  // Show top-level response structure
  console.log("Response top-level keys:", Object.keys(data));
  console.log();

  const products = (data.data || data.products || data.items || []) as Array<Record<string, unknown>>;

  for (let i = 0; i < Math.min(3, products.length); i++) {
    const p = products[i];
    console.log(`${"=".repeat(60)}`);
    console.log(`Product ${i + 1}: ${p.product_name || p.name}`);
    console.log(`${"=".repeat(60)}`);
    console.log("All keys:", Object.keys(p));
    console.log();

    // Show all fields
    for (const [key, value] of Object.entries(p)) {
      if (key === "custom_fields" || key === "custom_field") {
        console.log(`  ${key}:`, JSON.stringify(value, null, 4));
      } else if (typeof value === "object" && value !== null) {
        console.log(`  ${key}:`, JSON.stringify(value));
      } else {
        console.log(`  ${key}: ${value}`);
      }
    }
    console.log();
  }

  // Now specifically look at ALL products for any field containing "hubspot" or "hs"
  console.log(`\n${"=".repeat(60)}`);
  console.log("Scanning all products for hubspot-related fields...");
  console.log(`${"=".repeat(60)}\n`);

  let allProducts: Array<Record<string, unknown>> = [];
  let page = 1;
  while (true) {
    const r = await fetch(`${ZUPER_API_URL}/product?count=100&page=${page}`, {
      headers: { "x-api-key": ZUPER_API_KEY },
    });
    const d = await r.json() as Record<string, unknown>;
    const batch = (d.data || d.products || []) as Array<Record<string, unknown>>;
    if (batch.length === 0) break;
    allProducts.push(...batch);
    if (batch.length < 100) break;
    page++;
  }

  console.log(`Total products: ${allProducts.length}\n`);

  // Check every product for any hubspot-like data
  let withCustomFields = 0;
  let withHubspot = 0;
  const customFieldKeys = new Set<string>();
  const customFieldStructures = new Set<string>();

  for (const p of allProducts) {
    const cf = p.custom_fields || p.custom_field;
    if (cf) {
      withCustomFields++;
      // Inspect structure
      customFieldStructures.add(typeof cf === "object" ? (Array.isArray(cf) ? "array" : "object") : typeof cf);

      if (Array.isArray(cf)) {
        for (const entry of cf) {
          if (typeof entry === "object" && entry) {
            for (const k of Object.keys(entry as Record<string, unknown>)) {
              customFieldKeys.add(k);
            }
            // Check if any field references hubspot
            const vals = Object.values(entry as Record<string, unknown>);
            const keys = Object.keys(entry as Record<string, unknown>);
            const allStr = [...keys, ...vals.map(String)].join(" ").toLowerCase();
            if (allStr.includes("hubspot") || allStr.includes("hs_")) {
              withHubspot++;
              console.log(`  Found hubspot ref in: ${p.product_name}`, JSON.stringify(entry));
            }
          }
        }
      } else if (typeof cf === "object") {
        for (const k of Object.keys(cf as Record<string, unknown>)) {
          customFieldKeys.add(k);
          if (k.toLowerCase().includes("hubspot") || k.toLowerCase().includes("hs_")) {
            withHubspot++;
            console.log(`  Found hubspot key in: ${p.product_name}`, k, (cf as Record<string, unknown>)[k]);
          }
        }
      }
    }

    // Also check top-level fields for hubspot references
    for (const [key, value] of Object.entries(p)) {
      if (key.toLowerCase().includes("hubspot") && value) {
        console.log(`  Top-level hubspot field on ${p.product_name}: ${key} = ${value}`);
      }
    }
  }

  console.log(`\nProducts with custom_fields: ${withCustomFields}`);
  console.log(`Products with hubspot references: ${withHubspot}`);
  console.log(`Custom field structures: ${[...customFieldStructures].join(", ")}`);
  console.log(`Custom field entry keys: ${[...customFieldKeys].join(", ")}`);

  // Show a few custom field examples
  console.log("\nFirst 5 products with custom fields:");
  let shown = 0;
  for (const p of allProducts) {
    const cf = p.custom_fields || p.custom_field;
    if (cf && (Array.isArray(cf) ? cf.length > 0 : Object.keys(cf as Record<string, unknown>).length > 0)) {
      console.log(`  ${p.product_name}: ${JSON.stringify(cf)}`);
      shown++;
      if (shown >= 5) break;
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
