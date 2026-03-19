import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { fetchLineItemsForDeal } from "@/lib/hubspot";
import { prisma } from "@/lib/db";

/**
 * GET /api/service/deal-line-items?dealId=X
 *
 * Returns HubSpot line items for a deal, matched to InternalProduct
 * records where possible. Used by the SO creation slide-over to
 * auto-populate line items from existing deal data.
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireApiAuth();
    if (authResult instanceof NextResponse) return authResult;

    const dealId = new URL(request.url).searchParams.get("dealId");
    if (!dealId) {
      return NextResponse.json({ error: "dealId is required" }, { status: 400 });
    }

    // Fetch HubSpot line items
    const lineItems = await fetchLineItemsForDeal(dealId);
    if (lineItems.length === 0) {
      return NextResponse.json({ items: [], source: "none" });
    }

    // Match to InternalProduct by hubspotProductId for server-side pricing
    const hubspotProductIds = lineItems
      .map(li => li.hubspotProductId)
      .filter((id): id is string => !!id);

    let productMap = new Map<string, {
      id: string;
      name: string | null;
      sku: string | null;
      sellPrice: number | null;
      category: string;
      isActive: boolean;
    }>();

    if (hubspotProductIds.length > 0 && prisma) {
      const products = await prisma.internalProduct.findMany({
        where: { hubspotProductId: { in: hubspotProductIds } },
        select: {
          id: true,
          name: true,
          sku: true,
          sellPrice: true,
          category: true,
          isActive: true,
          hubspotProductId: true,
        },
      });
      productMap = new Map(
        products
          .filter(p => p.hubspotProductId)
          .map(p => [p.hubspotProductId!, p])
      );
    }

    // Build response: matched items get productId (for SO creation),
    // unmatched items get null productId (display-only)
    const items = lineItems.map(li => {
      const matched = li.hubspotProductId ? productMap.get(li.hubspotProductId) : null;
      return {
        productId: matched?.id || null,
        hubspotProductId: li.hubspotProductId,
        name: matched?.name || li.name,
        sku: matched?.sku || li.sku || null,
        quantity: li.quantity,
        unitPrice: matched?.sellPrice || li.price,
        category: matched?.category || li.productCategory || null,
        isActive: matched?.isActive ?? true,
        matched: !!matched,
      };
    });

    return NextResponse.json({ items, source: "hubspot" });
  } catch (error) {
    console.error("[DealLineItems] Error:", error);
    return NextResponse.json(
      { error: "Failed to load deal line items" },
      { status: 500 }
    );
  }
}
