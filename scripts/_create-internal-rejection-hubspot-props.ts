/**
 * One-time idempotent setup: create the Internal Rejection properties on HubSpot deals.
 *
 * Dry-run:  tsx scripts/_create-internal-rejection-hubspot-props.ts
 * Apply:    tsx scripts/_create-internal-rejection-hubspot-props.ts --apply
 *
 * Creates (all on the `deals` object, in an "Internal Rejection" group):
 *   - 2 checkbox  `internal_m1_documents` / `internal_m2_documents` (mirror pe_m{1,2}_documents)
 *   - 16 textarea `internal_reason_*` reviewer inputs (one per rejectable doc)
 *   - 7 textarea  `internal_rejection_notes_for_*` per-team outputs
 *   - 1 textarea  `internal_rejection_comments` combined output
 *
 * Names are derived from the webhook's registry (src/lib/internal-rejection-notes.ts)
 * so the properties and the code can't drift. Safe to re-run; skips anything that
 * already exists. Safe to delete after use.
 */
import "dotenv/config";
import { hubspotClient } from "../src/lib/hubspot";
import {
  INTERNAL_REJECTION_DOCS,
  INTERNAL_REJECTION_TEAM_FIELDS,
  INTERNAL_REJECTION_COMMENTS_FIELD,
  INTERNAL_M1_DOCUMENTS_FIELD,
  INTERNAL_M2_DOCUMENTS_FIELD,
} from "../src/lib/internal-rejection-notes";

const OBJECT_TYPE = "deals";
const GROUP_NAME = "internal_rejection";
const GROUP_LABEL = "Internal Rejection";

/** Checkbox option labels that differ from the value (mirror the live pe_m2_documents labels). */
const DOC_LABEL_OVERRIDES: Record<string, string> = {
  "Conditional Waiver and Release": "Conditional Waiver & Release (Final Payment)",
};

/** Human label for each team-field suffix. */
const TEAM_LABEL: Record<string, string> = {
  design: "Design",
  sales: "Sales",
  ops: "Ops",
  permitting: "Permitting",
  compliance: "Compliance",
  accounting: "Accounting",
  interconnection: "Interconnection",
};

interface PropDef {
  name: string;
  label: string;
  type: "string" | "enumeration";
  fieldType: "textarea" | "checkbox";
  options?: { label: string; value: string; displayOrder: number }[];
}

function milestoneOptions(milestone: "m1" | "m2") {
  return INTERNAL_REJECTION_DOCS.filter((d) => d.milestone === milestone).map((d, i) => ({
    label: DOC_LABEL_OVERRIDES[d.checkbox] ?? d.checkbox,
    value: d.checkbox,
    displayOrder: i,
  }));
}

function buildProps(): PropDef[] {
  const props: PropDef[] = [];

  // 1) The two milestone selector checkboxes — options mirror pe_m{1,2}_documents.
  props.push({
    name: INTERNAL_M1_DOCUMENTS_FIELD,
    label: "Internal M1 Documents",
    type: "enumeration",
    fieldType: "checkbox",
    options: milestoneOptions("m1"),
  });
  props.push({
    name: INTERNAL_M2_DOCUMENTS_FIELD,
    label: "Internal M2 Documents",
    type: "enumeration",
    fieldType: "checkbox",
    options: milestoneOptions("m2"),
  });

  // 2) 16 per-doc reason inputs (textarea).
  for (const d of INTERNAL_REJECTION_DOCS) {
    props.push({
      name: d.reasonField,
      label: `Internal Reason: ${DOC_LABEL_OVERRIDES[d.checkbox] ?? d.checkbox}`,
      type: "string",
      fieldType: "textarea",
    });
  }

  // 3) 7 per-team outputs (textarea).
  for (const field of INTERNAL_REJECTION_TEAM_FIELDS) {
    const team = field.replace("internal_rejection_notes_for_", "");
    props.push({
      name: field,
      label: `Internal Rejection Notes: ${TEAM_LABEL[team] ?? team}`,
      type: "string",
      fieldType: "textarea",
    });
  }

  // 4) Combined output (textarea).
  props.push({
    name: INTERNAL_REJECTION_COMMENTS_FIELD,
    label: "Internal Rejection Comments",
    type: "string",
    fieldType: "textarea",
  });

  return props;
}

async function ensureGroup(apply: boolean) {
  try {
    await hubspotClient.crm.properties.groupsApi.getByName(OBJECT_TYPE, GROUP_NAME);
    console.log(`  group ${GROUP_NAME} exists`);
  } catch {
    console.log(`  ${apply ? "CREATE" : "WOULD CREATE"} group ${GROUP_NAME}`);
    if (apply) {
      await hubspotClient.crm.properties.groupsApi.create(OBJECT_TYPE, {
        name: GROUP_NAME,
        label: GROUP_LABEL,
      });
    }
  }
}

async function ensureProp(prop: PropDef, apply: boolean) {
  try {
    await hubspotClient.crm.properties.coreApi.getByName(OBJECT_TYPE, prop.name);
    console.log(`  prop ${prop.name} exists`);
    return;
  } catch {
    /* not found — create */
  }
  console.log(`  ${apply ? "CREATE" : "WOULD CREATE"} prop ${prop.name} (${prop.fieldType})`);
  if (apply) {
    await hubspotClient.crm.properties.coreApi.create(OBJECT_TYPE, {
      name: prop.name,
      label: prop.label,
      type: prop.type,
      fieldType: prop.fieldType,
      groupName: GROUP_NAME,
      ...(prop.options ? { options: prop.options } : {}),
    } as Parameters<typeof hubspotClient.crm.properties.coreApi.create>[1]);
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const props = buildProps();
  console.log(apply ? "APPLY mode\n" : "DRY-RUN (pass --apply)\n");
  console.log(`== ${OBJECT_TYPE} — ${props.length} properties + 1 group ==`);
  await ensureGroup(apply);
  for (const prop of props) await ensureProp(prop, apply);
  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
