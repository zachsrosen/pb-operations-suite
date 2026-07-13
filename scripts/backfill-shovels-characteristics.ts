// scripts/backfill-shovels-characteristics.ts
//
// One-time catch-up: the Shovels->HubSpot property push has been failing for every
// already-enriched property (the batch included solar_permit_count, which did not
// exist on the object, so HubSpot 400'd the whole update). Now that the property
// exists, this pushes the enriched property characteristics from the DB cache onto
// the HubSpot property object for all already-enriched rows. Future enrichments push
// these inline; this backfills the historical ones. Mirrors the push block in
// src/lib/shovels-enrichment.ts.
//
// Usage:
//   tsx scripts/backfill-shovels-characteristics.ts          # dry-run (default)
//   tsx scripts/backfill-shovels-characteristics.ts --apply   # write to HubSpot
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const APPLY = process.argv.includes("--apply");

async function main() {
  const { prisma } = await import("../src/lib/db");
  if (!prisma) throw new Error("prisma client is null — DATABASE_URL not loaded");
  const { updateProperty } = await import("../src/lib/hubspot-property");

  const properties = await prisma.hubSpotPropertyCache.findMany({
    where: { shovelsEnrichmentStatus: "ENRICHED" },
    select: {
      id: true,
      hubspotObjectId: true,
      fullAddress: true,
      yearBuilt: true,
      squareFootage: true,
      lotSizeSqft: true,
      stories: true,
      propertyType: true,
      assessedValue: true,
      publicRecordOwnerName: true,
      shovelsSolarPermitCount: true,
    },
  });

  console.log(`Enriched properties: ${properties.length}`);
  console.log(APPLY ? ">>> APPLY mode — writing to HubSpot\n" : ">>> DRY RUN — no writes (pass --apply)\n");

  let written = 0, skipped = 0, failed = 0;
  for (const p of properties) {
    // Mirror the field mapping in shovels-enrichment.ts step 10.
    const props: Record<string, string | number | null> = {};
    if (p.yearBuilt != null) props.year_built = p.yearBuilt;
    if (p.squareFootage != null) props.square_footage = p.squareFootage;
    if (p.lotSizeSqft != null) props.lot_size_sqft = p.lotSizeSqft;
    if (p.stories != null) props.stories = p.stories;
    if (p.propertyType != null) props.property_type = p.propertyType;
    if (p.assessedValue != null) props.assessed_value = p.assessedValue;
    if (p.publicRecordOwnerName != null) props.public_record_owner_name = p.publicRecordOwnerName;
    // solar_permit_count is always meaningful (0 is a real value) when we have a count.
    if (p.shovelsSolarPermitCount != null) props.solar_permit_count = p.shovelsSolarPermitCount;

    if (Object.keys(props).length === 0) {
      skipped++;
      continue;
    }

    if (!APPLY) {
      if (written < 12) {
        console.log(`  ${(p.fullAddress ?? p.id).slice(0, 45).padEnd(45)} yb=${p.yearBuilt ?? "-"} sqft=${p.squareFootage ?? "-"} solar=${p.shovelsSolarPermitCount ?? "-"}`);
      }
      written++;
      continue;
    }

    try {
      await updateProperty(p.hubspotObjectId, props);
      written++;
      if (written % 200 === 0) console.log(`  ...wrote ${written}`);
    } catch (err) {
      failed++;
      console.error(`  FAILED ${p.id} (${p.fullAddress}):`, err instanceof Error ? err.message : err);
    }
  }

  console.log("\n========== SUMMARY ==========");
  console.log(`${APPLY ? "Written" : "Would write"}: ${written}`);
  console.log(`Skipped (no data):   ${skipped}`);
  if (APPLY) console.log(`Failed:              ${failed}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
