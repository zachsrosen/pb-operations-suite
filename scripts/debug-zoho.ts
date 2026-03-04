import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const clientId = process.env.ZOHO_INVENTORY_CLIENT_ID;
const clientSecret = process.env.ZOHO_INVENTORY_CLIENT_SECRET;
const refreshToken = process.env.ZOHO_INVENTORY_REFRESH_TOKEN;
const orgId = process.env.ZOHO_INVENTORY_ORG_ID;

async function main() {
  const tokenRes = await fetch("https://accounts.zoho.com/oauth/v2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId || "",
      client_secret: clientSecret || "",
      refresh_token: refreshToken || "",
    }),
  });
  const tokenData = await tokenRes.json() as Record<string, unknown>;

  // Print full scope
  console.log("Scopes:", tokenData.scope);
  console.log("Token type:", tokenData.token_type);

  const accessToken = tokenData.access_token as string;

  // Try with .com vs .in - Zoho has different data centers
  for (const base of ["https://www.zohoapis.com", "https://www.zohoapis.in", "https://www.zohoapis.eu"]) {
    const url = `${base}/inventory/v1/salesorders?organization_id=${orgId}&page=1&per_page=2`;
    const res = await fetch(url, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    });
    const text = await res.text();
    console.log(`\n${base}: status=${res.status}, body=${text.substring(0, 200)}`);
  }

  // Also try the items endpoint to see if READ works there
  const itemsUrl = `https://www.zohoapis.com/inventory/v1/items?organization_id=${orgId}&page=1&per_page=2`;
  const itemsRes = await fetch(itemsUrl, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  const itemsText = await itemsRes.text();
  console.log(`\nItems endpoint: status=${itemsRes.status}, body=${itemsText.substring(0, 300)}`);
}

main().catch(console.error);
