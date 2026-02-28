/**
 * Tests for GET /api/bom/zoho-so
 *
 * Covers all four query modes:
 *  1. ?so_number=SO-XXXX           → single SO with full line items
 *  2. ?so_numbers=SO-XXXX,SO-YYYY  → batch fetch multiple SOs
 *  3. ?search=PROJ-XXXX            → search SOs by text
 *  4. (no params)                  → list recent SOs (paginated)
 *
 * Plus auth passthrough and error handling.
 */

import { NextResponse } from "next/server";

// ── Auth ─────────────────────────────────────────────────────────────────────
const mockRequireApiAuth = jest.fn();
jest.mock("@/lib/api-auth", () => ({
  requireApiAuth: (...args: unknown[]) => mockRequireApiAuth(...args),
}));

// ── Zoho inventory client ─────────────────────────────────────────────────────
const mockGetSalesOrder = jest.fn();
const mockSearchSalesOrders = jest.fn();
const mockListSalesOrders = jest.fn();

jest.mock("@/lib/zoho-inventory", () => ({
  zohoInventory: {
    isConfigured: () => true,
    getSalesOrder: (...args: unknown[]) => mockGetSalesOrder(...args),
    searchSalesOrders: (...args: unknown[]) => mockSearchSalesOrders(...args),
    listSalesOrders: (...args: unknown[]) => mockListSalesOrders(...args),
  },
}));

// ── Route under test ──────────────────────────────────────────────────────────
import { GET } from "@/app/api/bom/zoho-so/route";
import { NextRequest } from "next/server";

function makeRequest(query: string = ""): NextRequest {
  return new NextRequest(`http://localhost:3000/api/bom/zoho-so${query ? `?${query}` : ""}`);
}

// ── Test data ─────────────────────────────────────────────────────────────────
function makeSalesOrder(overrides: Record<string, unknown> = {}) {
  return {
    salesorder_id: "so-abc",
    salesorder_number: "SO-8596",
    reference_number: "PROJ-8596",
    date: "2026-02-20",
    status: "confirmed",
    customer_name: "Eckert",
    total: 5200.0,
    delivery_method: "pickup",
    notes: "Test order",
    line_items: [
      {
        line_item_id: "li-1",
        item_id: "item-1",
        name: "Hyundai HiN-T440NF(BK)",
        sku: "HYU HIN-T440NF(BK)",
        quantity: 12,
        rate: 150,
        amount: 1800,
        description: "440W module",
      },
      {
        line_item_id: "li-2",
        item_id: "item-2",
        name: "Tesla Powerwall-3",
        sku: "1707000-21-K",
        quantity: 1,
        rate: 3400,
        amount: 3400,
        description: "Battery",
      },
      {
        line_item_id: "li-3",
        item_id: "item-3",
        name: "Permit Fees",
        sku: "Permit Fees",
        quantity: 1,
        rate: 0,
        amount: 0,
        description: "Admin",
      },
    ],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  // Default: auth passes (returns falsy = no error)
  mockRequireApiAuth.mockResolvedValue(null);
});

// ── 1. Single SO fetch (?so_number) ──────────────────────────────────────────

describe("GET /api/bom/zoho-so?so_number=SO-XXXX", () => {
  it("returns 200 with structured SO payload and filters admin line items into equipment_items", async () => {
    mockGetSalesOrder.mockResolvedValue(makeSalesOrder());

    const res = await GET(makeRequest("so_number=SO-8596"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.salesorder_number).toBe("SO-8596");
    expect(json.customer_name).toBe("Eckert");
    expect(json.line_item_count).toBe(3); // all items including admin
    expect(json.equipment_count).toBe(2); // excludes Permit Fees
    expect(json.line_items).toHaveLength(3);
    expect(json.equipment_items).toHaveLength(2);
    // Equipment items should NOT include Permit Fees
    expect(json.equipment_items.find((i: { name: string }) => i.name === "Permit Fees")).toBeUndefined();
    // But line_items should
    expect(json.line_items.find((i: { name: string }) => i.name === "Permit Fees")).toBeDefined();
  });

  it("filters all admin item types from equipment_items", async () => {
    const so = makeSalesOrder({
      line_items: [
        { line_item_id: "li-1", item_id: "i1", name: "Module", sku: "MOD-1", quantity: 10, rate: 100, amount: 1000, description: "" },
        { line_item_id: "li-2", item_id: "i2", name: "Permit Fees", sku: "PF", quantity: 1, rate: 0, amount: 0, description: "" },
        { line_item_id: "li-3", item_id: "i3", name: "Interconnection Fees", sku: "IF", quantity: 1, rate: 0, amount: 0, description: "" },
        { line_item_id: "li-4", item_id: "i4", name: "Design & Engineering", sku: "DE", quantity: 1, rate: 0, amount: 0, description: "" },
        { line_item_id: "li-5", item_id: "i5", name: "Inventory-no PO", sku: "Inventory-no PO", quantity: 1, rate: 0, amount: 0, description: "" },
      ],
    });
    mockGetSalesOrder.mockResolvedValue(so);

    const res = await GET(makeRequest("so_number=SO-8596"));
    const json = await res.json();

    expect(json.line_item_count).toBe(5);
    expect(json.equipment_count).toBe(1);
    expect(json.equipment_items).toHaveLength(1);
    expect(json.equipment_items[0].name).toBe("Module");
  });

  it("returns 500 when getSalesOrder throws", async () => {
    mockGetSalesOrder.mockRejectedValue(new Error("Sales order SO-9999 not found"));

    const res = await GET(makeRequest("so_number=SO-9999"));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain("SO-9999 not found");
  });
});

// ── 2. Batch fetch (?so_numbers) ─────────────────────────────────────────────

describe("GET /api/bom/zoho-so?so_numbers=SO-8596,SO-8721", () => {
  it("returns batch results with success/failure counts", async () => {
    mockGetSalesOrder
      .mockResolvedValueOnce(makeSalesOrder())
      .mockRejectedValueOnce(new Error("Not found"));

    const res = await GET(makeRequest("so_numbers=SO-8596,SO-8721"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.total_requested).toBe(2);
    expect(json.total_success).toBe(1);
    expect(json.total_failed).toBe(1);
    expect(json.salesorders).toHaveLength(2);
    expect(json.salesorders[0].success).toBe(true);
    expect(json.salesorders[0].data.salesorder_number).toBe("SO-8596");
    expect(json.salesorders[1].success).toBe(false);
    expect(json.salesorders[1].error).toContain("Not found");
  });

  it("rejects batch requests exceeding 50 SO numbers", async () => {
    const numbers = Array.from({ length: 51 }, (_, i) => `SO-${i}`).join(",");
    const res = await GET(makeRequest(`so_numbers=${numbers}`));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("Maximum 50");
  });
});

// ── 3. Search (?search) ──────────────────────────────────────────────────────

describe("GET /api/bom/zoho-so?search=PROJ-8596", () => {
  it("returns search results with count and has_more", async () => {
    mockSearchSalesOrders.mockResolvedValue({
      salesorders: [
        { salesorder_id: "so-1", salesorder_number: "SO-8596", customer_name: "Eckert", status: "confirmed", total: 5200, date: "2026-02-20" },
      ],
      hasMore: false,
    });

    const res = await GET(makeRequest("search=PROJ-8596"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.search).toBe("PROJ-8596");
    expect(json.count).toBe(1);
    expect(json.has_more).toBe(false);
    expect(json.salesorders).toHaveLength(1);
  });

  it("passes page and per_page to searchSalesOrders", async () => {
    mockSearchSalesOrders.mockResolvedValue({ salesorders: [], hasMore: false });

    await GET(makeRequest("search=test&page=3&per_page=50"));

    expect(mockSearchSalesOrders).toHaveBeenCalledWith("test", { page: 3, perPage: 50 });
  });
});

// ── 4. List (no params) ──────────────────────────────────────────────────────

describe("GET /api/bom/zoho-so (list mode)", () => {
  it("returns paginated SO list when no query params provided", async () => {
    mockListSalesOrders.mockResolvedValue({
      salesorders: [
        { salesorder_id: "so-1", salesorder_number: "SO-8596" },
        { salesorder_id: "so-2", salesorder_number: "SO-8721" },
      ],
      hasMore: true,
    });

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.page).toBe(1);
    expect(json.count).toBe(2);
    expect(json.has_more).toBe(true);
    expect(json.salesorders).toHaveLength(2);
  });

  it("passes pagination params to listSalesOrders", async () => {
    mockListSalesOrders.mockResolvedValue({ salesorders: [], hasMore: false });

    await GET(makeRequest("page=2&per_page=100"));

    expect(mockListSalesOrders).toHaveBeenCalledWith({
      page: 2,
      perPage: 100,
      sortColumn: "created_time",
      sortOrder: "D",
    });
  });
});

// ── 5. Auth ──────────────────────────────────────────────────────────────────

describe("GET /api/bom/zoho-so — auth", () => {
  it("returns auth error when requireApiAuth returns a response", async () => {
    const authError = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    mockRequireApiAuth.mockResolvedValue(authError);

    const res = await GET(makeRequest("so_number=SO-8596"));

    expect(res.status).toBe(401);
    expect(mockGetSalesOrder).not.toHaveBeenCalled();
  });
});
