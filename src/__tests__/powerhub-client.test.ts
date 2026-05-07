/**
 * Tesla PowerHub API client tests.
 * Tests JWT auth flow, rate limiting, endpoint wrappers, and error handling.
 */
import {
  createPowerHubClient,
  type PowerHubClient,
} from "@/lib/tesla-powerhub";

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Env setup
const TEST_ENV = {
  POWERHUB_ENABLED: "true",
  TESLA_POWERHUB_INSTANCE_ID: "test-instance-id",
  TESLA_POWERHUB_API_KEY: "test-api-key-123",
  TESLA_POWERHUB_BASE_URL: "https://fleet-api.tesla.com",
};

beforeEach(() => {
  jest.resetAllMocks();
  Object.entries(TEST_ENV).forEach(([k, v]) => {
    process.env[k] = v;
  });
});

afterEach(() => {
  Object.keys(TEST_ENV).forEach((k) => delete process.env[k]);
});

describe("PowerHub Client — Authentication", () => {
  it("should request a JWT token on first API call", async () => {
    // Token endpoint returns JWT
    mockFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "jwt-token-123", expires_in: 600 }), {
          status: 200,
        })
      )
      // Actual API call
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ groups: [] }), { status: 200 })
      );

    const client = createPowerHubClient();
    await client.getGroups();

    // First call should be token request
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toBe(
      "https://fleet-api.tesla.com/asset/tokens"
    );
    expect(mockFetch.mock.calls[0][1].method).toBe("POST");
  });

  it("should reuse cached token on subsequent calls", async () => {
    mockFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "jwt-token-123", expires_in: 600 }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ groups: [] }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sites: [] }), { status: 200 })
      );

    const client = createPowerHubClient();
    await client.getGroups();
    await client.getSites();

    // Only 1 token request, then 2 API calls = 3 total
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("should re-authenticate on 401 response", async () => {
    mockFetch
      // Initial token
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "old-token", expires_in: 600 }), {
          status: 200,
        })
      )
      // API returns 401
      .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
      // Re-auth token
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "new-token", expires_in: 600 }), {
          status: 200,
        })
      )
      // Retry succeeds
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ groups: [] }), { status: 200 })
      );

    const client = createPowerHubClient();
    const result = await client.getGroups();

    expect(result).toEqual({ groups: [] });
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });
});

describe("PowerHub Client — Rate Limiting", () => {
  it("should respect 4 req/sec rate limit", async () => {
    // Return token once
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ token: "jwt", expires_in: 600 }), {
        status: 200,
      })
    );
    // Then 5 API responses
    for (let i = 0; i < 5; i++) {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ data: i }), { status: 200 })
      );
    }

    const client = createPowerHubClient();
    const start = Date.now();
    await Promise.all([
      client.getGroups(),
      client.getGroups(),
      client.getGroups(),
      client.getGroups(),
      client.getGroups(),
    ]);
    const elapsed = Date.now() - start;

    // 5 requests at 4/sec means at least 1 must wait ~250ms
    expect(elapsed).toBeGreaterThanOrEqual(200);
  });
});

describe("PowerHub Client — Error Handling", () => {
  it("should retry on 429 with exponential backoff", async () => {
    mockFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "jwt", expires_in: 600 }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(new Response("Rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response("Rate limited", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ groups: [] }), { status: 200 })
      );

    const client = createPowerHubClient();
    const result = await client.getGroups();

    expect(result).toEqual({ groups: [] });
    // token + 2 retries + success = 4
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("should throw immediately on 403", async () => {
    mockFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "jwt", expires_in: 600 }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));

    const client = createPowerHubClient();
    await expect(client.getGroups()).rejects.toThrow(/403|Forbidden/);
  });

  it("should throw when POWERHUB_ENABLED is false", () => {
    process.env.POWERHUB_ENABLED = "false";
    expect(() => createPowerHubClient()).toThrow(/PowerHub.*disabled/i);
  });
});

describe("PowerHub Client — Endpoint Wrappers", () => {
  let client: PowerHubClient;

  beforeEach(() => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ token: "jwt", expires_in: 600 }), {
        status: 200,
      })
    );
    client = createPowerHubClient();
  });

  it("getSiteDetail should call /asset/sites/{siteId}", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ site_id: "abc", site_name: "Test" }), {
        status: 200,
      })
    );

    await client.getSiteDetail("abc");

    const url = mockFetch.mock.calls[1][0];
    expect(url).toContain("/asset/sites/abc");
  });

  it("getLastTelemetry should include signal list in params", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ signals: [] }), { status: 200 })
    );

    await client.getLastTelemetry("site-1", ["solar_instant_power", "battery_state_of_energy"]);

    const url = mockFetch.mock.calls[1][0];
    expect(url).toContain("target_id=site-1");
    expect(url).toContain("solar_instant_power");
  });

  it("getActiveAlerts should call /alerts/last with active_only", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ alerts: [] }), { status: 200 })
    );

    await client.getActiveAlerts("site-1");

    const url = mockFetch.mock.calls[1][0];
    expect(url).toContain("/alerts/last");
    expect(url).toContain("active_only=true");
  });
});
