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

// Get a direct (non-impersonated) token and then check tokeninfo
const now = Math.floor(Date.now() / 1000);
const b64url = (s) =>
  Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
const claims = b64url(
  JSON.stringify({
    iss: saEmail,
    scope: "openid email",
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

if (tokenData.access_token) {
  // Query tokeninfo to get the client ID
  const infoRes = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?access_token=${tokenData.access_token}`
  );
  const info = await infoRes.json();
  console.log("Token Info:");
  console.log(JSON.stringify(info, null, 2));
  console.log("\n========================================");
  console.log("Use this as the Client ID in Domain-wide Delegation:");
  // The azp field is the OAuth2 client ID
  console.log(`  ${info.azp || info.aud || "Not found in tokeninfo"}`);
  console.log("\nScopes to authorize:");
  console.log("  https://www.googleapis.com/auth/gmail.send,https://www.googleapis.com/auth/calendar.events");
  console.log("========================================");
} else {
  console.log("Token exchange failed:", tokenData.error, tokenData.error_description);
}
