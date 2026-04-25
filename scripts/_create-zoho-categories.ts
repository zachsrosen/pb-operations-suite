/**
 * Create the new Zoho Inventory categories per Zach's decision (2026-04-24):
 *   - "Battery"
 *   - "EV Charger"
 *
 * Idempotent — checks existing categories first; only creates missing ones.
 *
 * Run: node --env-file=.env.local --import tsx scripts/_create-zoho-categories.ts [--dry-run]
 */
const ORG_ID = process.env.ZOHO_INVENTORY_ORG_ID;
const REFRESH_TOKEN = process.env.ZOHO_INVENTORY_REFRESH_TOKEN;
const CLIENT_ID = process.env.ZOHO_INVENTORY_CLIENT_ID;
const CLIENT_SECRET = process.env.ZOHO_INVENTORY_CLIENT_SECRET;
const ACCOUNTS_BASE = process.env.ZOHO_ACCOUNTS_BASE_URL || "https://accounts.zoho.com";
const API_BASE = process.env.ZOHO_INVENTORY_API_BASE_URL || "https://www.zohoapis.com/inventory/v1";

if (!ORG_ID || !REFRESH_TOKEN || !CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing Zoho env");
  process.exit(1);
}

const DRY_RUN = process.argv.includes("--dry-run");

const TO_CREATE = ["Battery", "EV Charger"];

async function refresh(): Promise<string> {
  const body = new URLSearchParams({
    refresh_token: REFRESH_TOKEN!,
    client_id: CLIENT_ID!,
    client_secret: CLIENT_SECRET!,
    grant_type: "refresh_token",
  });
  const r = await fetch(`${ACCOUNTS_BASE}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const d = await r.json();
  if (!r.ok || !d.access_token) throw new Error(`OAuth refresh failed: ${JSON.stringify(d)}`);
  return d.access_token;
}

async function listCategories(token: string): Promise<Array<{ category_id?: string; name?: string }>> {
  const params = new URLSearchParams({ organization_id: ORG_ID!, per_page: "200" });
  const r = await fetch(`${API_BASE}/categories?${params}`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  if (!r.ok) throw new Error(`list failed: ${r.status} ${await r.text()}`);
  const d = await r.json();
  return d.categories || [];
}

async function createCategory(token: string, name: string): Promise<{ category_id: string; name: string }> {
  const params = new URLSearchParams({ organization_id: ORG_ID! });
  // Try a few payload shapes — Zoho Inventory's category create endpoint
  // is sparsely documented; common shapes are { name } or { category_name }
  const payloads: Record<string, unknown>[] = [
    { name, parent_category_id: "-1" },
    { name },
    { category_name: name },
  ];
  let lastErr = "";
  for (const body of payloads) {
    const r = await fetch(`${API_BASE}/categories?${params}`, {
      method: "POST",
      headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) {
      const cat = d.category || d;
      const cid = cat.category_id || cat.id;
      const cname = cat.name || cat.category_name || name;
      if (cid) return { category_id: String(cid), name: cname };
    }
    lastErr = `${r.status} ${JSON.stringify(d).slice(0, 300)} (payload: ${JSON.stringify(body)})`;
  }
  throw new Error(`Could not create category "${name}". Last: ${lastErr}`);
}

async function main() {
  console.log(`${DRY_RUN ? "DRY RUN — " : ""}Refreshing Zoho OAuth...`);
  const token = await refresh();

  console.log("Fetching existing categories...");
  const existing = await listCategories(token);
  const existingLower = new Set(existing.map((c) => (c.name || "").toLowerCase()));

  const created: Array<{ name: string; category_id: string }> = [];
  for (const name of TO_CREATE) {
    if (existingLower.has(name.toLowerCase())) {
      const match = existing.find((c) => (c.name || "").toLowerCase() === name.toLowerCase());
      console.log(`  = "${name}" already exists (id ${match?.category_id})`);
      if (match?.category_id) {
        created.push({ name, category_id: String(match.category_id) });
      }
      continue;
    }
    if (DRY_RUN) {
      console.log(`  + "${name}" would be created`);
      continue;
    }
    console.log(`  + Creating "${name}"...`);
    const c = await createCategory(token, name);
    console.log(`    ✓ created with id ${c.category_id}`);
    created.push({ name: c.name, category_id: c.category_id });
  }

  console.log("\nFinal mapping:");
  for (const c of created) console.log(`  ${c.name.padEnd(15)} ${c.category_id}`);

  const fs = await import("fs");
  fs.writeFileSync("scripts/zoho-new-categories.json", JSON.stringify({
    created_at: new Date().toISOString(),
    categories: created,
  }, null, 2));
  console.log("\nWrote scripts/zoho-new-categories.json");
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
