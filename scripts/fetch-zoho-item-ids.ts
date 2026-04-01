import dotenv from "dotenv";
dotenv.config({ path: ".env.production-pull" });

import * as fs from "fs";

const clientId = process.env.ZOHO_INVENTORY_CLIENT_ID;
const clientSecret = process.env.ZOHO_INVENTORY_CLIENT_SECRET;
const refreshToken = process.env.ZOHO_INVENTORY_REFRESH_TOKEN;
const orgId = process.env.ZOHO_INVENTORY_ORG_ID;

async function getAccessToken(): Promise<string> {
  const res = await fetch("https://accounts.zoho.com/oauth/v2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId || "",
      client_secret: clientSecret || "",
      refresh_token: (refreshToken || "").trim(),
    }),
  });
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("Token error: " + JSON.stringify(data));
  return data.access_token;
}

// The 44 high-confidence + 4 likely-good matches we need Zoho item_ids for
// Key = SO SKU (normalized), value = IP model we matched to
const TARGET_SKUS = [
  // High confidence
  "XR-LUG-03-A1", "HW-RD1430-01-M1", "M3317GBZ-SM", "S6466",
  "1879359-15-B", "XR-10-168M", "UFO-END-01-B1", "SNOW DOG-BLK",
  "XR10-BOSS-01-M1", "2045796-xx-y", "SEG-430-BTD-BG",
  "1978069-00-x", "THQL2160", "1978070-00-x", "153800-45-X",
  "1875157-20-y", "2466608", "1734411-02", "EZSLR JB-3",
  "1875157-05-y", "1734412-02-X", "KOB-1L02-B1", "TL270RCU",
  "EZSLR JB-1.2", "1509495-xx-x", "1509549-02-B",
  // Likely good
  "703153", "ENP X-IQ-AM1-240-5", "Q-12-10-240", "Q-12-17-240",
];

async function main() {
  console.log("Authenticating with Zoho...");
  const accessToken = await getAccessToken();

  // Load the SO review data to find which SOs contain these items
  const soData = JSON.parse(fs.readFileSync("scripts/2026-so-review.json", "utf-8"));

  // Find a sample SO for each target SKU
  const skuToSO = new Map<string, string>();
  for (const so of soData.salesOrders) {
    for (const item of so.items) {
      const sku = (item.sku || "").trim();
      if (!sku) continue;
      // Check if this SKU matches any target (exact or contained)
      for (const target of TARGET_SKUS) {
        if (sku === target || sku.includes(target) || target.includes(sku)) {
          if (!skuToSO.has(target)) {
            skuToSO.set(target, so.so_number);
          }
        }
      }
    }
  }

  console.log("Found SOs for " + skuToSO.size + " of " + TARGET_SKUS.length + " target SKUs\n");

  // Get unique SO numbers to fetch
  const soNumbers = [...new Set(skuToSO.values())];
  console.log("Fetching " + soNumbers.length + " SOs for item_id extraction...\n");

  // Fetch each SO detail and extract item_ids
  const skuToZohoId = new Map<string, { item_id: string; name: string; sku: string }>();

  for (let i = 0; i < soNumbers.length; i++) {
    const soNum = soNumbers[i];
    const url = "https://www.zohoapis.com/inventory/v1/salesorders?organization_id=" + orgId + "&salesorder_number=" + encodeURIComponent(soNum);
    const res = await fetch(url, {
      headers: { Authorization: "Zoho-oauthtoken " + accessToken },
    });
    const data = (await res.json()) as {
      salesorders?: Array<{
        salesorder_id?: string;
        salesorder_number?: string;
        line_items?: Array<{ item_id?: string; name?: string; sku?: string }>;
      }>;
    };

    const so = data.salesorders?.[0];
    if (!so?.line_items) {
      console.log("  " + soNum + ": no line items found");
      continue;
    }

    // Also fetch full detail if the list response doesn't have item_ids
    let lineItems = so.line_items;
    if (lineItems.length > 0 && !lineItems[0].item_id && so.salesorder_id) {
      const detailUrl = "https://www.zohoapis.com/inventory/v1/salesorders/" + so.salesorder_id + "?organization_id=" + orgId;
      const detailRes = await fetch(detailUrl, {
        headers: { Authorization: "Zoho-oauthtoken " + accessToken },
      });
      const detailData = (await detailRes.json()) as {
        salesorder?: { line_items?: Array<{ item_id?: string; name?: string; sku?: string }> };
      };
      lineItems = detailData.salesorder?.line_items || lineItems;
      await new Promise((r) => setTimeout(r, 500));
    }

    for (const li of lineItems) {
      if (!li.item_id || !li.sku) continue;
      const sku = li.sku.trim();
      for (const target of TARGET_SKUS) {
        if (sku === target || sku.includes(target) || target.includes(sku)) {
          if (!skuToZohoId.has(target)) {
            skuToZohoId.set(target, {
              item_id: li.item_id,
              name: li.name || "",
              sku: li.sku || "",
            });
          }
        }
      }
    }

    if ((i + 1) % 10 === 0 || i === soNumbers.length - 1) {
      console.log("Fetched " + (i + 1) + "/" + soNumbers.length + " SOs, found " + skuToZohoId.size + " item_ids so far");
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  // Also try searching Zoho items directly for any SKUs we didn't find in SOs
  const missing = TARGET_SKUS.filter((s) => !skuToZohoId.has(s));
  if (missing.length > 0) {
    console.log("\nSearching Zoho items directly for " + missing.length + " remaining SKUs...");
    for (const sku of missing) {
      const url = "https://www.zohoapis.com/inventory/v1/items?organization_id=" + orgId + "&search_text=" + encodeURIComponent(sku);
      const res = await fetch(url, {
        headers: { Authorization: "Zoho-oauthtoken " + accessToken },
      });
      const data = (await res.json()) as {
        items?: Array<{ item_id?: string; name?: string; sku?: string }>;
      };

      if (data.items?.length) {
        // Find best match by SKU
        const match = data.items.find((item) => {
          const itemSku = (item.sku || "").trim();
          return itemSku === sku || itemSku.includes(sku) || sku.includes(itemSku);
        }) || data.items[0];

        if (match.item_id) {
          skuToZohoId.set(sku, {
            item_id: match.item_id,
            name: match.name || "",
            sku: match.sku || "",
          });
          console.log("  Found: " + sku + " → " + match.name + " (item_id: " + match.item_id + ")");
        }
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // Load the comparison data and build the backfill mapping
  const comparison = JSON.parse(fs.readFileSync("scripts/2026-so-inventory-comparison.json", "utf-8"));
  const highConfAndLikely = comparison.comparison.filter((c: Record<string, unknown>) => {
    if (c.match_status !== "MATCHED" || c.ip_zoho_linked) return false;
    const ipBrand = String(c.ip_brand || "");
    const ipModel = String(c.ip_model || "");
    // Exclude false positives
    if (ipBrand === "SVC") return false;
    if (ipModel.toLowerCase() === "qo240") return false;
    if (ipModel.toLowerCase().includes("thwn-2 6 awg") && !String(c.so_item_name).toLowerCase().includes("6 awg")) return false;
    if (ipModel.toLowerCase().includes("pw3-60a") && !String(c.so_item_name).toLowerCase().includes("pw3")) return false;
    if (ipModel.toLowerCase().includes("production meter") && !String(c.so_item_name).toLowerCase().includes("production meter")) return false;
    if (ipModel.toLowerCase().includes("rec360")) return false;
    if (ipModel.toLowerCase().includes("quickmount halo") && !String(c.so_item_name).toLowerCase().includes("hug") && !String(c.so_item_name).toLowerCase().includes("halo")) return false;
    if (ipModel === "DG222URB" && !String(c.so_sku).includes("DG222")) return false;
    if (ipModel === "200A-MSP") return false;
    if (ipModel === "DC DISCONNECT" && !String(c.so_item_name).toLowerCase().includes("dc disconnect")) return false;
    if (ipModel === "MID CLAMP" && !String(c.so_item_name).toLowerCase().includes("mid clamp")) return false;
    return true;
  });

  // Build backfill records — dedupe by IP id (same InternalProduct might match multiple SO items)
  const backfillMap = new Map<string, {
    ip_id: string;
    ip_brand: string;
    ip_model: string;
    so_item_name: string;
    so_sku: string;
    zoho_item_id: string;
    zoho_item_name: string;
    zoho_item_sku: string;
    times_used: number;
  }>();

  for (const c of highConfAndLikely) {
    const soSku = String(c.so_sku || "").trim();
    if (!soSku) continue;

    // Find matching Zoho item_id
    let zohoMatch = skuToZohoId.get(soSku);
    if (!zohoMatch) {
      // Try each target that might match this SKU
      for (const [target, info] of skuToZohoId.entries()) {
        if (soSku.includes(target) || target.includes(soSku)) {
          zohoMatch = info;
          break;
        }
      }
    }
    // Try SKU parts (compound SKUs)
    if (!zohoMatch && soSku.includes("/")) {
      for (const part of soSku.split("/")) {
        const trimmed = part.trim();
        zohoMatch = skuToZohoId.get(trimmed);
        if (!zohoMatch) {
          for (const [target, info] of skuToZohoId.entries()) {
            if (trimmed.includes(target) || target.includes(trimmed)) {
              zohoMatch = info;
              break;
            }
          }
        }
        if (zohoMatch) break;
      }
    }

    if (!zohoMatch) continue;

    const ipId = String(c.ip_id);
    if (!backfillMap.has(ipId)) {
      backfillMap.set(ipId, {
        ip_id: ipId,
        ip_brand: String(c.ip_brand),
        ip_model: String(c.ip_model),
        so_item_name: String(c.so_item_name),
        so_sku: soSku,
        zoho_item_id: zohoMatch.item_id,
        zoho_item_name: zohoMatch.name,
        zoho_item_sku: zohoMatch.sku,
        times_used: Number(c.times_used),
      });
    }
  }

  const backfillList = [...backfillMap.values()].sort((a, b) => b.times_used - a.times_used);

  console.log("\n=== BACKFILL CANDIDATES (" + backfillList.length + ") ===");
  console.log("#".padEnd(4) + "IP Brand".padEnd(15) + "IP Model".padEnd(25) + "Zoho Item Name".padEnd(45) + "Zoho SKU".padEnd(22) + "Zoho ID".padEnd(22) + "Used");
  console.log("-".repeat(137));
  for (let i = 0; i < backfillList.length; i++) {
    const b = backfillList[i];
    console.log(
      String(i + 1).padEnd(4) +
      b.ip_brand.substring(0, 13).padEnd(15) +
      b.ip_model.substring(0, 23).padEnd(25) +
      b.zoho_item_name.substring(0, 43).padEnd(45) +
      b.zoho_item_sku.substring(0, 20).padEnd(22) +
      b.zoho_item_id.padEnd(22) +
      String(b.times_used)
    );
  }

  // Save for backfill step
  fs.writeFileSync("scripts/2026-zoho-backfill-candidates.json", JSON.stringify(backfillList, null, 2));
  console.log("\nSaved to scripts/2026-zoho-backfill-candidates.json");
}

main().catch(console.error);
