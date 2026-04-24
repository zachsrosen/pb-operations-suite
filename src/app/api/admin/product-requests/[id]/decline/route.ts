import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { notifyRepOfDecline } from "@/lib/product-requests/notifications";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const reviewer = session.user.email;
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const reviewerNote = typeof body.reviewerNote === "string" ? body.reviewerNote.trim() : "";
  if (!reviewerNote) {
    return NextResponse.json({ error: "reviewerNote is required" }, { status: 400 });
  }

  if (id.startsWith("eq_")) {
    const pushId = id.slice(3);
    const push = await prisma.pendingCatalogPush.findUnique({ where: { id: pushId } });
    if (!push) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (push.source !== "SALES_REQUEST") {
      return NextResponse.json(
        { error: "Not a sales request — use the existing reject endpoint" },
        { status: 400 },
      );
    }
    if (push.status !== "PENDING") {
      return NextResponse.json({ error: `Request already ${push.status}` }, { status: 409 });
    }

    const updated = await prisma.pendingCatalogPush.update({
      where: { id: pushId },
      data: { status: "REJECTED", note: reviewerNote, resolvedAt: new Date() },
    });

    try {
      await notifyRepOfDecline({
        to: updated.requestedBy,
        title: `${updated.brand} ${updated.model}`,
        reviewerNote,
      });
    } catch (err) {
      console.error("[product-requests/decline] email failed", err);
    }

    await prisma.activityLog.create({
      data: {
        type: "SALES_PRODUCT_REQUEST_DECLINED",
        description: `Equipment request declined: ${updated.brand} ${updated.model}`,
        userEmail: reviewer,
        entityType: "product_request",
        entityId: pushId,
        entityName: `${updated.brand} ${updated.model}`,
        metadata: { type: "EQUIPMENT", reviewerNote },
      },
    });

    return NextResponse.json({ ok: true });
  }

  if (id.startsWith("ad_")) {
    const requestId = id.slice(3);
    const existing = await prisma.adderRequest.findUnique({ where: { id: requestId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (existing.status !== "PENDING") {
      return NextResponse.json({ error: `Request already ${existing.status}` }, { status: 409 });
    }

    const updated = await prisma.adderRequest.update({
      where: { id: requestId },
      data: { status: "DECLINED", reviewerNote, resolvedAt: new Date() },
    });

    try {
      await notifyRepOfDecline({
        to: updated.requestedBy,
        title: updated.name,
        reviewerNote,
      });
    } catch (err) {
      console.error("[product-requests/decline] email failed", err);
    }

    await prisma.activityLog.create({
      data: {
        type: "SALES_PRODUCT_REQUEST_DECLINED",
        description: `Adder request declined: ${updated.name}`,
        userEmail: reviewer,
        entityType: "product_request",
        entityId: requestId,
        entityName: updated.name,
        metadata: { type: "ADDER", reviewerNote },
      },
    });

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Invalid id prefix" }, { status: 400 });
}
