import dotenv from "dotenv";
dotenv.config({ path: ".env.production-pull" });

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

interface LineItem {
  name: string;
  sku: string;
  quantity: number;
  rate: number;
  amount: number;
  description: string;
}

interface SOSummary {
  salesorder_id: string;
  salesorder_number: string;
  reference_number: string;
  customer_name: string;
  date: string;
  status: string;
  total: number;
  delivery_method: string;
}

interface SODetail extends SOSummary {
  line_items: LineItem[];
}

async function fetchAllSOSummaries(accessToken: string): Promise<SOSummary[]> {
  const allSOs: SOSummary[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const url = `https://www.zohoapis.com/inventory/v1/salesorders?organization_id=${orgId}&page=${page}&per_page=200&sort_column=date&sort_order=A`;
    const res = await fetch(url, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    });
    const data = (await res.json()) as {
      salesorders?: Array<Record<string, unknown>>;
      page_context?: { has_more_page?: boolean };
    };

    const sos = data.salesorders || [];
    for (const so of sos) {
      const dateStr = String(so.date || "");
      if (!dateStr.startsWith("2026")) continue;

      allSOs.push({
        salesorder_id: String(so.salesorder_id || ""),
        salesorder_number: String(so.salesorder_number || ""),
        reference_number: String(so.reference_number || ""),
        customer_name: String(so.customer_name || ""),
        date: dateStr,
        status: String(so.status || ""),
        total: Number(so.total || 0),
        delivery_method: String(so.delivery_method || ""),
      });
    }

    hasMore = !!data.page_context?.has_more_page;
    if (sos.length > 0) {
      const lastDate = String(sos[sos.length - 1].date || "");
      if (lastDate > "2026-12-31") hasMore = false;
    }

    console.log(`Page ${page}: ${sos.length} fetched, ${allSOs.length} matched 2026`);
    page++;
    await new Promise((r) => setTimeout(r, 500));
  }

  return allSOs;
}

async function fetchSODetail(accessToken: string, soId: string): Promise<LineItem[]> {
  const url = `https://www.zohoapis.com/inventory/v1/salesorders/${soId}?organization_id=${orgId}`;
  const res = await fetch(url, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  const data = (await res.json()) as {
    salesorder?: { line_items?: Array<Record<string, unknown>> };
  };

  return (data.salesorder?.line_items || []).map((li) => ({
    name: String(li.name || ""),
    sku: String(li.sku || ""),
    quantity: Number(li.quantity || 0),
    rate: Number(li.rate || 0),
    amount: Number(li.amount || 0),
    description: String(li.description || ""),
  }));
}

const ADMIN_ITEMS = [
  "permit fees", "interconnection fees", "design engineering",
  "inventory no po", "critter guard",
];

function isEquipmentItem(name: string): boolean {
  const lower = name.toLowerCase();
  return !ADMIN_ITEMS.some((admin) => lower.includes(admin));
}

async function main() {
  console.log("Authenticating with Zoho...");
  const accessToken = await getAccessToken();

  console.log("Fetching all 2026 Sales Order summaries...");
  const summaries = await fetchAllSOSummaries(accessToken);
  console.log(`\nFound ${summaries.length} Sales Orders in 2026\n`);

  // Fetch details for each SO
  const details: SODetail[] = [];
  for (let i = 0; i < summaries.length; i++) {
    const so = summaries[i];
    const lineItems = await fetchSODetail(accessToken, so.salesorder_id);
    details.push({ ...so, line_items: lineItems });

    if ((i + 1) % 10 === 0 || i === summaries.length - 1) {
      console.log(`Fetched details: ${i + 1}/${summaries.length} (${lineItems.length} items in ${so.salesorder_number})`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  // Aggregate items
  const itemMap = new Map<string, {
    name: string;
    sku: string;
    timesUsed: number;
    totalQty: number;
    soNumbers: string[];
    isEquipment: boolean;
  }>();

  let totalLineItems = 0;
  for (const so of details) {
    for (const li of so.line_items) {
      totalLineItems++;
      const key = li.sku ? `${li.name}|||${li.sku}` : li.name;
      const existing = itemMap.get(key);
      if (existing) {
        existing.timesUsed++;
        existing.totalQty += li.quantity;
        if (!existing.soNumbers.includes(so.salesorder_number)) {
          existing.soNumbers.push(so.salesorder_number);
        }
      } else {
        itemMap.set(key, {
          name: li.name,
          sku: li.sku,
          timesUsed: 1,
          totalQty: li.quantity,
          soNumbers: [so.salesorder_number],
          isEquipment: isEquipmentItem(li.name),
        });
      }
    }
  }

  console.log(`\nTotal line items across all SOs: ${totalLineItems}`);
  console.log(`Unique items: ${itemMap.size}`);

  const sortedItems = [...itemMap.values()].sort((a, b) => b.timesUsed - a.timesUsed);

  // Output JSON
  const output = {
    summary: {
      totalSOs: details.length,
      totalLineItems,
      uniqueItems: itemMap.size,
      dateRange: details.length
        ? `${details[0].date} to ${details[details.length - 1].date}`
        : "N/A",
    },
    salesOrders: details.map((so) => ({
      so_number: so.salesorder_number,
      reference: so.reference_number,
      customer: so.customer_name,
      date: so.date,
      status: so.status,
      total: so.total,
      location: so.delivery_method,
      item_count: so.line_items.length,
      items: so.line_items.map((li) => ({
        name: li.name,
        sku: li.sku,
        qty: li.quantity,
        rate: li.rate,
        amount: li.amount,
      })),
    })),
    itemFrequency: sortedItems.map((item) => ({
      name: item.name,
      sku: item.sku,
      times_used: item.timesUsed,
      total_qty: item.totalQty,
      unique_sos: item.soNumbers.length,
      is_equipment: item.isEquipment,
      so_numbers: item.soNumbers.join(", "),
    })),
  };

  const fs = await import("fs");
  fs.writeFileSync("scripts/2026-so-review.json", JSON.stringify(output, null, 2));
  console.log(`\nData written to scripts/2026-so-review.json`);

  console.log("\n=== Top 25 Most Used Items ===");
  console.log(
    "Item Name".padEnd(55) + "SKU".padEnd(22) + "Used".padEnd(8) + "Total Qty".padEnd(12) + "Equip?"
  );
  console.log("-".repeat(105));
  for (const item of sortedItems.slice(0, 25)) {
    console.log(
      item.name.substring(0, 53).padEnd(55) +
      (item.sku || "-").substring(0, 20).padEnd(22) +
      String(item.timesUsed).padEnd(8) +
      String(item.totalQty).padEnd(12) +
      (item.isEquipment ? "Yes" : "No")
    );
  }
}

main().catch(console.error);
