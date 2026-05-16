/**
 * Shovels Enrichment Orchestration
 *
 * Enriches a HubSpotPropertyCache record with property characteristics,
 * permit history, resident data from the Shovels API.
 *
 * Entry point: `enrichPropertyFromShovels(propertyCacheId)`
 * Called by: backfill script + /api/cron/shovels-enrich
 */

import { prisma } from "@/lib/db";
import {
  createShovelsClient,
  type ShovelsAddress,
  type ShovelsPermit,
} from "@/lib/shovels";
import { updateProperty } from "@/lib/hubspot-property";
import { appCache, CACHE_KEYS } from "@/lib/cache";

// ─── Match Verification ─────────────────────────────────────────────────────

export type MatchConfidence = "VERIFIED" | "LOW_CONFIDENCE" | "REJECTED";

interface OurAddress {
  streetAddress: string;
  city: string;
  state: string;
  zip: string;
}

/**
 * Strips leading zeros from Shovels-style street numbers (e.g. "000135" → "135").
 */
function normalizeStreetNo(raw: string | null): string {
  if (!raw) return "";
  return raw.replace(/^0+/, "") || "0";
}

/**
 * Strips accents and normalizes for city comparison.
 * Handles: Cañon City → canon city, DENVER → denver
 */
function normalizeCity(raw: string | null): string {
  if (!raw) return "";
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Extracts the street number from our address string.
 * "3175 Snow Trillium Way" → "3175"
 */
function extractStreetNo(street: string): string {
  const match = street.match(/^(\d+)/);
  return match ? match[1] : "";
}

/**
 * Extracts the first significant street name word after the number.
 * "3175 Snow Trillium Way" → "snow"
 * "9183 W Finland Dr" → "finland" (skips directional prefixes)
 */
function extractStreetName(street: string): string {
  const withoutNumber = street.replace(/^\d+\s*/, "").toLowerCase();
  const words = withoutNumber.split(/\s+/);
  const directionals = new Set(["n", "s", "e", "w", "ne", "nw", "se", "sw", "north", "south", "east", "west"]);
  for (const word of words) {
    if (!directionals.has(word)) return word;
  }
  return words[0] ?? "";
}

/**
 * Verify that a Shovels search result actually matches our property address.
 * Returns VERIFIED, LOW_CONFIDENCE (flagged/skipped), or REJECTED.
 */
export function verifyShovelsMatch(ours: OurAddress, theirs: ShovelsAddress): MatchConfidence {
  // 1. State must match exactly
  const ourState = ours.state.toUpperCase();
  const theirState = (theirs.state ?? "").toUpperCase();
  if (ourState !== theirState) return "REJECTED";

  // 2. Street number must match
  const ourNo = extractStreetNo(ours.streetAddress);
  const theirNo = normalizeStreetNo(theirs.street_no);
  if (!ourNo || !theirNo || ourNo !== theirNo) return "REJECTED";

  // 3. City must match (case/accent insensitive)
  const ourCity = normalizeCity(ours.city);
  const theirCity = normalizeCity(theirs.city);
  if (!ourCity || !theirCity) return "REJECTED";
  if (ourCity !== theirCity) {
    // Check if one contains the other (e.g. "Canon City" vs "Canon")
    if (!ourCity.includes(theirCity) && !theirCity.includes(ourCity)) {
      return "LOW_CONFIDENCE";
    }
  }

  // 4. Street name overlap (informational — doesn't block)
  const ourStreetName = extractStreetName(ours.streetAddress);
  const theirStreetName = extractStreetName(
    `${theirs.street_no ?? ""} ${theirs.street ?? ""}`,
  );
  if (ourStreetName && theirStreetName) {
    if (!ourStreetName.startsWith(theirStreetName.slice(0, 3)) &&
        !theirStreetName.startsWith(ourStreetName.slice(0, 3))) {
      // Street names are quite different — downgrade to low confidence
      return "LOW_CONFIDENCE";
    }
  }

  return "VERIFIED";
}

// ─── Property Field Extraction ───────────────────────────────────────────────

interface ExtractedPropertyData {
  yearBuilt: number | null;
  squareFootage: number | null;
  lotSizeSqft: number | null;
  stories: number | null;
  propertyType: string | null;
  assessedValue: number | null;
  publicRecordOwnerName: string | null;
}

/**
 * Merge property characteristics across permits. Iterates in API response
 * order (newest-first by file_date) and takes the first non-null value
 * for each field.
 */
function extractPropertyData(permits: ShovelsPermit[]): ExtractedPropertyData {
  const result: ExtractedPropertyData = {
    yearBuilt: null,
    squareFootage: null,
    lotSizeSqft: null,
    stories: null,
    propertyType: null,
    assessedValue: null,
    publicRecordOwnerName: null,
  };

  for (const p of permits) {
    if (result.yearBuilt === null && p.property_year_built != null) {
      result.yearBuilt = p.property_year_built;
    }
    if (result.squareFootage === null && p.property_building_area != null) {
      result.squareFootage = p.property_building_area;
    }
    if (result.lotSizeSqft === null && p.property_lot_size != null) {
      result.lotSizeSqft = p.property_lot_size;
    }
    if (result.stories === null && p.property_story_count != null) {
      result.stories = p.property_story_count;
    }
    if (result.propertyType === null) {
      const type = p.property_type;
      const detail = p.property_type_detail;
      if (type) {
        result.propertyType = detail ? `${type} / ${detail}` : type;
      }
    }
    if (result.assessedValue === null && p.property_assess_market_value != null) {
      // Shovels returns cents → divide by 100 for dollars
      result.assessedValue = Math.round(p.property_assess_market_value / 100);
    }
    if (result.publicRecordOwnerName === null && p.property_legal_owner != null) {
      result.publicRecordOwnerName = p.property_legal_owner;
    }

    // Short-circuit if all fields populated
    if (Object.values(result).every((v) => v !== null)) break;
  }

  return result;
}

// ─── Main Enrichment Function ────────────────────────────────────────────────

export interface EnrichmentResult {
  status: "enriched" | "no-match" | "rejected" | "low-confidence" | "skipped" | "error";
  creditsUsed: number;
  reason?: string;
}

export async function enrichPropertyFromShovels(
  propertyCacheId: string,
): Promise<EnrichmentResult> {
  let creditsUsed = 0;

  try {
    // 1. Read property
    const property = await prisma.hubSpotPropertyCache.findUnique({
      where: { id: propertyCacheId },
      select: {
        id: true,
        hubspotObjectId: true,
        streetAddress: true,
        city: true,
        state: true,
        zip: true,
        shovelsGeoId: true,
        shovelsLastSyncedAt: true,
        shovelsEnrichmentStatus: true,
      },
    });

    if (!property) {
      return { status: "error", creditsUsed: 0, reason: "property not found" };
    }

    // 2. Skip if recently enriched (< 30 days)
    if (
      property.shovelsGeoId &&
      property.shovelsLastSyncedAt &&
      Date.now() - property.shovelsLastSyncedAt.getTime() < 30 * 24 * 60 * 60 * 1000
    ) {
      return { status: "skipped", creditsUsed: 0, reason: "recently enriched" };
    }

    const client = createShovelsClient();

    // 3. Address search
    const query = `${property.streetAddress} ${property.city} ${property.state} ${property.zip}`;
    const addresses = await client.searchAddress(query);
    creditsUsed += addresses.length > 0 ? addresses.length : 1; // Even empty results cost 1

    if (addresses.length === 0) {
      await prisma.hubSpotPropertyCache.update({
        where: { id: propertyCacheId },
        data: {
          shovelsEnrichmentStatus: "NO_MATCH",
          shovelsMatchConfidence: null,
        },
      });
      return { status: "no-match", creditsUsed };
    }

    // 4. Match verification — check top result
    const match = verifyShovelsMatch(
      {
        streetAddress: property.streetAddress,
        city: property.city,
        state: property.state,
        zip: property.zip,
      },
      addresses[0],
    );

    if (match === "REJECTED") {
      await prisma.hubSpotPropertyCache.update({
        where: { id: propertyCacheId },
        data: {
          shovelsEnrichmentStatus: "REJECTED",
          shovelsMatchConfidence: "REJECTED",
        },
      });
      return { status: "rejected", creditsUsed };
    }

    if (match === "LOW_CONFIDENCE") {
      await prisma.hubSpotPropertyCache.update({
        where: { id: propertyCacheId },
        data: {
          shovelsEnrichmentStatus: "REJECTED",
          shovelsMatchConfidence: "LOW_CONFIDENCE",
        },
      });
      return { status: "low-confidence", creditsUsed };
    }

    const geoId = addresses[0].geo_id;

    // 5. Permit search — paginate to get all permits
    const allPermits: ShovelsPermit[] = [];
    let cursor: string | null = null;
    do {
      const page = await client.searchPermits(geoId, {
        from: "2000-01-01",
        size: 100,
        cursor: cursor ?? undefined,
      });
      allPermits.push(...page.items);
      creditsUsed += page.items.length || 1;
      cursor = page.next_cursor;
    } while (cursor);

    // 6. Extract property data (best-available merge)
    const propData = extractPropertyData(allPermits);

    // Count solar permits
    const solarPermitCount = allPermits.filter(
      (p) => p.tags?.some((t) => t === "solar" || t === "solar_battery_storage") ?? false,
    ).length;

    // 7. Resident lookup
    let residents: { name: string | null; personalEmail: string | null; phone: string | null; linkedinUrl: string | null; netWorth: string | null; incomeRange: string | null; isHomeowner: boolean | null }[] = [];
    try {
      const resPage = await client.getResidents(geoId, { size: 50 });
      creditsUsed += resPage.items.length || 1;
      residents = resPage.items.map((r) => ({
        name: r.name,
        personalEmail: r.personal_emails,
        phone: r.phone,
        linkedinUrl: r.linkedin_url,
        netWorth: r.net_worth,
        incomeRange: r.income_range,
        isHomeowner: r.is_homeowner,
      }));
    } catch {
      // Non-fatal — resident data is supplementary
    }

    // 8. Collect unique contractor IDs for lazy batch fetch
    const contractorIds = [
      ...new Set(allPermits.map((p) => p.contractor_id).filter(Boolean) as string[]),
    ];

    // 9. DB transaction
    await prisma.$transaction(async (tx) => {
      // Update property cache
      await tx.hubSpotPropertyCache.update({
        where: { id: propertyCacheId },
        data: {
          yearBuilt: propData.yearBuilt,
          squareFootage: propData.squareFootage,
          lotSizeSqft: propData.lotSizeSqft,
          stories: propData.stories,
          propertyType: propData.propertyType,
          assessedValue: propData.assessedValue,
          publicRecordOwnerName: propData.publicRecordOwnerName,
          shovelsGeoId: geoId,
          shovelsLastSyncedAt: new Date(),
          shovelsMatchConfidence: "VERIFIED",
          shovelsPermitCount: allPermits.length,
          shovelsSolarPermitCount: solarPermitCount,
          shovelsEnrichmentStatus: "ENRICHED",
          shovelsRetryCount: 0,
        },
      });

      // Upsert permit records
      for (const p of allPermits) {
        await tx.shovelsPermitRecord.upsert({
          where: {
            propertyId_shovelsId: { propertyId: propertyCacheId, shovelsId: p.id },
          },
          create: {
            propertyId: propertyCacheId,
            shovelsId: p.id,
            permitNumber: p.number,
            description: p.description,
            jurisdiction: p.jurisdiction,
            type: p.type,
            subtype: p.subtype,
            status: p.status,
            tags: p.tags ?? [],
            jobValueCents: p.job_value,
            feesCents: p.fees,
            fileDate: p.file_date ? new Date(p.file_date) : null,
            issueDate: p.issue_date ? new Date(p.issue_date) : null,
            finalDate: p.final_date ? new Date(p.final_date) : null,
            contractorId: p.contractor_id,
            constructionDurationDays: p.construction_duration,
            approvalDurationDays: p.approval_duration,
            inspectionPassRate: p.inspection_pass_rate,
          },
          update: {
            status: p.status,
            finalDate: p.final_date ? new Date(p.final_date) : null,
            tags: p.tags ?? [],
          },
        });
      }

      // Upsert resident records (delete-and-recreate for simplicity)
      if (residents.length > 0) {
        await tx.shovelsResident.deleteMany({ where: { propertyId: propertyCacheId } });
        await tx.shovelsResident.createMany({
          data: residents.map((r) => ({
            propertyId: propertyCacheId,
            ...r,
          })),
        });
      }
    });

    // 10. Push enriched fields to HubSpot
    try {
      const hubspotProps: Record<string, string | number | null> = {};
      if (propData.yearBuilt != null) hubspotProps.year_built = propData.yearBuilt;
      if (propData.squareFootage != null) hubspotProps.square_footage = propData.squareFootage;
      if (propData.lotSizeSqft != null) hubspotProps.lot_size_sqft = propData.lotSizeSqft;
      if (propData.stories != null) hubspotProps.stories = propData.stories;
      if (propData.propertyType != null) hubspotProps.property_type = propData.propertyType;
      if (propData.assessedValue != null) hubspotProps.assessed_value = propData.assessedValue;
      if (propData.publicRecordOwnerName != null) hubspotProps.public_record_owner_name = propData.publicRecordOwnerName;
      hubspotProps.solar_permit_count = solarPermitCount;

      if (Object.keys(hubspotProps).length > 0) {
        await updateProperty(property.hubspotObjectId, hubspotProps);
      }
    } catch (err) {
      console.error(`[shovels-enrichment] HubSpot push failed for ${propertyCacheId}:`, err);
      // Non-fatal — DB enrichment succeeded
    }

    // 11. Invalidate cache
    appCache.invalidate(CACHE_KEYS.PROPERTY_HUB_ACTIVITY(propertyCacheId));

    // 12. Lazy contractor fetch (non-blocking, best-effort)
    if (contractorIds.length > 0) {
      fetchContractors(contractorIds).catch((err) =>
        console.error("[shovels-enrichment] contractor fetch failed:", err),
      );
    }

    return { status: "enriched", creditsUsed };
  } catch (err) {
    console.error(`[shovels-enrichment] error for ${propertyCacheId}:`, err);

    // Mark as ERROR + increment retry count
    try {
      await prisma.hubSpotPropertyCache.update({
        where: { id: propertyCacheId },
        data: {
          shovelsEnrichmentStatus: "ERROR",
          shovelsRetryCount: { increment: 1 },
        },
      });
    } catch {
      // Best effort
    }

    return {
      status: "error",
      creditsUsed,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Contractor Batch Fetch ──────────────────────────────────────────────────

/**
 * Fetch contractor details for IDs not already in our cache.
 * Non-blocking — called fire-and-forget after enrichment.
 */
async function fetchContractors(contractorIds: string[]): Promise<void> {
  const existing = await prisma.shovelsContractor.findMany({
    where: { shovelsId: { in: contractorIds } },
    select: { shovelsId: true },
  });
  const existingSet = new Set(existing.map((e) => e.shovelsId));
  const missing = contractorIds.filter((id) => !existingSet.has(id));

  if (missing.length === 0) return;

  const client = createShovelsClient();
  for (const id of missing) {
    const detail = await client.getContractorById(id);
    if (detail) {
      await prisma.shovelsContractor.upsert({
        where: { shovelsId: id },
        create: {
          shovelsId: id,
          name: detail.name,
          phone: detail.phone,
          email: detail.email,
          website: detail.website,
          license: detail.license,
          classification: detail.classification_derived,
          totalPermitsCount: detail.total_permits_count,
          avgInspectionRate: detail.avg_inspection_pass_rate,
        },
        update: {
          name: detail.name,
          phone: detail.phone,
          email: detail.email,
          website: detail.website,
        },
      });
    }
    // Small delay between contractor fetches
    await new Promise((r) => setTimeout(r, 300));
  }
}
