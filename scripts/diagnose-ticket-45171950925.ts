/**
 * Diagnose if name-based fallback search would have found Wade Markland's
 * existing HubSpot contact when the call log was missing a phone.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env" });
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const TICKET_ID = "45171950925";
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

type ContactSearch = {
  total: number;
  results: { id: string; properties: { firstname?: string; lastname?: string; phone?: string; email?: string } }[];
};

async function searchContacts(filters: { propertyName: string; operator: string; value: string }[]): Promise<ContactSearch> {
  return hubspot<ContactSearch>("/crm/v3/objects/contacts/search", {
    method: "POST",
    body: JSON.stringify({
      filterGroups: [{ filters }],
      properties: ["firstname", "lastname", "phone", "email"],
      limit: 10,
    }),
  });
}

async function main() {
  const log = await prisma.onCallCallLog.findFirst({
    where: { hubspotTicketId: TICKET_ID },
  });
  if (!log) return;
  console.log(`\nCall log customerName: "${log.customerName}"`);

  const parts = log.customerName.trim().split(/\s+/);
  const firstname = parts[0] ?? "";
  const lastname = parts.slice(1).join(" ");
  console.log(`  firstname="${firstname}"  lastname="${lastname}"`);

  // 1) Exact firstname + exact lastname (case-insensitive — HubSpot search is by default).
  const both = await searchContacts([
    { propertyName: "firstname", operator: "EQ", value: firstname },
    { propertyName: "lastname", operator: "EQ", value: lastname },
  ]);
  console.log(`\n[A] EQ firstname="${firstname}" + EQ lastname="${lastname}"`);
  console.log(`    total=${both.total}`);
  for (const c of both.results) {
    console.log(`    - id=${c.id}  ${c.properties.firstname} ${c.properties.lastname}  phone=${c.properties.phone}  email=${c.properties.email}`);
  }

  // 2) Lastname-only (in case the firstname is a nickname / abbreviation).
  if (lastname) {
    const lastOnly = await searchContacts([
      { propertyName: "lastname", operator: "EQ", value: lastname },
    ]);
    console.log(`\n[B] EQ lastname="${lastname}" only`);
    console.log(`    total=${lastOnly.total}`);
    for (const c of lastOnly.results) {
      console.log(`    - id=${c.id}  ${c.properties.firstname} ${c.properties.lastname}  phone=${c.properties.phone}  email=${c.properties.email}`);
    }
  }

  // 3) Conclusion: would A have associated correctly?
  console.log(`\n=== Conclusion ===`);
  if (both.total === 1) {
    console.log(`  ✓ Approach A would have found EXACTLY ONE match (id=${both.results[0].id}). Auto-associate.`);
  } else if (both.total === 0) {
    console.log(`  ✗ Approach A would have found ZERO matches. Would still create a new contact.`);
  } else {
    console.log(`  ⚠ Approach A would have found ${both.total} matches. Would skip auto-association (ambiguous).`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
