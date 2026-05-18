#!/usr/bin/env tsx
/**
 * One-shot: create 30 HubSpot Deal properties for PE document tracking.
 * Creates a "Participate Energy Documents" property group, then 15 enum
 * status properties and 15 textarea notes properties. Idempotent — 409
 * (already exists) is treated as success.
 *
 * Usage:
 *   npx tsx scripts/create-pe-doc-properties.ts
 *   (requires HUBSPOT_ACCESS_TOKEN in env or .env.local)
 */

// Note: tsx resolves @/ aliases from tsconfig.json
import { PE_DOC_HUBSPOT_MAP } from "../src/lib/pe-hubspot-sync";

const token = process.env.HUBSPOT_ACCESS_TOKEN;
if (!token) {
  console.error("HUBSPOT_ACCESS_TOKEN missing");
  process.exit(1);
}

const API_BASE = "https://api.hubapi.com/crm/v3/properties/deals";

const STATUS_OPTIONS = [
  { label: "Not Uploaded", value: "not_uploaded", displayOrder: 0, hidden: false },
  { label: "Uploaded", value: "uploaded", displayOrder: 1, hidden: false },
  { label: "Under Review", value: "under_review", displayOrder: 2, hidden: false },
  { label: "Action Required", value: "action_required", displayOrder: 3, hidden: false },
  { label: "Rejected", value: "rejected", displayOrder: 4, hidden: false },
  { label: "Approved", value: "approved", displayOrder: 5, hidden: false },
];

async function ensurePropertyGroup(): Promise<void> {
  const res = await fetch("https://api.hubapi.com/crm/v3/properties/deals/groups", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "pe_documents",
      label: "Participate Energy Documents",
      displayOrder: -1,
    }),
  });

  if (res.ok) {
    console.log("✓ Created property group 'pe_documents'");
    return;
  }

  const errText = await res.text();
  if (res.status === 409 || /already.*exists/i.test(errText)) {
    console.log("= Property group 'pe_documents' already exists (skipped)");
    return;
  }
  throw new Error(`Failed to create property group: ${res.status} ${errText.slice(0, 300)}`);
}

async function createProperty(
  name: string,
  label: string,
  type: "enumeration" | "string",
  fieldType: "select" | "textarea",
  description: string,
  options?: typeof STATUS_OPTIONS,
): Promise<void> {
  const body: Record<string, unknown> = {
    name,
    label,
    type,
    fieldType,
    description,
    groupName: "pe_documents",
    formField: false,
  };
  if (options) body.options = options;

  const res = await fetch(API_BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (res.ok) {
    console.log(`  ✓ Created ${name}`);
    return;
  }

  const errText = await res.text();
  if (res.status === 409 || /already.*exists|conflict/i.test(errText)) {
    console.log(`  = ${name} already exists (skipped)`);
    return;
  }
  throw new Error(`Failed to create ${name}: ${res.status} ${errText.slice(0, 300)}`);
}

async function main() {
  console.log("Creating PE document property group...\n");
  await ensurePropertyGroup();

  console.log("\nCreating 15 status properties...");
  for (const entry of PE_DOC_HUBSPOT_MAP) {
    await createProperty(
      entry.statusProp,
      entry.label,
      "enumeration",
      "select",
      `PE document status for ${entry.docName}`,
      STATUS_OPTIONS,
    );
  }

  console.log("\nCreating 15 notes properties...");
  for (const entry of PE_DOC_HUBSPOT_MAP) {
    const notesLabel = entry.label + " Notes";
    await createProperty(
      entry.notesProp,
      notesLabel,
      "string",
      "textarea",
      `PE reviewer/partner notes for ${entry.docName}`,
    );
  }

  console.log(`\nDone — 30 properties ensured in 'pe_documents' group.`);
  console.log("Next: deploy code changes, then trigger a PE scraper sync to backfill.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
