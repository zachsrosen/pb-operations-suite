/**
 * Tests for Zoho customer cache load deduplication.
 *
 * Verifies that concurrent cold-cache requests share a single
 * loadAllCustomers() call rather than stampeding Zoho's API.
 */

// Mock zoho-inventory before importing the cache module
const mockFetchCustomerPage = jest.fn();
jest.mock("@/lib/zoho-inventory", () => ({
  zohoInventory: {
    fetchCustomerPage: mockFetchCustomerPage,
  },
}));

import {
  ensureCustomerCacheLoaded,
  searchCustomersByName,
  __resetForTest,
} from "@/lib/zoho-customer-cache";

beforeEach(() => {
  jest.clearAllMocks();
  __resetForTest();

  // Default: return one page of customers, then signal no more pages
  mockFetchCustomerPage.mockImplementation(async (page: number) => {
    // Small delay to simulate network
    await new Promise((r) => setTimeout(r, 30));
    if (page === 1) {
      return {
        contacts: [
          { contact_id: "zc-1", contact_name: "Acme Solar", email: "acme@test.com" },
          { contact_id: "zc-2", contact_name: "Beta Energy", email: "beta@test.com" },
        ],
        hasMore: false,
      };
    }
    return { contacts: [], hasMore: false };
  });
});

afterEach(() => {
  __resetForTest();
});

describe("Zoho customer cache load deduplication", () => {
  it("deduplicates concurrent cold-cache loads into one fetch cycle", async () => {
    // Fire 5 concurrent ensureCustomerCacheLoaded() calls on a cold cache
    await Promise.all([
      ensureCustomerCacheLoaded(),
      ensureCustomerCacheLoaded(),
      ensureCustomerCacheLoaded(),
      ensureCustomerCacheLoaded(),
      ensureCustomerCacheLoaded(),
    ]);

    // fetchCustomerPage should have been called for ONE load cycle only.
    // BATCH_SIZE = 10, so pages 1-10 are fetched in parallel for the first batch.
    // But since page 1 returns hasMore: false, only 10 calls total (one batch).
    expect(mockFetchCustomerPage).toHaveBeenCalledTimes(10);

    // Cache should be warm — subsequent search should work
    const results = searchCustomersByName("Acme");
    expect(results).toHaveLength(1);
    expect(results[0].contact_name).toBe("Acme Solar");
  });

  it("propagates load failure to all concurrent callers", async () => {
    mockFetchCustomerPage.mockRejectedValue(new Error("rate limited"));

    const results = await Promise.allSettled([
      ensureCustomerCacheLoaded(),
      ensureCustomerCacheLoaded(),
      ensureCustomerCacheLoaded(),
    ]);

    for (const result of results) {
      expect(result.status).toBe("rejected");
    }
  });

  it("allows a fresh load attempt after a failure", async () => {
    mockFetchCustomerPage.mockRejectedValue(new Error("transient error"));

    // First attempt fails
    await expect(ensureCustomerCacheLoaded()).rejects.toThrow();

    // Reset mock to succeed
    __resetForTest();
    mockFetchCustomerPage.mockImplementation(async (page: number) => {
      if (page === 1) {
        return {
          contacts: [{ contact_id: "zc-99", contact_name: "Recovered Inc" }],
          hasMore: false,
        };
      }
      return { contacts: [], hasMore: false };
    });

    // Second attempt should succeed
    await ensureCustomerCacheLoaded();
    const results = searchCustomersByName("Recovered");
    expect(results).toHaveLength(1);
  });

  it("does not re-fetch when cache is warm", async () => {
    // First load
    await ensureCustomerCacheLoaded();
    const firstCallCount = mockFetchCustomerPage.mock.calls.length;

    // Second call should be a no-op
    await ensureCustomerCacheLoaded();
    expect(mockFetchCustomerPage).toHaveBeenCalledTimes(firstCallCount);
  });
});
