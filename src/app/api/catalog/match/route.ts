/**
 * Catalog Match API — Phase 2
 *
 * POST /api/catalog/match
 *
 * Runs full pipeline: harvest -> dedupe per source -> crossMatch, then
 * upserts CatalogMatchGroup records.  Preserves "sticky" decisions —
 * groups that have already been approved/rejected and whose membership
 * is unchanged are left untouched.
 *
 * Requires ADMIN or OWNER role.
 */

import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma, logActivity } from "@/lib/db";
import { harvestAll } from "@/lib/catalog-harvest";
import { dedupeProducts } from "@/lib/catalog-dedupe";
import { crossMatch } from "@/lib/catalog-matcher";
import type { DedupeCluster } from "@/lib/catalog-dedupe";

export async function POST() {
  // ── Auth ──────────────────────────────────────────────────────────────
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { role } = authResult;
  if (role !== "ADMIN" && role !== "EXECUTIVE") {
    return NextResponse.json(
      { error: "Admin or Owner access required" },
      { status: 403 },
    );
  }

  if (!prisma) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 },
    );
  }

  try {
    // ── Harvest all sources ───────────────────────────────────────────
    const harvestResults = await harvestAll();

    // ── Dedupe per source ─────────────────────────────────────────────
    const allClusters: DedupeCluster[] = [];
    for (const result of harvestResults) {
      const clusters = dedupeProducts(result.products);
      allClusters.push(...clusters);
    }

    // ── Cross-match ───────────────────────────────────────────────────
    const matchGroups = crossMatch(allClusters);

    // ── Upsert into CatalogMatchGroup ─────────────────────────────────
    let created = 0;
    let updated = 0;
    let skippedSticky = 0;
    const byConfidence: Record<string, number> = {
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
    };

    for (const group of matchGroups) {
      byConfidence[group.confidence] =
        (byConfidence[group.confidence] ?? 0) + 1;

      const memberSourcesJson =
        group.memberSources as unknown as object;
      const memberSourcesStr = JSON.stringify(group.memberSources);

      // Check if this group already exists
      const existing = await prisma.catalogMatchGroup.findUnique({
        where: { matchGroupKey: group.matchGroupKey },
      });

      if (existing) {
        // Sticky decision: skip if already decided AND membership unchanged
        const existingMemberStr = JSON.stringify(existing.memberSources);
        const membershipUnchanged = existingMemberStr === memberSourcesStr;

        if (
          existing.decision !== "PENDING" &&
          membershipUnchanged
        ) {
          skippedSticky++;
          continue;
        }

        // Update: either still PENDING or membership changed
        await prisma.catalogMatchGroup.update({
          where: { matchGroupKey: group.matchGroupKey },
          data: {
            confidence: group.confidence,
            score: group.score,
            canonicalBrand: group.canonicalBrand,
            canonicalModel: group.canonicalModel,
            category: group.category,
            memberSources: memberSourcesJson,
            needsReview: group.confidence !== "HIGH",
            reviewReason:
              group.confidence === "LOW"
                ? "Low confidence match"
                : group.confidence === "MEDIUM"
                  ? "Medium confidence — verify match"
                  : null,
          },
        });
        updated++;
      } else {
        // Create new
        await prisma.catalogMatchGroup.create({
          data: {
            matchGroupKey: group.matchGroupKey,
            confidence: group.confidence,
            score: group.score,
            canonicalBrand: group.canonicalBrand,
            canonicalModel: group.canonicalModel,
            category: group.category,
            memberSources: memberSourcesJson,
            needsReview: group.confidence !== "HIGH",
            reviewReason:
              group.confidence === "LOW"
                ? "Low confidence match"
                : group.confidence === "MEDIUM"
                  ? "Medium confidence — verify match"
                  : null,
          },
        });
        created++;
      }
    }

    await logActivity({
      type: "FEATURE_USED",
      description: `Catalog match pipeline: ${created} created, ${updated} updated, ${skippedSticky} sticky`,
      userEmail: authResult.email,
      userName: authResult.name,
      entityType: "catalog_match",
      metadata: { totalMatchGroups: matchGroups.length, created, updated, skippedSticky, byConfidence },
      requestPath: "/api/catalog/match",
      requestMethod: "POST",
      responseStatus: 200,
    }).catch(() => {});

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      totalMatchGroups: matchGroups.length,
      created,
      updated,
      skippedSticky,
      byConfidence,
    });
  } catch (err) {
    console.error("[catalog/match] Unhandled error:", err);
    return NextResponse.json(
      {
        error: "Match pipeline failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
