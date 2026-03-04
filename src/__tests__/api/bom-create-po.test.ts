/**
 * Tests for POST /api/bom/create-po
 *
 * Focused on two critical behaviours:
 *  1. Non-inventory BOM categories (RACKING, RAPID_SHUTDOWN, etc.) are silently
 *     skipped during SKU lookup and do NOT cause a Prisma enum validation error.
 *  2. The idempotency guard returns the existing PO ID when zohoPoId is already set.
 */

// ── Auth ─────────────────────────────────────────────────────────────────────
jest.mock("@/lib/api-auth", () => ({
  requireApiAuth: jest.fn(async () => ({
    email: "test@photonbrothers.com",
    role: "ADMIN",
    ip: "127.0.0.1",
    userAgent: "jest",
  })),
}));

// ── Prisma ────────────────────────────────────────────────────────────────────
const mockFindFirst = jest.fn();
const mockFindMany = jest.fn();
const mockUpdate = jest.fn();

jest.mock("@/lib/db", () => ({
  prisma: {
    projectBomSnapshot: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
    equipmentSku: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
  },
  logActivity: jest.fn(async () => {}),
}));

// ── Zoho inventory client ─────────────────────────────────────────────────────
const mockCreatePurchaseOrder = jest.fn();
jest.mock("@/lib/zoho-inventory", () => ({
  zohoInventory: {
    isConfigured: () => true,
    createPurchaseOrder: (...args: unknown[]) => mockCreatePurchaseOrder(...args),
  },
}));

// ── Route under test ──────────────────────────────────────────────────────────
import { POST } from "@/app/api/bom/create-po/route";
import { NextRequest } from "next/server";

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost:3000/api/bom/create-po", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── Shared snapshot factory ───────────────────────────────────────────────────
function makeSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: "snap-1",
    dealId: "deal-123",
    dealName: "Test Project",
    version: 1,
    zohoPoId: null,
    bomData: {
      project: { address: "123 Solar St" },
      items: [
        // Inventory item — should generate a skuLookup
        { category: "MODULE", brand: "QCell", model: "Q.PEAK-400", description: "400W module", qty: 32 },
        // Non-inventory items — must NOT be cast to EquipmentCategory enum
        { category: "RACKING", brand: null, model: null, description: "IronRidge XR100", qty: 1 },
        { category: "RAPID_SHUTDOWN", brand: null, model: null, description: "Tigo TS4-F", qty: 32 },
        { category: "ELECTRICAL_BOS", brand: null, model: null, description: "Conduit kit", qty: 2 },
      ],
    },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdate.mockResolvedValue({});
  mockCreatePurchaseOrder.mockResolvedValue({
    purchaseorder_id: "po-abc",
    purchaseorder_number: "PO-001",
  });
});

// ── Test 1: Non-inventory categories don't cause enum errors ──────────────────
describe("POST /api/bom/create-po — non-inventory category filtering", () => {
  it("skips RACKING/RAPID_SHUTDOWN/ELECTRICAL_BOS in SKU lookup and succeeds", async () => {
    mockFindFirst.mockResolvedValue(makeSnapshot());
    // Only MODULE matches — so findMany is called with only that one category
    mockFindMany.mockResolvedValue([]);

    const req = makeRequest({ dealId: "deal-123", version: 1, vendorId: "vendor-1" });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.purchaseorder_id).toBe("po-abc");

    // findMany should only have been called for MODULE (1 item), NOT for RACKING etc.
    expect(mockFindMany).toHaveBeenCalledTimes(1);
    const findManyArgs = mockFindMany.mock.calls[0][0] as {
      where: { OR: Array<{ category: string }> };
    };
    const lookedUpCategories = findManyArgs.where.OR.map((c) => c.category);
    expect(lookedUpCategories).toEqual(["MODULE"]);
    expect(lookedUpCategories).not.toContain("RACKING");
    expect(lookedUpCategories).not.toContain("RAPID_SHUTDOWN");
    expect(lookedUpCategories).not.toContain("ELECTRICAL_BOS");

    // All 4 BOM items still appear as Zoho line items (unmatched ones have no item_id)
    const poPayload = mockCreatePurchaseOrder.mock.calls[0][0] as {
      line_items: Array<{ name: string; item_id?: string }>;
    };
    expect(poPayload.line_items).toHaveLength(4);
    // Non-inventory items should have no item_id
    const rackingItem = poPayload.line_items.find((li) => li.name === "IronRidge XR100");
    expect(rackingItem).toBeDefined();
    expect(rackingItem).not.toHaveProperty("item_id");
  });

  it("counts all non-matched items (including non-inventory) in unmatchedCount", async () => {
    mockFindFirst.mockResolvedValue(makeSnapshot());
    mockFindMany.mockResolvedValue([]); // no SKU matches at all

    const req = makeRequest({ dealId: "deal-123", version: 1, vendorId: "vendor-1" });
    const res = await POST(req);
    const json = await res.json();

    // 4 items total, 0 zohoItemId matches → unmatchedCount = 4
    expect(json.unmatchedCount).toBe(4);
  });
});

// ── Test 2: Idempotency guard ─────────────────────────────────────────────────
describe("POST /api/bom/create-po — idempotency guard", () => {
  it("returns existing PO ID when zohoPoId is already set without calling Zoho again", async () => {
    mockFindFirst.mockResolvedValue(makeSnapshot({ zohoPoId: "po-existing-123" }));

    const req = makeRequest({ dealId: "deal-123", version: 1, vendorId: "vendor-1" });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.purchaseorder_id).toBe("po-existing-123");
    expect(json.alreadyExisted).toBe(true);
    expect(mockCreatePurchaseOrder).not.toHaveBeenCalled();
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// ── Test 3: Quantity parsing ──────────────────────────────────────────────────
describe("POST /api/bom/create-po — quantity parsing", () => {
  it("treats qty:0 as 1 (minimum), not as 0", async () => {
    const snap = makeSnapshot();
    // Patch the MODULE qty to 0
    (snap.bomData.items[0] as Record<string, unknown>).qty = 0;
    mockFindFirst.mockResolvedValue(snap);
    mockFindMany.mockResolvedValue([]);

    const req = makeRequest({ dealId: "deal-123", version: 1, vendorId: "vendor-1" });
    await POST(req);

    const poPayload = mockCreatePurchaseOrder.mock.calls[0][0] as {
      line_items: Array<{ name: string; quantity: number }>;
    };
    const moduleItem = poPayload.line_items.find((li) => li.name.includes("Q.PEAK"));
    expect(moduleItem?.quantity).toBe(1);
  });

  it("rounds fractional quantities", async () => {
    const snap = makeSnapshot();
    (snap.bomData.items[0] as Record<string, unknown>).qty = "1.7";
    mockFindFirst.mockResolvedValue(snap);
    mockFindMany.mockResolvedValue([]);

    const req = makeRequest({ dealId: "deal-123", version: 1, vendorId: "vendor-1" });
    await POST(req);

    const poPayload = mockCreatePurchaseOrder.mock.calls[0][0] as {
      line_items: Array<{ name: string; quantity: number }>;
    };
    const moduleItem = poPayload.line_items.find((li) => li.name.includes("Q.PEAK"));
    expect(moduleItem?.quantity).toBe(2);
  });
});
