import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { FORM_CATEGORIES } from "@/lib/catalog-fields";
import { findEquipmentDuplicate } from "@/lib/product-requests/dedup";
import { notifyTechOpsOfNewRequest } from "@/lib/product-requests/notifications";

const SYSTEMS = ["INTERNAL", "HUBSPOT", "ZUPER", "ZOHO", "OPENSOLAR"];

export async function POST(req: NextRequest) {
  if (process.env.SALES_PRODUCT_REQUESTS_ENABLED !== "true") {
    return NextResponse.json({ error: "Feature disabled" }, { status: 503 });
  }
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const requestedBy = session.user.email;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const payload = body as Record<string, unknown>;

  const category = typeof payload.category === "string" ? payload.category.trim() : "";
  const brand = typeof payload.brand === "string" ? payload.brand.trim() : "";
  const model = typeof payload.model === "string" ? payload.model.trim() : "";
  const salesRequestNote =
    typeof payload.salesRequestNote === "string" ? payload.salesRequestNote.trim() : "";
  const datasheetUrl =
    typeof payload.datasheetUrl === "string" && payload.datasheetUrl.trim()
      ? payload.datasheetUrl.trim()
      : null;
  const dealId =
    typeof payload.dealId === "string" && payload.dealId.trim() ? payload.dealId.trim() : null;
  const extractedMetadata =
    payload.extractedMetadata && typeof payload.extractedMetadata === "object"
      ? (payload.extractedMetadata as Record<string, unknown>)
      : null;

  const missing: string[] = [];
  if (!category) missing.push("category");
  if (!brand) missing.push("brand");
  if (!model) missing.push("model");
  if (!salesRequestNote) missing.push("salesRequestNote");
  if (missing.length) {
    return NextResponse.json(
      { error: `Required fields missing: ${missing.join(", ")}` },
      { status: 400 },
    );
  }

  if (!(FORM_CATEGORIES as readonly string[]).includes(category)) {
    return NextResponse.json({ error: `Invalid category: ${category}` }, { status: 400 });
  }

  const duplicate = await findEquipmentDuplicate(brand, model);
  if (duplicate) {
    return NextResponse.json(
      {
        error:
          duplicate.source === "PENDING_PUSH"
            ? "A request for this product is already in the review queue."
            : "This product already exists in our catalog — search for it in OpenSolar.",
        duplicate,
      },
      { status: 409 },
    );
  }

  const metadataJson: Record<string, unknown> = {
    ...(extractedMetadata || {}),
  };
  if (datasheetUrl) metadataJson._datasheetUrl = datasheetUrl;

  const push = await prisma.pendingCatalogPush.create({
    data: {
      brand,
      model,
      category,
      description: `Sales request from ${requestedBy}: ${salesRequestNote}`,
      systems: SYSTEMS,
      status: "PENDING",
      source: "SALES_REQUEST",
      requestedBy,
      dealId,
      salesRequestNote,
      metadata:
        Object.keys(metadataJson).length > 0
          ? (metadataJson as unknown as import("@/generated/prisma/client").Prisma.InputJsonValue)
          : undefined,
    },
    select: { id: true },
  });

  await prisma.activityLog.create({
    data: {
      type: "SALES_PRODUCT_REQUEST_SUBMITTED",
      description: `Equipment request submitted: ${brand} ${model}`,
      userEmail: requestedBy,
      entityType: "product_request",
      entityId: push.id,
      entityName: `${brand} ${model}`,
      metadata: { type: "EQUIPMENT", category, dealId },
    },
  });

  const origin = req.nextUrl.origin;
  try {
    await notifyTechOpsOfNewRequest({
      requestId: `eq_${push.id}`,
      type: "EQUIPMENT",
      title: `${brand} ${model}`,
      requestedBy,
      salesRequestNote,
      dealId,
      reviewUrl: `${origin}/dashboards/catalog/review?focus=eq_${push.id}`,
    });
  } catch (err) {
    console.error("[product-requests/equipment] email failed", err);
  }

  return NextResponse.json({ id: `eq_${push.id}` }, { status: 201 });
}
