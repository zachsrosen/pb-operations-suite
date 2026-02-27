// src/__tests__/api/catalog-push-approve.test.ts

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
  getHubspotPropertiesFromMetadata: jest.fn(() => ({})),
}));

// ── HubSpot adapter ────────────────────────────────────────────────────────────
const mockCreateOrUpdateHubSpotProduct = jest.fn();
jest.mock("@/lib/hubspot", () => ({
  createOrUpdateHubSpotProduct: (...args: unknown[]) => mockCreateOrUpdateHubSpotProduct(...args),
}));

// ── Prisma ────────────────────────────────────────────────────────────────────
const mockFindUnique = jest.fn();
const mockUpsert = jest.fn();
const mockUpdate = jest.fn();
const mockSpecUpsert = jest.fn();
const mockPendingPushUpdate = jest.fn();
const mockEquipmentUpdate = jest.fn();

// $transaction receives a callback; we execute it with a fake tx client
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockTransaction = jest.fn(async (fn: any) => {
  const txClient = {
    equipmentSku: { upsert: (...args: unknown[]) => mockUpsert(...args) },
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
      update: (...args: unknown[]) => mockPendingPushUpdate(...args),
    },
    equipmentSku: {
      update: (...args: unknown[]) => mockEquipmentUpdate(...args),
    },
    $transaction: mockTransaction,
  },
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
  mockRequireApiAuth.mockResolvedValue({ email: "admin@photonbrothers.com", role: "ADMIN" });
  mockUpsert.mockResolvedValue({ id: "sku_1" });
  mockUpdate.mockResolvedValue({
    id: "push_1",
    status: "APPROVED",
    internalSkuId: "sku_1",
    zohoItemId: null,
    hubspotProductId: null,
    zuperItemId: null,
  });
  mockPendingPushUpdate.mockResolvedValue({
    id: "push_1",
    status: "APPROVED",
    internalSkuId: "sku_1",
    zohoItemId: null,
    hubspotProductId: "hs_prod_1",
    zuperItemId: null,
  });
  mockEquipmentUpdate.mockResolvedValue({ id: "sku_1" });
  mockCreateOrUpdateHubSpotProduct.mockResolvedValue({
    hubspotProductId: "hs_prod_1",
    created: true,
  });
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
    it("runs SKU upsert and status update in same $transaction", async () => {
      mockFindUnique.mockResolvedValue(makePush());

      await POST(new NextRequest("http://localhost"), makeParams());

      // $transaction called exactly once — both writes inside
      expect(mockTransaction).toHaveBeenCalledTimes(1);
      // SKU upsert called inside transaction
      expect(mockUpsert).toHaveBeenCalledTimes(1);
      // Status update called inside transaction
      expect(mockUpdate).toHaveBeenCalledTimes(1);
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "push_1" },
          data: expect.objectContaining({
            status: "APPROVED",
            internalSkuId: "sku_1",
          }),
        })
      );
    });

    it("includes resolvedAt timestamp in status update", async () => {
      mockFindUnique.mockResolvedValue(makePush());

      await POST(new NextRequest("http://localhost"), makeParams());

      const updateCall = mockUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(updateCall.data.resolvedAt).toBeInstanceOf(Date);
    });
  });

  // ── Internal catalog writes ────────────────────────────────────────────

  describe("internal catalog writes", () => {
    it("upserts EquipmentSku with all common fields", async () => {
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
          where: { skuId: "sku_1" },
          create: expect.objectContaining({ skuId: "sku_1", wattage: 410 }),
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
      // Transaction still called for status update
      expect(mockTransaction).toHaveBeenCalledTimes(1);
      // Status update with null internalSkuId
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "APPROVED",
            internalSkuId: null,
          }),
        })
      );
      expect(data.summary).toEqual({
        selected: 1,
        success: 0,
        failed: 0,
        skipped: 0,
        notImplemented: 1,
      });
      expect(data.outcomes.ZOHO.status).toBe("not_implemented");
    });

    it("logs ZOHO stub when ZOHO system selected", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();
      mockFindUnique.mockResolvedValue(makePush({ systems: ["INTERNAL", "ZOHO"] }));

      await POST(new NextRequest("http://localhost"), makeParams());

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("ZOHO"),
        expect.any(String)
      );
      consoleSpy.mockRestore();
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
      expect(mockPendingPushUpdate).toHaveBeenCalledWith(
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
    });

    it("reports failed HubSpot outcome when adapter throws", async () => {
      mockFindUnique.mockResolvedValue(makePush({ systems: ["INTERNAL", "HUBSPOT"] }));
      mockCreateOrUpdateHubSpotProduct.mockRejectedValue(new Error("HubSpot unavailable"));

      const res = await POST(new NextRequest("http://localhost"), makeParams());
      const data = await res.json();

      expect(mockPendingPushUpdate).not.toHaveBeenCalled();
      expect(mockEquipmentUpdate).not.toHaveBeenCalled();
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
      expect(data.push.internalSkuId).toBe("sku_1");
      expect(data.outcomes.INTERNAL.status).toBe("success");
      expect(data.summary).toEqual({
        selected: 1,
        success: 1,
        failed: 0,
        skipped: 0,
        notImplemented: 0,
      });
    });
  });
});
