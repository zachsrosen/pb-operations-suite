/**
 * Inventory SKU Stats API
 *
 * GET /api/inventory/skus/stats — per-category sync health breakdown
 *
 * Returns counts of SKUs by category and how many have each external ID populated.
 */

import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";

export async function GET() {
  try {
    const authResult = await requireApiAuth();
    if (authResult instanceof NextResponse) return authResult;

    if (!prisma) {
      return NextResponse.json(
        { error: "Database not configured" },
        { status: 503 }
      );
    }

    const skus = await prisma.equipmentSku.findMany({
      where: { isActive: true },
      select: {
        category: true,
        zohoItemId: true,
        hubspotProductId: true,
        zuperItemId: true,
        unitCost: true,
        sellPrice: true,
      },
    });

    // Group by category
    const byCategory: Record<
      string,
      {
        total: number;
        fullySynced: number;
        hasZoho: number;
        hasHubspot: number;
        hasZuper: number;
        withPricing: number;
      }
    > = {};

    for (const sku of skus) {
      const cat = sku.category;
      if (!byCategory[cat]) {
        byCategory[cat] = {
          total: 0,
          fullySynced: 0,
          hasZoho: 0,
          hasHubspot: 0,
          hasZuper: 0,
          withPricing: 0,
        };
      }
      const entry = byCategory[cat];
      entry.total++;

      const hasZoho = Boolean(sku.zohoItemId);
      const hasHubspot = Boolean(sku.hubspotProductId);
      const hasZuper = Boolean(sku.zuperItemId);

      if (hasZoho) entry.hasZoho++;
      if (hasHubspot) entry.hasHubspot++;
      if (hasZuper) entry.hasZuper++;
      if (hasZoho && hasHubspot && hasZuper) entry.fullySynced++;
      if (sku.unitCost != null && sku.sellPrice != null) entry.withPricing++;
    }

    // Build sorted array
    const categories = Object.entries(byCategory)
      .map(([category, stats]) => ({ category, ...stats }))
      .sort((a, b) => b.total - a.total);

    // Global totals
    const totals = {
      total: skus.length,
      fullySynced: categories.reduce((s, c) => s + c.fullySynced, 0),
      missingZoho: skus.length - categories.reduce((s, c) => s + c.hasZoho, 0),
      missingHubspot: skus.length - categories.reduce((s, c) => s + c.hasHubspot, 0),
      missingZuper: skus.length - categories.reduce((s, c) => s + c.hasZuper, 0),
      withPricing: categories.reduce((s, c) => s + c.withPricing, 0),
    };

    return NextResponse.json({ categories, totals });
  } catch (error) {
    console.error("Error fetching SKU stats:", error);
    Sentry.captureException(error);
    return NextResponse.json(
      { error: "Failed to fetch SKU stats" },
      { status: 500 }
    );
  }
}
