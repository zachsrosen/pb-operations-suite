import fs from "fs";
import crypto from "crypto";

// Load .env.local
const lines = fs.readFileSync(".env.local", "utf-8").split("\n");
for (const line of lines) {
  const match = line.match(/^([^#=]+)=(.*)/);
  if (match) {
    let val = match[2].trim();
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[match[1].trim()] = val;
  }
}

console.log("=== 1. ENV VARS ===");
const vars = [
  "GOOGLE_WORKSPACE_EMAIL_ENABLED",
  "GOOGLE_CALENDAR_SYNC_ENABLED",
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_ADMIN_EMAIL",
  "GOOGLE_EMAIL_SENDER",
  "EMAIL_FROM",
  "GOOGLE_SITE_SURVEY_CALENDAR_ID",
  "RESEND_API_KEY",
];
for (const v of vars) {
  const val = process.env[v];
  if (!val) {
    console.log(`  ${v}: NOT SET`);
  } else if (v.includes("KEY") || v.includes("PRIVATE")) {
    console.log(`  ${v}: set (${val.length} chars)`);
  } else {
    console.log(`  ${v}: ${val}`);
  }
}

// 2. Sender email
console.log("\n=== 2. SENDER EMAIL ===");
const parseEmail = (s) => {
  if (!s) return null;
  const m = s.trim().match(/<([^>]+)>/);
  const c = (m ? m[1] : s).trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c) ? c : null;
};
const senderEmail =
  parseEmail(process.env.GOOGLE_EMAIL_SENDER) ||
  parseEmail(process.env.EMAIL_FROM) ||
  parseEmail(process.env.GOOGLE_ADMIN_EMAIL);
console.log(`  Resolved: ${senderEmail || "NONE - will fail"}`);

// 3. Private key
console.log("\n=== 3. PRIVATE KEY ===");
const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
let privateKey = null;
if (rawKey) {
  // Try base64 decode first
  try {
    const decoded = Buffer.from(rawKey, "base64").toString("utf-8");
    if (decoded.includes("-----BEGIN")) {
      privateKey = decoded;
      console.log("  Decoded from base64");
    }
  } catch {}
  // Try raw with newline replacement
  if (!privateKey) {
    const raw = rawKey.replace(/\\n/g, "\n");
    if (raw.includes("-----BEGIN")) {
      privateKey = raw;
      console.log("  Parsed with newline replacement");
    }
  }
  if (privateKey) {
    console.log(`  OK (${privateKey.split("\n").length} lines)`);
  } else {
    console.log("  FAILED - no PEM markers found");
    console.log(`  First 80 chars: ${rawKey.slice(0, 80)}`);
  }
} else {
  console.log("  NOT SET");
}

// 4. JWT signing
console.log("\n=== 4. JWT SIGNING ===");
if (privateKey) {
  try {
    const sign = crypto.createSign("RSA-SHA256");
    sign.update("test");
    sign.end();
    const sig = sign.sign(privateKey, "base64");
    console.log(`  OK (sig: ${sig.slice(0, 20)}...)`);
  } catch (err) {
    console.log(`  FAILED: ${err.message}`);
  }
} else {
  console.log("  Skipped (no key)");
}

// 5. Gmail token exchange
console.log("\n=== 5. GMAIL TOKEN EXCHANGE ===");
const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;

if (privateKey && serviceAccountEmail && senderEmail) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const b64url = (s) =>
      Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

    const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = b64url(
      JSON.stringify({
        iss: serviceAccountEmail,
        sub: senderEmail,
        scope: "https://www.googleapis.com/auth/gmail.send",
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
      console.log(`  OK - got access token (expires in ${tokenData.expires_in}s)`);

      // Test: read sender's Gmail profile
      const profileRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(senderEmail)}/profile`,
        { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
      );
      if (profileRes.ok) {
        const profile = await profileRes.json();
        console.log(`  Gmail profile: ${profile.emailAddress} (${profile.messagesTotal} messages)`);
      } else {
        const errText = await profileRes.text();
        console.log(`  Gmail profile FAILED: ${profileRes.status} ${errText.slice(0, 300)}`);
      }
    } else {
      console.log(`  FAILED: ${tokenData.error} - ${tokenData.error_description}`);
    }
  } catch (err) {
    console.log(`  EXCEPTION: ${err.message}`);
  }
} else {
  console.log(
    `  Skipped (missing: ${[!privateKey && "key", !serviceAccountEmail && "sa email", !senderEmail && "sender"].filter(Boolean).join(", ")})`
  );
}

// 6. Calendar token exchange
console.log("\n=== 6. CALENDAR TOKEN EXCHANGE ===");
if (privateKey && serviceAccountEmail && senderEmail) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const b64url = (s) =>
      Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

    const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = b64url(
      JSON.stringify({
        iss: serviceAccountEmail,
        sub: senderEmail,
        scope: "https://www.googleapis.com/auth/calendar.events",
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
      console.log(`  OK - got access token (expires in ${tokenData.expires_in}s)`);

      const calId = (process.env.GOOGLE_SITE_SURVEY_CALENDAR_ID || "primary").trim();
      console.log(`  Testing calendar: "${calId}"`);
      const calRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}`,
        { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
      );
      if (calRes.ok) {
        const cal = await calRes.json();
        console.log(`  Calendar accessible: "${cal.summary}" (${cal.id})`);
      } else {
        const errText = await calRes.text();
        console.log(`  Calendar access FAILED: ${calRes.status} ${errText.slice(0, 300)}`);
      }
    } else {
      console.log(`  FAILED: ${tokenData.error} - ${tokenData.error_description}`);
    }
  } catch (err) {
    console.log(`  EXCEPTION: ${err.message}`);
  }
} else {
  console.log("  Skipped");
}

console.log("\n=== DONE ===");
