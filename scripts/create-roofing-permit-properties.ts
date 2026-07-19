// scripts/create-roofing-permit-properties.ts
//
// (1) DIAGNOSES whether the existing Shovels-pushed property-object fields
//     actually exist on the HubSpot Property object (solar_permit_count, etc.),
//     answering "have the existing shovels pushes been landing?".
// (2) CREATES the four roofing-permit rollup properties if missing.
//
// create-hubspot-property-object.ts only sends its field list when the object is
// FIRST created, so it can't add fields to the already-existing production object.
// This mirrors the create-missing pattern in create-property-extended-fields.ts.
//
// Usage:
//   tsx scripts/create-roofing-permit-properties.ts          # diagnose + dry-run
//   tsx scripts/create-roofing-permit-properties.ts --apply   # create missing props
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { Client } from "@hubspot/api-client";

const APPLY = process.argv.includes("--apply");
const OBJECT_TYPE = process.env.HUBSPOT_PROPERTY_OBJECT_TYPE;
const GROUP_ROOF = "property_roof";

// Fields the Shovels enrichment already pushes — checked to confirm they exist.
const EXISTING_SHOVELS_FIELDS = [
  "solar_permit_count",
  "year_built",
  "square_footage",
  "lot_size_sqft",
  "stories",
  "property_type",
  "assessed_value",
  "public_record_owner_name",
];

const ROOFING_FIELDS = [
  // solar_permit_count is pushed by the live enrichment but was never created —
  // its absence 400s the ENTIRE property push (see diagnostic above). Create it
  // to unbreak all Shovels property writes, not just roofing.
  { name: "solar_permit_count", label: "Solar Permit Count", type: "number", fieldType: "number", description: "Count of solar permits on record from Shovels" },
  { name: "roofing_permit_count", label: "Roofing Permit Count", type: "number", fieldType: "number", description: "Count of roofing permits on record from Shovels" },
  { name: "latest_roofing_permit_date", label: "Latest Roofing Permit Date", type: "date", fieldType: "date", description: "Issue date (fallback file date) of the most recent roofing permit" },
  { name: "latest_roofing_permit_number", label: "Latest Roofing Permit #", type: "string", fieldType: "text", description: "" },
  { name: "latest_roofing_permit_jurisdiction", label: "Latest Roofing Permit Jurisdiction", type: "string", fieldType: "text", description: "" },
];

async function main() {
  if (!OBJECT_TYPE) throw new Error("HUBSPOT_PROPERTY_OBJECT_TYPE is not set");
  const hubspot = new Client({ accessToken: process.env.HUBSPOT_ACCESS_TOKEN! });

  const allProps = await hubspot.crm.properties.coreApi.getAll(OBJECT_TYPE);
  const existing = new Set(allProps.results.map((p) => p.name));
  console.log(`Property object ${OBJECT_TYPE} has ${existing.size} properties.\n`);

  console.log("========== DIAGNOSTIC: existing Shovels push fields ==========");
  for (const f of EXISTING_SHOVELS_FIELDS) {
    console.log(`  ${existing.has(f) ? "✓ EXISTS " : "✗ MISSING"}  ${f}`);
  }
  const anyMissing = EXISTING_SHOVELS_FIELDS.some((f) => !existing.has(f));
  console.log(
    anyMissing
      ? "\n  ⚠️  At least one existing push field is MISSING — those updateProperty calls have been\n      silently failing in the try/catch. Create the missing field(s) to fix.\n"
      : "\n  All existing push fields exist — the current Shovels pushes are landing.\n",
  );

  console.log("========== CREATE: roofing rollup fields ==========");
  console.log(APPLY ? ">>> APPLY mode\n" : ">>> DRY RUN (pass --apply to create)\n");
  let created = 0, skipped = 0, failed = 0;
  for (const field of ROOFING_FIELDS) {
    if (existing.has(field.name)) {
      console.log(`  SKIP (exists): ${field.name}`);
      skipped++;
      continue;
    }
    if (!APPLY) {
      console.log(`  WOULD CREATE: ${field.name} (${field.label})`);
      created++;
      continue;
    }
    try {
      await hubspot.crm.properties.coreApi.create(OBJECT_TYPE, {
        groupName: GROUP_ROOF,
        name: field.name,
        label: field.label,
        description: field.description,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        type: field.type as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fieldType: field.fieldType as any,
      });
      console.log(`  ✓ Created: ${field.name}`);
      created++;
    } catch (err) {
      const msg = (err as { body?: { message?: string }; message?: string })?.body?.message || (err as Error)?.message || String(err);
      console.log(`  ✗ FAILED ${field.name}: ${String(msg).slice(0, 200)}`);
      failed++;
    }
  }
  console.log(`\n=== SUMMARY === created/would-create: ${created}, skipped: ${skipped}, failed: ${failed}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
