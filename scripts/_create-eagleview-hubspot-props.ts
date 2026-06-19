/**
 * One-time idempotent setup: create EagleView properties on HubSpot deals + tickets.
 *
 * Dry-run:  tsx scripts/_create-eagleview-hubspot-props.ts
 * Apply:    tsx scripts/_create-eagleview-hubspot-props.ts --apply
 *
 * Safe to re-run; skips properties/group that already exist. Safe to delete after use.
 */
import "dotenv/config";
import { hubspotClient } from "../src/lib/hubspot";

const GROUP_NAME = "eagleview";
const GROUP_LABEL = "EagleView";

const PROPS = [
  {
    name: "eagleview_status",
    label: "EagleView Status",
    type: "enumeration",
    fieldType: "select",
    options: ["Ordered", "Delivered", "Failed", "Cancelled"].map((v) => ({
      label: v,
      value: v,
    })),
  },
  { name: "eagleview_report_id", label: "EagleView Report ID", type: "string", fieldType: "text" },
  { name: "eagleview_drive_folder_url", label: "EagleView Drive Folder URL", type: "string", fieldType: "text" },
  { name: "eagleview_ordered_date", label: "EagleView Ordered Date", type: "date", fieldType: "date" },
  { name: "eagleview_delivered_date", label: "EagleView Delivered Date", type: "date", fieldType: "date" },
] as const;

const OBJECT_TYPES = ["deals", "tickets"] as const;

async function ensureGroup(objectType: string, apply: boolean) {
  try {
    await hubspotClient.crm.properties.groupsApi.getByName(objectType, GROUP_NAME);
    console.log(`  group ${GROUP_NAME} exists on ${objectType}`);
  } catch {
    console.log(`  ${apply ? "CREATE" : "WOULD CREATE"} group ${GROUP_NAME} on ${objectType}`);
    if (apply) {
      await hubspotClient.crm.properties.groupsApi.create(objectType, {
        name: GROUP_NAME,
        label: GROUP_LABEL,
      });
    }
  }
}

async function ensureProp(objectType: string, prop: (typeof PROPS)[number], apply: boolean) {
  try {
    await hubspotClient.crm.properties.coreApi.getByName(objectType, prop.name);
    console.log(`  prop ${prop.name} exists on ${objectType}`);
    return;
  } catch {
    /* not found — create */
  }
  console.log(`  ${apply ? "CREATE" : "WOULD CREATE"} prop ${prop.name} on ${objectType}`);
  if (apply) {
    await hubspotClient.crm.properties.coreApi.create(objectType, {
      name: prop.name,
      label: prop.label,
      type: prop.type,
      fieldType: prop.fieldType,
      groupName: GROUP_NAME,
      ...(("options" in prop) ? { options: prop.options } : {}),
    } as Parameters<typeof hubspotClient.crm.properties.coreApi.create>[1]);
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(apply ? "APPLY mode\n" : "DRY-RUN (pass --apply)\n");
  for (const objectType of OBJECT_TYPES) {
    console.log(`== ${objectType} ==`);
    await ensureGroup(objectType, apply);
    for (const prop of PROPS) await ensureProp(objectType, prop, apply);
  }
  console.log("\nDone.");
}

main().catch((e) => { console.error(e); process.exit(1); });
