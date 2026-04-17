import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { getUserByEmail } from "@/lib/db";
import type { UserRole } from "@/generated/prisma/enums";
import { ROLES } from "@/lib/roles";
import { isCatalogSyncEnabled } from "@/lib/catalog-sync-confirmation";
import { harvestZoho } from "@/lib/catalog-harvest";
import { dedupeProducts } from "@/lib/catalog-dedupe";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED_ROLES = new Set<UserRole>(["ADMIN", "EXECUTIVE"]);

// POST: Scan Zoho for duplicates
export async function POST() {
  if (!isCatalogSyncEnabled()) {
    return NextResponse.json({ error: "Catalog sync is not enabled" }, { status: 404 });
  }

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const dbUser = await getUserByEmail(authResult.email);
  const role = (ROLES[((dbUser?.role ?? authResult.role) as UserRole)]?.normalizesTo ?? ((dbUser?.role ?? authResult.role) as UserRole));
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "Admin or owner access required" }, { status: 403 });
  }

  try {
    const allProducts = await harvestZoho();

    // Filter to active items only
    const activeProducts = allProducts.filter((p) => {
      const status = p.rawPayload?.status;
      return !status || status === "active";
    });

    const clusters = dedupeProducts(activeProducts);

    // Only return clusters with more than 1 member (actual duplicates)
    const duplicateClusters = clusters
      .filter((c) => c.members.length > 1)
      .map((cluster) => ({
        canonicalKey: cluster.canonicalKey,
        dedupeReason: cluster.dedupeReason,
        ambiguityCount: cluster.ambiguityCount,
        members: cluster.members.map((m) => ({
          externalId: m.externalId,
          name: m.rawName,
          brand: m.rawBrand,
          model: m.rawModel,
          category: m.category,
          price: m.price,
          sku: String(m.rawPayload?.sku || ""),
          stockOnHand: Number(m.rawPayload?.stock_on_hand ?? 0),
          hasStock: Number(m.rawPayload?.stock_on_hand ?? 0) > 0,
        })),
        recommendedKeepId: cluster.representative.externalId,
      }));

    return NextResponse.json({
      totalScanned: activeProducts.length,
      totalClusters: duplicateClusters.length,
      totalDuplicateItems: duplicateClusters.reduce((sum, c) => sum + c.members.length, 0),
      clusters: duplicateClusters,
    });
  } catch (error) {
    console.error("[Zoho Dedup] Scan failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Scan failed" },
      { status: 500 },
    );
  }
}
