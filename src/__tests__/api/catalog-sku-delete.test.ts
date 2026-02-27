// src/__tests__/api/catalog-sku-delete.test.ts

// ── Auth ──────────────────────────────────────────────────────────────────────
const mockRequireApiAuth = jest.fn();
jest.mock("@/lib/api-auth", () => ({
  requireApiAuth: (...args: unknown[]) => mockRequireApiAuth(...args),
}));

// ── Sentry ────────────────────────────────────────────────────────────────────
jest.mock("@sentry/nextjs", () => ({ captureException: jest.fn() }));
jest.mock("@/lib/sentry-request", () => ({ tagSentryRequest: jest.fn() }));

// ── Prisma ────────────────────────────────────────────────────────────────────
const mockFindUnique = jest.fn();
const mockDelete = jest.fn();
const mockTransaction = jest.fn();
const mockUserFindUnique = jest.fn();
const mockAuditCreate = jest.fn();
const mockPushUpdateMany = jest.fn();
const mockPushCount = jest.fn();

jest.mock("@/lib/db", () => ({
  prisma: {
    equipmentSku: { findUnique: (...args: unknown[]) => mockFindUnique(...args) },
    user: { findUnique: (...args: unknown[]) => mockUserFindUnique(...args) },
    catalogAuditLog: { create: (...args: unknown[]) => mockAuditCreate(...args) },
    pendingCatalogPush: {
      updateMany: (...args: unknown[]) => mockPushUpdateMany(...args),
      count: (...args: unknown[]) => mockPushCount(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

import { NextRequest } from "next/server";

// Import after mocks
const { DELETE } = require("@/app/api/inventory/skus/[id]/route") as {
  DELETE: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
};

function makeRequest(body?: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/inventory/skus/test-id", {
    method: "DELETE",
    ...(body ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}),
  });
}

function makeCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

const ADMIN_USER = { email: "admin@test.com", role: "ADMIN", ip: "127.0.0.1", userAgent: "test" };
const NON_ADMIN_USER = { email: "user@test.com", role: "PROJECT_MANAGER", ip: "127.0.0.1", userAgent: "test" };

const BASIC_SKU = {
  id: "sku-1",
  category: "MODULE",
  brand: "TestBrand",
  model: "TestModel",
  description: null,
  vendorName: null,
  vendorPartNumber: null,
  unitSpec: 400,
  unitLabel: "W",
  unitCost: 100,
  sellPrice: 200,
  sku: null,
  hardToProcure: false,
  length: null,
  width: null,
  weight: null,
  isActive: true,
  zohoItemId: null,
  hubspotProductId: null,
  zuperItemId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  stockLevels: [],
  moduleSpec: null,
  inverterSpec: null,
  batterySpec: null,
  evChargerSpec: null,
  mountingHardwareSpec: null,
  electricalHardwareSpec: null,
  relayDeviceSpec: null,
};

const DB_USER = { id: "user-db-1", email: "admin@test.com" };

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireApiAuth.mockResolvedValue(ADMIN_USER);
  mockUserFindUnique.mockResolvedValue(DB_USER);
  mockPushCount.mockResolvedValue(0);
  // Default: transaction executes the callback
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
    const tx = {
      equipmentSku: {
        findUnique: mockFindUnique,
        delete: mockDelete,
      },
      user: { findUnique: mockUserFindUnique },
      catalogAuditLog: { create: mockAuditCreate },
      pendingCatalogPush: {
        updateMany: mockPushUpdateMany,
        count: mockPushCount,
      },
    };
    return fn(tx);
  });
});

describe("DELETE /api/inventory/skus/[id]", () => {
  it("returns 401 when not authenticated", async () => {
    const { NextResponse } = await import("next/server");
    mockRequireApiAuth.mockResolvedValue(
      NextResponse.json({ error: "Authentication required" }, { status: 401 })
    );
    const res = await DELETE(makeRequest(), makeCtx("sku-1"));
    expect(res.status).toBe(401);
  });

  it("returns 403 when user is not ADMIN", async () => {
    mockRequireApiAuth.mockResolvedValue(NON_ADMIN_USER);
    const res = await DELETE(makeRequest(), makeCtx("sku-1"));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/ADMIN/i);
  });

  it("returns 404 when SKU not found", async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await DELETE(makeRequest(), makeCtx("nonexistent"));
    expect(res.status).toBe(404);
  });

  it("returns preflight with syncedSystems when SKU is synced and force=false", async () => {
    mockFindUnique.mockResolvedValue({ ...BASIC_SKU, zohoItemId: "z-1", hubspotProductId: "h-1" });
    const res = await DELETE(makeRequest(), makeCtx("sku-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.preflight).toBe(true);
    expect(body.syncedSystems).toContain("ZOHO");
    expect(body.syncedSystems).toContain("HUBSPOT");
    expect(body.syncedSystems).not.toContain("ZUPER");
    // Verify no deletion occurred
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("returns preflight with pendingCount when SKU has pending pushes and force=false", async () => {
    mockFindUnique.mockResolvedValue(BASIC_SKU);
    mockPushCount.mockResolvedValue(2);
    const res = await DELETE(makeRequest(), makeCtx("sku-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.preflight).toBe(true);
    expect(body.pendingCount).toBe(2);
    // Verify it filters by PENDING status only (not APPROVED)
    expect(mockPushCount).toHaveBeenCalledWith({
      where: { internalSkuId: "sku-1", status: "PENDING" },
    });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("returns preflight with both sync + pending warnings when both apply", async () => {
    mockFindUnique.mockResolvedValue({ ...BASIC_SKU, zohoItemId: "z-1" });
    mockPushCount.mockResolvedValue(3);
    const res = await DELETE(makeRequest(), makeCtx("sku-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.preflight).toBe(true);
    expect(body.syncedSystems).toContain("ZOHO");
    expect(body.pendingCount).toBe(3);
  });

  it("returns preflight with no warnings for clean unsynced SKU (force=false)", async () => {
    mockFindUnique.mockResolvedValue(BASIC_SKU);
    const res = await DELETE(makeRequest(), makeCtx("sku-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.preflight).toBe(true);
    expect(body.syncedSystems).toBeUndefined();
    expect(body.pendingCount).toBeUndefined();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("deletes SKU with force=true even when synced", async () => {
    mockFindUnique.mockResolvedValue({ ...BASIC_SKU, zohoItemId: "z-1" });
    mockDelete.mockResolvedValue({ id: "sku-1" });
    mockAuditCreate.mockResolvedValue({ id: "audit-1" });
    const res = await DELETE(makeRequest({ force: true }), makeCtx("sku-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(true);
    expect(body.auditLogId).toBe("audit-1");
  });

  it("creates audit log with full snapshot", async () => {
    mockFindUnique.mockResolvedValue(BASIC_SKU);
    mockDelete.mockResolvedValue({ id: "sku-1" });
    mockAuditCreate.mockResolvedValue({ id: "audit-1" });
    await DELETE(makeRequest({ force: true }), makeCtx("sku-1"));
    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "SKU_DELETE",
        skuId: "sku-1",
        snapshot: expect.objectContaining({ id: "sku-1", brand: "TestBrand" }),
        deletedByUserId: "user-db-1",
        deletedByEmail: "admin@test.com",
      }),
    });
  });

  it("nulls out PendingCatalogPush.internalSkuId references", async () => {
    mockFindUnique.mockResolvedValue(BASIC_SKU);
    mockDelete.mockResolvedValue({ id: "sku-1" });
    mockAuditCreate.mockResolvedValue({ id: "audit-1" });
    await DELETE(makeRequest({ force: true }), makeCtx("sku-1"));
    expect(mockPushUpdateMany).toHaveBeenCalledWith({
      where: { internalSkuId: "sku-1" },
      data: { internalSkuId: null },
    });
  });

  it("returns 400 for missing id param", async () => {
    const res = await DELETE(makeRequest(), makeCtx(""));
    expect(res.status).toBe(400);
  });
});
