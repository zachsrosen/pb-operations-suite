/**
 * Dump all unique field names from Zoho Inventory items
 * to see what we're missing in the export.
 *
 * Usage: npx tsx scripts/zoho-item-fields.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config();

const BASE_URL = process.env.ZOHO_INVENTORY_API_BASE_URL || "https://www.zohoapis.com/inventory/v1";
const ORG_ID = process.env.ZOHO_INVENTORY_ORG_ID!;
let currentToken = process.env.ZOHO_INVENTORY_ACCESS_TOKEN || "";

async function refreshToken(): Promise<string> {
  const params = new URLSearchParams({
    refresh_token: process.env.ZOHO_INVENTORY_REFRESH_TOKEN!,
    client_id: process.env.ZOHO_INVENTORY_CLIENT_ID!,
    client_secret: process.env.ZOHO_INVENTORY_CLIENT_SECRET!,
    grant_type: "refresh_token",
  });
  const res = await fetch(`${process.env.ZOHO_ACCOUNTS_BASE_URL || "https://accounts.zoho.com"}/oauth/v2/token?${params}`, { method: "POST" });
  const data = await res.json();
  if (!data.access_token) throw new Error("Token refresh failed");
  currentToken = data.access_token;
  return currentToken;
}

async function zohoFetch(path: string, attempt = 0): Promise<any> {
  if (!currentToken) await refreshToken();
  const url = `${BASE_URL}${path}${path.includes("?") ? "&" : "?"}organization_id=${ORG_ID}`;
  const res = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${currentToken}` } });
  if (res.status === 401 && attempt === 0) { await refreshToken(); return zohoFetch(path, 1); }
  if (!res.ok) throw new Error(`Zoho ${res.status}: ${await res.text()}`);
  return res.json();
}

async function main() {
  // Fetch page 1 of items (200 items) — enough to see all fields
  console.log("Fetching items page 1...");
  const data = await zohoFetch("/items?page=1&per_page=200");
  const items = data.items || [];
  console.log(`Got ${items.length} items\n`);

  // Collect all unique keys across all items, with sample values
  const fieldInfo = new Map<string, { count: number; type: string; sample: any; nonEmpty: number }>();

  for (const item of items) {
    collectFields(item, "", fieldInfo, items.length);
  }

  // Sort by path name
  const sorted = [...fieldInfo.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  console.log("=== ALL FIELDS ON ZOHO ITEMS ===\n");
  console.log(`${"Field".padEnd(50)} ${"Type".padEnd(12)} ${"Non-empty".padEnd(12)} Sample`);
  console.log("-".repeat(120));

  for (const [path, info] of sorted) {
    const sampleStr = typeof info.sample === "object" ? JSON.stringify(info.sample).slice(0, 60) : String(info.sample).slice(0, 60);
    console.log(`${path.padEnd(50)} ${info.type.padEnd(12)} ${(info.nonEmpty + "/" + items.length).padEnd(12)} ${sampleStr}`);
  }

  // Also fetch ONE item by ID to get the detailed view (sometimes has more fields)
  console.log("\n\n=== DETAILED ITEM VIEW (single item) ===\n");
  const sampleId = items[0].item_id;
  const detail = await zohoFetch(`/items/${sampleId}`);
  const detailItem = detail.item;
  if (detailItem) {
    const detailFields = new Map<string, { count: number; type: string; sample: any; nonEmpty: number }>();
    collectFields(detailItem, "", detailFields, 1);
    const detailSorted = [...detailFields.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    console.log(`${"Field".padEnd(50)} ${"Type".padEnd(12)} Sample`);
    console.log("-".repeat(120));
    for (const [path, info] of detailSorted) {
      const sampleStr = typeof info.sample === "object" ? JSON.stringify(info.sample).slice(0, 80) : String(info.sample).slice(0, 80);
      console.log(`${path.padEnd(50)} ${info.type.padEnd(12)} ${sampleStr}`);
    }

    // Check for custom fields specifically
    if (detailItem.custom_fields) {
      console.log("\n=== CUSTOM FIELDS ===\n");
      console.log(JSON.stringify(detailItem.custom_fields, null, 2));
    }
    if (detailItem.custom_field_hash) {
      console.log("\n=== CUSTOM FIELD HASH ===\n");
      console.log(JSON.stringify(detailItem.custom_field_hash, null, 2));
    }
  }
}

function collectFields(
  obj: any,
  prefix: string,
  map: Map<string, { count: number; type: string; sample: any; nonEmpty: number }>,
  total: number
) {
  if (!obj || typeof obj !== "object") return;

  for (const [key, val] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;

    // Skip deeply nested arrays (like warehouse stock details) beyond first level
    if (Array.isArray(val)) {
      const existing = map.get(path);
      const nonEmpty = (val as any[]).length > 0 ? 1 : 0;
      if (existing) {
        existing.count++;
        existing.nonEmpty += nonEmpty;
        if (!existing.sample && val.length > 0) existing.sample = `Array[${val.length}]`;
      } else {
        map.set(path, {
          count: 1,
          type: "array",
          sample: val.length > 0 ? `Array[${val.length}]` : "[]",
          nonEmpty,
        });
      }
      // Recurse into first element to capture nested field names
      if (val.length > 0 && typeof val[0] === "object") {
        collectFields(val[0], `${path}[]`, map, total);
      }
    } else if (typeof val === "object" && val !== null) {
      collectFields(val, path, map, total);
    } else {
      const isEmpty = val === undefined || val === null || val === "" || val === 0 || val === false;
      const existing = map.get(path);
      if (existing) {
        existing.count++;
        if (!isEmpty) existing.nonEmpty++;
        if (!existing.sample && !isEmpty) existing.sample = val;
      } else {
        map.set(path, {
          count: 1,
          type: typeof val,
          sample: isEmpty ? val : val,
          nonEmpty: isEmpty ? 0 : 1,
        });
      }
    }
  }
}

main().catch((err) => { console.error("Error:", err); process.exit(1); });
