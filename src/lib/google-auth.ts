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

/**
 * Per-instance token cache.
 *
 * Tokens are minted via signed-JWT bearer-grant; each mint requires an RSA
 * sign + a round-trip to `oauth2.googleapis.com/token`. A single PE audit
 * triggers ~50-100 Drive calls; without caching, that's an OAuth token-mint
 * storm against Google's rate limits and a major latency tax.
 *
 * Cache key = `${scopes-joined}|${impersonateEmail ?? ""}`. Tokens live for
 * 60 minutes; we refresh at 55. Concurrent callers during a cache miss get
 * the same in-flight Promise so we mint once, not N times.
 */
interface CachedToken {
  token: string;
  /** Epoch ms when this cached value should be considered expired. */
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();
const inflight = new Map<string, Promise<string>>();

const TOKEN_TTL_MS = 55 * 60 * 1000; // refresh at 55min (Google issues 60min tokens)

/** Test-only — clear the cache between tests. */
export function _resetTokenCacheForTests(): void {
  tokenCache.clear();
  inflight.clear();
}

export async function getServiceAccountToken(
  scopes: string[],
  impersonateEmail?: string,
): Promise<string> {
  const cacheKey = `${[...scopes].sort().join(",")}|${impersonateEmail ?? ""}`;

  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  // De-duplicate concurrent cache misses for the same key.
  const existing = inflight.get(cacheKey);
  if (existing) return existing;

  const promise = mintServiceAccountToken(scopes, impersonateEmail)
    .then((token) => {
      tokenCache.set(cacheKey, { token, expiresAt: Date.now() + TOKEN_TTL_MS });
      return token;
    })
    .finally(() => {
      inflight.delete(cacheKey);
    });

  inflight.set(cacheKey, promise);
  return promise;
}

async function mintServiceAccountToken(scopes: string[], impersonateEmail?: string): Promise<string> {
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
  const data = (await res.json()) as { access_token?: string; error?: string };
  if (!data.access_token) throw new Error(`Google token error: ${data.error ?? "unknown"}`);
  return data.access_token;
}
