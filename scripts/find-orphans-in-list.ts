import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const ZUPER_API_URL = process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";
  const ZUPER_API_KEY = process.env.ZUPER_API_KEY!;

  const targetUids = new Set([
    "036169ac-0172-4ac2-bca7-c1edfe3e9e4e",
    "e0eb2bc5-11f8-487c-bf43-f1a3fc2b54fa",
    "f408661a-b748-432d-8b75-12e8bcff5e5f",
    "2243f4ee-65dc-4c97-be80-b2b9b7da7ede",
    "c1883093-1575-4b99-b5c6-e12a42e4b3f2",
    "e7f997e0-22fc-4c7e-ad81-66b05e6dccaf",
    "d75da1ea-cd1c-4ac1-8b6c-2b03c7cd6aba",
    "14702e40-f392-4b6e-8c0e-96e4e3f9c71d",
  ]);

  let page = 1;
  let found = 0;
  while (true) {
    const r = await fetch(`${ZUPER_API_URL}/product?count=100&page=${page}`, {
      headers: { "x-api-key": ZUPER_API_KEY },
    });
    const d = await r.json() as any;
    const batch = d.data || [];

    for (const p of batch) {
      if (targetUids.has(p.product_uid)) {
        console.log(`FOUND in list: "${p.product_name}" uid=${p.product_uid} is_active=${p.is_active}`);
        found++;
      }
    }

    if (batch.length < 100) break;
    page++;
  }

  console.log(`\nFound ${found}/${targetUids.size} orphans in list endpoint`);

  // Also search by name for "SEG-420" and "QM-HUG" to see what's there
  for (const search of ["SEG-420", "QM-HUG", "XR10-BOSS", "COMBINER BOX"]) {
    const r = await fetch(`${ZUPER_API_URL}/product?count=10&filter.keyword=${encodeURIComponent(search)}`, {
      headers: { "x-api-key": ZUPER_API_KEY },
    });
    const d = await r.json() as any;
    const results = d.data || [];
    console.log(`\nSearch "${search}": ${results.length} results`);
    for (const p of results) {
      console.log(`  "${p.product_name}" uid=${p.product_uid.substring(0, 12)}… active=${p.is_active}`);
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
