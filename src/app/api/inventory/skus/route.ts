/**
 * Inventory SKU API
 *
 * GET  /api/inventory/skus - List SKUs with optional filtering
 * POST /api/inventory/skus - Create or upsert a SKU (admin/manager only)
 */

import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";
import { tagSentryRequest } from "@/lib/sentry-request";
import { EquipmentCategory } from "@/generated/prisma/enums";

// Roles allowed to create/upsert SKUs
const WRITE_ROLES = ["ADMIN", "OWNER", "MANAGER", "PROJECT_MANAGER"];

// Valid EquipmentCategory values for validation
const VALID_CATEGORIES = Object.values(EquipmentCategory);

/**
 * GET /api/inventory/skus
 *
 * Query params:
 *   category - Filter by EquipmentCategory enum value
 *   active   - "true" (default) to show only active SKUs, "false" to include inactive
 */
export async function GET(request: NextRequest) {
  tagSentryRequest(request);
  if (!prisma) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const categoryParam = searchParams.get("category");
    const activeParam = searchParams.get("active");
    const activeOnly = activeParam !== "false"; // default true

    // Validate category if provided
    if (
      categoryParam &&
      !VALID_CATEGORIES.includes(categoryParam as EquipmentCategory)
    ) {
      return NextResponse.json(
        {
          error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}`,
        },
        { status: 400 }
      );
    }

    const skus = await prisma.equipmentSku.findMany({
      where: {
        ...(categoryParam && {
          category: categoryParam as EquipmentCategory,
        }),
        ...(activeOnly && { isActive: true }),
      },
      include: {
        stockLevels: {
          select: { location: true, quantityOnHand: true },
        },
      },
      orderBy: [
        { category: "asc" },
        { brand: "asc" },
        { model: "asc" },
      ],
    });

    return NextResponse.json({ skus, count: skus.length });
  } catch (error) {
    console.error("Error fetching SKUs:", error);
    Sentry.captureException(error);
    return NextResponse.json(
      { error: "Failed to fetch SKUs" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/inventory/skus
 *
 * Body: { category, brand, model, unitSpec?, unitLabel? }
 *
 * Upserts on the compound unique (category + brand + model).
 * Requires ADMIN, OWNER, MANAGER, or PROJECT_MANAGER role.
 */
export async function POST(request: NextRequest) {
  tagSentryRequest(request);
  if (!prisma) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );
  }

  // Auth check
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  // Role check
  if (!WRITE_ROLES.includes(authResult.role)) {
    return NextResponse.json(
      { error: "Insufficient permissions. Requires ADMIN, OWNER, MANAGER, or PROJECT_MANAGER role." },
      { status: 403 }
    );
  }

  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    const { category, brand, model, unitSpec, unitLabel } = body;

    // Validate required fields
    if (!category || !brand || !model) {
      return NextResponse.json(
        { error: "category, brand, and model are required" },
        { status: 400 }
      );
    }

    // Validate category enum
    if (!VALID_CATEGORIES.includes(category as EquipmentCategory)) {
      return NextResponse.json(
        {
          error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}`,
        },
        { status: 400 }
      );
    }

    const trimmedBrand = String(brand).trim();
    const trimmedModel = String(model).trim();

    if (!trimmedBrand || !trimmedModel) {
      return NextResponse.json(
        { error: "brand and model must not be empty after trimming" },
        { status: 400 }
      );
    }

    const sku = await prisma.equipmentSku.upsert({
      where: {
        category_brand_model: {
          category: category as EquipmentCategory,
          brand: trimmedBrand,
          model: trimmedModel,
        },
      },
      update: {
        ...(unitSpec !== undefined && { unitSpec: unitSpec ? Number(unitSpec) : null }),
        ...(unitLabel !== undefined && { unitLabel: unitLabel || null }),
        isActive: true,
      },
      create: {
        category: category as EquipmentCategory,
        brand: trimmedBrand,
        model: trimmedModel,
        unitSpec: unitSpec ? Number(unitSpec) : null,
        unitLabel: unitLabel || null,
      },
    });

    return NextResponse.json({ sku }, { status: 201 });
  } catch (error) {
    console.error("Error creating/upserting SKU:", error);
    Sentry.captureException(error);
    return NextResponse.json(
      { error: "Failed to create/upsert SKU" },
      { status: 500 }
    );
  }
}
