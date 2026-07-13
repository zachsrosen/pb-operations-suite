// scripts/backfill-permit-rollups.ts
//
// One-time backfill of the per-permit-type rollup fields onto already-enriched
// HubSpot property records, computed from stored ShovelsPermitRecord +
// ShovelsContractor. Future enrichments push these inline (shovels-enrichment.ts).
// Uses the same computePermitRollups() as the live path so values can't drift.
//
// PREREQ: run create-permit-rollup-properties.ts --apply first, or updates 400.
//
// Usage:
//   tsx scripts/backfill-permit-rollups.ts          # dry-run
//   tsx scripts/backfill-permit-rollups.ts --apply   # write to HubSpot
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import {
  fromDbPermit,
  computePermitRollups,
  contractorLabelFrom,
} from "../src/lib/shovels-permit-rollups";

const APPLY = process.argv.includes("--apply");

async function main() {
  const { prisma } = await import("../src/lib/db");
  if (!prisma) throw new Error("prisma client is null — DATABASE_URL not loaded");
  const { updateProperty } = await import("../src/lib/hubspot-property");

  const properties = await prisma.hubSpotPropertyCache.findMany({
    where: { shovelsEnrichmentStatus: "ENRICHED" },
    select: { id: true, hubspotObjectId: true, fullAddress: true },
  });

  console.log(`Enriched properties: ${properties.length}`);
  console.log(APPLY ? ">>> APPLY mode — writing to HubSpot\n" : ">>> DRY RUN — no writes (pass --apply)\n");

  let written = 0, skipped = 0, failed = 0;
  for (const prop of properties) {
    const permits = await prisma.shovelsPermitRecord.findMany({
      where: { propertyId: prop.id },
      select: {
        tags: true, issueDate: true, fileDate: true, permitNumber: true,
        jurisdiction: true, contractorId: true,
      },
    });
    if (permits.length === 0) {
      skipped++;
      continue;
    }

    // Resolve contractor labels for this property's permits.
    const contractorIds = [...new Set(permits.map((p) => p.contractorId).filter(Boolean) as string[])];
    const contractors = contractorIds.length > 0
      ? await prisma.shovelsContractor.findMany({
          where: { shovelsId: { in: contractorIds } },
          select: { shovelsId: true, name: true, license: true },
        })
      : [];
    const cMap = new Map(contractors.map((c) => [c.shovelsId, c]));

    const rollupPermits = permits.map(fromDbPermit);
    const props = computePermitRollups(rollupPermits, (id) => contractorLabelFrom(cMap.get(id)));

    if (!APPLY) {
      if (written < 10) {
        console.log(`  ${(prop.fullAddress ?? prop.id).slice(0, 42).padEnd(42)} total=${props.total_permit_count} elec=${props.electrical_permit_count ?? 0} roof=${props.roofing_permit_count ?? 0} batt=${props.battery_permit_count ?? 0}`);
      }
      written++;
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
  console.log(`${APPLY ? "Written" : "Would write"}: ${written}`);
  console.log(`Skipped (no permits): ${skipped}`);
  if (APPLY) console.log(`Failed:               ${failed}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
