/**
 * Unit tests for EagleViewClient.
 *
 * Covers:
 *  - OAuth2 client_credentials token flow with Basic auth
 *  - Token caching & refresh
 *  - 401 retry with forced token refresh
 *  - Rate-limit / 5xx retry with exponential backoff
 *  - camelCase request body (per real-API requirement)
 *  - Bearer token sent on all subsequent calls
 *  - Public method coverage: getAvailableProducts, checkSolarAvailability,
 *    placeOrder, getReport, getFileLinks, downloadFile
 */
import {
  EagleViewClient,
  EagleViewError,
  EAGLEVIEW_PRODUCT_ID,
  EAGLEVIEW_TOKEN_URL,
} from "@/lib/eagleview";

const mkResp = (
  status: number,
  body: unknown,
  opts: { isText?: boolean } = {},
): Response => {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    text: async () => text,
    json: async () => (opts.isText ? text : body),
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
  } as unknown as Response;
};

beforeEach(() => {
  jest.useRealTimers();
  global.fetch = jest.fn() as unknown as typeof fetch;
});

afterEach(() => {
  jest.clearAllMocks();
});

const makeClient = () =>
  new EagleViewClient({
    clientId: "test-client",
    clientSecret: "test-secret",
    baseUrl: "https://sandbox.apicenter.eagleview.com",
    timeoutMs: 5000,
  });

const tokenResponse = mkResp(200, {
  access_token: "test-access-token",
  expires_in: 3600,
  token_type: "Bearer",
});

describe("EagleViewClient — config", () => {
  it("isConfigured returns true when both creds set", () => {
    const c = makeClient();
    expect(c.isConfigured()).toBe(true);
    expect(c.getMissingConfig()).toEqual([]);
  });

  it("isConfigured returns false and lists missing keys", () => {
    const c = new EagleViewClient({ clientId: "", clientSecret: "" });
    expect(c.isConfigured()).toBe(false);
    expect(c.getMissingConfig()).toEqual(
      expect.arrayContaining(["EAGLEVIEW_CLIENT_ID", "EAGLEVIEW_CLIENT_SECRET"]),
    );
  });
});

describe("EagleViewClient — auth", () => {
  it("fetches a token with Basic auth + grant_type=client_credentials", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(tokenResponse);
    const c = makeClient();
    const tok = await c.getAccessToken();
    expect(tok).toBe("test-access-token");

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe(EAGLEVIEW_TOKEN_URL);
    expect(init.method).toBe("POST");
    expect(init.body).toBe("grant_type=client_credentials");
    const expectedBasic =
      "Basic " + Buffer.from("test-client:test-secret").toString("base64");
    expect(init.headers.Authorization).toBe(expectedBasic);
    expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
  });

  it("caches token across calls", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(tokenResponse);
    const c = makeClient();
    await c.getAccessToken();
    await c.getAccessToken();
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(1);
  });

  it("forces refresh when forceRefresh=true", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(tokenResponse)
      .mockResolvedValueOnce(
        mkResp(200, { access_token: "second", expires_in: 3600 }),
      );
    const c = makeClient();
    await c.getAccessToken();
    const second = await c.getAccessToken(true);
    expect(second).toBe("second");
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(2);
  });

  it("coalesces concurrent token fetches into one network call", async () => {
    let resolveFetch!: (r: Response) => void;
    (global.fetch as jest.Mock).mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const c = makeClient();
    const p1 = c.getAccessToken();
    const p2 = c.getAccessToken();
    resolveFetch(tokenResponse);
    const [t1, t2] = await Promise.all([p1, p2]);
    expect(t1).toBe("test-access-token");
    expect(t2).toBe("test-access-token");
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(1);
  });

  it("throws EagleViewError on token endpoint failure", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mkResp(401, "invalid_client"),
    );
    const c = makeClient();
    await expect(c.getAccessToken()).rejects.toThrow(EagleViewError);
  });
});

describe("EagleViewClient — request flow", () => {
  it("sends Bearer token on API calls and parses JSON response", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(tokenResponse)
      .mockResolvedValueOnce(
        mkResp(200, [
          { productID: 91, name: "TrueDesign for Planning", priceMin: 100, priceMax: 100 },
        ]),
      );
    const c = makeClient();
    const products = await c.getAvailableProducts();
    expect(products[0].productID).toBe(EAGLEVIEW_PRODUCT_ID.TDP);

    const [, init] = (global.fetch as jest.Mock).mock.calls[1];
    expect(init.headers.Authorization).toBe("Bearer test-access-token");
    expect(init.method).toBe("GET");
  });

  it("sends camelCase body on checkSolarAvailability (NOT PascalCase)", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(tokenResponse)
      .mockResolvedValueOnce(
        mkResp(200, {
          jobId: "abc",
          address: "x",
          latitude: "33.0",
          longitude: "-117.0",
          availabilityStatus: [{ isAvailable: true, productId: 91 }],
          jobStatus: "Completed",
          requestId: "r",
        }),
      );
    const c = makeClient();
    await c.checkSolarAvailability(
      {
        address: "2001 Via Teca, San Clemente, California 92673, United States",
        latitude: 33.44448,
        longitude: -117.61949,
      },
      [EAGLEVIEW_PRODUCT_ID.TDP],
    );
    const [url, init] = (global.fetch as jest.Mock).mock.calls[1];
    expect(url).toBe(
      "https://sandbox.apicenter.eagleview.com/v1/Product/SolarProductAvailability",
    );
    const body = JSON.parse(init.body as string);
    // Critical: camelCase, not PascalCase
    expect(body).toHaveProperty("address");
    expect(body).toHaveProperty("latitude", 33.44448);
    expect(body).toHaveProperty("longitude", -117.61949);
    expect(body).toHaveProperty("productList", [91]);
    expect(body).toHaveProperty("vintageExtension", false);
    expect(body).not.toHaveProperty("Address");
    expect(body).not.toHaveProperty("Latitude");
  });

  it("retries once on 401 with refreshed token", async () => {
    const responses = [
      tokenResponse, // initial token
      mkResp(401, { error: "expired" }), // first call fails
      mkResp(200, { access_token: "refreshed", expires_in: 3600 }), // refresh
      mkResp(200, []), // retry succeeds
    ];
    (global.fetch as jest.Mock).mockImplementation(() =>
      Promise.resolve(responses.shift()),
    );
    const c = makeClient();
    await c.getAvailableProducts();
    const calls = (global.fetch as jest.Mock).mock.calls;
    // 4 calls: token, get-products(401), refresh-token, get-products(200)
    expect(calls.length).toBe(4);
    // Last call should use the refreshed token
    expect(calls[3][1].headers.Authorization).toBe("Bearer refreshed");
  });

  it("retries on 429 with backoff", async () => {
    const responses = [
      tokenResponse,
      mkResp(429, { error: "rate_limited" }),
      mkResp(200, []),
    ];
    (global.fetch as jest.Mock).mockImplementation(() =>
      Promise.resolve(responses.shift()),
    );
    const c = makeClient();
    const promise = c.getAvailableProducts();
    await expect(promise).resolves.toEqual([]);
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(3);
  }, 15_000);

  it("retries on 503 (server error) with backoff", async () => {
    const responses = [
      tokenResponse,
      mkResp(503, "service unavailable"),
      mkResp(200, []),
    ];
    (global.fetch as jest.Mock).mockImplementation(() =>
      Promise.resolve(responses.shift()),
    );
    const c = makeClient();
    await expect(c.getAvailableProducts()).resolves.toEqual([]);
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(3);
  }, 15_000);

  it("does NOT retry on 400 client errors", async () => {
    const responses = [
      tokenResponse,
      mkResp(400, { error: "bad request" }),
    ];
    (global.fetch as jest.Mock).mockImplementation(() =>
      Promise.resolve(responses.shift()),
    );
    const c = makeClient();
    await expect(c.getAvailableProducts()).rejects.toThrow(EagleViewError);
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(2);
  });
});

describe("EagleViewClient — placeOrder + reports", () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockReset();
  });

  it("placeOrder posts to /v2/Order/PlaceOrder and returns reportId", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(tokenResponse)
      .mockResolvedValueOnce(mkResp(200, { reportId: 12345 }));
    const c = makeClient();
    const result = await c.placeOrder({
      reportAddresses: {
        primary: { street: "1 Main St", city: "Denver", state: "CO", zip: "80202" },
      },
      primaryProductId: 91,
      deliveryProductId: 8,
      measurementInstructionType: 1,
      changesInLast4Years: false,
    });
    expect(result.reportId).toBe(12345);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[1];
    expect(url).toBe("https://sandbox.apicenter.eagleview.com/v2/Order/PlaceOrder");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.primaryProductId).toBe(91);
  });

  it("getReport sends reportId as query param", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(tokenResponse)
      .mockResolvedValueOnce(mkResp(200, { reportId: 999, displayStatus: "Completed" }));
    const c = makeClient();
    const r = await c.getReport(999);
    expect(r.displayStatus).toBe("Completed");
    const [url] = (global.fetch as jest.Mock).mock.calls[1];
    expect(url).toBe(
      "https://sandbox.apicenter.eagleview.com/v3/Report/GetReport?reportId=999",
    );
  });

  it("getFileLinks encodes reportId in path", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(tokenResponse)
      .mockResolvedValueOnce(mkResp(200, { links: [] }));
    const c = makeClient();
    await c.getFileLinks(777);
    const [url] = (global.fetch as jest.Mock).mock.calls[1];
    expect(url).toBe(
      "https://sandbox.apicenter.eagleview.com/v3/Report/777/file-links",
    );
  });

  it("downloadFile uses signed URL without bearer token", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mkResp(200, "binary-data"),
    );
    const c = makeClient();
    await c.downloadFile("https://signed.example.com/file.pdf?sig=abc");
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("https://signed.example.com/file.pdf?sig=abc");
    // No auth header — signed URLs are self-authenticating
    expect(init.headers).toBeUndefined();
  });

  it("downloadFile throws EagleViewError on 404", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mkResp(404, "Not Found"));
    const c = makeClient();
    await expect(c.downloadFile("https://signed.example.com/file.pdf")).rejects.toThrow(
      EagleViewError,
    );
  });
});
