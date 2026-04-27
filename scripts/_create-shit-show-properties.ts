#!/usr/bin/env tsx
/**
 * One-shot: create the 3 HubSpot Deal custom properties for the Shit Show
 * Meeting hub. Idempotent — re-running on already-created properties yields
 * 409 / "already exists" which we treat as success.
 *
 * Usage: HUBSPOT_ACCESS_TOKEN=... npx tsx scripts/_create-shit-show-properties.ts
 *   (or, with the project's loaded env: npx tsx -r dotenv/config scripts/_create-shit-show-properties.ts)
 */

const token = process.env.HUBSPOT_ACCESS_TOKEN;
if (!token) {
  console.error("HUBSPOT_ACCESS_TOKEN missing");
  process.exit(1);
}

type PropertyDef = {
  name: string;
  label: string;
  type: "bool" | "string" | "date" | "datetime";
  fieldType: "booleancheckbox" | "textarea" | "date";
  description: string;
  groupName?: string;
  options?: Array<{ label: string; value: string; displayOrder: number; hidden: boolean }>;
};

const PROPS: PropertyDef[] = [
  {
    name: "pb_shit_show_flagged",
    label: "Shit Show Flagged",
    type: "bool",
    fieldType: "booleancheckbox",
    description: "Flagged for discussion in the Shit Show meeting. Set/cleared by IDR + Shit Show meeting hubs.",
    options: [
      { label: "Yes", value: "true", displayOrder: 0, hidden: false },
      { label: "No", value: "false", displayOrder: 1, hidden: false },
    ],
  },
  {
    name: "pb_shit_show_reason",
    label: "Shit Show Reason",
    type: "string",
    fieldType: "textarea",
    description: "Free-text rationale for why this deal is currently a shit show.",
  },
  {
    name: "pb_shit_show_flagged_since",
    label: "Shit Show Flagged Since",
    type: "date",
    fieldType: "date",
    description: "Date the deal was first flagged as a shit show. Drives the Shit Show queue's oldest-first sort.",
  },
];

async function createProperty(prop: PropertyDef): Promise<void> {
  const body: Record<string, unknown> = {
    name: prop.name,
    label: prop.label,
    type: prop.type,
    fieldType: prop.fieldType,
    description: prop.description,
    groupName: prop.groupName ?? "dealinformation",
    formField: false,
  };
  if (prop.options) body.options = prop.options;

  const res = await fetch("https://api.hubapi.com/crm/v3/properties/deals", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (res.ok) {
    console.log(`✓ Created ${prop.name}`);
    return;
  }

  const errText = await res.text();
  // 409 conflict = property exists already → idempotent success
  if (res.status === 409 || /already.*exists|PROPERTY_DOESNT_EXIST.*PROPERTY_ALREADY_EXISTS|conflict/i.test(errText)) {
    console.log(`= ${prop.name} already exists (skipped)`);
    return;
  }
  throw new Error(`Failed to create ${prop.name}: ${res.status} ${errText.slice(0, 300)}`);
}

async function main() {
  for (const prop of PROPS) {
    await createProperty(prop);
  }
  console.log("\nAll 3 properties present. Run the backfill next:");
  console.log("  npx tsx scripts/backfill-shit-show-flags.ts");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
