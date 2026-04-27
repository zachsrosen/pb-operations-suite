/**
 * Pull every Zoho Inventory item, extract distinct group_name + category_name
 * values, count items per group, and cross-reference against our internal
 * EquipmentCategory enum.
 *
 * "Item Groups" (the /itemgroups endpoint) is a different concept in Zoho —
 * it's for variant items (t-shirt sizes etc.). What we use as `group_name`
 * on item create is actually a top-level item field that comes from the
 * existing items in the org.
 *
 * Read-only. Output: scripts/zoho-item-groups.json
 *
 * Run: npx tsx scripts/_pull-zoho-item-groups.ts
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const ORG_ID = process.env.ZOHO_INVENTORY_ORG_ID;
const REFRESH_TOKEN = process.env.ZOHO_INVENTORY_REFRESH_TOKEN;
const CLIENT_ID = process.env.ZOHO_INVENTORY_CLIENT_ID;
const CLIENT_SECRET = process.env.ZOHO_INVENTORY_CLIENT_SECRET;
const ACCOUNTS_BASE = process.env.ZOHO_ACCOUNTS_BASE_URL || "https://accounts.zoho.com";
const API_BASE = process.env.ZOHO_INVENTORY_API_BASE_URL || "https://www.zohoapis.com/inventory/v1";

if (!ORG_ID || !REFRESH_TOKEN || !CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing Zoho env vars");
  process.exit(1);
}

async function refreshAccessToken(): Promise<string> {
  const body = new URLSearchParams({
    refresh_token: REFRESH_TOKEN!,
    client_id: CLIENT_ID!,
    client_secret: CLIENT_SECRET!,
    grant_type: "refresh_token",
  });
  const res = await fetch(`${ACCOUNTS_BASE}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`OAuth refresh failed (${res.status}): ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

interface ZohoItem {
  item_id?: string;
  name?: string;
  group_name?: string;
  group_id?: string;
  category_name?: string;
  category_id?: string;
  brand?: string;
  manufacturer?: string;
  status?: string;
}

async function listAllItems(token: string): Promise<ZohoItem[]> {
  const all: ZohoItem[] = [];
  let page = 1;
  const perPage = 200;
  while (true) {
    const params = new URLSearchParams({
      organization_id: ORG_ID!,
      page: String(page),
      per_page: String(perPage),
    });
    const res = await fetch(`${API_BASE}/items?${params}`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });
    if (!res.ok) {
      throw new Error(`items fetch failed page ${page}: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    const items: ZohoItem[] = data.items || [];
    all.push(...items);
    process.stdout.write(`\r  fetched page ${page} (${all.length} items so far)`);
    const ctx = data.page_context;
    if (!ctx?.has_more_page) break;
    page++;
    if (page > 100) {
      console.warn("\n  hit page cap (100) — truncating");
      break;
    }
  }
  console.log("");
  return all;
}

interface ZohoCategory {
  category_id?: string;
  name?: string;
  parent_category_id?: string;
  depth?: number;
  visibility?: boolean;
  has_active_items?: boolean;
}

async function listCategories(token: string): Promise<ZohoCategory[]> {
  // The /categories endpoint returns a flat list with `name` (not `category_name`)
  const params = new URLSearchParams({ organization_id: ORG_ID!, per_page: "200" });
  try {
    const res = await fetch(`${API_BASE}/categories?${params}`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.categories || [];
  } catch {
    return [];
  }
}

function groupBy<T>(items: T[], keyFn: (i: T) => string | undefined) {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item) || "(unset)";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return map;
}

async function main() {
  console.log("Refreshing Zoho OAuth token...");
  const token = await refreshAccessToken();

  console.log("Fetching /categories...");
  const categories = await listCategories(token);
  if (categories.length > 0) {
    console.log(`  found ${categories.length} categories\n`);
    console.log("─".repeat(80));
    console.log("ZOHO CATEGORIES (via /categories endpoint, with IDs)");
    console.log("─".repeat(80));
    const visible = categories.filter((c) => c.name && c.name !== "ROOT");
    visible.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    for (const c of visible) {
      const indent = c.depth ? "  ".repeat(c.depth) : "";
      console.log(`  ${(c.category_id || "?").padEnd(22)} ${indent}${c.name || "?"}`);
    }
  } else {
    console.log("  /categories returned nothing");
  }

  console.log("\nFetching all items (paginated)...");
  const items = await listAllItems(token);
  console.log(`Total items: ${items.length}\n`);

  const byGroup = groupBy(items, (i) => i.group_name);
  const byCategory = groupBy(items, (i) => i.category_name);
  const byBrand = groupBy(items, (i) => i.brand || i.manufacturer);

  console.log("─".repeat(80));
  console.log(`DISTINCT group_name VALUES (${byGroup.size})`);
  console.log("─".repeat(80));
  const groupRows = [...byGroup.entries()]
    .sort((a, b) => b[1].length - a[1].length);
  for (const [name, members] of groupRows) {
    console.log(`  ${name.padEnd(40)} ${String(members.length).padStart(5)} items`);
  }

  console.log("\n" + "─".repeat(80));
  console.log(`DISTINCT category_name VALUES (${byCategory.size})`);
  console.log("─".repeat(80));
  const catRows = [...byCategory.entries()]
    .sort((a, b) => b[1].length - a[1].length);
  for (const [name, members] of catRows) {
    console.log(`  ${name.padEnd(40)} ${String(members.length).padStart(5)} items`);
  }

  console.log("\n" + "─".repeat(80));
  console.log(`DISTINCT brand VALUES (top 30 of ${byBrand.size})`);
  console.log("─".repeat(80));
  const brandRows = [...byBrand.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 30);
  for (const [name, members] of brandRows) {
    console.log(`  ${name.padEnd(40)} ${String(members.length).padStart(5)} items`);
  }

  // Cross-reference
  const internalCategories = [
    "MODULE", "INVERTER", "BATTERY", "BATTERY_EXPANSION", "EV_CHARGER",
    "RACKING", "ELECTRICAL_BOS", "MONITORING", "RAPID_SHUTDOWN", "OPTIMIZER",
    "GATEWAY", "D_AND_R", "SERVICE", "ADDER_SERVICES",
    "TESLA_SYSTEM_COMPONENTS", "PROJECT_MILESTONES",
  ];

  console.log("\n" + "─".repeat(80));
  console.log("HEURISTIC MATCH: internal category → existing Zoho group_name");
  console.log("─".repeat(80));
  const groupNames = [...byGroup.keys()];
  for (const cat of internalCategories) {
    const c = cat.toLowerCase().replace(/_/g, " ").trim();
    const cWords = c.split(" ").filter((w) => w.length > 2);
    const matches = groupNames.filter((n) => {
      const nl = n.toLowerCase();
      return nl.includes(c) || c.includes(nl) || cWords.some((w) => nl.includes(w));
    });
    const result = matches.length > 0 ? matches.join(" | ") : "(no Zoho group matches — needs decision)";
    console.log(`  ${cat.padEnd(28)} → ${result}`);
  }

  // Persist
  const fs = await import("fs");
  const out = {
    pulled_at: new Date().toISOString(),
    org_id: ORG_ID,
    item_count: items.length,
    distinct_groups: groupRows.map(([name, members]) => ({
      group_name: name,
      item_count: members.length,
      sample_items: members.slice(0, 3).map((i) => ({ name: i.name, brand: i.brand })),
    })),
    distinct_categories: catRows.map(([name, members]) => ({
      category_name: name,
      item_count: members.length,
    })),
    api_categories: categories,
  };
  fs.writeFileSync("scripts/zoho-item-groups.json", JSON.stringify(out, null, 2));
  console.log("\nWrote scripts/zoho-item-groups.json");
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
