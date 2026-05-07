/**
 * Tesla PowerHub API client tests.
 * Tests OAuth2 client_credentials auth, rate limiting, endpoint wrappers, and error handling.
 *
 * Real API quirks verified in production:
 * - Token endpoint: POST /v1/auth/token → { meta, data: { access_token, token_type }, links }
 * - Data endpoints: GET /v2/... → { data: T } (unwrapped by apiCall)
 * - No `expires_in` in token response — expiry derived from JWT `exp` claim
 * - Telemetry signals return { signal_name, data_points: [{ value, timestamp }] }
 */
import {
  createPowerHubClient,
  type PowerHubClient,
} from "@/lib/tesla-powerhub";

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Env setup — mirrors real env vars
const TEST_ENV = {
  POWERHUB_ENABLED: "true",
  TESLA_POWERHUB_CLIENT_ID: "test-client-id",
  TESLA_POWERHUB_CLIENT_SECRET: "test-client-secret",
  TESLA_POWERHUB_PROXY_URL: "https://pb-powerhub-proxy.fly.dev",
};

/** Build a fake JWT with an exp claim for testing */
function fakeJwt(token: string, expSeconds?: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64");
  const payload = Buffer.from(
    JSON.stringify({
      sub: token,
      exp: expSeconds ?? Math.floor(Date.now() / 1000) + 600,
    })
  ).toString("base64");
  return `${header}.${payload}.fake-signature`;
}

/** Token endpoint response — matches real Tesla format: { meta, data, links } */
function tokenResponse(token: string) {
  const jwt = fakeJwt(token);
  return new Response(
    JSON.stringify({
      meta: { request_id: "test-req-id" },
      data: { access_token: jwt, token_type: "Bearer" },
      links: null,
    }),
    { status: 200 }
  );
}

/** Data endpoint response — matches real Tesla format: { data: T } */
function dataResponse(data: unknown) {
  return new Response(JSON.stringify({ data }), { status: 200 });
}

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
  it("should request a token via client_credentials grant on first API call", async () => {
    mockFetch
      .mockResolvedValueOnce(tokenResponse("jwt-token-123"))
      .mockResolvedValueOnce(dataResponse([]));

    const client = createPowerHubClient();
    await client.getGroups();

    // First call should be token request
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toBe(
      "https://pb-powerhub-proxy.fly.dev/v1/auth/token"
    );
    expect(mockFetch.mock.calls[0][1].method).toBe("POST");

    // Should use Basic Auth with client_id:client_secret
    const authHeader = mockFetch.mock.calls[0][1].headers.Authorization;
    const decoded = Buffer.from(authHeader.replace("Basic ", ""), "base64").toString();
    expect(decoded).toBe("test-client-id:test-client-secret");

    // Body should be form-encoded grant_type
    expect(mockFetch.mock.calls[0][1].body).toBe("grant_type=client_credentials");
    expect(mockFetch.mock.calls[0][1].headers["Content-Type"]).toBe(
      "application/x-www-form-urlencoded"
    );
  });

  it("should reuse cached token on subsequent calls", async () => {
    mockFetch
      .mockResolvedValueOnce(tokenResponse("jwt-token-123"))
      .mockResolvedValueOnce(dataResponse([]))
      .mockResolvedValueOnce(
        dataResponse({ site_id: "abc", site_name: "Test" })
      );

    const client = createPowerHubClient();
    await client.getGroups();
    await client.getSiteDetail("abc");

    // Only 1 token request, then 2 API calls = 3 total
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("should re-authenticate on 401 response", async () => {
    mockFetch
      .mockResolvedValueOnce(tokenResponse("old-token"))
      // API returns 401
      .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
      // Re-auth token
      .mockResolvedValueOnce(tokenResponse("new-token"))
      // Retry succeeds
      .mockResolvedValueOnce(dataResponse([]));

    const client = createPowerHubClient();
    const result = await client.getGroups();

    expect(result).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });
});

describe("PowerHub Client — Rate Limiting", () => {
  it("should respect 4 req/sec rate limit", async () => {
    mockFetch.mockResolvedValueOnce(tokenResponse("jwt"));
    // Then 5 API responses
    for (let i = 0; i < 5; i++) {
      mockFetch.mockResolvedValueOnce(dataResponse([]));
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
      .mockResolvedValueOnce(tokenResponse("jwt"))
      .mockResolvedValueOnce(new Response("Rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response("Rate limited", { status: 429 }))
      .mockResolvedValueOnce(dataResponse([]));

    const client = createPowerHubClient();
    const result = await client.getGroups();

    expect(result).toEqual([]);
    // token + 2 retries + success = 4
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("should throw immediately on 403", async () => {
    mockFetch
      .mockResolvedValueOnce(tokenResponse("jwt"))
      .mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));

    const client = createPowerHubClient();
    await expect(client.getGroups()).rejects.toThrow(/403|Forbidden/);
  });

  it("should throw when POWERHUB_ENABLED is false", () => {
    process.env.POWERHUB_ENABLED = "false";
    expect(() => createPowerHubClient()).toThrow(/PowerHub.*disabled/i);
  });

  it("should throw when client credentials are missing", () => {
    delete process.env.TESLA_POWERHUB_CLIENT_ID;
    expect(() => createPowerHubClient()).toThrow(/Missing PowerHub env vars/);
  });
});

describe("PowerHub Client — Endpoint Wrappers", () => {
  let client: PowerHubClient;

  beforeEach(() => {
    mockFetch.mockResolvedValueOnce(tokenResponse("jwt"));
    client = createPowerHubClient();
  });

  it("getGroups should call /v2/asset/groups and unwrap data", async () => {
    const groups = [
      { group_id: "g1", group_name: "Test Group", sites: [{ site_id: "s1" }] },
    ];
    mockFetch.mockResolvedValueOnce(dataResponse(groups));

    const result = await client.getGroups();

    const url = mockFetch.mock.calls[1][0];
    expect(url).toContain("/v2/asset/groups");
    expect(result).toEqual(groups);
  });

  it("getSiteDetail should call /v2/asset/sites/{siteId}", async () => {
    mockFetch.mockResolvedValueOnce(
      dataResponse({ site_id: "abc", site_name: "Test" })
    );

    const result = await client.getSiteDetail("abc");

    const url = mockFetch.mock.calls[1][0];
    expect(url).toContain("/v2/asset/sites/abc");
    expect(result.site_id).toBe("abc");
  });

  it("getLastTelemetry should include signal list in params", async () => {
    const signals = [
      {
        signal_name: "solar_instant_power",
        rollup: null,
        derivative: null,
        site_id: "site-1",
        data_points: [{ value: 5000, timestamp: "2026-05-07T22:00:00Z" }],
      },
    ];
    mockFetch.mockResolvedValueOnce(dataResponse(signals));

    const result = await client.getLastTelemetry("site-1", [
      "solar_instant_power",
      "battery_instant_power",
    ]);

    const url = mockFetch.mock.calls[1][0];
    expect(url).toContain("/v2/telemetry/last");
    expect(url).toContain("target_id=site-1");
    expect(url).toContain("solar_instant_power");
    expect(result[0].data_points[0].value).toBe(5000);
  });

  it("getActiveAlerts should call /v2/alerts/last with active_only", async () => {
    mockFetch.mockResolvedValueOnce(dataResponse([]));

    await client.getActiveAlerts("site-1");

    const url = mockFetch.mock.calls[1][0];
    expect(url).toContain("/v2/alerts/last");
    expect(url).toContain("active_only=true");
  });

  it("getAvailableSignals should call /v2/telemetry/signals", async () => {
    mockFetch.mockResolvedValueOnce(
      dataResponse({ solar_instant_power: true, battery_instant_power: true })
    );

    const result = await client.getAvailableSignals("site-1");

    const url = mockFetch.mock.calls[1][0];
    expect(url).toContain("/v2/telemetry/signals");
    expect(url).toContain("target_id=site-1");
    expect(result.solar_instant_power).toBe(true);
  });
});
