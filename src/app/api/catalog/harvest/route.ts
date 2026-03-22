/**
 * Catalog Harvest API — Phase 1 (read-only)
 *
 * POST /api/catalog/harvest
 *
 * Runs all 5 source adapters, deduplicates within each source, and returns a
 * JSON report with per-source summaries and cluster details.
 *
 * Requires ADMIN or OWNER role.
 */

import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { harvestAll, parseHarvestWarnings } from "@/lib/catalog-harvest";
import { dedupeProducts } from "@/lib/catalog-dedupe";
import type { DedupeCluster } from "@/lib/catalog-dedupe";
import type { HarvestSource } from "@/lib/catalog-harvest";

interface SourceSummary {
  source: HarvestSource;
  totalHarvested: number;
  dedupeClusters: number;
  duplicatesFound: number;
  parseWarnings: number;
  error?: string;
}

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

  try {
    // ── Harvest all sources ───────────────────────────────────────────
    const harvestResults = await harvestAll();

    // ── Dedupe + summarize per source ─────────────────────────────────
    const sourceSummaries: SourceSummary[] = [];
    const allClusters: DedupeCluster[] = [];

    for (const result of harvestResults) {
      const clusters = dedupeProducts(result.products);
      allClusters.push(...clusters);

      // Count parse warnings across all products in this source
      let parseWarningCount = 0;
      for (const product of result.products) {
        parseWarningCount += parseHarvestWarnings(product).length;
      }

      sourceSummaries.push({
        source: result.source,
        totalHarvested: result.products.length,
        dedupeClusters: clusters.length,
        duplicatesFound: result.products.length - clusters.length,
        parseWarnings: parseWarningCount,
        ...(result.error ? { error: result.error } : {}),
      });
    }

    // ── Aggregate stats ───────────────────────────────────────────────
    const ambiguousClusters = allClusters.filter(
      (c) => c.ambiguityCount > 0,
    );

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      sources: sourceSummaries,
      totalClusters: allClusters.length,
      totalAmbiguous: ambiguousClusters.length,
      clusters: allClusters.slice(0, 500),
      ambiguousClusters: ambiguousClusters.slice(0, 100),
    });
  } catch (err) {
    console.error("[catalog/harvest] Unhandled error:", err);
    return NextResponse.json(
      {
        error: "Harvest failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
