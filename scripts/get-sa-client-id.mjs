import fs from "fs";
import crypto from "crypto";

// Load .env.local
const lines = fs.readFileSync(".env.local", "utf-8").split("\n");
for (const line of lines) {
  const match = line.match(/^([^#=]+)=(.*)/);
  if (match) {
    let val = match[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[match[1].trim()] = val;
  }
}

const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
const saEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;

let privateKey = null;
if (rawKey) {
  try {
    const decoded = Buffer.from(rawKey, "base64").toString("utf-8");
    if (decoded.includes("-----BEGIN")) privateKey = decoded;
  } catch {}
  if (!privateKey) {
    const raw = rawKey.replace(/\\n/g, "\n");
    if (raw.includes("-----BEGIN")) privateKey = raw;
  }
}

if (!privateKey || !saEmail) {
  console.log("Missing key or email");
  process.exit(1);
}

// Get a self-signed token (no impersonation) to query the service account info
const now = Math.floor(Date.now() / 1000);
const b64url = (s) =>
  Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
const claims = b64url(
  JSON.stringify({
    iss: saEmail,
    // No 'sub' - this is a direct service account token, not impersonation
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })
);

const sign = crypto.createSign("RSA-SHA256");
sign.update(`${header}.${claims}`);
sign.end();
const signature = sign
  .sign(privateKey, "base64")
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .replace(/=/g, "");

const jwt = `${header}.${claims}.${signature}`;

const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt,
  }),
});

const tokenData = await tokenRes.json();

if (!tokenData.access_token) {
  console.log("Token exchange failed:", tokenData.error, tokenData.error_description);

  // Alternative: try to decode the access_token to find sub/client_id
  // Or query the tokeninfo endpoint
  console.log("\nTrying tokeninfo endpoint with the JWT itself...");

  // Let's also check if domain-wide delegation is even enabled
  // by trying a token with no sub (direct service account auth)
  const claims2 = b64url(
    JSON.stringify({
      iss: saEmail,
      scope: "https://www.googleapis.com/auth/iam",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );

  const sign2 = crypto.createSign("RSA-SHA256");
  sign2.update(`${header}.${claims2}`);
  sign2.end();
  const sig2 = sign2
    .sign(privateKey, "base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  const jwt2 = `${header}.${claims2}.${sig2}`;
  const tokenRes2 = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt2,
    }),
  });
  const tokenData2 = await tokenRes2.json();

  if (tokenData2.access_token) {
    console.log("Got direct SA token (no impersonation) - the SA key is valid");

    // Now query the service account details
    const projectId = saEmail.split("@")[1].split(".")[0];
    const saRes = await fetch(
      `https://iam.googleapis.com/v1/projects/${projectId}/serviceAccounts/${encodeURIComponent(saEmail)}`,
      { headers: { Authorization: `Bearer ${tokenData2.access_token}` } }
    );
    if (saRes.ok) {
      const saData = await saRes.json();
      console.log("\n========================================");
      console.log("Service Account Details:");
      console.log(`  Email: ${saData.email}`);
      console.log(`  Unique ID (Client ID): ${saData.uniqueId}`);
      console.log(`  Display Name: ${saData.displayName || "(none)"}`);
      console.log(`  OAuth2 Client ID: ${saData.oauth2ClientId || saData.uniqueId}`);
      console.log("========================================");
      console.log("\nUse this Client ID in Google Admin > Domain-wide Delegation:");
      console.log(`  ${saData.uniqueId}`);
      console.log("\nWith these scopes:");
      console.log("  https://www.googleapis.com/auth/gmail.send,https://www.googleapis.com/auth/calendar.events");
    } else {
      const errText = await saRes.text();
      console.log("Failed to query SA details:", saRes.status, errText.slice(0, 300));
    }
  } else {
    console.log("Direct SA token also failed:", tokenData2.error, tokenData2.error_description);
    console.log("The service account key may be invalid or the IAM API is not enabled.");
  }

  process.exit(0);
}

// If we got a cloud-platform token, query SA info
const projectId = saEmail.split("@")[1].split(".")[0];
const saRes = await fetch(
  `https://iam.googleapis.com/v1/projects/${projectId}/serviceAccounts/${encodeURIComponent(saEmail)}`,
  { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
);

if (saRes.ok) {
  const saData = await saRes.json();
  console.log("========================================");
  console.log("Service Account Details:");
  console.log(`  Email: ${saData.email}`);
  console.log(`  Unique ID (Client ID): ${saData.uniqueId}`);
  console.log(`  Display Name: ${saData.displayName || "(none)"}`);
  console.log("========================================");
  console.log("\nUse this Client ID in Google Admin > Domain-wide Delegation:");
  console.log(`  ${saData.uniqueId}`);
  console.log("\nWith these scopes:");
  console.log("  https://www.googleapis.com/auth/gmail.send,https://www.googleapis.com/auth/calendar.events");
} else {
  const errText = await saRes.text();
  console.log("Failed to query SA:", saRes.status, errText.slice(0, 300));
}
