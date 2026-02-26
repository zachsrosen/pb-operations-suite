import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { fetchLineItemsForDeal } from "@/lib/hubspot";
import { zohoInventory, type ZohoInventoryItem } from "@/lib/zoho-inventory";

const ALLOWED_ROLES = new Set([
  "ADMIN",
  "OWNER",
  "MANAGER",
  "OPERATIONS",
  "OPERATIONS_MANAGER",
  "PROJECT_MANAGER",
  "DESIGNER",
  "PERMITTING",
  "SALES",
]);

interface LinkedProduct {
  id: string;
  hubspotProductId: string | null;
  name: string;
  sku: string | null;
  description: string | null;
  manufacturer: string | null;
  productCategory: string | null;
  quantity: number;
  zohoItemId: string | null;
  zohoName: string | null;
  zohoSku: string | null;
  zohoDescription: string | null;
}

function normalizeText(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSku(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

function tokenize(value: string | null | undefined): Set<string> {
  const normalized = normalizeText(value);
  if (!normalized) return new Set<string>();
  return new Set(normalized.split(" ").filter((token) => token.length >= 3));
}

function tokenSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) overlap += 1;
  }
  const union = new Set([...a, ...b]).size;
  return union > 0 ? overlap / union : 0;
}

function bestZohoMatch(
  lineItem: { name: string; sku: string; description: string },
  zohoItems: ZohoInventoryItem[]
): ZohoInventoryItem | null {
  if (!zohoItems.length) return null;

  const sku = normalizeSku(lineItem.sku);
  if (sku) {
    const exactSku = zohoItems.find((item) => normalizeSku(item.sku) === sku);
    if (exactSku) return exactSku;
  }

  const lineTokens = new Set([
    ...tokenize(lineItem.name),
    ...tokenize(lineItem.description),
    ...tokenize(lineItem.sku),
  ]);

  let best: ZohoInventoryItem | null = null;
  let bestScore = 0;

  for (const item of zohoItems) {
    const itemTokens = new Set([
      ...tokenize(item.name),
      ...tokenize((item as ZohoInventoryItem & { description?: string }).description),
      ...tokenize(item.sku),
    ]);

    const score = tokenSimilarity(lineTokens, itemTokens);
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }

  return bestScore >= 0.45 ? best : null;
}

export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  if (!ALLOWED_ROLES.has(authResult.role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const dealId = String(request.nextUrl.searchParams.get("dealId") || "").trim();
  if (!dealId) {
    return NextResponse.json({ error: "dealId is required" }, { status: 400 });
  }

  const lineItems = await fetchLineItemsForDeal(dealId);

  let zohoItems: ZohoInventoryItem[] = [];
  let usedZohoCache = false;
  if (zohoInventory.isConfigured()) {
    try {
      zohoItems = await zohoInventory.listItems();
    } catch {
      zohoItems = [];
    }
  }
  if (!zohoItems.length && prisma) {
    try {
      const cachedZohoProducts = await prisma.catalogProduct.findMany({
        where: { source: "ZOHO" },
        orderBy: { updatedAt: "desc" },
        take: 10000,
      });
      zohoItems = cachedZohoProducts
        .map((product) => ({
          item_id: product.externalId,
          name: product.name || "",
          sku: product.sku || "",
          description: product.description || undefined,
        }))
        .filter((item) => item.item_id && (item.name || item.sku)) as ZohoInventoryItem[];
      usedZohoCache = zohoItems.length > 0;
    } catch {
      // ignore cache failures and continue without Zoho enrichment
    }
  }

  const products: LinkedProduct[] = lineItems.map((line) => {
    const zohoMatch = bestZohoMatch(
      {
        name: line.name,
        sku: line.sku,
        description: line.description,
      },
      zohoItems
    );

    return {
      id: String(line.id),
      hubspotProductId: String(line.hubspotProductId || "").trim() || null,
      name: String(line.name || "").trim(),
      sku: String(line.sku || "").trim() || null,
      description: String(line.description || "").trim() || null,
      manufacturer: String(line.manufacturer || "").trim() || null,
      productCategory: String(line.productCategory || "").trim() || null,
      quantity: Number(line.quantity) || 1,
      zohoItemId: String(zohoMatch?.item_id || "").trim() || null,
      zohoName: String(zohoMatch?.name || "").trim() || null,
      zohoSku: String(zohoMatch?.sku || "").trim() || null,
      zohoDescription:
        String((zohoMatch as ZohoInventoryItem & { description?: string } | undefined)?.description || "").trim() || null,
    };
  });

  return NextResponse.json({
    products,
    summary: {
      hubspotLinkedCount: products.length,
      zohoMatchedCount: products.filter((p) => p.zohoItemId).length,
      zohoSource: usedZohoCache ? "cache" : "live",
    },
  });
}
