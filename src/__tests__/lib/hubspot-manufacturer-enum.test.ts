/**
 * Tests for HubSpot manufacturer enum behavior in createOrUpdateHubSpotProduct.
 *
 * Phase A/B behavior (flag off — default):
 *   A 400 with a manufacturer-enum rejection message causes a silent retry
 *   without the `manufacturer` property, succeeds, and returns a warning.
 *
 * Phase D behavior (flag on — HUBSPOT_MANUFACTURER_ENFORCEMENT=true):
 *   The same 400 triggers an auto-add of the brand to HubSpot's enum (PATCH
 *   /properties/products/manufacturer), then retries the create with the brand
 *   intact, notifies TechOps, and returns success. If the auto-add fails, the
 *   typed HubSpotManufacturerEnumError is thrown so the caller blocks the
 *   submission with an actionable message.
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

// Mock catalog-notify so we can assert the TechOps notification fires without
// pulling in the email infra
jest.mock("@/lib/catalog-notify", () => ({
  notifyTechOpsOfAutoAddedBrand: jest.fn(),
  notifyAdminsOfApprovalWarnings: jest.fn(),
  notifyAdminsOfNewCatalogRequest: jest.fn(),
}));

// ── Import after mocks are set up ────────────────────────────────────────────
import {
  addBrandToHubSpotManufacturerEnum,
  createOrUpdateHubSpotProduct,
  HubSpotManufacturerEnumError,
  isManufacturerEnumRejection,
} from "@/lib/hubspot";
import * as catalogNotify from "@/lib/catalog-notify";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal Response-like mock that global.fetch can return. */
function makeFetchResponse(
  body: unknown,
  status: number,
): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const parsed = typeof body === "string" ? body : body;
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(text),
    json: () => Promise.resolve(parsed),
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

  describe("when HUBSPOT_MANUFACTURER_ENFORCEMENT=true (Phase D — auto-add)", () => {
    beforeEach(() => {
      process.env.HUBSPOT_MANUFACTURER_ENFORCEMENT = "true";
      (catalogNotify.notifyTechOpsOfAutoAddedBrand as jest.Mock).mockClear();
    });

    it("auto-adds the brand and retries the create successfully", async () => {
      // Sequence per createOrUpdateHubSpotProduct invocation:
      //   1) POST /search by hs_sku → empty
      //   2) POST /search by name+manufacturer+category → empty
      //   3) POST /products with manufacturer → 400 enum rejection
      //   4) GET /properties/products/manufacturer → returns existing options
      //   5) PATCH /properties/products/manufacturer → 200 (added)
      //   6) POST /products with manufacturer (retry) → 201 success
      const fetchSpy = jest.spyOn(global, "fetch").mockImplementation(
        (url: unknown, opts?: RequestInit) => {
          const u = String(url);
          const method = opts?.method ?? "GET";
          const body = opts?.body ? (JSON.parse(opts.body as string) as Record<string, unknown>) : {};

          // Property GET (auto-add helper)
          if (method === "GET" && u.includes("/properties/products/manufacturer")) {
            return Promise.resolve(
              makeFetchResponse({ name: "manufacturer", options: [{ label: "Tesla", value: "Tesla" }] }, 200),
            );
          }
          // Property PATCH (auto-add helper)
          if (method === "PATCH" && u.includes("/properties/products/manufacturer")) {
            return Promise.resolve(makeFetchResponse({ name: "manufacturer" }, 200));
          }
          // Search calls → empty
          if (method === "POST" && u.includes("/search")) {
            return Promise.resolve(makeFetchResponse({ results: [] }, 200));
          }
          // Create with manufacturer
          if (method === "POST" && u.includes("/crm/v3/objects/products")) {
            const props = (body?.properties as Record<string, unknown>) || {};
            // Track call count per test by stringifying — first POST returns 400, second returns 201
            const callCount = fetchSpy.mock.calls.filter(
              ([uu, oo]) => (oo?.method ?? "GET") === "POST" &&
                String(uu).includes("/crm/v3/objects/products") &&
                !String(uu).includes("/search"),
            ).length;
            if (callCount <= 1 && props["manufacturer"]) {
              return Promise.resolve(makeFetchResponse(MANUFACTURER_REJECTION_BODY, 400));
            }
            return Promise.resolve(makeFetchResponse(CREATED_BODY, 200));
          }
          return Promise.resolve(makeFetchResponse({ results: [] }, 200));
        },
      );

      const result = await createOrUpdateHubSpotProduct(INPUT);

      expect(result.hubspotProductId).toBe("hs-product-123");
      expect(result.created).toBe(true);
      expect(result.warnings).toBeDefined();
      expect(result.warnings![0]).toContain("auto-added");
      expect(result.warnings![0]).toContain("IronRidge");

      // PATCH /properties was called
      const patchCalls = fetchSpy.mock.calls.filter(
        ([url, opts]) => (opts?.method) === "PATCH" && String(url).includes("/properties/products/manufacturer"),
      );
      expect(patchCalls.length).toBe(1);
      const patchBody = JSON.parse(patchCalls[0][1]!.body as string) as { options: Array<{ value: string }> };
      expect(patchBody.options.some((o) => o.value === "IronRidge")).toBe(true);

      // TechOps notification fired
      expect(catalogNotify.notifyTechOpsOfAutoAddedBrand).toHaveBeenCalledWith(
        expect.objectContaining({ brand: "IronRidge" }),
      );

      // The retry create call DID include manufacturer
      const createCalls = fetchSpy.mock.calls.filter(
        ([url, opts]) => (opts?.method) === "POST" &&
          String(url).includes("/crm/v3/objects/products") &&
          !String(url).includes("/search"),
      );
      expect(createCalls.length).toBe(2);
      const retryBody = JSON.parse(createCalls[1][1]!.body as string) as { properties: Record<string, unknown> };
      expect(retryBody.properties["manufacturer"]).toBe("IronRidge");
    });

    it("falls back to throwing typed error when auto-add fails (e.g., missing scope)", async () => {
      jest.spyOn(global, "fetch").mockImplementation(
        (url: unknown, opts?: RequestInit) => {
          const u = String(url);
          const method = opts?.method ?? "GET";
          const body = opts?.body ? (JSON.parse(opts.body as string) as Record<string, unknown>) : {};

          if (method === "GET" && u.includes("/properties/products/manufacturer")) {
            return Promise.resolve(
              makeFetchResponse({ name: "manufacturer", options: [] }, 200),
            );
          }
          if (method === "PATCH" && u.includes("/properties/products/manufacturer")) {
            // Auto-add fails — simulate missing scope
            return Promise.resolve(makeFetchResponse({ status: "error", message: "insufficient scope" }, 403));
          }
          if (method === "POST" && u.includes("/search")) {
            return Promise.resolve(makeFetchResponse({ results: [] }, 200));
          }
          if (method === "POST" && u.includes("/crm/v3/objects/products")) {
            const props = (body?.properties as Record<string, unknown>) || {};
            if (props["manufacturer"]) {
              return Promise.resolve(makeFetchResponse(MANUFACTURER_REJECTION_BODY, 400));
            }
          }
          return Promise.resolve(makeFetchResponse({ results: [] }, 200));
        },
      );

      await expect(createOrUpdateHubSpotProduct(INPUT)).rejects.toThrow(HubSpotManufacturerEnumError);
      expect(catalogNotify.notifyTechOpsOfAutoAddedBrand).not.toHaveBeenCalled();
    });
  });
});

describe("addBrandToHubSpotManufacturerEnum", () => {
  const originalEnv = process.env.HUBSPOT_ACCESS_TOKEN;
  beforeAll(() => { process.env.HUBSPOT_ACCESS_TOKEN = "test-token"; });
  afterAll(() => { process.env.HUBSPOT_ACCESS_TOKEN = originalEnv; });
  afterEach(() => { jest.restoreAllMocks(); });

  it("no-ops when brand is already present (case-insensitive)", async () => {
    jest.spyOn(global, "fetch").mockImplementation(() =>
      Promise.resolve(makeFetchResponse({
        options: [{ label: "ironridge", value: "IRONRIDGE" }],
      }, 200))
    );
    const r = await addBrandToHubSpotManufacturerEnum("IronRidge");
    expect(r.ok).toBe(true);
    expect(r.added).toBe(false);
  });

  it("PATCHes when brand is missing", async () => {
    let patchSent: { options: Array<{ value: string }> } | null = null;
    jest.spyOn(global, "fetch").mockImplementation((_url, opts?: RequestInit) => {
      if ((opts?.method ?? "GET") === "PATCH") {
        patchSent = JSON.parse(opts!.body as string);
        return Promise.resolve(makeFetchResponse({}, 200));
      }
      return Promise.resolve(makeFetchResponse({ options: [{ label: "Tesla", value: "Tesla" }] }, 200));
    });
    const r = await addBrandToHubSpotManufacturerEnum("Pegasus");
    expect(r.ok).toBe(true);
    expect(r.added).toBe(true);
    expect(patchSent!.options.some((o) => o.value === "Pegasus")).toBe(true);
    expect(patchSent!.options.some((o) => o.value === "Tesla")).toBe(true);
  });

  it("returns ok=false when GET fails", async () => {
    jest.spyOn(global, "fetch").mockImplementation(() =>
      Promise.resolve(makeFetchResponse({ message: "forbidden" }, 403))
    );
    const r = await addBrandToHubSpotManufacturerEnum("Pegasus");
    expect(r.ok).toBe(false);
    expect(r.message).toContain("403");
  });

  it("returns ok=false for empty brand input", async () => {
    const r = await addBrandToHubSpotManufacturerEnum("");
    expect(r.ok).toBe(false);
  });
});
