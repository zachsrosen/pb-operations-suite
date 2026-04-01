import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const ZUPER_API_URL = process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";
  const ZUPER_API_KEY = process.env.ZUPER_API_KEY!;

  // Test: fetch the SEG original orphan
  const uid = "036169ac-0172-4ac2-bca7-c1edfe3e9e4e";

  // Try single product endpoint
  const r1 = await fetch(`${ZUPER_API_URL}/product/${uid}`, {
    headers: { "x-api-key": ZUPER_API_KEY },
  });
  console.log("Single endpoint status:", r1.status);
  const d1 = await r1.json();
  console.log("Single endpoint response:", JSON.stringify(d1).substring(0, 300));

  // Try products endpoint with filter
  const r2 = await fetch(`${ZUPER_API_URL}/product?count=5&filter.product_uid=${uid}`, {
    headers: { "x-api-key": ZUPER_API_KEY },
  });
  console.log("\nList+filter status:", r2.status);
  const d2 = await r2.json();
  console.log("List+filter response:", JSON.stringify(d2).substring(0, 300));

  // Search all and find it
  let page = 1;
  let found = false;
  while (!found && page <= 6) {
    const r = await fetch(`${ZUPER_API_URL}/product?count=100&page=${page}`, {
      headers: { "x-api-key": ZUPER_API_KEY },
    });
    const d = await r.json() as any;
    const batch = d.data || [];
    for (const p of batch) {
      if (p.product_uid === uid) {
        console.log(`\nFound in list page ${page}: "${p.product_name}" active=${p.is_active}`);
        found = true;
        break;
      }
    }
    if (batch.length < 100) break;
    page++;
  }
  if (!found) console.log("\nNot found in full list scan!");
}
main().catch(e => { console.error(e); process.exit(1); });
