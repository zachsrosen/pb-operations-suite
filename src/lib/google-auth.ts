// src/lib/google-auth.ts
// Shared Google service account JWT helper — used by Drive, Gmail, Calendar

import crypto from "crypto";

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function parsePrivateKey(raw: string): string {
  // Handle \n-escaped keys stored as a single line in env vars
  const normalizedRaw = raw.replace(/\\n/g, "\n").trim();
  if (normalizedRaw.includes("-----BEGIN")) {
    return normalizedRaw;
  }

  // Fallback: try base64-decoding (some providers store the key base64-encoded)
  const decoded = Buffer.from(raw, "base64").toString("utf-8");
  const normalizedDecoded = decoded.replace(/\\n/g, "\n").trim();
  if (normalizedDecoded.includes("-----BEGIN")) {
    return normalizedDecoded;
  }

  return normalizedRaw;
}

async function signRS256(input: string, privateKeyPem: string): Promise<string> {
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(input);
  sign.end();
  const sig = sign.sign(privateKeyPem, "base64");
  return sig.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export async function getServiceAccountToken(scopes: string[], impersonateEmail?: string): Promise<string> {
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!serviceAccountEmail || !rawKey) throw new Error("Google service account credentials not configured");

  const privateKey = parsePrivateKey(rawKey);
  const now = Math.floor(Date.now() / 1000);
  const claims: Record<string, unknown> = {
    iss: serviceAccountEmail,
    scope: scopes.join(" "),
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  if (impersonateEmail) claims.sub = impersonateEmail;

  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64UrlEncode(JSON.stringify(claims));
  const sig = await signRS256(`${header}.${payload}`, privateKey);
  const jwt = `${header}.${payload}.${sig}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const data = await res.json() as { access_token?: string; error?: string };
  if (!data.access_token) throw new Error(`Google token error: ${data.error ?? "unknown"}`);
  return data.access_token;
}
