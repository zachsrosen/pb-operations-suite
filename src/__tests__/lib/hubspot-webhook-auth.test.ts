/**
 * Tests for HubSpot Webhook Signature Validation
 *
 * Covers:
 *   - Valid signature passes
 *   - Wrong signature fails
 *   - Expired timestamp fails
 *   - Missing secret fails
 *   - Tampered body fails
 */

import crypto from "crypto";
import { validateHubSpotWebhook } from "@/lib/hubspot-webhook-auth";

const TEST_SECRET = "test-webhook-secret-abc123";

function makeSignature(params: {
  method: string;
  url: string;
  body: string;
  timestamp: string;
  secret?: string;
}): string {
  const source =
    params.method.toUpperCase() +
    params.url +
    params.body +
    params.timestamp;
  return crypto
    .createHmac("sha256", params.secret ?? TEST_SECRET)
    .update(source, "utf8")
    .digest("base64");
}

describe("validateHubSpotWebhook", () => {
  const originalEnv = process.env.HUBSPOT_WEBHOOK_SECRET;

  beforeEach(() => {
    process.env.HUBSPOT_WEBHOOK_SECRET = TEST_SECRET;
  });

  afterAll(() => {
    if (originalEnv !== undefined) {
      process.env.HUBSPOT_WEBHOOK_SECRET = originalEnv;
    } else {
      delete process.env.HUBSPOT_WEBHOOK_SECRET;
    }
  });

  const METHOD = "POST";
  const URL = "https://example.com/api/webhooks/hubspot/design-complete";
  const BODY = JSON.stringify([{ eventId: 1, objectId: 123, subscriptionType: "deal.propertyChange" }]);

  it("accepts a valid signature", () => {
    const timestamp = String(Date.now());
    const signature = makeSignature({ method: METHOD, url: URL, body: BODY, timestamp });

    const result = validateHubSpotWebhook({
      rawBody: BODY,
      signature,
      timestamp,
      requestUrl: URL,
      method: METHOD,
    });

    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("rejects a wrong signature", () => {
    const timestamp = String(Date.now());
    const signature = makeSignature({
      method: METHOD,
      url: URL,
      body: BODY,
      timestamp,
      secret: "wrong-secret",
    });

    const result = validateHubSpotWebhook({
      rawBody: BODY,
      signature,
      timestamp,
      requestUrl: URL,
      method: METHOD,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/mismatch/i);
  });

  it("rejects a tampered body", () => {
    const timestamp = String(Date.now());
    const signature = makeSignature({ method: METHOD, url: URL, body: BODY, timestamp });

    const result = validateHubSpotWebhook({
      rawBody: BODY + "tampered",
      signature,
      timestamp,
      requestUrl: URL,
      method: METHOD,
    });

    expect(result.valid).toBe(false);
  });

  it("rejects an expired timestamp (>5 min)", () => {
    const oldTimestamp = String(Date.now() - 6 * 60 * 1000); // 6 minutes ago
    const signature = makeSignature({ method: METHOD, url: URL, body: BODY, timestamp: oldTimestamp });

    const result = validateHubSpotWebhook({
      rawBody: BODY,
      signature,
      timestamp: oldTimestamp,
      requestUrl: URL,
      method: METHOD,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/too old/i);
  });

  it("rejects when HUBSPOT_WEBHOOK_SECRET is not set", () => {
    delete process.env.HUBSPOT_WEBHOOK_SECRET;

    const timestamp = String(Date.now());
    const signature = makeSignature({ method: METHOD, url: URL, body: BODY, timestamp });

    const result = validateHubSpotWebhook({
      rawBody: BODY,
      signature,
      timestamp,
      requestUrl: URL,
      method: METHOD,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/not configured/i);
  });

  it("rejects an invalid timestamp value", () => {
    const result = validateHubSpotWebhook({
      rawBody: BODY,
      signature: "irrelevant",
      timestamp: "not-a-number",
      requestUrl: URL,
      method: METHOD,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/invalid timestamp/i);
  });

  it("rejects a future timestamp (>5 min ahead)", () => {
    const futureTimestamp = String(Date.now() + 6 * 60 * 1000); // 6 minutes in the future
    const signature = makeSignature({ method: METHOD, url: URL, body: BODY, timestamp: futureTimestamp });

    const result = validateHubSpotWebhook({
      rawBody: BODY,
      signature,
      timestamp: futureTimestamp,
      requestUrl: URL,
      method: METHOD,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/future/i);
  });

  it("accepts a timestamp at the boundary (just under 5 min)", () => {
    const justUnder5Min = String(Date.now() - 4 * 60 * 1000 - 50 * 1000); // 4m50s ago
    const signature = makeSignature({ method: METHOD, url: URL, body: BODY, timestamp: justUnder5Min });

    const result = validateHubSpotWebhook({
      rawBody: BODY,
      signature,
      timestamp: justUnder5Min,
      requestUrl: URL,
      method: METHOD,
    });

    expect(result.valid).toBe(true);
  });
});
