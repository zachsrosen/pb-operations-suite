/**
 * Update ticket 45171950925's content field to include Wade Markland's
 * phone + address (pulled from his HubSpot contact). The original ticket
 * was created before the find-by-name flow shipped, so the body was missing
 * those lines.
 *
 *   npx tsx scripts/update-wade-ticket-content.ts          # dry-run (prints proposed body)
 *   npx tsx scripts/update-wade-ticket-content.ts --apply
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env" });

const TICKET_ID = "45171950925";
const CONTACT_ID = "51107108473";
const HS = "https://api.hubapi.com";
const HS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN!;

async function hubspot<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${HS}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${HS_TOKEN}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot ${path} → ${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

async function main() {
  const apply = process.argv.includes("--apply");

  const ticket = await hubspot<{ properties: { subject: string; content: string } }>(
    `/crm/v3/objects/tickets/${TICKET_ID}?properties=subject,content`,
  );
  console.log(`Ticket ${TICKET_ID}: ${ticket.properties.subject}`);
  console.log("\n--- Current content ---");
  console.log(ticket.properties.content);

  const contact = await hubspot<{ properties: { phone?: string; address?: string } }>(
    `/crm/v3/objects/contacts/${CONTACT_ID}?properties=phone,address`,
  );
  console.log(`\nContact ${CONTACT_ID}: phone=${contact.properties.phone}  address=${contact.properties.address}`);

  // Insert a "Phone:" and "Address:" line right after the "Date: ..." line
  // (matches the order createServiceTicket builds bodies in). Skip if either
  // line already appears so this is idempotent.
  const existing = ticket.properties.content;
  const lines = existing.split("\n");
  const dateIdx = lines.findIndex((l) => l.startsWith("Date:"));
  const insertAt = dateIdx >= 0 ? dateIdx + 1 : lines.length;
  const additions: string[] = [];
  if (contact.properties.phone && !existing.includes(`Phone:`)) {
    additions.push(`Phone: ${contact.properties.phone}`);
  }
  if (contact.properties.address && !existing.includes(`Address:`)) {
    additions.push(`Address: ${contact.properties.address}`);
  }
  if (additions.length === 0) {
    console.log("\nNothing to add — Phone/Address already present.");
    return;
  }
  const next = [...lines.slice(0, insertAt), ...additions, ...lines.slice(insertAt)].join("\n");

  console.log("\n--- Proposed content ---");
  console.log(next);

  if (!apply) {
    console.log("\n(Re-run with --apply to update the ticket.)");
    return;
  }

  await hubspot(`/crm/v3/objects/tickets/${TICKET_ID}`, {
    method: "PATCH",
    body: JSON.stringify({ properties: { content: next } }),
  });
  console.log("\n✓ ticket content updated");
}
main().catch((e) => { console.error(e); process.exit(1); });
