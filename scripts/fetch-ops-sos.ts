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
      refresh_token: refreshToken || "",
    }),
  });
  const data = await res.json() as { access_token?: string };
  if (!data.access_token) {
    throw new Error("Failed to get access token: " + JSON.stringify(data));
  }
  return data.access_token;
}

interface SoResult {
  so_number: string;
  found: boolean;
  reference?: string;
  customer?: string;
  total?: number;
  item_count?: number;
  date?: string;
  delivery_method?: string;
  line_items?: Array<{ name: string; sku: string; quantity: number; rate: number }>;
}

async function fetchSO(accessToken: string, soNum: string): Promise<SoResult> {
  const url = `https://www.zohoapis.com/inventory/v1/salesorders?organization_id=${orgId}&salesorder_number=${soNum}`;
  const res = await fetch(url, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  const data = await res.json() as { salesorders?: Array<Record<string, unknown>> };

  if (data.salesorders?.length) {
    const so = data.salesorders[0] as Record<string, unknown>;
    const lineItems = (so.line_items as Array<Record<string, unknown>> || []).map((li) => ({
      name: String(li.name || ""),
      sku: String(li.sku || ""),
      quantity: Number(li.quantity || 0),
      rate: Number(li.rate || 0),
    }));
    return {
      so_number: String(so.salesorder_number),
      found: true,
      reference: String(so.reference_number || ""),
      customer: String(so.customer_name || ""),
      total: Number(so.total || 0),
      item_count: lineItems.length,
      date: String(so.date || ""),
      delivery_method: String(so.delivery_method || ""),
      line_items: lineItems,
    };
  }
  return { so_number: soNum, found: false };
}

const ALL_PROJ = [
  // Westminster
  "8841", "8615", "8587", "8550", "8505",
  // Centennial
  "8593", "8592", "8591", "8579", "8543",
  // Colorado Springs
  "8603", "8628", "8700", "8529", "8569",
  // SLO
  "8827", "8823", "8809", "8808", "8802",
  // Camarillo
  "8848", "8814", "8804", "8739", "8750",
];

async function main() {
  const accessToken = await getAccessToken();
  console.error("Got access token, fetching", ALL_PROJ.length, "SOs...");

  const results: SoResult[] = [];
  for (const num of ALL_PROJ) {
    const soNum = `SO-${num}`;
    try {
      const result = await fetchSO(accessToken, soNum);
      results.push(result);
      console.error(`  ${soNum}: ${result.found ? `found (${result.item_count} items, ${result.delivery_method})` : "NOT FOUND"}`);
    } catch (err) {
      console.error(`  ${soNum}: ERROR -`, err);
      results.push({ so_number: soNum, found: false });
    }
  }

  const found = results.filter((r) => r.found);
  const notFound = results.filter((r) => !r.found);
  console.error(`\nResults: ${found.length} found, ${notFound.length} not found`);
  if (notFound.length > 0) {
    console.error("Missing:", notFound.map((r) => r.so_number).join(", "));
  }

  // Write full results to stdout
  console.log(JSON.stringify(results, null, 2));
}

main().catch(console.error);
