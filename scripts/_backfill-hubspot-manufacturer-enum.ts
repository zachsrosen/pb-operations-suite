/**
 * Backfill HubSpot Products `manufacturer` enum with the 31 missing brands
 * present in our InternalProduct catalog.
 *
 * Skips:
 *   - "Generic" (decided to be per-row re-brand instead)
 *   - "UNIRAC" duplicate of "Unirac" (canonical)
 *   - "MULTIPLE" duplicate of "Multiple" (canonical)
 *   - 3 test brands (TestBrand_*, UIBrand_*, UIBrand2_*)
 *
 * Adds canonical-cased forms via PATCH /crm/v3/properties/products/manufacturer.
 * Idempotent — checks current enum values first and only adds missing ones.
 *
 * Run: node --env-file=.env.local --import tsx scripts/_backfill-hubspot-manufacturer-enum.ts [--dry-run]
 */
const TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
if (!TOKEN) {
  console.error("HUBSPOT_ACCESS_TOKEN missing");
  process.exit(1);
}

const DRY_RUN = process.argv.includes("--dry-run");

// Final list per Zach's decisions 2026-04-24
// "Generic" added 2026-04-25 after Phase B audit found 86 of 106 Generic-brand
// rows are genuinely commodity hardware with no actual manufacturer.
const BRANDS_TO_ADD = [
  "Generic",
  "IronRidge",
  "Square D",
  "Siemens",
  "Pegasus",
  "GE",
  "Eaton",
  "Alpine",
  "SVC",
  "SEG Solar",
  "Unirac",
  "EZ Solar",
  "ABB",
  "Ecolibrium Solar",
  "IMO",
  "S-5!",
  "Heyco",
  "Multiple",
  "Arlington",
  "Polaris",
  "bussman",
  "QuickBolt",
  "Solis",
  "Cutler-Hammer",
  "Rooftech",
  "System Sensor",
  "Midwest",
  "Cutler Hammer - Eaton",
  "Buchanan",
  "Xcel Energy",
  "QCell",
  "AP Smart",
];

interface PropertyOption {
  label: string;
  value: string;
  displayOrder?: number;
  hidden?: boolean;
  description?: string;
}

interface PropertyDef {
  name: string;
  label: string;
  type: string;
  fieldType: string;
  options: PropertyOption[];
  formField?: boolean;
  groupName?: string;
  description?: string;
}

async function getProperty(): Promise<PropertyDef> {
  const res = await fetch(
    `https://api.hubapi.com/crm/v3/properties/products/manufacturer`,
    { headers: { Authorization: `Bearer ${TOKEN}` } }
  );
  if (!res.ok) throw new Error(`GET failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function patchProperty(options: PropertyOption[]): Promise<void> {
  const res = await fetch(
    `https://api.hubapi.com/crm/v3/properties/products/manufacturer`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ options }),
    }
  );
  if (!res.ok) throw new Error(`PATCH failed: ${res.status} ${await res.text()}`);
}

async function main() {
  console.log(`${DRY_RUN ? "DRY RUN — " : ""}Fetching current HubSpot manufacturer enum...`);
  const prop = await getProperty();
  console.log(`Current: ${prop.options.length} options.`);

  const existingLower = new Set(prop.options.map((o) => (o.value || "").toLowerCase()));
  const toAdd: PropertyOption[] = BRANDS_TO_ADD
    .filter((b) => !existingLower.has(b.toLowerCase()))
    .map((b, i) => ({
      label: b,
      value: b,
      displayOrder: prop.options.length + i,
      hidden: false,
    }));

  if (toAdd.length === 0) {
    console.log("All brands already present. Nothing to do.");
    return;
  }

  console.log(`\nWill ADD ${toAdd.length} options:`);
  for (const o of toAdd) console.log(`  + ${o.value}`);

  if (DRY_RUN) {
    console.log("\nDRY RUN — no PATCH sent. Re-run without --dry-run to apply.");
    return;
  }

  // PATCH expects the FULL options list (existing + new)
  const fullOptions = [...prop.options, ...toAdd].map((o, i) => ({
    label: o.label,
    value: o.value,
    displayOrder: i,
    hidden: o.hidden ?? false,
  }));

  console.log(`\nSending PATCH with ${fullOptions.length} total options...`);
  await patchProperty(fullOptions);
  console.log("✓ HubSpot manufacturer enum updated.");

  // Verify
  const after = await getProperty();
  const addedOk = toAdd.filter((a) => after.options.some((o) => o.value === a.value));
  console.log(`\nVerified: ${addedOk.length}/${toAdd.length} new options present in enum.`);
  if (addedOk.length < toAdd.length) {
    console.warn("Some options did not land:");
    for (const a of toAdd) {
      if (!after.options.some((o) => o.value === a.value)) console.warn(`  ✗ ${a.value}`);
    }
  }
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
