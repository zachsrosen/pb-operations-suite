// src/__tests__/api/catalog-push-approve.test.ts

// ── catalog-activity-log ──────────────────────────────────────────────────────
jest.mock("@/lib/catalog-activity-log", () => ({
  logCatalogSync: jest.fn().mockResolvedValue(null),
  logCatalogProductCreated: jest.fn().mockResolvedValue(null),
}));

// ── Auth ──────────────────────────────────────────────────────────────────────
const mockRequireApiAuth = jest.fn();
jest.mock("@/lib/api-auth", () => ({
  requireApiAuth: (...args: unknown[]) => mockRequireApiAuth(...args),
}));

// ── catalog-fields ────────────────────────────────────────────────────────────
jest.mock("@/lib/catalog-fields", () => ({
  getSpecTableName: jest.fn((cat: string) => {
    const map: Record<string, string> = {
      MODULE: "moduleSpec",
      INVERTER: "inverterSpec",
      BATTERY: "batterySpec",
      BATTERY_EXPANSION: "batterySpec",
    };
    return map[cat];
  }),
  getHubspotCategoryValue: jest.fn((cat: string) => {
    const map: Record<string, string> = {
      MODULE: "Module",
      INVERTER: "Inverter",
      BATTERY: "Battery",
      BATTERY_EXPANSION: "Battery Expansion",
    };
    return map[cat];
  }),
  getZuperCategoryValue: jest.fn((cat: string) => {
    const map: Record<string, string> = {
      MODULE: "Module",
      INVERTER: "Inverter",
      BATTERY: "Battery",
      BATTERY_EXPANSION: "Battery Expansion",
    };
    return map[cat];
  }),
  generateZuperSpecification: jest.fn(() => "Spec Summary"),
  getHubspotPropertiesFromMetadata: jest.fn(() => ({})),
  filterMetadataToSpecFields: jest.fn((_cat: string, meta: Record<string, unknown>) => meta),
}));

// ── HubSpot adapter ────────────────────────────────────────────────────────────
const mockCreateOrUpdateHubSpotProduct = jest.fn();
jest.mock("@/lib/hubspot", () => ({
  createOrUpdateHubSpotProduct: (...args: unknown[]) => mockCreateOrUpdateHubSpotProduct(...args),
}));

// ── Zoho adapter ───────────────────────────────────────────────────────────────
const mockCreateOrUpdateZohoItem = jest.fn();
const mockZohoUpdateItem = jest.fn();
jest.mock("@/lib/zoho-inventory", () => ({
  createOrUpdateZohoItem: (...args: unknown[]) => mockCreateOrUpdateZohoItem(...args),
  zohoInventory: { updateItem: (...args: unknown[]) => mockZohoUpdateItem(...args) },
}));

// ── Zuper adapter ──────────────────────────────────────────────────────────────
const mockCreateOrUpdateZuperPart = jest.fn();
const mockUpdateZuperPart = jest.fn();
const mockBuildZuperProductCustomFields = jest.fn();
jest.mock("@/lib/zuper-catalog", () => ({
  createOrUpdateZuperPart: (...args: unknown[]) => mockCreateOrUpdateZuperPart(...args),
  updateZuperPart: (...args: unknown[]) => mockUpdateZuperPart(...args),
  buildZuperProductCustomFields: (...args: unknown[]) => mockBuildZuperProductCustomFields(...args),
}));

// ── Catalog notify ──────────────────────────────────────────────────────────────
jest.mock("@/lib/catalog-notify", () => ({
  notifyAdminsOfApprovalWarnings: jest.fn(),
}));

// ── Canonical ───────────────────────────────────────────────────────────────────
jest.mock("@/lib/canonical", () => ({
  canonicalToken: jest.fn((s: string) => s?.toLowerCase().replace(/[^a-z0-9]/g, "") || ""),
  buildCanonicalKey: jest.fn((_cat: string, brand: string, model: string) =>
    `${brand}::${model}`.toLowerCase()
  ),
}));

// ── Prisma ────────────────────────────────────────────────────────────────────
const mockFindUnique = jest.fn();
const mockCatalogFindMany = jest.fn();
const mockCatalogFindUnique = jest.fn();
const mockInternalProductFindUnique = jest.fn();
const mockUpsert = jest.fn();
const mockUpdate = jest.fn();
const mockSpecUpsert = jest.fn();
const mockEquipmentUpdate = jest.fn();
let pushState: Record<string, unknown>;

// $transaction receives a callback; we execute it with a fake tx client
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockTransaction = jest.fn(async (fn: any) => {
  const txClient = {
    internalProduct: {
      findUnique: (...args: unknown[]) => mockInternalProductFindUnique(...args),
      upsert: (...args: unknown[]) => mockUpsert(...args),
      update: (...args: unknown[]) => mockEquipmentUpdate(...args),
    },
    moduleSpec: { upsert: (...args: unknown[]) => mockSpecUpsert(...args) },
    inverterSpec: { upsert: (...args: unknown[]) => mockSpecUpsert(...args) },
    batterySpec: { upsert: (...args: unknown[]) => mockSpecUpsert(...args) },
    pendingCatalogPush: { update: (...args: unknown[]) => mockUpdate(...args) },
  };
  return fn(txClient);
});

jest.mock("@/lib/db", () => ({
  prisma: {
    pendingCatalogPush: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
    internalProduct: {
      update: (...args: unknown[]) => mockEquipmentUpdate(...args),
    },
    catalogProduct: {
      findMany: (...args: unknown[]) => mockCatalogFindMany(...args),
      findUnique: (...args: unknown[]) => mockCatalogFindUnique(...args),
    },
    $transaction: mockTransaction,
  },
  logActivity: jest.fn().mockResolvedValue(null),
}));

// ── Enums ─────────────────────────────────────────────────────────────────────
jest.mock("@/generated/prisma/enums", () => ({
  EquipmentCategory: {
    MODULE: "MODULE",
    INVERTER: "INVERTER",
    BATTERY: "BATTERY",
    EV_CHARGER: "EV_CHARGER",
    RAPID_SHUTDOWN: "RAPID_SHUTDOWN",
    RACKING: "RACKING",
    ELECTRICAL_BOS: "ELECTRICAL_BOS",
    MONITORING: "MONITORING",
    BATTERY_EXPANSION: "BATTERY_EXPANSION",
    OPTIMIZER: "OPTIMIZER",
    GATEWAY: "GATEWAY",
    D_AND_R: "D_AND_R",
    SERVICE: "SERVICE",
    ADDER_SERVICES: "ADDER_SERVICES",
    TESLA_SYSTEM_COMPONENTS: "TESLA_SYSTEM_COMPONENTS",
    PROJECT_MILESTONES: "PROJECT_MILESTONES",
  },
}));

// ── Route under test ──────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { POST } from "@/app/api/catalog/push-requests/[id]/approve/route";
import * as activityLog from "@/lib/catalog-activity-log";

// ── Helpers ───────────────────────────────────────────────────────────────────
function makePush(overrides: Record<string, unknown> = {}) {
  return {
    id: "push_1",
    status: "PENDING",
    brand: "REC",
    model: "REC-400AA",
    description: "400W Module",
    category: "MODULE",
    unitSpec: "400",
    unitLabel: "W",
    sku: "REC400",
    vendorName: "BayWa",
    vendorPartNumber: "V-REC-400",
    unitCost: 120,
    sellPrice: 180,
    hardToProcure: false,
    length: 68.5,
    width: 40.2,
    weight: 46,
    metadata: null,
    systems: ["INTERNAL"],
    ...overrides,
  };
}

function makeParams(id = "push_1") {
  return { params: Promise.resolve({ id }) };
}

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  pushState = {
    id: "push_1",
    status: "PENDING",
    internalSkuId: null,
    zohoItemId: null,
    hubspotProductId: null,
    zuperItemId: null,
    resolvedAt: null,
    note: null,
  };
  mockRequireApiAuth.mockResolvedValue({ email: "admin@photonbrothers.com", role: "ADMIN" });
  // Default: product does not exist yet → wasInternalCreate = true
  mockInternalProductFindUnique.mockResolvedValue(null);
  mockUpsert.mockResolvedValue({ id: "sku_1" });
  mockUpdate.mockImplementation((args: { data?: Record<string, unknown> }) => {
    const nextData = args?.data ?? {};
    pushState = {
      ...pushState,
      ...nextData,
    };
    return Promise.resolve({ ...pushState });
  });
  mockEquipmentUpdate.mockResolvedValue({ id: "sku_1" });
  mockCatalogFindMany.mockResolvedValue([]);
  mockCatalogFindUnique.mockResolvedValue(null);
  mockCreateOrUpdateHubSpotProduct.mockResolvedValue({
    hubspotProductId: "hs_prod_1",
    created: true,
  });
  mockCreateOrUpdateZohoItem.mockResolvedValue({
    zohoItemId: "zoho_item_1",
    created: true,
  });
  mockCreateOrUpdateZuperPart.mockResolvedValue({
    zuperItemId: "zuper_item_1",
    created: true,
  });
  // Cross-link defaults (succeed silently)
  mockZohoUpdateItem.mockResolvedValue({ status: "updated", message: "ok" });
  mockUpdateZuperPart.mockResolvedValue({ status: "updated", zuperItemId: "zuper_item_1", message: "ok" });
  mockBuildZuperProductCustomFields.mockReturnValue({ hubspot_product_id: "hs_prod_1", zoho_item_id: "zoho_item_1", internal_product_id: "sku_1" });
  // Global fetch for HubSpot cross-link PATCH
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as jest.Mock;
  process.env.HUBSPOT_ACCESS_TOKEN = "test-token";
});

// ── Auth & Guard tests ───────────────────────────────────────────────────────

describe("POST /api/catalog/push-requests/[id]/approve", () => {
  describe("auth guards", () => {
    it("returns 403 when user lacks admin role", async () => {
      mockRequireApiAuth.mockResolvedValue({ email: "viewer@test.com", role: "VIEWER" });

      const res = await POST(new NextRequest("http://localhost"), makeParams());
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toMatch(/admin/i);
    });

    it("returns auth error when requireApiAuth returns NextResponse", async () => {
      mockRequireApiAuth.mockResolvedValue(NextResponse.json({ error: "Unauthenticated" }, { status: 401 }));

      const res = await POST(new NextRequest("http://localhost"), makeParams());
      expect(res.status).toBe(401);
    });

    it("allows MANAGER role", async () => {
      mockRequireApiAuth.mockResolvedValue({ email: "mgr@test.com", role: "MANAGER" });
      mockFindUnique.mockResolvedValue(makePush());

      const res = await POST(new NextRequest("http://localhost"), makeParams());
      expect(res.status).toBe(200);
    });

    it("allows OWNER role", async () => {
      mockRequireApiAuth.mockResolvedValue({ email: "owner@test.com", role: "OWNER" });
      mockFindUnique.mockResolvedValue(makePush());

      const res = await POST(new NextRequest("http://localhost"), makeParams());
      expect(res.status).toBe(200);
    });
  });

  describe("push request guards", () => {
    it("returns 404 when push request not found", async () => {
      mockFindUnique.mockResolvedValue(null);

      const res = await POST(new NextRequest("http://localhost"), makeParams("nonexistent"));
      expect(res.status).toBe(404);
    });

    it("returns 409 when push is already approved", async () => {
      mockFindUnique.mockResolvedValue(makePush({ status: "APPROVED" }));

      const res = await POST(new NextRequest("http://localhost"), makeParams());
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toMatch(/already approved/i);
    });

    it("returns 409 when push is already rejected", async () => {
      mockFindUnique.mockResolvedValue(makePush({ status: "REJECTED" }));

      const res = await POST(new NextRequest("http://localhost"), makeParams());
      expect(res.status).toBe(409);
    });
  });

  // ── Transaction atomicity ────────────────────────────────────────────────

  describe("transaction atomicity", () => {
    it("runs SKU upsert and core ID persistence in same $transaction", async () => {
      mockFindUnique.mockResolvedValue(makePush());

      await POST(new NextRequest("http://localhost"), makeParams());

      // First transaction contains core internal writes.
      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockUpsert).toHaveBeenCalledTimes(1);
      expect(mockUpdate).toHaveBeenCalledTimes(2);
      expect(mockUpdate.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          where: { id: "push_1" },
          data: expect.objectContaining({
            internalSkuId: "sku_1",
          }),
        })
      );
      expect(mockUpdate.mock.calls[1][0]).toEqual(
        expect.objectContaining({
          where: { id: "push_1" },
          data: expect.objectContaining({
            status: "APPROVED",
          }),
        })
      );
    });

    it("includes resolvedAt timestamp in status update", async () => {
      mockFindUnique.mockResolvedValue(makePush());

      await POST(new NextRequest("http://localhost"), makeParams());

      const statusCall = mockUpdate.mock.calls.find(
        (call) => (call[0] as { data?: Record<string, unknown> })?.data?.status === "APPROVED"
      )?.[0] as { data: Record<string, unknown> } | undefined;
      expect(statusCall?.data.resolvedAt).toBeInstanceOf(Date);
    });
  });

  // ── Internal catalog writes ────────────────────────────────────────────

  describe("internal catalog writes", () => {
    it("upserts InternalProduct with all common fields", async () => {
      mockFindUnique.mockResolvedValue(makePush());

      await POST(new NextRequest("http://localhost"), makeParams());

      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            category_brand_model: {
              category: "MODULE",
              brand: "REC",
              model: "REC-400AA",
            },
          },
          create: expect.objectContaining({
            brand: "REC",
            model: "REC-400AA",
            sku: "REC400",
            vendorName: "BayWa",
            unitCost: 120,
            sellPrice: 180,
            hardToProcure: false,
          }),
          update: expect.objectContaining({
            isActive: true,
            sku: "REC400",
          }),
        })
      );
    });

    it("parses unitSpec string to float", async () => {
      mockFindUnique.mockResolvedValue(makePush({ unitSpec: "410.5" }));

      await POST(new NextRequest("http://localhost"), makeParams());

      const upsertArg = mockUpsert.mock.calls[0][0] as { create: Record<string, unknown> };
      expect(upsertArg.create.unitSpec).toBe(410.5);
    });

    it("handles null unitSpec gracefully", async () => {
      mockFindUnique.mockResolvedValue(makePush({ unitSpec: null }));

      await POST(new NextRequest("http://localhost"), makeParams());

      const upsertArg = mockUpsert.mock.calls[0][0] as { create: Record<string, unknown> };
      expect(upsertArg.create.unitSpec).toBeNull();
    });

    it("handles non-numeric unitSpec gracefully", async () => {
      mockFindUnique.mockResolvedValue(makePush({ unitSpec: "N/A" }));

      await POST(new NextRequest("http://localhost"), makeParams());

      const upsertArg = mockUpsert.mock.calls[0][0] as { create: Record<string, unknown> };
      expect(upsertArg.create.unitSpec).toBeNull();
    });
  });

  // ── Spec table writes ──────────────────────────────────────────────────

  describe("spec table writes", () => {
    it("upserts spec table when metadata is present", async () => {
      const metadata = { wattage: 410, cellType: "Mono PERC", efficiency: 21.3 };
      mockFindUnique.mockResolvedValue(makePush({ metadata }));

      await POST(new NextRequest("http://localhost"), makeParams());

      expect(mockSpecUpsert).toHaveBeenCalledTimes(1);
      expect(mockSpecUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { internalProductId: "sku_1" },
          create: expect.objectContaining({ internalProductId: "sku_1", wattage: 410 }),
          update: expect.objectContaining({ wattage: 410 }),
        })
      );
    });

    it("skips spec table when metadata is null", async () => {
      mockFindUnique.mockResolvedValue(makePush({ metadata: null }));

      await POST(new NextRequest("http://localhost"), makeParams());

      expect(mockSpecUpsert).not.toHaveBeenCalled();
    });

    it("skips spec table when metadata is empty object", async () => {
      mockFindUnique.mockResolvedValue(makePush({ metadata: {} }));

      await POST(new NextRequest("http://localhost"), makeParams());

      expect(mockSpecUpsert).not.toHaveBeenCalled();
    });

    it("skips spec table for categories without one (e.g. OPTIMIZER)", async () => {
      mockFindUnique.mockResolvedValue(
        makePush({ category: "OPTIMIZER", metadata: { someField: "val" } })
      );

      await POST(new NextRequest("http://localhost"), makeParams());

      // SKU upsert still happens, but spec table upsert does not
      expect(mockUpsert).toHaveBeenCalledTimes(1);
      expect(mockSpecUpsert).not.toHaveBeenCalled();
    });
  });

  // ── Non-INTERNAL systems ───────────────────────────────────────────────

  describe("non-INTERNAL systems", () => {
    it("skips internal catalog when INTERNAL is not in systems", async () => {
      mockFindUnique.mockResolvedValue(makePush({ systems: ["ZOHO"] }));

      const res = await POST(new NextRequest("http://localhost"), makeParams());
      const data = await res.json();

      // No SKU upsert
      expect(mockUpsert).not.toHaveBeenCalled();
      // Two transactions: approval + external ID persistence
      expect(mockTransaction).toHaveBeenCalledTimes(2);
      // Final status update happens after external result processing
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "APPROVED",
          }),
        })
      );
      expect(data.summary).toEqual({
        selected: 1,
        success: 1,
        failed: 0,
        skipped: 0,
        notImplemented: 0,
      });
      expect(data.outcomes.ZOHO.status).toBe("success");
    });

    it("reports failed ZOHO outcome when adapter throws", async () => {
      mockFindUnique.mockResolvedValue(makePush({ systems: ["INTERNAL", "ZOHO"] }));
      mockCreateOrUpdateZohoItem.mockRejectedValue(new Error("Zoho unavailable"));

      const res = await POST(new NextRequest("http://localhost"), makeParams());
      const data = await res.json();

      expect(data.push.status).toBe("PENDING");
      expect(data.retryable).toBe(true);
      expect(data.outcomes.ZOHO.status).toBe("failed");
      expect(data.outcomes.ZOHO.message).toMatch(/zoho unavailable/i);
      expect(data.summary).toEqual({
        selected: 2,
        success: 1,
        failed: 1,
        skipped: 0,
        notImplemented: 0,
      });
    });

    it("reports failed ZUPER outcome when adapter throws", async () => {
      mockFindUnique.mockResolvedValue(makePush({ systems: ["INTERNAL", "ZUPER"] }));
      mockCreateOrUpdateZuperPart.mockRejectedValue(new Error("Zuper unavailable"));

      const res = await POST(new NextRequest("http://localhost"), makeParams());
      const data = await res.json();

      expect(data.outcomes.ZUPER.status).toBe("failed");
      expect(data.outcomes.ZUPER.message).toMatch(/zuper unavailable/i);
      expect(data.summary).toEqual({
        selected: 2,
        success: 1,
        failed: 1,
        skipped: 0,
        notImplemented: 0,
      });
    });
  });

  describe("HubSpot push integration", () => {
    it("pushes to HubSpot and persists returned product IDs", async () => {
      mockFindUnique.mockResolvedValue(makePush({ systems: ["INTERNAL", "HUBSPOT"] }));

      const res = await POST(new NextRequest("http://localhost"), makeParams());
      const data = await res.json();

      expect(mockCreateOrUpdateHubSpotProduct).toHaveBeenCalledWith(
        expect.objectContaining({
          brand: "REC",
          model: "REC-400AA",
          sku: "REC400",
          productCategory: "Module",
          unitCost: 120,
          sellPrice: 180,
        })
      );
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "push_1" },
          data: { hubspotProductId: "hs_prod_1" },
        })
      );
      expect(mockEquipmentUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "sku_1" },
          data: { hubspotProductId: "hs_prod_1" },
        })
      );

      expect(data.push.hubspotProductId).toBe("hs_prod_1");
      expect(data.outcomes.HUBSPOT.status).toBe("success");
      expect(data.outcomes.HUBSPOT.externalId).toBe("hs_prod_1");
      expect(data.summary).toEqual({
        selected: 2,
        success: 2,
        failed: 0,
        skipped: 0,
        notImplemented: 0,
      });
      expect(mockTransaction).toHaveBeenCalledTimes(2);
    });

    it("reports failed HubSpot outcome when adapter throws", async () => {
      mockFindUnique.mockResolvedValue(makePush({ systems: ["INTERNAL", "HUBSPOT"] }));
      mockCreateOrUpdateHubSpotProduct.mockRejectedValue(new Error("HubSpot unavailable"));

      const res = await POST(new NextRequest("http://localhost"), makeParams());
      const data = await res.json();

      const hasHubSpotIdWrite = mockUpdate.mock.calls.some((call) => {
        const arg = call[0] as { data?: Record<string, unknown> };
        return arg?.data?.hubspotProductId === "hs_prod_1";
      });
      expect(hasHubSpotIdWrite).toBe(false);
      // The HubSpot product ID must NOT have been written back to the internal product
      const hasHubSpotIdOnProduct = mockEquipmentUpdate.mock.calls.some((call) => {
        const arg = call[0] as { data?: Record<string, unknown> };
        return arg?.data?.hubspotProductId !== undefined;
      });
      expect(hasHubSpotIdOnProduct).toBe(false);
      expect(data.outcomes.HUBSPOT.status).toBe("failed");
      expect(data.outcomes.HUBSPOT.message).toMatch(/hubspot unavailable/i);
      expect(data.summary).toEqual({
        selected: 2,
        success: 1,
        failed: 1,
        skipped: 0,
        notImplemented: 0,
      });
    });
  });

  describe("ZOHO push integration", () => {
    it("pushes to ZOHO and persists returned item IDs", async () => {
      mockFindUnique.mockResolvedValue(makePush({ systems: ["INTERNAL", "ZOHO"] }));

      const res = await POST(new NextRequest("http://localhost"), makeParams());
      const data = await res.json();

      expect(mockCreateOrUpdateZohoItem).toHaveBeenCalledWith(
        expect.objectContaining({
          brand: "REC",
          model: "REC-400AA",
          sku: "REC400",
          unitCost: 120,
          sellPrice: 180,
        })
      );
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "push_1" },
          data: { zohoItemId: "zoho_item_1" },
        })
      );
      expect(mockEquipmentUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "sku_1" },
          data: { zohoItemId: "zoho_item_1" },
        })
      );
      expect(data.outcomes.ZOHO.status).toBe("success");
      expect(data.outcomes.ZOHO.externalId).toBe("zoho_item_1");
      expect(data.summary).toEqual({
        selected: 2,
        success: 2,
        failed: 0,
        skipped: 0,
        notImplemented: 0,
      });
    });
  });

  describe("ZUPER push integration", () => {
    it("pushes to ZUPER and persists returned item IDs", async () => {
      mockFindUnique.mockResolvedValue(
        makePush({ systems: ["INTERNAL", "ZUPER"], metadata: { wattage: 400 } })
      );

      const res = await POST(new NextRequest("http://localhost"), makeParams());
      const data = await res.json();

      expect(mockCreateOrUpdateZuperPart).toHaveBeenCalledWith(
        expect.objectContaining({
          brand: "REC",
          model: "REC-400AA",
          sku: "REC400",
          unitCost: 120,
          sellPrice: 180,
          category: "Module",
          specification: "Spec Summary",
        })
      );
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "push_1" },
          data: { zuperItemId: "zuper_item_1" },
        })
      );
      expect(mockEquipmentUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "sku_1" },
          data: { zuperItemId: "zuper_item_1" },
        })
      );
      expect(data.outcomes.ZUPER.status).toBe("success");
      expect(data.outcomes.ZUPER.externalId).toBe("zuper_item_1");
      expect(data.summary).toEqual({
        selected: 2,
        success: 2,
        failed: 0,
        skipped: 0,
        notImplemented: 0,
      });
    });
  });

  // ── Response shape ─────────────────────────────────────────────────────

  describe("response shape", () => {
    it("returns 200 with push, outcomes, and summary on success", async () => {
      mockFindUnique.mockResolvedValue(makePush());
      mockUpdate.mockResolvedValue({
        id: "push_1",
        status: "APPROVED",
        internalSkuId: "sku_1",
        zohoItemId: null,
        hubspotProductId: null,
        zuperItemId: null,
      });

      const res = await POST(new NextRequest("http://localhost"), makeParams());

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.push.status).toBe("APPROVED");
      expect(data.retryable).toBe(false);
      expect(data.push.internalSkuId).toBe("sku_1");
      expect(data.outcomes.INTERNAL.status).toBe("success");
      expect(data.summary).toEqual({
        selected: 1,
        success: 1,
        failed: 0,
        skipped: 0,
        notImplemented: 0,
      });
      // Audit logging: logCatalogSync must be called with the correct shape
      expect(activityLog.logCatalogSync).toHaveBeenCalledWith(
        expect.objectContaining({
          internalProductId: expect.any(String),
          source: "approval_retry",
          outcomes: expect.objectContaining({
            INTERNAL: expect.objectContaining({ status: "success" }),
          }),
        })
      );
    });
  });

  // ── Cross-link warning paths ───────────────────────────────────────────

  describe("cross-link warning paths", () => {
    // Helper: push all 4 systems so cross-links run for all 3 external systems
    function setupAllSystems() {
      mockFindUnique.mockResolvedValue(makePush({ systems: ["INTERNAL", "ZOHO", "HUBSPOT", "ZUPER"] }));
    }

    it("surfaces Zoho cross-link warning when updateItem returns non-updated status", async () => {
      setupAllSystems();
      mockZohoUpdateItem.mockResolvedValue({ status: "error", message: "Field not found" });

      const res = await POST(new NextRequest("http://localhost"), makeParams());
      const data = await res.json();

      // Approval still succeeds (cross-link is best-effort)
      expect(res.status).toBe(200);
      expect(data.outcomes.ZOHO.status).toBe("success");
      expect(data.outcomes.ZOHO.message).toMatch(/Zoho cross-link update returned error/);
      expect(data.outcomes.ZOHO.message).toMatch(/Field not found/);
    });

    it("surfaces Zoho cross-link warning when updateItem throws", async () => {
      setupAllSystems();
      mockZohoUpdateItem.mockRejectedValue(new Error("Zoho timeout"));

      const res = await POST(new NextRequest("http://localhost"), makeParams());
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.outcomes.ZOHO.status).toBe("success");
      expect(data.outcomes.ZOHO.message).toMatch(/Could not write custom field cross-links/);
    });

    it("surfaces Zuper cross-link warning when updateZuperPart returns failed status", async () => {
      setupAllSystems();
      mockUpdateZuperPart.mockResolvedValue({ status: "failed", zuperItemId: "zuper_item_1", message: "Endpoint rejected" });

      const res = await POST(new NextRequest("http://localhost"), makeParams());
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.outcomes.ZUPER.status).toBe("success");
      expect(data.outcomes.ZUPER.message).toMatch(/Zuper cross-link update returned failed/);
      expect(data.outcomes.ZUPER.message).toMatch(/Endpoint rejected/);
    });

    it("surfaces Zuper cross-link warning when updateZuperPart returns not_found status", async () => {
      setupAllSystems();
      mockUpdateZuperPart.mockResolvedValue({ status: "not_found", zuperItemId: "zuper_item_1", message: "Item not found" });

      const res = await POST(new NextRequest("http://localhost"), makeParams());
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.outcomes.ZUPER.message).toMatch(/Zuper cross-link update returned not_found/);
    });

    it("surfaces Zuper cross-link warning when updateZuperPart throws", async () => {
      setupAllSystems();
      mockUpdateZuperPart.mockRejectedValue(new Error("Zuper network error"));

      const res = await POST(new NextRequest("http://localhost"), makeParams());
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.outcomes.ZUPER.status).toBe("success");
      expect(data.outcomes.ZUPER.message).toMatch(/Could not write cross-link IDs to Zuper/);
    });

    it("surfaces HubSpot cross-link warning when PATCH returns non-2xx", async () => {
      setupAllSystems();
      (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 404 });

      const res = await POST(new NextRequest("http://localhost"), makeParams());
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.outcomes.HUBSPOT.status).toBe("success");
      expect(data.outcomes.HUBSPOT.message).toMatch(/HubSpot cross-link PATCH returned 404/);
    });

    it("surfaces HubSpot cross-link warning when fetch throws", async () => {
      setupAllSystems();
      (global.fetch as jest.Mock).mockRejectedValue(new Error("Network failure"));

      const res = await POST(new NextRequest("http://localhost"), makeParams());
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.outcomes.HUBSPOT.status).toBe("success");
      expect(data.outcomes.HUBSPOT.message).toMatch(/Could not write cross-link IDs to HubSpot/);
    });

    it("does not run cross-links when only INTERNAL system is selected", async () => {
      mockFindUnique.mockResolvedValue(makePush({ systems: ["INTERNAL"] }));

      await POST(new NextRequest("http://localhost"), makeParams());

      expect(mockZohoUpdateItem).not.toHaveBeenCalled();
      expect(mockUpdateZuperPart).not.toHaveBeenCalled();
      // fetch may still be called by other code, but not for cross-link PATCH
    });
  });
});
