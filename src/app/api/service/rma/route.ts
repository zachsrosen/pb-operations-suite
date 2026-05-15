import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail, logActivity, prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { RmaLineItem } from "@/lib/zoho-so-helpers";

export async function POST(request: NextRequest) {
  if (process.env.RMA_ENABLED !== "true") {
    return NextResponse.json({ error: "RMA disabled" }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const user = await getUserByEmail(session.user.email);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 403 });
  }
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const body = await request.json();
  const { ticketId, ticketSubject, outboundItems, inboundItems, pbLocation, notes } = body as {
    ticketId?: string;
    ticketSubject?: string;
    outboundItems?: RmaLineItem[];
    inboundItems?: RmaLineItem[];
    pbLocation?: string | null;
    notes?: string | null;
  };

  if (!ticketId?.trim()) {
    return NextResponse.json({ error: "ticketId is required" }, { status: 400 });
  }
  if (!outboundItems || outboundItems.length === 0) {
    return NextResponse.json({ error: "At least one outbound item is required" }, { status: 400 });
  }

  const productIds = [
    ...outboundItems.map((i) => i.productId),
    ...(inboundItems ?? []).map((i) => i.productId),
  ];
  const products = await prisma.internalProduct.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true,
      brand: true,
      model: true,
      category: true,
      unitSpec: true,
      unitLabel: true,
      zohoItemId: true,
      hubspotProductId: true,
    },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  const snapshotItems = (items: RmaLineItem[]): RmaLineItem[] =>
    items.map((item) => {
      const prod = productMap.get(item.productId);
      if (!prod) throw new Error(`Product ${item.productId} not found`);
      const unitSpecLabel =
        prod.unitSpec != null && prod.unitLabel
          ? `${prod.unitSpec}${prod.unitLabel}`
          : null;
      return {
        productId: item.productId,
        brand: prod.brand,
        model: prod.model,
        category: prod.category,
        quantity: item.quantity,
        unitSpecLabel,
        zohoItemId: prod.zohoItemId ?? null,
        hubspotProductId: prod.hubspotProductId ?? null,
        condition: item.condition ?? null,
      };
    });

  let snappedOutbound: RmaLineItem[];
  let snappedInbound: RmaLineItem[] | undefined;
  try {
    snappedOutbound = snapshotItems(outboundItems);
    if (inboundItems && inboundItems.length > 0) {
      snappedInbound = snapshotItems(inboundItems);
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid product" },
      { status: 400 }
    );
  }

  const rmaOrder = await prisma.rmaOrder.create({
    data: {
      ticketId: ticketId.trim(),
      ticketSubject: ticketSubject || "",
      outboundItems: JSON.parse(JSON.stringify(snappedOutbound)) as Prisma.InputJsonValue,
      inboundItems: snappedInbound
        ? (JSON.parse(JSON.stringify(snappedInbound)) as Prisma.InputJsonValue)
        : undefined,
      pbLocation: pbLocation?.trim() || null,
      notes: notes?.trim() || null,
      createdBy: session.user.email,
    },
  });

  await logActivity({
    type: "RMA_ORDER_CREATED",
    description: `Created RMA draft for ticket ${ticketId}`,
    userEmail: session.user.email,
    userName: user.name || session.user.email,
    entityType: "rma_order",
    entityId: rmaOrder.id,
    metadata: {
      ticketId,
      rmaOrderId: rmaOrder.id,
      outboundCount: snappedOutbound.length,
      inboundCount: snappedInbound?.length ?? 0,
    },
  });

  return NextResponse.json(rmaOrder, { status: 201 });
}

export async function GET(request: NextRequest) {
  if (process.env.RMA_ENABLED !== "true") {
    return NextResponse.json({ error: "RMA disabled" }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const ticketId = request.nextUrl.searchParams.get("ticketId");
  if (!ticketId) {
    return NextResponse.json({ error: "ticketId query param is required" }, { status: 400 });
  }

  const orders = await prisma.rmaOrder.findMany({
    where: { ticketId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(orders);
}
