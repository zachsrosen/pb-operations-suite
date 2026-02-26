import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";

const ADMIN_ROLES = ["ADMIN", "OWNER", "MANAGER"];
const VALID_SYSTEMS = ["INTERNAL", "ZOHO", "HUBSPOT", "ZUPER"] as const;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  if (!ADMIN_ROLES.includes(authResult.role)) {
    return NextResponse.json({ error: "Admin role required" }, { status: 403 });
  }

  const { id } = await params;
  const existing = await prisma.pendingCatalogPush.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.status !== "PENDING") {
    return NextResponse.json({ error: `Cannot edit ${existing.status.toLowerCase()} request` }, { status: 409 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {};

  if ("brand" in body) {
    const brand = String(body.brand || "").trim();
    if (!brand) return NextResponse.json({ error: "brand is required" }, { status: 400 });
    updateData.brand = brand;
  }
  if ("model" in body) {
    const model = String(body.model || "").trim();
    if (!model) return NextResponse.json({ error: "model is required" }, { status: 400 });
    updateData.model = model;
  }
  if ("description" in body) {
    const description = String(body.description || "").trim();
    if (!description) return NextResponse.json({ error: "description is required" }, { status: 400 });
    updateData.description = description;
  }
  if ("category" in body) {
    const category = String(body.category || "").trim();
    if (!category) return NextResponse.json({ error: "category is required" }, { status: 400 });
    updateData.category = category;
  }
  if ("unitSpec" in body) {
    const unitSpecRaw = body.unitSpec;
    updateData.unitSpec =
      unitSpecRaw === null || unitSpecRaw === undefined || String(unitSpecRaw).trim() === ""
        ? null
        : String(unitSpecRaw).trim();
  }
  if ("unitLabel" in body) {
    const unitLabelRaw = body.unitLabel;
    updateData.unitLabel =
      unitLabelRaw === null || unitLabelRaw === undefined || String(unitLabelRaw).trim() === ""
        ? null
        : String(unitLabelRaw).trim();
  }
  if ("systems" in body) {
    const systems = body.systems;
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
    updateData.systems = systems;
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
  }

  const push = await prisma.pendingCatalogPush.update({
    where: { id },
    data: updateData,
  });

  return NextResponse.json({ push });
}
