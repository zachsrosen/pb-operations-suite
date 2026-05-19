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

  // Two auth modes:
  //   1. NextAuth session — must be ADMIN or OWNER
  //   2. Machine token (Bearer API_SECRET_TOKEN) — verified by middleware,
  //      which sets `x-api-token-authenticated: 1` on the request when valid.
  //      Used for one-shot fleet imports and the future bookmarklet flow.
  const isMachineAuth =
    request.headers.get("x-api-token-authenticated") === "1";
  if (!isMachineAuth) {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const currentUser = await getUserByEmail(session.user.email);
    const roles = currentUser?.roles ?? [];
    if (!roles.includes("ADMIN") && !roles.includes("OWNER")) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
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

  // Index our PowerhubSite rows by siteId. Load existing propertyId so we
  // can detect + clear stale links when a re-import places the site outside
  // the LOW radius of its previously-matched property.
  const ourSites = new Map(
    (
      await prisma.powerhubSite.findMany({
        where: { siteId: { in: parsed.sites.map((s) => s.siteId) } },
        select: { siteId: true, propertyId: true, linkMethod: true },
      })
    ).map((s) => [s.siteId, s] as const),
  );

  let coordsUpdated = 0;
  let linksWritten = 0;
  let linksCleared = 0;
  let skippedUnknown = 0;
  const matchCounts: Record<"HIGH" | "MEDIUM" | "LOW" | "UNMATCHED", number> = {
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
    UNMATCHED: 0,
  };
  // Property IDs that need resolvePrimarySite called: any property we just
  // linked TO, or any property we just unlinked FROM (so its denormalized
  // teslaPortalUrl/teslaSiteId on HubSpotPropertyCache refreshes correctly).
  const propertyIdsTouched = new Set<string>();

  for (const incoming of parsed.sites) {
    const existing = ourSites.get(incoming.siteId);
    if (!existing) {
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
      coordsUpdated++;
      if (match) linksWritten++;
      // If the site is currently linked but wouldn't be after re-import,
      // dryRun reports that as a cleared link.
      if (!match && existing.propertyId) linksCleared++;
      continue;
    }

    // Build the update payload. Three branches:
    //   (a) match found       → write coords + GEO link
    //   (b) no match, was linked → clear the stale link (Bug fix from code review:
    //       silently preserving propertyId here was worse than the over-clustering
    //       this PR replaces — re-imports would never demote a site away from
    //       a property it's no longer near.)
    //   (c) no match, wasn't linked → write coords only, leave UNLINKED
    const data: {
      latitude: number;
      longitude: number;
      lastGeoSyncAt: Date;
      propertyId?: string | null;
      dealId?: null;
      linkMethod?: "GEO" | "UNLINKED";
      linkConfidence?: "HIGH" | "MEDIUM" | "LOW";
      linkDistanceM?: number | null;
      primaryForProperty?: false;
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
      linksWritten++;
    } else if (existing.propertyId) {
      // Branch (b) — explicitly clear stale link
      data.propertyId = null;
      data.dealId = null;
      data.linkMethod = "UNLINKED";
      data.linkDistanceM = null;
      data.primaryForProperty = false;
      propertyIdsTouched.add(existing.propertyId);
      linksCleared++;
    }

    // Race note: two concurrent imports touching the same (siteId, propertyId)
    // could interleave their primaryForProperty writes here. resolvePrimarySite
    // calls retryOnUniqueConflict so the worst case is a nondeterministic
    // primary winner — acceptable for an admin-only, manually-triggered
    // endpoint. If this becomes a real workflow we'd want a per-property
    // advisory lock.
    await prisma.powerhubSite.update({
      where: { siteId: incoming.siteId },
      data,
    });
    coordsUpdated++;
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
    coordsUpdated,
    linksWritten,
    linksCleared,
    skippedUnknown,
    matched: matchCounts,
    propertiesResolved: dryRun ? 0 : propertyIdsTouched.size,
    dryRun,
  });
}
