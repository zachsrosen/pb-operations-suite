/**
 * Discover which HubSpot ticket properties drive the "Address" card on the
 * ticket record view (Street Address, City, State, Postal Code, Lat, Lng).
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env" });

const HS = "https://api.hubapi.com";
const HS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN!;

async function hubspot<T>(path: string): Promise<T> {
  const res = await fetch(`${HS}${path}`, {
    headers: { Authorization: `Bearer ${HS_TOKEN}` },
  });
  if (!res.ok) throw new Error(`HubSpot ${path} → ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function main() {
  const r = await hubspot<{
    results: { name: string; label: string; type: string; groupName: string }[];
  }>(`/crm/v3/properties/tickets`);

  const candidates = r.results.filter((p) =>
    /address|city|state|zip|postal|location|street|latitude|longitude/i.test(p.name + " " + p.label),
  );
  console.log(`\nProperties matching address/city/state/zip on tickets:\n`);
  for (const p of candidates) {
    console.log(`  ${p.name.padEnd(40)} | ${p.label.padEnd(30)} | type=${p.type} | group=${p.groupName}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
