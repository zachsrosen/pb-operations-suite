/**
 * One-off Zoho item search by name pattern.
 * Run: node --env-file=.env.local --import tsx scripts/_zoho-search.ts <query>
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

const QUERY = process.argv[2] || "iq10";

async function refresh(): Promise<string> {
  const body = new URLSearchParams({
    refresh_token: REFRESH_TOKEN!,
    client_id: CLIENT_ID!,
    client_secret: CLIENT_SECRET!,
    grant_type: "refresh_token",
  });
  const r = await fetch(`${ACCOUNTS_BASE}/oauth/v2/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  const d = await r.json();
  return d.access_token;
}

async function main() {
  const t = await refresh();
  // Search via search_text (Zoho-supported)
  const params = new URLSearchParams({
    organization_id: ORG_ID!,
    search_text: QUERY,
    per_page: "50",
  });
  const r = await fetch(`${API_BASE}/items?${params}`, {
    headers: { Authorization: `Zoho-oauthtoken ${t}` },
  });
  const d = await r.json();
  const items = d.items || [];
  console.log(`Found ${items.length} items matching "${QUERY}"\n`);
  for (const i of items) {
    console.log(`  name:           ${i.name}`);
    console.log(`  sku:            ${i.sku}`);
    console.log(`  part_number:    ${i.part_number}`);
    console.log(`  brand:          ${i.brand || "(unset)"}`);
    console.log(`  manufacturer:   ${i.manufacturer || "(unset)"}`);
    console.log(`  group_name:     ${i.group_name || "(unset)"}`);
    console.log(`  category_name:  ${i.category_name || "(unset)"}`);
    console.log(`  category_id:    ${i.category_id || "(unset)"}`);
    console.log(`  status:         ${i.status}`);
    console.log("  ---");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
