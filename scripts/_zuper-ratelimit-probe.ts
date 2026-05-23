/**
 * One-shot diagnostic: hit a benign Zuper read endpoint and dump ALL
 * response headers so we can see what rate-limit info (if any) they ship.
 *
 * Usage:  npx tsx scripts/_zuper-ratelimit-probe.ts
 */

const ZUPER_API_URL = process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";
const ZUPER_API_KEY = process.env.ZUPER_API_KEY;

if (!ZUPER_API_KEY) {
  console.error("ZUPER_API_KEY not set");
  process.exit(1);
}

// A read endpoint with a tiny payload — lists 1 job, minimal load on Zuper.
const path = "/jobs?count=1&page=1";

(async () => {
  const t0 = Date.now();
  const res = await fetch(`${ZUPER_API_URL}${path}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ZUPER_API_KEY,
    },
  });
  const elapsed = Date.now() - t0;

  console.log(`HTTP ${res.status}  (${elapsed}ms)`);
  console.log("\n=== ALL RESPONSE HEADERS ===");
  const headers: Array<[string, string]> = [];
  res.headers.forEach((value, key) => headers.push([key, value]));
  headers.sort();
  for (const [k, v] of headers) {
    console.log(`  ${k}: ${v}`);
  }

  console.log("\n=== RATE-LIMIT-LIKE HEADERS (filtered) ===");
  const rateLikely = headers.filter(([k]) =>
    /rate|limit|quota|throttle|retry|remaining|reset|budget/i.test(k),
  );
  if (rateLikely.length === 0) {
    console.log("  (none found)");
  } else {
    for (const [k, v] of rateLikely) console.log(`  ${k}: ${v}`);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
