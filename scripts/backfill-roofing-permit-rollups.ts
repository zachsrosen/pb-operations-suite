// scripts/backfill-roofing-permit-rollups.ts
//
// Backfills the roofing-permit rollup properties onto already-enriched HubSpot
// property-object records, using permits already stored in ShovelsPermitRecord.
// This is the one-time catch-up for the writeback added to shovels-enrichment.ts
// (future enrichments push these fields inline).
//
// PREREQ: run `tsx scripts/create-hubspot-property-object.ts` first so the four
//   roofing_* properties exist on the property object, or every update 400s.
//
// Usage:
//   tsx scripts/backfill-roofing-permit-rollups.ts          # dry-run (default)
//   tsx scripts/backfill-roofing-permit-rollups.ts --apply   # write to HubSpot
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const APPLY = process.argv.includes("--apply");

// Canonical Shovels roofing tag — matches shovels-enrichment.ts roofing rollup.
const ROOFING_TAG = "roofing";

async function main() {
  const { prisma } = await import("../src/lib/db");
  if (!prisma) throw new Error("prisma client is null — DATABASE_URL not loaded");
  const { updateProperty } = await import("../src/lib/hubspot-property");

  // Enriched properties — hubspotObjectId is a required column, so every row is writable.
  const properties = await prisma.hubSpotPropertyCache.findMany({
    where: { shovelsEnrichmentStatus: "ENRICHED" },
    select: { id: true, hubspotObjectId: true, fullAddress: true },
  });

  console.log(`Enriched properties with a HubSpot id: ${properties.length}`);
  console.log(APPLY ? ">>> APPLY mode — writing to HubSpot\n" : ">>> DRY RUN — no writes (pass --apply to write)\n");

  let withRoofing = 0;
  let written = 0;
  let failed = 0;

  for (const prop of properties) {
    const roofing = await prisma.shovelsPermitRecord.findMany({
      where: { propertyId: prop.id, tags: { has: ROOFING_TAG } },
    });
    if (roofing.length === 0) continue;
    withRoofing++;

    // Latest by coalesced (issueDate ?? fileDate), matching the live enrichment path.
    // Done in JS to avoid Postgres NULLS-FIRST ordering picking a fileDate-only row.
    const dated = roofing
      .map((p) => ({ p, when: p.issueDate ?? p.fileDate }))
      .filter((x): x is { p: (typeof roofing)[number]; when: Date } => x.when != null)
      .sort((a, b) => b.when.getTime() - a.when.getTime());
    const latest = dated[0]?.p ?? roofing[0];
    const when = latest.issueDate ?? latest.fileDate;

    const props: Record<string, string | number | null> = {
      roofing_permit_count: roofing.length,
    };
    if (when) props.latest_roofing_permit_date = when.toISOString().slice(0, 10);
    if (latest.permitNumber) props.latest_roofing_permit_number = latest.permitNumber;
    if (latest.jurisdiction) props.latest_roofing_permit_jurisdiction = latest.jurisdiction;

    if (!APPLY) {
      if (withRoofing <= 15) {
        console.log(
          `  ${(prop.fullAddress ?? prop.id).slice(0, 45).padEnd(45)} count=${roofing.length} ` +
            `date=${props.latest_roofing_permit_date ?? "-"} #${latest.permitNumber ?? "-"}`,
        );
      }
      continue;
    }

    try {
      await updateProperty(prop.hubspotObjectId, props);
      written++;
      if (written % 200 === 0) console.log(`  ...wrote ${written}`);
    } catch (err) {
      failed++;
      console.error(`  FAILED ${prop.id} (${prop.fullAddress}):`, err instanceof Error ? err.message : err);
    }
  }

  console.log("\n========== SUMMARY ==========");
  console.log(`Properties with roofing permits: ${withRoofing}`);
  if (APPLY) {
    console.log(`Written to HubSpot:              ${written}`);
    console.log(`Failed:                          ${failed}`);
  } else {
    console.log("(dry run — re-run with --apply to write)");
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
