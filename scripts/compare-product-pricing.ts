/**
 * Cross-system product pricing comparison.
 *
 * Pulls InternalProduct records that have Zoho and/or HubSpot links,
 * fetches pricing from those systems, and outputs a CSV comparison.
 *
 * Usage: npx tsx scripts/compare-product-pricing.ts > pricing-comparison.csv
 */
import "dotenv/config";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { zohoInventory } from "../src/lib/zoho-inventory";
import { hubspotClient } from "../src/lib/hubspot";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

interface PricingRow {
  id: string;
  brand: string;
  model: string;
  name: string;
  sku: string;
  category: string;
  isActive: boolean;
  // Internal
  internalSellPrice: number | null;
  internalUnitCost: number | null;
  // Zoho
  zohoItemId: string | null;
  zohoSellPrice: number | null;
  zohoPurchaseRate: number | null;
  zohoName: string | null;
  // HubSpot
  hubspotProductId: string | null;
  hubspotPrice: number | null;
  hubspotName: string | null;
  // Flags
  sellPriceMismatch: boolean;
  costMismatch: boolean;
  internalMissingSellPrice: boolean;
  internalMissingCost: boolean;
}

async function main() {
  // 1. Load all InternalProducts with external links
  const products = await prisma.internalProduct.findMany({
    where: {
      OR: [
        { zohoItemId: { not: null } },
        { hubspotProductId: { not: null } },
      ],
    },
    select: {
      id: true,
      brand: true,
      model: true,
      name: true,
      sku: true,
      category: true,
      isActive: true,
      sellPrice: true,
      unitCost: true,
      zohoItemId: true,
      hubspotProductId: true,
    },
    orderBy: [{ category: "asc" }, { brand: "asc" }, { model: "asc" }],
  });

  console.error(`Found ${products.length} products with external links`);

  // 2. Fetch all Zoho items (cached, single API call)
  const zohoItemIds = products
    .map(p => p.zohoItemId)
    .filter((id): id is string => !!id);

  console.error(`Fetching Zoho items (${zohoItemIds.length} linked)...`);
  let zohoMap = new Map<string, { rate: number | null; purchase_rate: number | null; name: string }>();
  if (zohoItemIds.length > 0) {
    try {
      const allItems = await zohoInventory.listItems();
      for (const item of allItems) {
        zohoMap.set(item.item_id, {
          rate: item.rate ?? null,
          purchase_rate: item.purchase_rate ?? null,
          name: item.name,
        });
      }
      console.error(`Loaded ${zohoMap.size} Zoho items`);
    } catch (err) {
      console.error("Failed to fetch Zoho items:", err);
    }
  }

  // 3. Fetch HubSpot products in batches of 100
  const hubspotIds = products
    .map(p => p.hubspotProductId)
    .filter((id): id is string => !!id);

  console.error(`Fetching HubSpot products (${hubspotIds.length} linked)...`);
  const hubspotMap = new Map<string, { price: number | null; name: string }>();
  if (hubspotIds.length > 0) {
    const BATCH = 100;
    for (let i = 0; i < hubspotIds.length; i += BATCH) {
      const batch = hubspotIds.slice(i, i + BATCH);
      try {
        const resp = await hubspotClient.crm.products.batchApi.read({
          inputs: batch.map(id => ({ id })),
          properties: ["name", "price", "hs_sku"],
          propertiesWithHistory: [],
        });
        for (const p of resp.results || []) {
          hubspotMap.set(p.id, {
            price: p.properties?.price ? Number(p.properties.price) : null,
            name: String(p.properties?.name || ""),
          });
        }
      } catch (err) {
        console.error(`HubSpot batch read failed (batch ${i / BATCH + 1}):`, err);
      }
    }
    console.error(`Loaded ${hubspotMap.size} HubSpot products`);
  }

  // 4. Build comparison rows
  const rows: PricingRow[] = products.map(p => {
    const zoho = p.zohoItemId ? zohoMap.get(p.zohoItemId) : null;
    const hs = p.hubspotProductId ? hubspotMap.get(p.hubspotProductId) : null;

    const zohoSell = zoho?.rate ?? null;
    const zohoCost = zoho?.purchase_rate ?? null;
    const hsPrice = hs?.price ?? null;

    // Mismatch flags: compare internal vs Zoho sell price (within $0.01 tolerance)
    const sellPriceMismatch = (
      p.sellPrice != null && zohoSell != null &&
      Math.abs(p.sellPrice - zohoSell) > 0.01
    ) || (
      p.sellPrice != null && hsPrice != null &&
      Math.abs(p.sellPrice - hsPrice) > 0.01
    );

    const costMismatch = (
      p.unitCost != null && zohoCost != null &&
      Math.abs(p.unitCost - zohoCost) > 0.01
    );

    return {
      id: p.id,
      brand: p.brand,
      model: p.model,
      name: p.name || `${p.brand} ${p.model}`,
      sku: p.sku || "",
      category: p.category,
      isActive: p.isActive,
      internalSellPrice: p.sellPrice,
      internalUnitCost: p.unitCost,
      zohoItemId: p.zohoItemId,
      zohoSellPrice: zohoSell,
      zohoPurchaseRate: zohoCost,
      zohoName: zoho?.name ?? null,
      hubspotProductId: p.hubspotProductId,
      hubspotPrice: hsPrice,
      hubspotName: hs?.name ?? null,
      sellPriceMismatch,
      costMismatch,
      internalMissingSellPrice: p.sellPrice == null && (zohoSell != null || hsPrice != null),
      internalMissingCost: p.unitCost == null && zohoCost != null,
    };
  });

  // 5. Summary stats (to stderr)
  const mismatches = rows.filter(r => r.sellPriceMismatch || r.costMismatch);
  const missingSell = rows.filter(r => r.internalMissingSellPrice);
  const missingCost = rows.filter(r => r.internalMissingCost);

  console.error(`\n--- Summary ---`);
  console.error(`Total products compared: ${rows.length}`);
  console.error(`Price mismatches: ${mismatches.length}`);
  console.error(`Internal missing sell price (Zoho/HS has it): ${missingSell.length}`);
  console.error(`Internal missing unit cost (Zoho has it): ${missingCost.length}`);

  // 6. Output CSV to stdout
  const headers = [
    "Category", "Brand", "Model", "Display Name", "SKU", "Active",
    "Internal Sell Price", "Internal Unit Cost",
    "Zoho Sell Price", "Zoho Purchase Rate", "Zoho Name",
    "HubSpot Price", "HubSpot Name",
    "Sell Price Mismatch", "Cost Mismatch",
    "Internal Missing Sell", "Internal Missing Cost",
  ];

  console.log(headers.join(","));

  for (const r of rows) {
    const vals = [
      r.category,
      csvEscape(r.brand),
      csvEscape(r.model),
      csvEscape(r.name),
      csvEscape(r.sku),
      r.isActive ? "Yes" : "No",
      r.internalSellPrice ?? "",
      r.internalUnitCost ?? "",
      r.zohoSellPrice ?? "",
      r.zohoPurchaseRate ?? "",
      csvEscape(r.zohoName || ""),
      r.hubspotPrice ?? "",
      csvEscape(r.hubspotName || ""),
      r.sellPriceMismatch ? "YES" : "",
      r.costMismatch ? "YES" : "",
      r.internalMissingSellPrice ? "YES" : "",
      r.internalMissingCost ? "YES" : "",
    ];
    console.log(vals.join(","));
  }
}

function csvEscape(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

main()
  .catch(err => { console.error("Fatal:", err); process.exit(1); })
  .finally(() => prisma.$disconnect());
