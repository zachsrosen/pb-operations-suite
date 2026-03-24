/**
 * Tests for Zoho token refresh deduplication.
 *
 * Verifies that concurrent calls to getAccessToken() share a single
 * in-flight OAuth request rather than stampeding Zoho's token endpoint.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { zohoInventory } from "@/lib/zoho-inventory";

// Access private methods/fields via the instance for testing
const client = zohoInventory as any;

// Track how many times executeTokenRefresh is called
let refreshCallCount: number;
let refreshDelay: number;
let refreshShouldFail: boolean;
const originalExecuteTokenRefresh = client.executeTokenRefresh.bind(client);

beforeEach(() => {
  refreshCallCount = 0;
  refreshDelay = 50;
  refreshShouldFail = false;

  // Reset token state to force refresh
  client.dynamicAccessToken = undefined;
  client.dynamicTokenExpiresAtMs = 0;
  client.inflightRefresh = undefined;

  // Ensure refresh credentials are present (mock values)
  client.refreshToken = "mock-refresh-token";
  client.clientId = "mock-client-id";
  client.clientSecret = "mock-client-secret";

  // Spy on executeTokenRefresh to count calls and control behavior
  jest.spyOn(client, "executeTokenRefresh").mockImplementation(async () => {
    refreshCallCount += 1;
    await new Promise((r) => setTimeout(r, refreshDelay));
    if (refreshShouldFail) {
      throw new Error("Failed to refresh Zoho Inventory token (Access Denied)");
    }
    client.dynamicAccessToken = `token-${refreshCallCount}`;
    client.dynamicTokenExpiresAtMs = Date.now() + 3600_000;
    return client.dynamicAccessToken;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  // Clean up token state
  client.dynamicAccessToken = undefined;
  client.dynamicTokenExpiresAtMs = 0;
  client.inflightRefresh = undefined;
});

describe("Zoho token refresh deduplication", () => {
  it("deduplicates concurrent refresh calls into a single request", async () => {
    // Fire 5 concurrent getAccessToken() calls with no cached token
    const results = await Promise.all([
      client.getAccessToken(),
      client.getAccessToken(),
      client.getAccessToken(),
      client.getAccessToken(),
      client.getAccessToken(),
    ]);

    // All should get the same token
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe("token-1");

    // Only ONE actual refresh should have been made
    expect(refreshCallCount).toBe(1);
  });

  it("clears inflight promise after successful refresh", async () => {
    await client.getAccessToken();
    expect(client.inflightRefresh).toBeUndefined();
  });

  it("clears inflight promise after failed refresh", async () => {
    refreshShouldFail = true;

    await expect(client.getAccessToken()).rejects.toThrow("Access Denied");

    // The inflight promise MUST be cleared so the next attempt can retry
    expect(client.inflightRefresh).toBeUndefined();
  });

  it("propagates refresh failure to all waiting callers", async () => {
    refreshShouldFail = true;

    const results = await Promise.allSettled([
      client.getAccessToken(),
      client.getAccessToken(),
      client.getAccessToken(),
    ]);

    // All callers should get the same rejection
    for (const result of results) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") {
        expect(result.reason.message).toContain("Access Denied");
      }
    }

    // Still only one refresh attempt
    expect(refreshCallCount).toBe(1);
  });

  it("allows a fresh refresh after a failed one", async () => {
    refreshShouldFail = true;
    await expect(client.getAccessToken()).rejects.toThrow("Access Denied");
    expect(refreshCallCount).toBe(1);

    // Now succeed on the next attempt
    refreshShouldFail = false;
    const token = await client.getAccessToken();
    expect(token).toBe("token-2");
    expect(refreshCallCount).toBe(2);
  });

  it("skips refresh when cached token is still valid", async () => {
    // Pre-populate a valid cached token
    client.dynamicAccessToken = "cached-token";
    client.dynamicTokenExpiresAtMs = Date.now() + 60_000;

    const results = await Promise.all([
      client.getAccessToken(),
      client.getAccessToken(),
      client.getAccessToken(),
    ]);

    // Should use cached token, no refresh calls
    expect(results).toEqual(["cached-token", "cached-token", "cached-token"]);
    expect(refreshCallCount).toBe(0);
  });
});
