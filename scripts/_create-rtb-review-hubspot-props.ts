/**
 * One-time idempotent setup: create the RTB PM-Review properties on HubSpot deals.
 *
 * Dry-run:  tsx scripts/_create-rtb-review-hubspot-props.ts
 * Apply:    tsx scripts/_create-rtb-review-hubspot-props.ts --apply
 *
 * Creates (all on the `deals` object, in an "RTB Review" group):
 *   - bool     pm_rtb_approved        (the single PM release control)
 *   - datetime pm_rtb_approved_date   (stamped when pm_rtb_approved flips true)
 *
 * Safe to re-run; skips anything that already exists. Safe to delete after use.
 */
import "dotenv/config";
import { hubspotClient } from "../src/lib/hubspot";

const OBJECT_TYPE = "deals";
const GROUP_NAME = "rtb_review";
const GROUP_LABEL = "RTB Review";
const APPLY = process.argv.includes("--apply");

interface PropDef {
  name: string;
  label: string;
  type: "bool" | "datetime";
  fieldType: "booleancheckbox" | "date";
  description: string;
  options?: { label: string; value: string; displayOrder: number }[];
}

const PROPS: PropDef[] = [
  {
    name: "pm_rtb_approved",
    label: "PM Approved — Release to Build",
    type: "bool",
    fieldType: "booleancheckbox",
    description:
      "When true, a HubSpot workflow advances the deal from RTB - Blocked to Ready to Build. Reset to false on entry to RTB - Blocked.",
    options: [
      { label: "Yes", value: "true", displayOrder: 0 },
      { label: "No", value: "false", displayOrder: 1 },
    ],
  },
  {
    name: "pm_rtb_approved_date",
    label: "PM RTB Approved Date",
    type: "datetime",
    fieldType: "date",
    description: "Timestamp when PM Approved — Release to Build was set true.",
  },
];

async function ensureGroup() {
  try {
    await hubspotClient.crm.properties.groupsApi.getByName(OBJECT_TYPE, GROUP_NAME);
    console.log(`group "${GROUP_NAME}" exists`);
  } catch {
    if (!APPLY) {
      console.log(`[dry-run] would create group "${GROUP_NAME}"`);
      return;
    }
    await hubspotClient.crm.properties.groupsApi.create(OBJECT_TYPE, {
      name: GROUP_NAME,
      label: GROUP_LABEL,
      displayOrder: -1,
    });
    console.log(`created group "${GROUP_NAME}"`);
  }
}

async function ensureProp(p: PropDef) {
  try {
    await hubspotClient.crm.properties.coreApi.getByName(OBJECT_TYPE, p.name);
    console.log(`  prop ${p.name} exists — skip`);
    return;
  } catch {
    /* not found — create below */
  }
  if (!APPLY) {
    console.log(`  [dry-run] would create prop ${p.name} (${p.type}/${p.fieldType})`);
    return;
  }
  await hubspotClient.crm.properties.coreApi.create(OBJECT_TYPE, {
    name: p.name,
    label: p.label,
    type: p.type,
    fieldType: p.fieldType,
    groupName: GROUP_NAME,
    description: p.description,
    ...(p.options ? { options: p.options } : {}),
  } as Parameters<typeof hubspotClient.crm.properties.coreApi.create>[1]);
  console.log(`  created prop ${p.name}`);
}

async function main() {
  console.log(APPLY ? "APPLY mode" : "DRY-RUN (pass --apply to write)");
  await ensureGroup();
  for (const p of PROPS) await ensureProp(p);
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
