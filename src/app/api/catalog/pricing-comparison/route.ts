import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { zohoInventory } from "@/lib/zoho-inventory";
import { hubspotClient } from "@/lib/hubspot";

/**
 * GET /api/catalog/pricing-comparison
 *
 * Cross-system product pricing comparison: Internal Catalog vs Zoho vs HubSpot.
 * Returns CSV or JSON depending on Accept header.
 *
 * Admin-only.
 */
export async function GET(request: Request) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  if (!prisma) {
    return NextResponse.json({ error: "Database not available" }, { status: 503 });
  }

  const wantCsv = request.headers.get("accept")?.includes("text/csv");

  // 1. Load all InternalProducts with external links
  const products = await prisma.internalProduct.findMany({
    where: {
      OR: [
        { zohoItemId: { not: null } },
        { hubspotProductId: { not: null } },
      ],
    },
    select: {
      id: true, brand: true, model: true, name: true, sku: true,
      category: true, isActive: true, sellPrice: true, unitCost: true,
      zohoItemId: true, hubspotProductId: true,
    },
    orderBy: [{ category: "asc" }, { brand: "asc" }, { model: "asc" }],
  });

  // 2. Fetch Zoho items
  const zohoMap = new Map<string, { rate: number | null; purchase_rate: number | null; name: string }>();
  try {
    const allItems = await zohoInventory.listItems();
    for (const item of allItems) {
      zohoMap.set(item.item_id, {
        rate: item.rate ?? null,
        purchase_rate: item.purchase_rate ?? null,
        name: item.name,
      });
    }
  } catch (err) {
    console.warn("[PricingComparison] Zoho fetch failed:", err);
  }

  // 3. Fetch HubSpot products in batches
  const hubspotIds = products
    .map(p => p.hubspotProductId)
    .filter((id): id is string => !!id);

  const hubspotMap = new Map<string, { price: number | null; name: string }>();
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
      console.warn(`[PricingComparison] HubSpot batch ${i / BATCH + 1} failed:`, err);
    }
  }

  // 4. Build rows
  const rows = products.map(p => {
    const zoho = p.zohoItemId ? zohoMap.get(p.zohoItemId) : null;
    const hs = p.hubspotProductId ? hubspotMap.get(p.hubspotProductId) : null;

    const zohoSell = zoho?.rate ?? null;
    const zohoCost = zoho?.purchase_rate ?? null;
    const hsPrice = hs?.price ?? null;

    const sellMismatch = (
      p.sellPrice != null && zohoSell != null && Math.abs(p.sellPrice - zohoSell) > 0.01
    ) || (
      p.sellPrice != null && hsPrice != null && Math.abs(p.sellPrice - hsPrice) > 0.01
    );

    const costMismatch = (
      p.unitCost != null && zohoCost != null && Math.abs(p.unitCost - zohoCost) > 0.01
    );

    return {
      category: p.category,
      brand: p.brand,
      model: p.model,
      displayName: p.name || `${p.brand} ${p.model}`,
      sku: p.sku || "",
      active: p.isActive,
      internalSellPrice: p.sellPrice,
      internalUnitCost: p.unitCost,
      zohoSellPrice: zohoSell,
      zohoPurchaseRate: zohoCost,
      zohoName: zoho?.name ?? null,
      hubspotPrice: hsPrice,
      hubspotName: hs?.name ?? null,
      sellPriceMismatch: sellMismatch,
      costMismatch: costMismatch,
      internalMissingSellPrice: p.sellPrice == null && (zohoSell != null || hsPrice != null),
      internalMissingCost: p.unitCost == null && zohoCost != null,
    };
  });

  // Summary
  const summary = {
    totalProducts: rows.length,
    priceMismatches: rows.filter(r => r.sellPriceMismatch || r.costMismatch).length,
    missingSellPrice: rows.filter(r => r.internalMissingSellPrice).length,
    missingUnitCost: rows.filter(r => r.internalMissingCost).length,
    zohoItemsLoaded: zohoMap.size,
    hubspotProductsLoaded: hubspotMap.size,
  };

  if (wantCsv) {
    const headers = [
      "Category", "Brand", "Model", "Display Name", "SKU", "Active",
      "Internal Sell Price", "Internal Unit Cost",
      "Zoho Sell Price", "Zoho Purchase Rate", "Zoho Name",
      "HubSpot Price", "HubSpot Name",
      "Sell Price Mismatch", "Cost Mismatch",
      "Internal Missing Sell", "Internal Missing Cost",
    ];

    const csvRows = [headers.join(",")];
    for (const r of rows) {
      csvRows.push([
        r.category,
        esc(r.brand), esc(r.model), esc(r.displayName), esc(r.sku),
        r.active ? "Yes" : "No",
        r.internalSellPrice ?? "",
        r.internalUnitCost ?? "",
        r.zohoSellPrice ?? "",
        r.zohoPurchaseRate ?? "",
        esc(r.zohoName || ""),
        r.hubspotPrice ?? "",
        esc(r.hubspotName || ""),
        r.sellPriceMismatch ? "YES" : "",
        r.costMismatch ? "YES" : "",
        r.internalMissingSellPrice ? "YES" : "",
        r.internalMissingCost ? "YES" : "",
      ].join(","));
    }

    return new Response(csvRows.join("\n"), {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=pricing-comparison.csv",
      },
    });
  }

  return NextResponse.json({ summary, rows });
}

function esc(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}
