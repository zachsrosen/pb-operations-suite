/**
 * Inventory Stock API — GET stock levels
 *
 * GET /api/inventory/stock
 *   Query params:
 *     - location (string) — filter by warehouse location
 *     - category (string) — filter by sku.category (MODULE, INVERTER, BATTERY, EV_CHARGER)
 *
 *   Returns { stock, count }
 */

import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { tagSentryRequest } from "@/lib/sentry-request";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  tagSentryRequest(request);
  try {
    if (!prisma) {
      return NextResponse.json(
        { error: "Database not configured" },
        { status: 503 }
      );
    }

    const { searchParams } = request.nextUrl;
    const location = searchParams.get("location");
    const category = searchParams.get("category");

    // Build where clause — always filter to active SKUs
    const where: Record<string, unknown> = {
      sku: {
        isActive: true,
        ...(category ? { category } : {}),
      },
    };

    if (location) {
      where.location = location;
    }

    const stock = await prisma.inventoryStock.findMany({
      where,
      include: { sku: true },
      orderBy: [
        { sku: { category: "asc" } },
        { sku: { brand: "asc" } },
        { location: "asc" },
      ],
    });

    return NextResponse.json({ stock, count: stock.length });
  } catch (error) {
    console.error("Failed to fetch stock levels:", error);
    Sentry.captureException(error);
    return NextResponse.json(
      { error: "Failed to fetch stock levels" },
      { status: 500 }
    );
  }
}
