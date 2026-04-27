// src/app/api/catalog/push-requests/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";
import { FORM_CATEGORIES } from "@/lib/catalog-fields";
import { isBlank, validateRequiredSpecFields } from "@/lib/catalog-form-state";
import { executeCatalogPushApproval } from "@/lib/catalog-push-approve";
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
    sku, vendorName, zohoVendorId, vendorPartNumber, unitCost, sellPrice,
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

  // Vendor pair validation
  const hasVendorName = !isBlank(vendorName);
  const hasZohoVendorId = !isBlank(zohoVendorId);

  if (hasVendorName && !hasZohoVendorId) {
    return NextResponse.json(
      { error: "Vendor must be selected from the list" },
      { status: 400 }
    );
  }
  if (!hasVendorName && hasZohoVendorId) {
    return NextResponse.json(
      { error: "Vendor ID provided without vendor name" },
      { status: 400 }
    );
  }
  if (hasVendorName && hasZohoVendorId) {
    const lookup = await prisma.vendorLookup.findUnique({
      where: { zohoVendorId: String(zohoVendorId) },
    });
    if (!lookup || lookup.name !== String(vendorName).trim()) {
      return NextResponse.json(
        { error: "Vendor name does not match the selected vendor record" },
        { status: 400 }
      );
    }
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
      zohoVendorId: hasZohoVendorId ? String(zohoVendorId).trim() : null,
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

  // Auto-approve: submissions go straight into INTERNAL + selected external systems.
  // Partial failures leave the row PENDING with a note so an admin can retry.
  const approval = await executeCatalogPushApproval(push.id, { source: "wizard", userEmail: authResult.email }).catch((err) => {
    console.error("[catalog/push-requests] Auto-approval failed:", err);
    return null;
  });

  const autoApproved = approval ? !approval.retryable : false;

  // If auto-approval didn't finish (partial external-system failure or throw),
  // fall back to the legacy admin notification so someone can retry the push.
  if (!autoApproved) {
    notifyAdminsOfNewCatalogRequest({
      id: push.id,
      brand: push.brand,
      model: push.model,
      category: push.category,
      requestedBy: push.requestedBy,
      systems: push.systems,
      dealId: push.dealId,
    });
  }

  return NextResponse.json(
    {
      push: approval?.push ?? push,
      outcomes: approval?.outcomes ?? {},
      summary: approval?.summary ?? null,
      retryable: approval?.retryable ?? true,
      autoApproved,
    },
    { status: 201 }
  );
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
