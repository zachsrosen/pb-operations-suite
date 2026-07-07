/**
 * One-time: create the HubSpot deal properties that drive the
 * "Additional Visit" admin workflow.
 *
 *   create_additional_visit  — booleancheckbox; ticking it fires the workflow
 *   additional_visit_reason  — textarea; copied into the Zuper job description
 *
 * Idempotent: skips properties that already exist.
 *
 *     npx tsx scripts/_create-additional-visit-props.ts
 */
import "dotenv/config";

const TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const BASE = "https://api.hubapi.com/crm/v3/properties/deals";

async function exists(name: string): Promise<boolean> {
  const res = await fetch(`${BASE}/${name}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  return res.ok;
}

async function create(body: Record<string, unknown>): Promise<void> {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Create ${body.name} failed: ${res.status} ${await res.text()}`);
  }
  console.log(`Created deal property: ${body.name}`);
}

async function main() {
  if (!TOKEN) throw new Error("HUBSPOT_ACCESS_TOKEN not set");

  if (await exists("create_additional_visit")) {
    console.log("create_additional_visit already exists — skipping");
  } else {
    await create({
      name: "create_additional_visit",
      label: "Create Additional Visit Job",
      groupName: "dealinformation",
      type: "enumeration",
      fieldType: "booleancheckbox",
      options: [
        { label: "Yes", value: "true", displayOrder: 0 },
        { label: "No", value: "false", displayOrder: 1 },
      ],
      description:
        "Tick to auto-create an unscheduled Additional Visit job in Zuper (PB Ops admin workflow). Resets itself after the job is created.",
    });
  }

  if (await exists("additional_visit_reason")) {
    console.log("additional_visit_reason already exists — skipping");
  } else {
    await create({
      name: "additional_visit_reason",
      label: "Additional Visit Reason",
      groupName: "dealinformation",
      type: "string",
      fieldType: "textarea",
      description: "Why the additional visit is needed. Copied into the Zuper job description.",
    });
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
