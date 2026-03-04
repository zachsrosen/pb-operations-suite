import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

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
  if (!data.access_token) throw new Error("Token error: " + JSON.stringify(data));
  return data.access_token;
}

async function main() {
  const accessToken = await getAccessToken();

  // List first page of SOs to see the number format
  const url = `https://www.zohoapis.com/inventory/v1/salesorders?organization_id=${orgId}&page=1&per_page=10&sort_column=date&sort_order=D`;
  const res = await fetch(url, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  const data = await res.json() as { salesorders?: Array<Record<string, unknown>>; page_context?: Record<string, unknown> };

  console.log("Page context:", JSON.stringify(data.page_context, null, 2));
  console.log("\nRecent SOs:");
  for (const so of data.salesorders || []) {
    console.log(`  ${so.salesorder_number} | ref: ${so.reference_number} | ${so.customer_name} | ${so.date} | ${so.delivery_method}`);
  }

  // Also search by reference number containing PROJ for one known deal
  const searchUrl = `https://www.zohoapis.com/inventory/v1/salesorders?organization_id=${orgId}&reference_number=PROJ-8841`;
  const searchRes = await fetch(searchUrl, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  const searchData = await searchRes.json() as { salesorders?: Array<Record<string, unknown>> };
  console.log("\nSearch by reference PROJ-8841:", searchData.salesorders?.length || 0, "results");
  for (const so of searchData.salesorders || []) {
    console.log(`  ${so.salesorder_number} | ref: ${so.reference_number} | ${so.customer_name}`);
  }

  // Try search_text param
  const textUrl = `https://www.zohoapis.com/inventory/v1/salesorders?organization_id=${orgId}&search_text=8841`;
  const textRes = await fetch(textUrl, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  const textData = await textRes.json() as { salesorders?: Array<Record<string, unknown>> };
  console.log("\nText search '8841':", textData.salesorders?.length || 0, "results");
  for (const so of textData.salesorders || []) {
    console.log(`  ${so.salesorder_number} | ref: ${so.reference_number} | ${so.customer_name}`);
  }

  // Try customer name search
  const nameUrl = `https://www.zohoapis.com/inventory/v1/salesorders?organization_id=${orgId}&customer_name=Walker`;
  const nameRes = await fetch(nameUrl, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  const nameData = await nameRes.json() as { salesorders?: Array<Record<string, unknown>> };
  console.log("\nCustomer search 'Walker':", nameData.salesorders?.length || 0, "results");
  for (const so of nameData.salesorders || []) {
    console.log(`  ${so.salesorder_number} | ref: ${so.reference_number} | ${so.customer_name}`);
  }
}

main().catch(console.error);
