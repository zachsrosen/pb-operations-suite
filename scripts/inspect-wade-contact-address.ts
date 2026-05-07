import dotenv from "dotenv";
dotenv.config({ path: ".env" });

const HS = "https://api.hubapi.com";
const HS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN!;
const CONTACT_ID = "51107108473";

async function hubspot<T>(path: string): Promise<T> {
  const res = await fetch(`${HS}${path}`, {
    headers: { Authorization: `Bearer ${HS_TOKEN}` },
  });
  if (!res.ok) throw new Error(`HubSpot ${path} → ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function main() {
  // Pull all address-relevant contact fields.
  const props = ["address", "city", "state", "zip", "country", "latitude", "longitude", "pb_location"];
  const r = await hubspot<{ properties: Record<string, string | null> }>(
    `/crm/v3/objects/contacts/${CONTACT_ID}?properties=${props.join(",")}`,
  );
  console.log(`Contact ${CONTACT_ID} address fields:`);
  for (const p of props) console.log(`  ${p.padEnd(15)} = ${r.properties[p]}`);

  // Also enumerate all contact properties matching address/city/etc to see if pb has custom fields.
  const all = await hubspot<{
    results: { name: string; label: string }[];
  }>(`/crm/v3/properties/contacts`);
  const candidates = all.results.filter((p) =>
    /address|city|state|zip|postal|street|latitude|longitude/i.test(p.name + " " + p.label),
  );
  console.log(`\nAll contact properties touching address:`);
  for (const c of candidates) console.log(`  ${c.name.padEnd(40)} | ${c.label}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
