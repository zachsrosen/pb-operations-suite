import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { executeCatalogPushApproval } from "@/lib/catalog-push-approve";
import { pushProductToOpenSolar } from "@/lib/product-requests/opensolar-push";
import { notifyRepOfApproval } from "@/lib/product-requests/notifications";
import { AdderCategory, AdderUnit, AdderType, AdderDirection } from "@/generated/prisma/enums";

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

  if (id.startsWith("eq_")) {
    const pushId = id.slice(3);
    const result = await executeCatalogPushApproval(pushId);
    if (result.notFound) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!result.push || result.error) {
      return NextResponse.json(
        { error: result.error || "Approval failed", result },
        { status: 500 },
      );
    }

    // Sales-request-specific post-processing: OpenSolar push + rep email.
    if (result.push.source === "SALES_REQUEST") {
      if (result.push.internalSkuId) {
        const ip = await prisma.internalProduct.findUnique({
          where: { id: result.push.internalSkuId },
          select: { id: true, brand: true, model: true, category: true },
        });
        if (ip) {
          const osResult = await pushProductToOpenSolar({
            id: ip.id,
            brand: ip.brand,
            model: ip.model,
            category: ip.category,
          });
          if (osResult.ok && osResult.openSolarId) {
            await prisma.pendingCatalogPush.update({
              where: { id: pushId },
              data: { openSolarId: osResult.openSolarId },
            });
          } else {
            console.error("[opensolar-push] failed", { pushId, error: osResult.error });
          }
        }
      }

      try {
        await notifyRepOfApproval({
          to: result.push.requestedBy,
          title: `${result.push.brand} ${result.push.model}`,
          dealId: result.push.dealId,
        });
      } catch (err) {
        console.error("[product-requests/approve] email failed", err);
      }

      await prisma.activityLog.create({
        data: {
          type: "SALES_PRODUCT_REQUEST_APPROVED",
          description: `Equipment request approved: ${result.push.brand} ${result.push.model}`,
          userEmail: reviewer,
          entityType: "product_request",
          entityId: pushId,
          entityName: `${result.push.brand} ${result.push.model}`,
          metadata: { type: "EQUIPMENT", internalSkuId: result.push.internalSkuId },
        },
      });
    }

    return NextResponse.json({ ok: true, result });
  }

  if (id.startsWith("ad_")) {
    const requestId = id.slice(3);
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const code = typeof body.code === "string" ? body.code.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const basePrice =
      typeof body.basePrice === "number"
        ? body.basePrice
        : typeof body.basePrice === "string" && body.basePrice
          ? Number(body.basePrice)
          : NaN;
    const baseCost =
      typeof body.baseCost === "number"
        ? body.baseCost
        : typeof body.baseCost === "string" && body.baseCost
          ? Number(body.baseCost)
          : NaN;
    const type =
      typeof body.type === "string" && Object.values(AdderType).includes(body.type as AdderType)
        ? (body.type as AdderType)
        : AdderType.FIXED;
    const direction =
      typeof body.direction === "string" &&
      Object.values(AdderDirection).includes(body.direction as AdderDirection)
        ? (body.direction as AdderDirection)
        : AdderDirection.ADD;

    const missing: string[] = [];
    if (!code) missing.push("code");
    if (!name) missing.push("name");
    if (!Number.isFinite(basePrice)) missing.push("basePrice");
    if (!Number.isFinite(baseCost)) missing.push("baseCost");
    if (missing.length) {
      return NextResponse.json(
        { error: `Required fields missing: ${missing.join(", ")}` },
        { status: 400 },
      );
    }

    const existing = await prisma.adderRequest.findUnique({ where: { id: requestId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (existing.status !== "PENDING") {
      return NextResponse.json({ error: `Request already ${existing.status}` }, { status: 409 });
    }

    const { adder, request } = await prisma.$transaction(async (tx) => {
      const created = await tx.adder.create({
        data: {
          code,
          name,
          category: existing.category as AdderCategory,
          type,
          direction,
          unit: existing.unit as AdderUnit,
          basePrice,
          baseCost,
          active: true,
          createdBy: reviewer,
          updatedBy: reviewer,
        },
      });
      const updated = await tx.adderRequest.update({
        where: { id: requestId },
        data: { status: "ADDED", adderCatalogId: created.id, resolvedAt: new Date() },
      });
      return { adder: created, request: updated };
    });

    try {
      await notifyRepOfApproval({
        to: request.requestedBy,
        title: request.name,
        dealId: request.dealId,
      });
    } catch (err) {
      console.error("[product-requests/approve] email failed", err);
    }

    await prisma.activityLog.create({
      data: {
        type: "SALES_PRODUCT_REQUEST_APPROVED",
        description: `Adder request approved: ${request.name}`,
        userEmail: reviewer,
        entityType: "product_request",
        entityId: requestId,
        entityName: request.name,
        metadata: { type: "ADDER", adderId: adder.id },
      },
    });

    return NextResponse.json({ ok: true, adder });
  }

  return NextResponse.json({ error: "Invalid id prefix" }, { status: 400 });
}
