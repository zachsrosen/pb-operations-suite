/**
 * Set the structured address properties on ticket 45171950925 so the
 * Address card on the ticket record populates (Street/City/State/Zip).
 * Pulls values from Wade Markland's HubSpot contact.
 *
 *   npx tsx scripts/update-wade-ticket-address.ts          # dry-run
 *   npx tsx scripts/update-wade-ticket-address.ts --apply
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
  if (!res.ok) throw new Error(`HubSpot ${path} → ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const contact = await hubspot<{ properties: { address?: string; city?: string; state?: string; zip?: string } }>(
    `/crm/v3/objects/contacts/${CONTACT_ID}?properties=address,city,state,zip`,
  );
  const props: Record<string, string> = {};
  if (contact.properties.address) props.street_address = contact.properties.address;
  if (contact.properties.city) props.city = contact.properties.city;
  if (contact.properties.state) props.state = contact.properties.state;
  if (contact.properties.zip) props.zip_code = contact.properties.zip;

  console.log(`\nWill set on ticket ${TICKET_ID}:`);
  for (const [k, v] of Object.entries(props)) console.log(`  ${k.padEnd(15)} = ${v}`);

  if (!apply) {
    console.log("\n(Re-run with --apply to update.)");
    return;
  }

  await hubspot(`/crm/v3/objects/tickets/${TICKET_ID}`, {
    method: "PATCH",
    body: JSON.stringify({ properties: props }),
  });
  console.log("\n✓ ticket address fields updated");
}
main().catch((e) => { console.error(e); process.exit(1); });
