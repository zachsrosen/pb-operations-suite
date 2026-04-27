/**
 * Pull HubSpot's `manufacturer` enum options for the Products object.
 * Cross-references against the brands present in our InternalProduct catalog
 * to identify which brands would be blocked by the new D4 enforcement.
 *
 * Read-only.
 *
 * Run: npx tsx scripts/_pull-hubspot-manufacturer-enum.ts
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { prisma } from "../src/lib/db";

const TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
if (!TOKEN) {
  console.error("HUBSPOT_ACCESS_TOKEN missing");
  process.exit(1);
}

interface HubSpotProperty {
  name?: string;
  label?: string;
  type?: string;
  fieldType?: string;
  options?: Array<{ label?: string; value?: string; displayOrder?: number }>;
}

async function getManufacturerProperty(): Promise<HubSpotProperty | null> {
  const res = await fetch(
    `https://api.hubapi.com/crm/v3/properties/products/manufacturer`,
    { headers: { Authorization: `Bearer ${TOKEN}` } }
  );
  if (!res.ok) {
    console.error(`Failed to fetch manufacturer property: ${res.status} ${await res.text()}`);
    return null;
  }
  return res.json();
}

async function main() {
  console.log("Fetching HubSpot Product 'manufacturer' property...\n");
  const prop = await getManufacturerProperty();
  if (!prop) {
    process.exit(1);
  }

  console.log(`Property: ${prop.label} (${prop.name})`);
  console.log(`Type: ${prop.type} / ${prop.fieldType}`);
  console.log(`Options: ${prop.options?.length || 0}\n`);

  const enumValues = (prop.options || [])
    .map((o) => (o.value || "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  console.log("─".repeat(80));
  console.log(`HUBSPOT MANUFACTURER ENUM VALUES (${enumValues.length})`);
  console.log("─".repeat(80));
  for (const v of enumValues) console.log(`  ${v}`);

  // Cross-reference against InternalProduct.brand
  try {
    if (!prisma) {
      console.error("Prisma not configured");
      return;
    }
    const products = await prisma.internalProduct.findMany({
      where: { isActive: true },
      select: { brand: true, category: true },
    });
    const brandSet = new Map<string, number>();
    for (const p of products) {
      const b = (p.brand || "").trim();
      if (!b) continue;
      brandSet.set(b, (brandSet.get(b) || 0) + 1);
    }
    const brands = [...brandSet.entries()].sort((a, b) => b[1] - a[1]);

    const enumLower = new Set(enumValues.map((v) => v.toLowerCase()));

    console.log("\n" + "─".repeat(80));
    console.log(`INTERNAL BRANDS vs HUBSPOT ENUM (${brands.length} brands)`);
    console.log("─".repeat(80));
    let okCount = 0, missingCount = 0;
    const missing: Array<{ brand: string; count: number }> = [];
    for (const [brand, count] of brands) {
      const ok = enumLower.has(brand.toLowerCase());
      if (ok) okCount++;
      else { missingCount++; missing.push({ brand, count }); }
      const marker = ok ? "✓" : "✗ MISSING";
      console.log(`  ${marker.padEnd(10)} ${brand.padEnd(35)} (${count} products)`);
    }
    console.log(`\n  ✓ in enum:    ${okCount}`);
    console.log(`  ✗ missing:    ${missingCount}`);
    console.log(`  total brands: ${brands.length}`);

    if (missing.length > 0) {
      console.log("\n" + "─".repeat(80));
      console.log("BRANDS THAT WOULD BLOCK SUBMISSION UNDER NEW D4 POLICY");
      console.log("─".repeat(80));
      console.log("Add these to HubSpot → Settings → Properties → Products → Manufacturer:");
      for (const { brand, count } of missing) {
        console.log(`  ${brand}  (used by ${count} internal products)`);
      }
    }

    const fs = await import("fs");
    fs.writeFileSync("scripts/hubspot-manufacturer-enum.json", JSON.stringify({
      pulled_at: new Date().toISOString(),
      enum_values: enumValues,
      enum_count: enumValues.length,
      internal_brands: brands.map(([brand, count]) => ({
        brand,
        count,
        in_hubspot_enum: enumLower.has(brand.toLowerCase()),
      })),
      missing_brands: missing,
    }, null, 2));
    console.log("\nWrote scripts/hubspot-manufacturer-enum.json");
  } finally {
    await prisma?.$disconnect();
  }
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
