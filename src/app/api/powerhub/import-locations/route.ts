/**
 * POST /api/powerhub/import-locations
 *
 * Ingests site lat/lng from Tesla's GridLogic portal (the `assetGetSiteLocations`
 * GraphQL response) and runs geo-coordinate matching against
 * HubSpotPropertyCache.
 *
 * Why this endpoint exists: Tesla's REST partner API doesn't return site
 * coordinates, and the portal's GraphQL endpoint requires browser-cookie SSO
 * (rejects our partner JWT). An authenticated user runs the GraphQL query
 * client-side (Chrome MCP, bookmarklet, or a future admin UI button), and
 * POSTs the response payload here for ingestion.
 *
 * Request body:
 *   { sites: [{ siteId: string, latitude: number, longitude: number, siteName?: string }] }
 *
 * Response:
 *   {
 *     received:     number,  // total sites in payload
 *     updated:      number,  // PowerhubSite rows with new lat/lng
 *     skippedUnknown: number,  // sites in payload but not in our DB
 *     matched: {
 *       HIGH: number,   // sites that got an auto-link at ≤25m
 *       MEDIUM: number, // 25-50m
 *       LOW: number,    // 50-100m
 *       UNMATCHED: number, // >100m or no nearby property
 *     },
 *     dryRun: boolean,
 *   }
 *
 * Admin-only. Pass ?dryRun=1 to compute matches without writing.
 *
 * See: docs/superpowers/specs/2026-05-19-powerhub-geo-linking-design.md
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { getUserByEmail, prisma } from "@/lib/db";
import {
  filterByBoundingBox,
  findNearestProperty,
  GEO_PREFILTER_DEG,
  type PropertyCandidate,
} from "@/lib/powerhub-geo-match";
import { resolvePrimarySite } from "@/lib/powerhub-crosslink";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const RequestSchema = z.object({
  sites: z
    .array(
      z.object({
        siteId: z.string().min(1),
        latitude: z.number().gte(-90).lte(90),
        longitude: z.number().gte(-180).lte(180),
        siteName: z.string().optional(),
      }),
    )
    .min(1)
    .max(10_000), // sanity cap; PB fleet is ~3k
});

export async function POST(request: Request) {
  if (process.env.POWERHUB_ENABLED !== "true") {
    return NextResponse.json({ error: "PowerHub disabled" }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const currentUser = await getUserByEmail(session.user.email);
  const roles = currentUser?.roles ?? [];
  if (!roles.includes("ADMIN") && !roles.includes("OWNER")) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  let parsed;
  try {
    const body = await request.json();
    parsed = RequestSchema.parse(body);
  } catch (err) {
    return NextResponse.json(
      { error: "Invalid request body", details: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  // Load all property candidates once (lat+lng present)
  const rawProps = await prisma.hubSpotPropertyCache.findMany({
    select: { id: true, latitude: true, longitude: true },
  });
  const candidates: PropertyCandidate[] = [];
  for (const p of rawProps) {
    if (p.latitude !== null && p.longitude !== null) {
      candidates.push({ id: p.id, latitude: p.latitude, longitude: p.longitude });
    }
  }

  // Index our PowerhubSite rows by siteId for fast lookup
  const ourSiteIds = new Set(
    (
      await prisma.powerhubSite.findMany({
        where: { siteId: { in: parsed.sites.map((s) => s.siteId) } },
        select: { siteId: true },
      })
    ).map((s) => s.siteId),
  );

  let updated = 0;
  let skippedUnknown = 0;
  const matchCounts: Record<"HIGH" | "MEDIUM" | "LOW" | "UNMATCHED", number> = {
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
    UNMATCHED: 0,
  };
  const propertyIdsTouched = new Set<string>();

  for (const incoming of parsed.sites) {
    if (!ourSiteIds.has(incoming.siteId)) {
      skippedUnknown++;
      continue;
    }

    const nearby = filterByBoundingBox(
      incoming.latitude,
      incoming.longitude,
      candidates,
      GEO_PREFILTER_DEG,
    );
    const match = findNearestProperty(
      incoming.latitude,
      incoming.longitude,
      nearby,
    );

    if (match) {
      matchCounts[match.confidence]++;
    } else {
      matchCounts.UNMATCHED++;
    }

    if (dryRun) {
      updated++;
      continue;
    }

    // Write coords + (optionally) link, in a single update per row
    const data: {
      latitude: number;
      longitude: number;
      lastGeoSyncAt: Date;
      propertyId?: string;
      dealId?: null;
      linkMethod?: "GEO";
      linkConfidence?: "HIGH" | "MEDIUM" | "LOW";
      linkDistanceM?: number;
    } = {
      latitude: incoming.latitude,
      longitude: incoming.longitude,
      lastGeoSyncAt: new Date(),
    };

    if (match) {
      data.propertyId = match.propertyId;
      data.dealId = null; // geo-match doesn't bind to a specific deal
      data.linkMethod = "GEO";
      data.linkConfidence = match.confidence;
      data.linkDistanceM = match.distanceM;
      propertyIdsTouched.add(match.propertyId);
    }

    await prisma.powerhubSite.update({
      where: { siteId: incoming.siteId },
      data,
    });
    updated++;
  }

  // Re-resolve primary for every affected property so teslaPortalUrl /
  // teslaSiteId on HubSpotPropertyCache reflects the new linkage.
  if (!dryRun) {
    for (const propertyId of propertyIdsTouched) {
      await resolvePrimarySite(propertyId);
    }
  }

  return NextResponse.json({
    received: parsed.sites.length,
    updated,
    skippedUnknown,
    matched: matchCounts,
    propertiesResolved: dryRun ? 0 : propertyIdsTouched.size,
    dryRun,
  });
}
