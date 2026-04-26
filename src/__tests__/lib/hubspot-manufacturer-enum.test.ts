/**
 * Tests for HubSpot manufacturer enum enforcement in createOrUpdateHubSpotProduct.
 *
 * Phase A behavior (flag off — default):
 *   A 400 with a manufacturer-enum rejection message causes a silent retry
 *   without the `manufacturer` property, succeeds, and returns a warning.
 *
 * Phase C behavior (flag on — HUBSPOT_MANUFACTURER_ENFORCEMENT=true):
 *   The same 400 throws HubSpotManufacturerEnumError immediately without retrying.
 */

// ── Mock @hubspot/api-client so the module can be imported ───────────────────
jest.mock("@hubspot/api-client", () => ({
  Client: jest.fn().mockImplementation(() => ({
    crm: {
      contacts: { searchApi: { doSearch: jest.fn() } },
      deals: { searchApi: { doSearch: jest.fn() } },
      tickets: { searchApi: { doSearch: jest.fn() } },
      associations: { batchApi: { read: jest.fn() } },
      lineItems: { batchApi: { read: jest.fn() } },
    },
  })),
}));

jest.mock("@hubspot/api-client/lib/codegen/crm/deals", () => ({
  FilterOperatorEnum: {},
}));

// ── Import after mocks are set up ────────────────────────────────────────────
import {
  createOrUpdateHubSpotProduct,
  HubSpotManufacturerEnumError,
  isManufacturerEnumRejection,
} from "@/lib/hubspot";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal Response-like mock that global.fetch can return. */
function makeFetchResponse(
  body: unknown,
  status: number,
): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(text),
  } as unknown as Response;
}

/** The manufacturer enum rejection body HubSpot typically returns. */
const MANUFACTURER_REJECTION_BODY = {
  status: "error",
  message: 'Property "manufacturer" was not one of the allowed options',
  error: "INVALID_ENUM_PROPERTY",
  correlationId: "test-correlation-id",
};

/** A successful HubSpot create response. */
const CREATED_BODY = { id: "hs-product-123" };

/** Shared input for all tests. */
const INPUT = {
  brand: "IronRidge",
  model: "XR-100-168A",
  sku: "XR-100-168A",
  description: "IronRidge flush mount rail",
  productCategory: "Racking",
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("isManufacturerEnumRejection", () => {
  it("returns true for HubSpot's standard enum rejection message", () => {
    expect(
      isManufacturerEnumRejection(
        'Failed to create HubSpot product (400): Property "manufacturer" was not one of the allowed options',
      ),
    ).toBe(true);
  });

  it("returns true for 'is not a valid option' variant", () => {
    expect(
      isManufacturerEnumRejection(
        "manufacturer value ABC is not a valid option",
      ),
    ).toBe(true);
  });

  it("returns true for 'is not one of the allowed' variant", () => {
    expect(
      isManufacturerEnumRejection(
        "manufacturer is not one of the allowed values",
      ),
    ).toBe(true);
  });

  it("returns false for a non-manufacturer 400 error", () => {
    expect(
      isManufacturerEnumRejection(
        "Failed to create HubSpot product (400): Property 'hs_sku' is invalid",
      ),
    ).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isManufacturerEnumRejection("")).toBe(false);
  });
});

describe("createOrUpdateHubSpotProduct — manufacturer enum", () => {
  const originalEnv = process.env.HUBSPOT_ACCESS_TOKEN;

  beforeAll(() => {
    process.env.HUBSPOT_ACCESS_TOKEN = "test-token";
  });

  afterAll(() => {
    process.env.HUBSPOT_ACCESS_TOKEN = originalEnv;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.HUBSPOT_MANUFACTURER_ENFORCEMENT;
  });

  describe("when HUBSPOT_MANUFACTURER_ENFORCEMENT is not set (default / Phase A-B)", () => {
    it("retries without manufacturer on enum rejection and returns a warning", async () => {
      // 1st call: SKU search → no existing product
      // 2nd call: name+manufacturer+category search → no existing product
      // 3rd call: create with manufacturer → 400 enum rejection
      // 4th call: create without manufacturer → 201 success
      const fetchSpy = jest.spyOn(global, "fetch").mockImplementation(
        (_url: unknown, opts?: RequestInit) => {
          const body =
            opts?.body ? (JSON.parse(opts.body as string) as Record<string, unknown>) : {};

          // Search calls → empty results
          if ((opts?.method ?? "GET") === "POST" && String(_url).includes("/search")) {
            return Promise.resolve(
              makeFetchResponse({ results: [] }, 200),
            );
          }

          // Create call with manufacturer → 400
          if (
            (opts?.method ?? "GET") === "POST" &&
            String(_url).includes("/crm/v3/objects/products") &&
            (body?.properties as Record<string, unknown>)?.["manufacturer"]
          ) {
            return Promise.resolve(
              makeFetchResponse(MANUFACTURER_REJECTION_BODY, 400),
            );
          }

          // Create call without manufacturer → 201
          if (
            (opts?.method ?? "GET") === "POST" &&
            String(_url).includes("/crm/v3/objects/products")
          ) {
            return Promise.resolve(makeFetchResponse(CREATED_BODY, 200));
          }

          return Promise.resolve(makeFetchResponse({ results: [] }, 200));
        },
      );

      const result = await createOrUpdateHubSpotProduct(INPUT);

      expect(result.hubspotProductId).toBe("hs-product-123");
      expect(result.created).toBe(true);
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.length).toBeGreaterThan(0);
      // Warning must name the rejected brand
      expect(result.warnings![0]).toContain("IronRidge");

      // Should have called fetch at least 3 times (2 searches + 2 create attempts)
      expect(fetchSpy).toHaveBeenCalledTimes(4);

      // The retry call should NOT include manufacturer in the body
      const retryCalls = fetchSpy.mock.calls.filter(
        ([url, opts]) =>
          (opts?.method ?? "GET") === "POST" &&
          String(url).includes("/crm/v3/objects/products") &&
          !String(url).includes("/search"),
      );
      expect(retryCalls.length).toBe(2);
      const retryBody = JSON.parse(retryCalls[1][1]!.body as string) as {
        properties: Record<string, unknown>;
      };
      expect(retryBody.properties["manufacturer"]).toBeUndefined();
    });
  });

  describe("when HUBSPOT_MANUFACTURER_ENFORCEMENT=true (Phase C)", () => {
    beforeEach(() => {
      process.env.HUBSPOT_MANUFACTURER_ENFORCEMENT = "true";
    });

    it("throws HubSpotManufacturerEnumError without retrying", async () => {
      const fetchSpy = jest.spyOn(global, "fetch").mockImplementation(
        (_url: unknown, opts?: RequestInit) => {
          const body =
            opts?.body ? (JSON.parse(opts.body as string) as Record<string, unknown>) : {};

          // Search calls → empty results
          if ((opts?.method ?? "GET") === "POST" && String(_url).includes("/search")) {
            return Promise.resolve(
              makeFetchResponse({ results: [] }, 200),
            );
          }

          // Create call with manufacturer → 400 enum rejection
          if (
            (opts?.method ?? "GET") === "POST" &&
            String(_url).includes("/crm/v3/objects/products") &&
            (body?.properties as Record<string, unknown>)?.["manufacturer"]
          ) {
            return Promise.resolve(
              makeFetchResponse(MANUFACTURER_REJECTION_BODY, 400),
            );
          }

          // Should never reach a retry — enforcement throws before retrying
          return Promise.resolve(makeFetchResponse(CREATED_BODY, 200));
        },
      );

      await expect(createOrUpdateHubSpotProduct(INPUT)).rejects.toThrow(
        HubSpotManufacturerEnumError,
      );

      // Verify the thrown error carries the correct brand
      let thrownError: HubSpotManufacturerEnumError | null = null;
      try {
        await createOrUpdateHubSpotProduct(INPUT);
      } catch (err) {
        if (err instanceof HubSpotManufacturerEnumError) thrownError = err;
      }
      expect(thrownError).not.toBeNull();
      expect(thrownError!.brand).toBe("IronRidge");
      expect(thrownError!.hubspotMessage).toContain("manufacturer");

      // Retry call should never happen — only 2 search + 1 create per invocation
      // (2 calls total per invocation × 2 invocations = 4 search + 2 create = up to 6,
      //  but each invocation should NOT make a retry create call)
      const createCalls = fetchSpy.mock.calls.filter(
        ([url, opts]) =>
          (opts?.method ?? "GET") === "POST" &&
          String(url).includes("/crm/v3/objects/products") &&
          !String(url).includes("/search"),
      );
      // Each invocation makes exactly 1 create attempt then throws (no retry)
      expect(createCalls.length).toBe(2); // 2 invocations × 1 create each
    });
  });
});
