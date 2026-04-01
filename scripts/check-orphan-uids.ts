import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const ZUPER_API_URL = process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";
  const ZUPER_API_KEY = process.env.ZUPER_API_KEY!;

  const orphanUids = [
    { label: "SEG-420-BTD-BG", uid: "036169ac-0172-4ac2-bca7-c1edfe3e9e4e" },
    { label: "Tesla 7.6kW Inverter", uid: "e0eb2bc5-11f8-487c-bf43-f1a3fc2b54fa" },
    { label: "BACKUP GATEWAY 3", uid: "f408661a-b748-432d-8b75-12e8bcff5e5f" },
    { label: "IRONRIDGE QM-HUG-01-M1", uid: "2243f4ee-65dc-4c97-be80-b2b9b7da7ede" },
    { label: "IRONRIDGE XR10-BOSS-01-M1", uid: "c1883093-1575-4b99-b5c6-e12a42e4b3f2" },
    { label: "ENPHASE IQ COMBINER BOX-5", uid: "e7f997e0-22fc-4c7e-ad81-66b05e6dccaf" },
    { label: "Tesla PW3 Expansion Pack", uid: "d75da1ea-cd1c-4ac1-8b6c-2b03c7cd6aba" },
    { label: "Silfab SIL-400 HC+", uid: "14702e40-f392-4b6e-8c0e-96e4e3f9c71d" },
  ];

  for (const { label, uid } of orphanUids) {
    const r = await fetch(`${ZUPER_API_URL}/product/${uid}`, {
      headers: { "x-api-key": ZUPER_API_KEY },
    });
    const status = r.status;
    const d = await r.json() as any;
    const found = d.data?.product_name || "NOT FOUND";
    console.log(`${status === 200 ? "✓" : "✗"} ${label}: ${found} (${status})`);
  }

  // Count total Zuper products now
  let total = 0;
  let page = 1;
  while (true) {
    const r = await fetch(`${ZUPER_API_URL}/product?count=100&page=${page}`, {
      headers: { "x-api-key": ZUPER_API_KEY },
    });
    const d = await r.json() as any;
    const batch = d.data || [];
    total += batch.length;
    if (batch.length < 100) break;
    page++;
  }
  console.log(`\nTotal Zuper products now: ${total} (was 475 during audit)`);
}
main().catch(e => { console.error(e); process.exit(1); });
