// src/app/api/catalog/push-requests/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";

const VALID_SYSTEMS = ["INTERNAL", "ZOHO", "HUBSPOT", "ZUPER"] as const;
const VALID_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
type PushStatus = typeof VALID_STATUSES[number];

export async function POST(request: NextRequest) {
  if (!prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    brand, model, description, category, unitSpec, unitLabel,
    sku, vendorName, vendorPartNumber, unitCost, sellPrice,
    hardToProcure, length, width, weight, metadata,
    systems, dealId,
  } = body as Record<string, unknown>;

  if (!brand || !model || !description || !category) {
    return NextResponse.json({ error: "brand, model, description, category are required" }, { status: 400 });
  }
  if (!Array.isArray(systems) || systems.length === 0) {
    return NextResponse.json({ error: "systems must be a non-empty array" }, { status: 400 });
  }
  if (!systems.every((s): s is string => typeof s === "string")) {
    return NextResponse.json({ error: "systems must be an array of strings" }, { status: 400 });
  }
  const invalidSystems = systems.filter((s) => !(VALID_SYSTEMS as readonly string[]).includes(s));
  if (invalidSystems.length > 0) {
    return NextResponse.json({ error: `Invalid systems: ${invalidSystems.join(", ")}` }, { status: 400 });
  }

  const push = await prisma.pendingCatalogPush.create({
    data: {
      brand: String(brand).trim(),
      model: String(model).trim(),
      description: String(description).trim(),
      category: String(category).trim(),
      unitSpec: unitSpec ? String(unitSpec).trim() : null,
      unitLabel: unitLabel ? String(unitLabel).trim() : null,
      sku: sku ? String(sku).trim() : null,
      vendorName: vendorName ? String(vendorName).trim() : null,
      vendorPartNumber: vendorPartNumber ? String(vendorPartNumber).trim() : null,
      unitCost: unitCost != null ? Number(unitCost) || null : null,
      sellPrice: sellPrice != null ? Number(sellPrice) || null : null,
      hardToProcure: hardToProcure === true,
      length: length != null ? Number(length) || null : null,
      width: width != null ? Number(width) || null : null,
      weight: weight != null ? Number(weight) || null : null,
      metadata: metadata || undefined,
      systems: systems,
      requestedBy: authResult.email,
      dealId: dealId ? String(dealId) : null,
    },
  });

  return NextResponse.json({ push }, { status: 201 });
}

export async function GET(request: NextRequest) {
  if (!prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const rawStatus = request.nextUrl.searchParams.get("status") ?? "PENDING";
  if (!(VALID_STATUSES as readonly string[]).includes(rawStatus)) {
    return NextResponse.json({ error: "Invalid status value" }, { status: 400 });
  }
  const status = rawStatus as PushStatus;

  const pushes = await prisma.pendingCatalogPush.findMany({
    where: { status },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ pushes, count: pushes.length });
}
