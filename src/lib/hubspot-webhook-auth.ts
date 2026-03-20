/**
 * HubSpot Webhook Signature Validation
 *
 * Validates incoming HubSpot webhook requests using v3 signature verification.
 * HubSpot signs webhooks with HMAC SHA-256 using the app's client secret.
 *
 * Signature v3: SHA-256 HMAC of (requestMethod + requestUri + requestBody + timestamp)
 * Header: X-HubSpot-Signature-v3
 * Timestamp: X-HubSpot-Request-Timestamp
 *
 * @see https://developers.hubspot.com/docs/api/webhooks#security
 */

import crypto from "crypto";

/** Maximum age (in ms) of a valid webhook request — 5 minutes. */
const MAX_TIMESTAMP_AGE_MS = 5 * 60 * 1000;

export interface WebhookValidationParams {
  /** The raw request body string (NOT parsed JSON). */
  rawBody: string;
  /** Value of X-HubSpot-Signature-v3 header. */
  signature: string;
  /** Value of X-HubSpot-Request-Timestamp header. */
  timestamp: string;
  /** The full request URL (method + URI used in signature). */
  requestUrl: string;
  /** HTTP method (uppercase). */
  method: string;
}

export interface WebhookValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Normalize the request URL to match what HubSpot signed against.
 *
 * On Vercel, `req.url` may use internal hostnames or http:// instead of
 * the custom domain HubSpot actually sent to. This reconstructs the
 * canonical URL using WEBHOOK_CANONICAL_BASE_URL or NEXTAUTH_URL.
 */
function normalizeRequestUrl(requestUrl: string): string {
  const canonicalBase =
    process.env.WEBHOOK_CANONICAL_BASE_URL || process.env.NEXTAUTH_URL;
  if (!canonicalBase) return requestUrl;

  try {
    const incoming = new URL(requestUrl);
    const canonical = new URL(canonicalBase);
    // Replace scheme + host with canonical, keep path + query
    return `${canonical.protocol}//${canonical.host}${incoming.pathname}${incoming.search}`;
  } catch {
    return requestUrl;
  }
}

/**
 * Validate a HubSpot webhook signature (v3).
 *
 * Returns `{ valid: true }` on success, or `{ valid: false, error }` on failure.
 *
 * Tries the request URL as-is first, then falls back to a canonical URL
 * normalization to handle Vercel domain mismatches.
 */
export function validateHubSpotWebhook(
  params: WebhookValidationParams,
): WebhookValidationResult {
  const secret = process.env.HUBSPOT_WEBHOOK_SECRET;
  if (!secret) {
    return { valid: false, error: "HUBSPOT_WEBHOOK_SECRET not configured" };
  }

  // 1. Check timestamp freshness
  const tsMs = Number(params.timestamp);
  if (!Number.isFinite(tsMs)) {
    return { valid: false, error: "Invalid timestamp header" };
  }
  const age = Date.now() - tsMs;
  if (Math.abs(age) > MAX_TIMESTAMP_AGE_MS) {
    const direction = age > 0 ? "old" : "in the future";
    return { valid: false, error: `Timestamp too ${direction} (${Math.round(Math.abs(age) / 1000)}s)` };
  }

  // 2. Try signature with original URL first, then canonical URL
  const urlsToTry = [params.requestUrl];
  const normalizedUrl = normalizeRequestUrl(params.requestUrl);
  if (normalizedUrl !== params.requestUrl) {
    urlsToTry.push(normalizedUrl);
  }

  for (const url of urlsToTry) {
    const sourceString =
      params.method.toUpperCase() +
      url +
      params.rawBody +
      params.timestamp;

    // 3. Compute HMAC SHA-256
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(sourceString, "utf8")
      .digest("base64");

    // 4. Constant-time comparison
    try {
      const sigBuffer = Buffer.from(params.signature, "base64");
      const expectedBuffer = Buffer.from(expectedSignature, "base64");
      if (
        sigBuffer.length === expectedBuffer.length &&
        crypto.timingSafeEqual(sigBuffer, expectedBuffer)
      ) {
        if (url !== params.requestUrl) {
          console.log(`[webhook-auth] Signature matched using canonical URL: ${url} (original: ${params.requestUrl})`);
        }
        return { valid: true };
      }
    } catch {
      // Try next URL
    }
  }

  // Log the URLs we tried for debugging
  console.warn(`[webhook-auth] Signature validation failed. URLs tried: ${urlsToTry.join(", ")}`);
  return { valid: false, error: "Signature mismatch" };
}
