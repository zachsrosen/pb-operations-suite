// src/app/api/catalog/push-requests/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";
import { FORM_CATEGORIES } from "@/lib/catalog-fields";
import { isBlank, validateRequiredSpecFields } from "@/lib/catalog-form-state";
import { notifyAdminsOfNewCatalogRequest } from "@/lib/catalog-notify";

const VALID_SYSTEMS = ["INTERNAL", "ZOHO", "HUBSPOT", "ZUPER"] as const;
const VALID_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
const VALID_CATEGORIES = new Set<string>(FORM_CATEGORIES as readonly string[]);
type PushStatus = typeof VALID_STATUSES[number];

function parseNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

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

  // Top-level required fields — use isBlank() so whitespace-only values are rejected
  const topLevelRequired = { brand, model, description, category } as Record<string, unknown>;
  const missingTopLevel = Object.entries(topLevelRequired)
    .filter(([, v]) => isBlank(v))
    .map(([k]) => k);
  if (missingTopLevel.length > 0) {
    return NextResponse.json(
      { error: `Required fields missing: ${missingTopLevel.join(", ")}` },
      { status: 400 }
    );
  }

  const normalizedCategory = String(category).trim();
  if (!VALID_CATEGORIES.has(normalizedCategory)) {
    return NextResponse.json({ error: `Invalid category: ${normalizedCategory}` }, { status: 400 });
  }

  // Required spec field validation
  const specMetadata = metadata && typeof metadata === "object"
    ? (metadata as Record<string, unknown>)
    : {};
  const specErrors = validateRequiredSpecFields(normalizedCategory, specMetadata);
  if (specErrors.length > 0) {
    return NextResponse.json(
      {
        error: `Required spec fields missing: ${specErrors.map((e) => e.message).join("; ")}`,
        missingFields: specErrors.map((e) => e.field),
      },
      { status: 400 }
    );
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
      category: normalizedCategory,
      unitSpec: unitSpec ? String(unitSpec).trim() : null,
      unitLabel: unitLabel ? String(unitLabel).trim() : null,
      sku: sku ? String(sku).trim() : null,
      vendorName: vendorName ? String(vendorName).trim() : null,
      vendorPartNumber: vendorPartNumber ? String(vendorPartNumber).trim() : null,
      unitCost: parseNullableNumber(unitCost),
      sellPrice: parseNullableNumber(sellPrice),
      hardToProcure: hardToProcure === true,
      length: parseNullableNumber(length),
      width: parseNullableNumber(width),
      weight: parseNullableNumber(weight),
      metadata: metadata || undefined,
      systems: systems,
      requestedBy: authResult.email,
      dealId: dealId ? String(dealId) : null,
    },
  });

  // Fire-and-forget admin notification
  notifyAdminsOfNewCatalogRequest({
    id: push.id,
    brand: push.brand,
    model: push.model,
    category: push.category,
    requestedBy: push.requestedBy,
    systems: push.systems,
    dealId: push.dealId,
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
