import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { isIdrAllowedRole } from "@/lib/idr-meeting";
import { fetchLineItemsForDeal, createDealLineItem } from "@/lib/hubspot";
import { prisma } from "@/lib/db";

/**
 * GET /api/idr-meeting/line-items/[dealId]
 *
 * Fetches HubSpot line items for a deal. Used by the detail panel
 * to show equipment from the BOM instead of the snapshot summary.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { dealId } = await params;
  const lineItems = await fetchLineItemsForDeal(dealId);

  return NextResponse.json({ lineItems });
}

/**
 * POST /api/idr-meeting/line-items/[dealId]
 *
 * Creates a HubSpot line item on the deal from an InternalProduct.
 * Body: { internalProductId: string, quantity?: number }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { dealId } = await params;
  const body = await req.json().catch(() => ({})) as {
    internalProductId?: string;
    quantity?: number;
  };

  const { internalProductId, quantity = 1 } = body;
  if (!internalProductId) {
    return NextResponse.json({ error: "internalProductId is required" }, { status: 400 });
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return NextResponse.json({ error: "quantity must be > 0" }, { status: 400 });
  }

  // Look up the InternalProduct
  if (!prisma) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  const product = await prisma.internalProduct.findUnique({
    where: { id: internalProductId },
    select: {
      id: true,
      brand: true,
      model: true,
      name: true,
      description: true,
      sku: true,
      hubspotProductId: true,
      unitCost: true,
      sellPrice: true,
    },
  });

  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }
  if (!product.hubspotProductId) {
    return NextResponse.json(
      { error: "Product has no HubSpot product ID — sync it first" },
      { status: 422 },
    );
  }

  const displayName = product.name || `${product.brand} ${product.model}`.trim();

  let result;
  try {
    result = await createDealLineItem({
      dealId,
      name: displayName,
      quantity,
      description: product.description ?? undefined,
      sku: product.sku ?? undefined,
      hubspotProductId: product.hubspotProductId,
      unitPrice: product.sellPrice ?? product.unitCost ?? undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `HubSpot error: ${msg}` }, { status: 502 });
  }

  return NextResponse.json({
    success: true,
    lineItem: {
      id: result.lineItemId,
      name: displayName,
      quantity,
      hubspotProductId: product.hubspotProductId,
    },
  });
}
