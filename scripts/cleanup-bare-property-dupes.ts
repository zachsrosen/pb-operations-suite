// scripts/cleanup-bare-property-dupes.ts
//
// Identifies and archives "bare" HubSpot Property records created by the
// now-disabled "Property Creation and Associations" workflow (ID 1817837900).
//
// Bare records have no `google_place_id` and no `normalized_address` because
// the workflow copied raw contact address fields without geocoding. Our webhook
// then geocoded the same address, couldn't find the bare record (no dedup keys),
// and created a second, enriched record — producing duplicates.
//
// Strategy:
//   1. Fetch ALL Property records from HubSpot (paged)
//   2. Partition into "bare" (no placeId AND no normalizedAddress) vs "enriched"
//   3. For each bare record with a matching enriched record (same street+city+state+zip),
//      archive the bare one
//   4. Bare records with NO enriched counterpart are kept (they're unique addresses
//      that only the workflow created — our webhook never saw them)
//   5. Clean up orphaned HubSpotPropertyCache rows pointing to archived records
//
// Usage:
//   DRY_RUN=true tsx scripts/cleanup-bare-property-dupes.ts      # preview
//   tsx scripts/cleanup-bare-property-dupes.ts                     # execute
//
// Rate limiting: archives in batches of 100 with 1s pause between batches.

import "dotenv/config";
import { Client } from "@hubspot/api-client";
import { withRetry } from "../src/lib/hubspot-custom-objects";
import { prisma } from "../src/lib/db";

const DRY_RUN = process.env.DRY_RUN === "true";

const hubspotClient = new Client({
  accessToken: process.env.HUBSPOT_ACCESS_TOKEN,
  numberOfApiCallRetries: 2,
});

const PROPERTY_OBJECT_TYPE = process.env.HUBSPOT_PROPERTY_OBJECT_TYPE;
if (!PROPERTY_OBJECT_TYPE) {
  console.error("HUBSPOT_PROPERTY_OBJECT_TYPE is not set");
  process.exit(1);
}

const PROPERTIES_TO_FETCH = [
  "google_place_id",
  "normalized_address",
  "street_address",
  "city",
  "state",
  "zip",
  "record_name",
  "full_address",
];

interface PropertyRecord {
  id: string;
  properties: Record<string, string | null>;
}

// ---------------------------------------------------------------------------
// Step 1: Fetch all Property records
// ---------------------------------------------------------------------------

async function fetchAllProperties(): Promise<PropertyRecord[]> {
  const results: PropertyRecord[] = [];
  let after: string | undefined;
  let page = 0;

  do {
    const response = await withRetry(() =>
      hubspotClient.crm.objects.basicApi.getPage(
        PROPERTY_OBJECT_TYPE!,
        100,
        after,
        PROPERTIES_TO_FETCH,
        undefined,
        undefined
      )
    );

    results.push(
      ...response.results.map((r) => ({
        id: r.id,
        properties: r.properties as Record<string, string | null>,
      }))
    );
    after = response.paging?.next?.after;
    page++;
    if (page % 50 === 0) {
      console.log(`  ... fetched ${results.length} records (page ${page})`);
    }
  } while (after);

  return results;
}

// ---------------------------------------------------------------------------
// Step 2: Partition and find duplicates
// ---------------------------------------------------------------------------

function addressKey(r: PropertyRecord): string | null {
  const street = (r.properties.street_address ?? "").trim().toLowerCase();
  const city = (r.properties.city ?? "").trim().toLowerCase();
  const state = (r.properties.state ?? "").trim().toLowerCase();
  const zip = (r.properties.zip ?? "").trim().toLowerCase();
  if (!street || !city || !state || !zip) return null;
  return `${street}|${city}|${state}|${zip}`;
}

function isBare(r: PropertyRecord): boolean {
  const placeId = (r.properties.google_place_id ?? "").trim();
  const normAddr = (r.properties.normalized_address ?? "").trim();
  return !placeId && !normAddr;
}

// ---------------------------------------------------------------------------
// Step 3: Batch archive
// ---------------------------------------------------------------------------

async function batchArchive(ids: string[]): Promise<{ archived: number; failed: number }> {
  let archived = 0;
  let failed = 0;
  const BATCH_SIZE = 100;

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);

    try {
      await withRetry(() =>
        hubspotClient.crm.objects.batchApi.archive(PROPERTY_OBJECT_TYPE!, {
          inputs: batch.map((id) => ({ id })),
        })
      );
      archived += batch.length;
    } catch (err) {
      console.error(`  Batch archive failed at offset ${i}:`, err);
      // Fall back to individual archives
      for (const id of batch) {
        try {
          await withRetry(() =>
            hubspotClient.crm.objects.basicApi.archive(PROPERTY_OBJECT_TYPE!, id)
          );
          archived++;
        } catch (innerErr) {
          console.error(`  Individual archive failed for ${id}:`, innerErr);
          failed++;
        }
      }
    }

    if (i + BATCH_SIZE < ids.length) {
      console.log(`  ... archived ${archived}/${ids.length} so far`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  return { archived, failed };
}

// ---------------------------------------------------------------------------
// Step 4: Clean up orphaned cache rows
// ---------------------------------------------------------------------------

async function cleanupOrphanedCacheRows(archivedIds: string[]): Promise<number> {
  if (!archivedIds.length) return 0;

  const CHUNK = 500;
  let deleted = 0;

  for (let i = 0; i < archivedIds.length; i += CHUNK) {
    const chunk = archivedIds.slice(i, i + CHUNK);

    // Find cache rows FIRST (before deleting them)
    const cacheRows = await prisma.hubSpotPropertyCache.findMany({
      where: { hubspotObjectId: { in: chunk } },
      select: { id: true },
    });
    const cacheIds = cacheRows.map((r) => r.id);

    // Delete link table rows that reference these cache rows
    if (cacheIds.length) {
      await prisma.propertyDealLink.deleteMany({ where: { propertyCacheId: { in: cacheIds } } });
      await prisma.propertyTicketLink.deleteMany({ where: { propertyCacheId: { in: cacheIds } } });
      await prisma.propertyContactLink.deleteMany({ where: { propertyCacheId: { in: cacheIds } } });
      await prisma.propertyCompanyLink.deleteMany({ where: { propertyCacheId: { in: cacheIds } } });
    }

    // Now delete the cache rows themselves
    const result = await prisma.hubSpotPropertyCache.deleteMany({
      where: { hubspotObjectId: { in: chunk } },
    });
    deleted += result.count;
  }

  return deleted;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n=== Property Duplicate Cleanup ${DRY_RUN ? "(DRY RUN)" : "(LIVE)"} ===\n`);

  // Step 1: Fetch all records
  console.log("Step 1: Fetching all Property records from HubSpot...");
  const allRecords = await fetchAllProperties();
  console.log(`  Total records: ${allRecords.length}`);

  // Step 2: Partition
  console.log("\nStep 2: Partitioning into bare vs enriched...");
  const bare: PropertyRecord[] = [];
  const enriched: PropertyRecord[] = [];

  for (const r of allRecords) {
    if (isBare(r)) {
      bare.push(r);
    } else {
      enriched.push(r);
    }
  }
  console.log(`  Bare records (no placeId, no normalizedAddress): ${bare.length}`);
  console.log(`  Enriched records: ${enriched.length}`);

  // Build address index from enriched records
  const enrichedByAddress = new Map<string, PropertyRecord[]>();
  for (const r of enriched) {
    const key = addressKey(r);
    if (!key) continue;
    const arr = enrichedByAddress.get(key) ?? [];
    arr.push(r);
    enrichedByAddress.set(key, arr);
  }

  // Step 3: Identify bare records that have enriched counterparts
  console.log("\nStep 3: Identifying bare duplicates with enriched counterparts...");
  const toArchive: string[] = [];
  const uniqueBare: PropertyRecord[] = [];
  const noAddressBare: PropertyRecord[] = [];

  for (const r of bare) {
    const key = addressKey(r);
    if (!key) {
      noAddressBare.push(r);
      continue;
    }

    const enrichedMatch = enrichedByAddress.get(key);
    if (enrichedMatch && enrichedMatch.length > 0) {
      toArchive.push(r.id);
    } else {
      uniqueBare.push(r);
    }
  }

  console.log(`  Bare duplicates to archive (enriched counterpart exists): ${toArchive.length}`);
  console.log(`  Bare unique (no enriched counterpart, keeping): ${uniqueBare.length}`);
  console.log(`  Bare with no address (no street/city/state/zip): ${noAddressBare.length}`);

  // Show a sample
  if (toArchive.length > 0) {
    console.log("\n  Sample bare duplicates to archive:");
    for (const id of toArchive.slice(0, 5)) {
      const r = bare.find((b) => b.id === id)!;
      const key = addressKey(r);
      const enrichedMatch = key ? enrichedByAddress.get(key) : null;
      console.log(`    ${id}: "${r.properties.street_address}, ${r.properties.city}" → enriched match: ${enrichedMatch?.[0]?.id}`);
    }
  }

  if (uniqueBare.length > 0) {
    console.log("\n  Sample bare unique (keeping):");
    for (const r of uniqueBare.slice(0, 5)) {
      console.log(`    ${r.id}: "${r.properties.street_address}, ${r.properties.city}"`);
    }
  }

  if (noAddressBare.length > 0) {
    console.log("\n  Bare records with no address will also be archived (useless):");
    toArchive.push(...noAddressBare.map((r) => r.id));
    console.log(`  Updated total to archive: ${toArchive.length}`);
  }

  if (DRY_RUN) {
    console.log("\n=== DRY RUN — no changes made ===");
    console.log(`Would archive: ${toArchive.length} records`);
    await prisma.$disconnect();
    process.exit(0);
  }

  // Step 4: Archive
  if (toArchive.length === 0) {
    console.log("\nNothing to archive. Done.");
    await prisma.$disconnect();
    process.exit(0);
  }

  console.log(`\nStep 4: Archiving ${toArchive.length} bare duplicate records...`);
  const { archived, failed } = await batchArchive(toArchive);
  console.log(`  Archived: ${archived}`);
  console.log(`  Failed: ${failed}`);

  // Step 5: Clean up orphaned cache rows
  console.log("\nStep 5: Cleaning up orphaned cache rows...");
  const deletedCacheRows = await cleanupOrphanedCacheRows(toArchive);
  console.log(`  Deleted cache rows: ${deletedCacheRows}`);

  console.log("\n=== Done ===");
  console.log(`  Total archived: ${archived}`);
  console.log(`  Total failed: ${failed}`);
  console.log(`  Cache rows cleaned: ${deletedCacheRows}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(3);
});
