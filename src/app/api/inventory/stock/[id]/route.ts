/**
 * Inventory Stock Item API — PUT to update stock metadata
 *
 * PUT /api/inventory/stock/[id]
 *   Auth required, role-gated.
 *   Body: { minStockLevel? }
 *   Updates minStockLevel and sets lastCountedAt to now.
 *   Returns { stock } (with sku relation)
 */

import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";
import { tagSentryRequest } from "@/lib/sentry-request";

const ALLOWED_ROLES = [
  "ADMIN",
  "OWNER",
  "PROJECT_MANAGER",
  "OPERATIONS",
  "OPERATIONS_MANAGER",
];

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  tagSentryRequest(request);
  try {
    const authResult = await requireApiAuth();
    if (authResult instanceof NextResponse) return authResult;

    if (!ALLOWED_ROLES.includes(authResult.role)) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    if (!prisma) {
      return NextResponse.json(
        { error: "Database not configured" },
        { status: 503 }
      );
    }

    const { id } = await params;

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    const { minStockLevel } = body;

    const stock = await prisma.inventoryStock.update({
      where: { id },
      data: {
        ...(minStockLevel !== undefined ? { minStockLevel } : {}),
        lastCountedAt: new Date(),
      },
      include: { sku: true },
    });

    return NextResponse.json({ stock });
  } catch (error) {
    console.error("Failed to update stock:", error);
    Sentry.captureException(error);
    return NextResponse.json(
      { error: "Failed to update stock" },
      { status: 500 }
    );
  }
}
