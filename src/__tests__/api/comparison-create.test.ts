// src/__tests__/api/comparison-create.test.ts
//
// Tests for POST /api/products/comparison/create — focusing on the
// cross-link warning paths for all three external systems.

// ── Auth ──────────────────────────────────────────────────────────────────────
const mockRequireApiAuth = jest.fn();
jest.mock("@/lib/api-auth", () => ({
  requireApiAuth: (...args: unknown[]) => mockRequireApiAuth(...args),
}));

// ── DB helpers ────────────────────────────────────────────────────────────────
const mockGetUserByEmail = jest.fn();
const mockLogActivity = jest.fn();
jest.mock("@/lib/role-permissions", () => ({
  normalizeRole: (role: string) => role,
}));

// ── catalog-fields ──────────────────────────────────────────────────────────
jest.mock("@/lib/catalog-fields", () => ({
  getSpecTableName: jest.fn(() => null),
  getHubspotCategoryValue: jest.fn(() => "Module"),
  getZuperCategoryValue: jest.fn(() => "Module"),
  generateZuperSpecification: jest.fn(() => "Spec"),
  getHubspotPropertiesFromMetadata: jest.fn(() => ({})),
}));

// ── HubSpot adapter ─────────────────────────────────────────────────────────
const mockCreateOrUpdateHubSpotProduct = jest.fn();
jest.mock("@/lib/hubspot", () => ({
  createOrUpdateHubSpotProduct: (...args: unknown[]) => mockCreateOrUpdateHubSpotProduct(...args),
}));

// ── Zoho adapter ────────────────────────────────────────────────────────────
const mockCreateOrUpdateZohoItem = jest.fn();
const mockZohoUpdateItem = jest.fn();
jest.mock("@/lib/zoho-inventory", () => ({
  createOrUpdateZohoItem: (...args: unknown[]) => mockCreateOrUpdateZohoItem(...args),
  zohoInventory: { updateItem: (...args: unknown[]) => mockZohoUpdateItem(...args) },
}));

// ── Zuper adapter ───────────────────────────────────────────────────────────
const mockCreateOrUpdateZuperPart = jest.fn();
const mockUpdateZuperPart = jest.fn();
const mockBuildZuperProductCustomFields = jest.fn();
jest.mock("@/lib/zuper-catalog", () => ({
  createOrUpdateZuperPart: (...args: unknown[]) => mockCreateOrUpdateZuperPart(...args),
  updateZuperPart: (...args: unknown[]) => mockUpdateZuperPart(...args),
  buildZuperProductCustomFields: (...args: unknown[]) => mockBuildZuperProductCustomFields(...args),
}));

// ── External links ──────────────────────────────────────────────────────────
jest.mock("@/lib/external-links", () => ({
  getHubSpotProductUrl: (id: string) => `https://hubspot.com/products/${id}`,
  getZohoItemUrl: (id: string) => `https://zoho.com/items/${id}`,
  getZuperProductUrl: (id: string) => `https://zuper.com/products/${id}`,
}));

// ── Enums ───────────────────────────────────────────────────────────────────
jest.mock("@/generated/prisma/enums", () => ({
  CatalogProductSource: { HUBSPOT: "HUBSPOT", ZUPER: "ZUPER", ZOHO: "ZOHO" },
}));

// ── Prisma ──────────────────────────────────────────────────────────────────
const mockInternalProductFindUnique = jest.fn();
const mockInternalProductUpdate = jest.fn();
const mockCatalogProductUpsert = jest.fn();
jest.mock("@/lib/db", () => ({
  prisma: {
    internalProduct: {
      findUnique: (...args: unknown[]) => mockInternalProductFindUnique(...args),
      update: (...args: unknown[]) => mockInternalProductUpdate(...args),
    },
    catalogProduct: {
      upsert: (...args: unknown[]) => mockCatalogProductUpsert(...args),
    },
  },
  getUserByEmail: (...args: unknown[]) => mockGetUserByEmail(...args),
  logActivity: (...args: unknown[]) => mockLogActivity(...args),
}));

// ── Route under test ────────────────────────────────────────────────────────
import { NextRequest } from "next/server";
import { POST } from "@/app/api/products/comparison/create/route";

// ── Helpers ─────────────────────────────────────────────────────────────────
function makeSkuRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "sku_1",
    brand: "REC",
    model: "REC-400AA",
    category: "MODULE",
    description: "400W Module",
    sku: "REC400",
    vendorPartNumber: "V-REC-400",
    unitLabel: "W",
    vendorName: "BayWa",
    sellPrice: 180,
    unitCost: 120,
    hardToProcure: false,
    length: 68.5,
    width: 40.2,
    moduleSpec: null,
    inverterSpec: null,
    batterySpec: null,
    evChargerSpec: null,
    mountingHardwareSpec: null,
    electricalHardwareSpec: null,
    relayDeviceSpec: null,
    hubspotProductId: "hs_existing",
    zuperItemId: "zuper_existing",
    zohoItemId: "zoho_existing",
    ...overrides,
  };
}

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/products/comparison/create", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireApiAuth.mockResolvedValue({
    email: "admin@photonbrothers.com",
    role: "ADMIN",
    name: "Admin",
    ip: "127.0.0.1",
    userAgent: "jest",
  });
  mockGetUserByEmail.mockResolvedValue({ role: "ADMIN" });
  mockLogActivity.mockResolvedValue(undefined);

  // Default: SKU exists with all 3 external IDs pre-linked
  mockInternalProductFindUnique.mockResolvedValue(makeSkuRecord());
  mockInternalProductUpdate.mockResolvedValue({});
  mockCatalogProductUpsert.mockResolvedValue({});

  // Source creation defaults
  mockCreateOrUpdateHubSpotProduct.mockResolvedValue({ hubspotProductId: "hs_new_1", created: true });
  mockCreateOrUpdateZohoItem.mockResolvedValue({ zohoItemId: "zoho_new_1", created: true });
  mockCreateOrUpdateZuperPart.mockResolvedValue({ zuperItemId: "zuper_new_1", created: true });

  // Cross-link defaults (succeed silently)
  mockZohoUpdateItem.mockResolvedValue({ status: "updated", message: "ok" });
  mockUpdateZuperPart.mockResolvedValue({ status: "updated", zuperItemId: "zuper_existing", message: "ok" });
  mockBuildZuperProductCustomFields.mockReturnValue({ hubspot_product_id: "hs_existing", zoho_item_id: "zoho_existing", internal_product_id: "sku_1" });

  // Global fetch for HubSpot cross-link PATCH
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as jest.Mock;
  process.env.HUBSPOT_ACCESS_TOKEN = "test-token";
});

// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/products/comparison/create", () => {
  describe("basic flow", () => {
    it("creates a HubSpot product and returns 200", async () => {
      const res = await POST(makeRequest({ internalSkuId: "sku_1", source: "hubspot" }));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.source).toBe("hubspot");
      expect(data.externalId).toBe("hs_new_1");
      expect(data.created).toBe(true);
      expect(mockCreateOrUpdateHubSpotProduct).toHaveBeenCalledTimes(1);
    });

    it("creates a Zuper product and returns 200", async () => {
      const res = await POST(makeRequest({ internalSkuId: "sku_1", source: "zuper" }));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.source).toBe("zuper");
      expect(data.externalId).toBe("zuper_new_1");
      expect(mockCreateOrUpdateZuperPart).toHaveBeenCalledTimes(1);
    });

    it("creates a Zoho product and returns 200", async () => {
      const res = await POST(makeRequest({ internalSkuId: "sku_1", source: "zoho" }));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.source).toBe("zoho");
      expect(data.externalId).toBe("zoho_new_1");
      expect(mockCreateOrUpdateZohoItem).toHaveBeenCalledTimes(1);
    });

    it("returns 404 when internal product not found", async () => {
      mockInternalProductFindUnique.mockResolvedValueOnce(null);
      const res = await POST(makeRequest({ internalSkuId: "nonexistent", source: "hubspot" }));
      expect(res.status).toBe(404);
    });

    it("returns 403 for non-admin/executive roles", async () => {
      mockRequireApiAuth.mockResolvedValue({ email: "viewer@test.com", role: "VIEWER" });
      mockGetUserByEmail.mockResolvedValue({ role: "VIEWER" });

      const res = await POST(makeRequest({ internalSkuId: "sku_1", source: "hubspot" }));
      expect(res.status).toBe(403);
    });

    it("returns 400 for invalid payload", async () => {
      const res = await POST(makeRequest({ internalSkuId: "", source: "hubspot" }));
      expect(res.status).toBe(400);
    });
  });

  // ── Cross-link warning paths ───────────────────────────────────────────

  describe("cross-link warning paths", () => {
    // For cross-link tests, we create a HubSpot product. The freshSku lookup
    // returns all 3 external IDs so all cross-link branches execute.

    it("logs warning when Zoho cross-link updateItem returns non-updated status", async () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      mockZohoUpdateItem.mockResolvedValue({ status: "error", message: "Custom field not found" });

      const res = await POST(makeRequest({ internalSkuId: "sku_1", source: "hubspot" }));

      // Approval still succeeds — cross-link is best-effort
      expect(res.status).toBe(200);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Zoho cross-link update returned error/)
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Custom field not found/)
      );
      warnSpy.mockRestore();
    });

    it("does not fail when Zoho cross-link updateItem throws", async () => {
      mockZohoUpdateItem.mockRejectedValue(new Error("Zoho timeout"));

      const res = await POST(makeRequest({ internalSkuId: "sku_1", source: "hubspot" }));

      // Cross-link failure is swallowed — route still succeeds
      expect(res.status).toBe(200);
    });

    it("logs warning when Zuper cross-link updateZuperPart returns failed status", async () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      mockUpdateZuperPart.mockResolvedValue({ status: "failed", zuperItemId: "zuper_existing", message: "Endpoint rejected" });

      const res = await POST(makeRequest({ internalSkuId: "sku_1", source: "hubspot" }));

      expect(res.status).toBe(200);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Zuper cross-link update returned failed/)
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Endpoint rejected/)
      );
      warnSpy.mockRestore();
    });

    it("logs warning when Zuper cross-link updateZuperPart returns not_found status", async () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      mockUpdateZuperPart.mockResolvedValue({ status: "not_found", zuperItemId: "zuper_existing", message: "Item not found" });

      const res = await POST(makeRequest({ internalSkuId: "sku_1", source: "hubspot" }));

      expect(res.status).toBe(200);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Zuper cross-link update returned not_found/)
      );
      warnSpy.mockRestore();
    });

    it("does not fail when Zuper cross-link updateZuperPart throws", async () => {
      mockUpdateZuperPart.mockRejectedValue(new Error("Zuper network error"));

      const res = await POST(makeRequest({ internalSkuId: "sku_1", source: "hubspot" }));

      expect(res.status).toBe(200);
    });

    it("logs warning when HubSpot cross-link PATCH returns non-2xx", async () => {
      // Use zuper as source so freshSku.hubspotProductId triggers the HS cross-link
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 404 });

      const res = await POST(makeRequest({ internalSkuId: "sku_1", source: "zuper" }));

      expect(res.status).toBe(200);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/HubSpot cross-link PATCH returned 404/)
      );
      warnSpy.mockRestore();
    });

    it("does not fail when HubSpot cross-link fetch throws", async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error("Network failure"));

      const res = await POST(makeRequest({ internalSkuId: "sku_1", source: "zuper" }));

      // Entire cross-link block is in try/catch — route still succeeds
      expect(res.status).toBe(200);
    });

    it("skips cross-links when freshSku has no external IDs", async () => {
      // First call: findUnique with include (returns full sku, no external IDs)
      // Second call: findUnique with select (returns freshSku for cross-links)
      mockInternalProductFindUnique
        .mockResolvedValueOnce(makeSkuRecord({ hubspotProductId: null, zuperItemId: null, zohoItemId: null }))
        .mockResolvedValueOnce({ hubspotProductId: null, zuperItemId: null, zohoItemId: null });

      const res = await POST(makeRequest({ internalSkuId: "sku_1", source: "hubspot" }));

      expect(res.status).toBe(200);
      expect(mockZohoUpdateItem).not.toHaveBeenCalled();
      expect(mockUpdateZuperPart).not.toHaveBeenCalled();
    });
  });
});
