// src/app/api/catalog/push-requests/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";

const VALID_SYSTEMS = ["INTERNAL", "ZOHO", "HUBSPOT", "ZUPER"];

export async function POST(request: NextRequest) {
  if (!prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { brand, model, description, category, unitSpec, unitLabel, systems, dealId } = body as Record<string, unknown>;

  if (!brand || !model || !description || !category) {
    return NextResponse.json({ error: "brand, model, description, category are required" }, { status: 400 });
  }
  if (!Array.isArray(systems) || systems.length === 0) {
    return NextResponse.json({ error: "systems must be a non-empty array" }, { status: 400 });
  }
  const invalidSystems = (systems as string[]).filter((s) => !VALID_SYSTEMS.includes(s));
  if (invalidSystems.length > 0) {
    return NextResponse.json({ error: `Invalid systems: ${invalidSystems.join(", ")}` }, { status: 400 });
  }

  const push = await prisma.pendingCatalogPush.create({
    data: {
      brand: String(brand).trim(),
      model: String(model).trim(),
      description: String(description).trim(),
      category: String(category),
      unitSpec: unitSpec ? String(unitSpec) : null,
      unitLabel: unitLabel ? String(unitLabel) : null,
      systems: systems as string[],
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

  const status = request.nextUrl.searchParams.get("status") ?? "PENDING";

  const pushes = await prisma.pendingCatalogPush.findMany({
    where: { status: status as "PENDING" | "APPROVED" | "REJECTED" },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ pushes, count: pushes.length });
}
