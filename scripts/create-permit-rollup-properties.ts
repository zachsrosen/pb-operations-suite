// scripts/create-permit-rollup-properties.ts
//
// Creates the per-permit-type rollup fields (total + 5 per tag = 121) on the
// existing HubSpot Property object, in a "Permit History" group. Create-missing
// pattern (getAll -> skip existing -> create) so it's safe to re-run and skips the
// roofing/solar fields already created. Field defs come from shovels-permit-rollups.ts.
//
// Usage:
//   tsx scripts/create-permit-rollup-properties.ts          # dry-run
//   tsx scripts/create-permit-rollup-properties.ts --apply   # create missing fields
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { Client } from "@hubspot/api-client";
import { permitRollupFieldDefs } from "../src/lib/shovels-permit-rollups";

const APPLY = process.argv.includes("--apply");
const OBJECT_TYPE = process.env.HUBSPOT_PROPERTY_OBJECT_TYPE;
const GROUP = "permit_history";
const GROUP_LABEL = "Permit History";

async function main() {
  if (!OBJECT_TYPE) throw new Error("HUBSPOT_PROPERTY_OBJECT_TYPE is not set");
  const hubspot = new Client({ accessToken: process.env.HUBSPOT_ACCESS_TOKEN! });

  // Ensure the property group exists (idempotent).
  try {
    await hubspot.crm.properties.groupsApi.create(OBJECT_TYPE, { name: GROUP, label: GROUP_LABEL });
    console.log(`Created property group "${GROUP}"`);
  } catch {
    console.log(`Property group "${GROUP}" already exists (or reused)`);
  }

  const allProps = await hubspot.crm.properties.coreApi.getAll(OBJECT_TYPE);
  const existing = new Set(allProps.results.map((p) => p.name));
  const defs = permitRollupFieldDefs();
  console.log(`Rollup fields defined: ${defs.length}. Existing on object: ${existing.size}.`);
  console.log(APPLY ? ">>> APPLY mode\n" : ">>> DRY RUN (pass --apply)\n");

  let created = 0, skipped = 0, failed = 0;
  for (const field of defs) {
    if (existing.has(field.name)) {
      skipped++;
      continue;
    }
    if (!APPLY) {
      if (created < 10) console.log(`  WOULD CREATE: ${field.name}`);
      created++;
      continue;
    }
    try {
      await hubspot.crm.properties.coreApi.create(OBJECT_TYPE, {
        groupName: GROUP,
        name: field.name,
        label: field.label,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        type: field.type as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fieldType: field.fieldType as any,
      });
      created++;
      if (created % 20 === 0) console.log(`  ...created ${created}`);
    } catch (err) {
      const msg = (err as { body?: { message?: string }; message?: string })?.body?.message || (err as Error)?.message || String(err);
      console.log(`  ✗ FAILED ${field.name}: ${String(msg).slice(0, 160)}`);
      failed++;
    }
  }
  console.log(`\n=== SUMMARY === ${APPLY ? "created" : "would create"}: ${created}, skipped (exist): ${skipped}, failed: ${failed}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
