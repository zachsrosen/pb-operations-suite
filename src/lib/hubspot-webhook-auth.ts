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
 * Validate a HubSpot webhook signature (v3).
 *
 * Returns `{ valid: true }` on success, or `{ valid: false, error }` on failure.
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

  // 2. Build the source string: method + URL + body + timestamp
  const sourceString =
    params.method.toUpperCase() +
    params.requestUrl +
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
    if (sigBuffer.length !== expectedBuffer.length) {
      return { valid: false, error: "Signature length mismatch" };
    }
    if (!crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
      return { valid: false, error: "Signature mismatch" };
    }
  } catch {
    return { valid: false, error: "Signature comparison failed" };
  }

  return { valid: true };
}
