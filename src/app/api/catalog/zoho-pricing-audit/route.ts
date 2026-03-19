import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { zohoInventory } from "@/lib/zoho-inventory";

/**
 * GET /api/catalog/zoho-pricing-audit?format=csv
 *
 * Audits ALL Zoho Inventory items for pricing quality.
 * Flags: rate == purchase_rate, both zero, missing prices, etc.
 */
export async function GET(request: Request) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const url = new URL(request.url);
  const wantCsv = url.searchParams.get("format") === "csv" ||
    request.headers.get("accept")?.includes("text/csv");

  // Fetch all Zoho items
  const allItems = await zohoInventory.listItems();

  // Categorize each item
  const rows = allItems.map(item => {
    const sell = item.rate ?? null;
    const cost = item.purchase_rate ?? null;
    const hasSell = sell !== null && sell !== undefined;
    const hasCost = cost !== null && cost !== undefined;

    let issue = "OK";
    if (hasSell && hasCost && sell === cost && sell > 0) {
      issue = "SELL = COST (identical)";
    } else if (hasSell && hasCost && sell === 0 && cost === 0) {
      issue = "BOTH ZERO";
    } else if (hasSell && sell === 0 && hasCost && cost > 0) {
      issue = "SELL IS ZERO (cost exists)";
    } else if (!hasSell && !hasCost) {
      issue = "NO PRICES";
    } else if (hasSell && hasCost && sell > 0 && cost > 0 && sell !== cost) {
      issue = "OK";
    } else if (hasSell && sell > 0 && (!hasCost || cost === 0)) {
      issue = "MISSING COST";
    } else if (hasCost && cost > 0 && (!hasSell || sell === 0)) {
      issue = "MISSING SELL";
    }

    return {
      itemId: item.item_id,
      name: item.name,
      sku: item.sku || "",
      status: item.status || "",
      sellPrice: sell,
      purchaseRate: cost,
      issue,
    };
  });

  // Summary stats
  const total = rows.length;
  const sellEqualsCost = rows.filter(r => r.issue === "SELL = COST (identical)").length;
  const bothZero = rows.filter(r => r.issue === "BOTH ZERO").length;
  const sellIsZero = rows.filter(r => r.issue === "SELL IS ZERO (cost exists)").length;
  const noPrices = rows.filter(r => r.issue === "NO PRICES").length;
  const missingCost = rows.filter(r => r.issue === "MISSING COST").length;
  const missingSell = rows.filter(r => r.issue === "MISSING SELL").length;
  const ok = rows.filter(r => r.issue === "OK").length;

  const summary = {
    totalItems: total,
    sellEqualsCost,
    bothZero,
    sellIsZero,
    noPrices,
    missingCost,
    missingSell,
    ok,
    pctSellEqualsCost: total > 0 ? Math.round(sellEqualsCost / total * 100) : 0,
    pctIssues: total > 0 ? Math.round((total - ok) / total * 100) : 0,
  };

  if (wantCsv) {
    const headers = ["Name", "SKU", "Status", "Sell Price", "Purchase Rate", "Issue"];
    const csvRows = [headers.join(",")];
    for (const r of rows) {
      csvRows.push([
        esc(r.name), esc(r.sku), r.status,
        r.sellPrice ?? "", r.purchaseRate ?? "",
        r.issue,
      ].join(","));
    }
    return new Response(csvRows.join("\n"), {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=zoho-pricing-audit.csv",
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
