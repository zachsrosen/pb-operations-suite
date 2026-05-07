/**
 * One-off: associate ticket 45171950925 (Wade Markland follow-up) to its
 * existing HubSpot contact, and backfill the call-log row with the contact's
 * phone + address so future views show them.
 *
 *   npx tsx scripts/backfill-wade-markland-ticket.ts          # dry-run
 *   npx tsx scripts/backfill-wade-markland-ticket.ts --apply
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env" });
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

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

  // 1) Pull the contact's current phone + address.
  const contact = await hubspot<{ id: string; properties: { phone?: string; address?: string; firstname?: string; lastname?: string } }>(
    `/crm/v3/objects/contacts/${CONTACT_ID}?properties=phone,address,firstname,lastname`,
  );
  console.log(`Contact ${CONTACT_ID}: ${contact.properties.firstname} ${contact.properties.lastname}`);
  console.log(`  phone   = ${contact.properties.phone}`);
  console.log(`  address = ${contact.properties.address}`);

  // 2) Find the call log row that owns this ticket.
  const log = await prisma.onCallCallLog.findFirst({ where: { hubspotTicketId: TICKET_ID } });
  if (!log) {
    console.error(`No call log row references ticket ${TICKET_ID}`);
    process.exit(1);
  }
  console.log(`\nCall log ${log.id}: ${log.customerName}`);
  console.log(`  customerPhone   = ${log.customerPhone}`);
  console.log(`  customerAddress = ${log.customerAddress}`);
  console.log(`  hubspotContactId = ${log.hubspotContactId}`);

  if (!apply) {
    console.log("\n=== Plan (dry-run) ===");
    console.log(`  - Associate ticket ${TICKET_ID} → contact ${CONTACT_ID}`);
    console.log(`  - Update call log ${log.id}:`);
    console.log(`      hubspotContactId = ${CONTACT_ID}`);
    if (!log.customerPhone && contact.properties.phone) {
      console.log(`      customerPhone    = "${contact.properties.phone}" (from contact)`);
    }
    if (!log.customerAddress && contact.properties.address) {
      console.log(`      customerAddress  = "${contact.properties.address}" (from contact)`);
    }
    console.log("\n(Re-run with --apply to execute.)");
    return;
  }

  // 3) Apply: PUT the association on the ticket, then UPDATE the call log row.
  console.log(`\nAssociating ticket ${TICKET_ID} → contact ${CONTACT_ID}…`);
  await hubspot(
    `/crm/v4/objects/tickets/${TICKET_ID}/associations/default/contacts/${CONTACT_ID}`,
    { method: "PUT" },
  );
  console.log("  ✓ association created");

  const updated = await prisma.onCallCallLog.update({
    where: { id: log.id },
    data: {
      hubspotContactId: CONTACT_ID,
      ...(log.customerPhone || !contact.properties.phone ? {} : { customerPhone: contact.properties.phone }),
      ...(log.customerAddress || !contact.properties.address ? {} : { customerAddress: contact.properties.address }),
    },
  });
  console.log(`  ✓ call log updated`);
  console.log(`    customerPhone   = ${updated.customerPhone}`);
  console.log(`    customerAddress = ${updated.customerAddress}`);
  console.log(`    hubspotContactId = ${updated.hubspotContactId}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
