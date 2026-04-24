import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { AdderCategory, AdderUnit } from "@/generated/prisma/enums";
import { findAdderDuplicate } from "@/lib/product-requests/dedup";
import { notifyTechOpsOfNewRequest } from "@/lib/product-requests/notifications";

const ADDER_CATEGORIES = Object.values(AdderCategory) as string[];
const ADDER_UNITS = Object.values(AdderUnit) as string[];

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
  const unit =
    typeof payload.unit === "string" && payload.unit.trim() ? payload.unit.trim() : "FLAT";
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const salesRequestNote =
    typeof payload.salesRequestNote === "string" ? payload.salesRequestNote.trim() : "";
  const description =
    typeof payload.description === "string" && payload.description.trim()
      ? payload.description.trim()
      : null;
  const dealId =
    typeof payload.dealId === "string" && payload.dealId.trim() ? payload.dealId.trim() : null;
  const estimatedPrice =
    typeof payload.estimatedPrice === "number"
      ? payload.estimatedPrice
      : typeof payload.estimatedPrice === "string" && payload.estimatedPrice.trim()
        ? Number(payload.estimatedPrice)
        : null;

  const missing: string[] = [];
  if (!category) missing.push("category");
  if (!name) missing.push("name");
  if (!salesRequestNote) missing.push("salesRequestNote");
  if (missing.length) {
    return NextResponse.json(
      { error: `Required fields missing: ${missing.join(", ")}` },
      { status: 400 },
    );
  }

  if (!ADDER_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: `Invalid category: ${category}` }, { status: 400 });
  }
  if (!ADDER_UNITS.includes(unit)) {
    return NextResponse.json({ error: `Invalid unit: ${unit}` }, { status: 400 });
  }
  if (estimatedPrice !== null && !Number.isFinite(estimatedPrice)) {
    return NextResponse.json({ error: "estimatedPrice must be a number" }, { status: 400 });
  }

  const duplicate = await findAdderDuplicate(name);
  if (duplicate) {
    return NextResponse.json(
      {
        error:
          duplicate.source === "ADDER_REQUEST"
            ? "A request for this adder is already in the review queue."
            : "This adder already exists in our catalog — search for it in OpenSolar.",
        duplicate,
      },
      { status: 409 },
    );
  }

  const request = await prisma.adderRequest.create({
    data: {
      status: "PENDING",
      category: category as AdderCategory,
      unit: unit as AdderUnit,
      name,
      estimatedPrice,
      description,
      salesRequestNote,
      requestedBy,
      dealId,
    },
    select: { id: true },
  });

  await prisma.activityLog.create({
    data: {
      type: "SALES_PRODUCT_REQUEST_SUBMITTED",
      description: `Adder request submitted: ${name}`,
      userEmail: requestedBy,
      entityType: "product_request",
      entityId: request.id,
      entityName: name,
      metadata: { type: "ADDER", category, unit, dealId },
    },
  });

  const origin = req.nextUrl.origin;
  try {
    await notifyTechOpsOfNewRequest({
      requestId: `ad_${request.id}`,
      type: "ADDER",
      title: name,
      requestedBy,
      salesRequestNote,
      dealId,
      reviewUrl: `${origin}/dashboards/catalog/review?focus=ad_${request.id}`,
    });
  } catch (err) {
    console.error("[product-requests/adder] email failed", err);
  }

  return NextResponse.json({ id: `ad_${request.id}` }, { status: 201 });
}
