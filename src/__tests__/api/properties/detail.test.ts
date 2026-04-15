/**
 * Tests for GET /api/properties/[id] — Task 5.1 of the HubSpot Property plan.
 *
 * Covers:
 *   1. 404 when the cache row is missing
 *   2. 403 when the caller's role fails the `canAccessRoute("/api/service")`
 *      gate — exercises the REAL role-permissions module (no canAccessRoute
 *      mock) so the test catches regressions in the role matrix.
 *   3. Happy path: hydrated PropertyDetail with owners + deals + tickets +
 *      equipment summary derived from a mocked `fetchLineItemsForDeals`.
 */

// ── Mock: auth + getUserByEmail ───────────────────────────────────────────────
const mockAuth = jest.fn();
jest.mock("@/auth", () => ({
  auth: () => mockAuth(),
}));

const mockGetUserByEmail = jest.fn();
const mockPropertyFindUnique = jest.fn();
const mockInternalProductFindMany = jest.fn();

jest.mock("@/lib/db", () => ({
  prisma: {
    hubSpotPropertyCache: {
      findUnique: (...args: unknown[]) => mockPropertyFindUnique(...args),
    },
    internalProduct: {
      findMany: (...args: unknown[]) => mockInternalProductFindMany(...args),
    },
  },
  getUserByEmail: (email: string) => mockGetUserByEmail(email),
}));

// ── Mock: HubSpot line-items fetch (only live call the route makes) ───────────
const mockFetchLineItemsForDeals = jest.fn();
jest.mock("@/lib/hubspot", () => ({
  fetchLineItemsForDeals: (dealIds: string[]) =>
    mockFetchLineItemsForDeals(dealIds),
}));

// ── Route under test ──────────────────────────────────────────────────────────
import { GET } from "@/app/api/properties/[id]/route";
import { NextRequest } from "next/server";

function makeReq(id: string): NextRequest {
  return new NextRequest(`http://test/api/properties/${id}`, { method: "GET" });
}

async function callGet(id: string) {
  return GET(makeReq(id), { params: Promise.resolve({ id }) });
}

describe("GET /api/properties/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { email: "user@photonbrothers.com" } });
  });

  it("returns 404 when the cache row is missing", async () => {
    mockGetUserByEmail.mockResolvedValue({ id: "u1", role: "ADMIN" });
    mockPropertyFindUnique.mockResolvedValue(null);

    const res = await callGet("999");

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Property not found");
    expect(mockFetchLineItemsForDeals).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller's role fails the /api/service gate", async () => {
    // VIEWER is defined in role-permissions.ts without /api/service in
    // allowedRoutes. We do NOT mock canAccessRoute — we exercise the real
    // function so the test would catch a permission-matrix regression.
    mockGetUserByEmail.mockResolvedValue({ id: "u1", role: "VIEWER" });

    const res = await callGet("123");

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Forbidden");
    expect(mockPropertyFindUnique).not.toHaveBeenCalled();
  });

  it("returns hydrated PropertyDetail with owners + deals + tickets + equipment", async () => {
    mockGetUserByEmail.mockResolvedValue({ id: "u1", role: "ADMIN" });

    const createdAt = new Date("2025-01-01T00:00:00.000Z");
    const mostRecentContactLinkAt = new Date("2026-02-01T12:00:00.000Z");
    const olderContactLinkAt = new Date("2025-06-01T12:00:00.000Z");

    mockPropertyFindUnique.mockResolvedValue({
      id: "prop-cuid-1",
      hubspotObjectId: "123",
      fullAddress: "123 Main St, Denver, CO 80202",
      latitude: 39.7392,
      longitude: -104.9903,
      pbLocation: "DTC",
      ahjName: "Denver",
      utilityName: "Xcel",

      firstInstallDate: new Date("2024-05-01T00:00:00.000Z"),
      mostRecentInstallDate: new Date("2025-12-01T00:00:00.000Z"),
      systemSizeKwDc: 8.4,
      hasBattery: true,
      hasEvCharger: false,
      openTicketsCount: 1,
      lastServiceDate: new Date("2025-11-15T00:00:00.000Z"),
      earliestWarrantyExpiry: null,

      createdAt,

      // Link tables — orderBy desc is expected to pre-sort, so mimic that.
      contactLinks: [
        {
          contactId: "c-newer",
          label: "Current Owner",
          associatedAt: mostRecentContactLinkAt,
        },
        {
          contactId: "c-older",
          label: "Previous Owner",
          associatedAt: olderContactLinkAt,
        },
      ],
      dealLinks: [
        { dealId: "d1", associatedAt: new Date() },
        { dealId: "d2", associatedAt: new Date() },
      ],
      ticketLinks: [{ ticketId: "t1", associatedAt: new Date() }],
    });

    // Two MODULE line items (qty 20 @ 400W, qty 5 @ 400W) and one BATTERY
    // (qty 2 @ 13.5kWh). Expect modules.count = 25, totalWattage = 10000;
    // batteries.count = 2, totalKwh = 27.
    mockFetchLineItemsForDeals.mockResolvedValue([
      {
        id: "li1",
        dealId: "d1",
        hubspotProductId: "hp-module",
        name: "Module",
        sku: "MOD-400",
        description: "",
        quantity: 20,
        price: 0,
        amount: 0,
        productCategory: "Module",
        manufacturer: "QCells",
        dcSize: 400,
        acSize: 0,
        energyStorageCapacity: 0,
      },
      {
        id: "li2",
        dealId: "d2",
        hubspotProductId: "hp-module",
        name: "Module",
        sku: "MOD-400",
        description: "",
        quantity: 5,
        price: 0,
        amount: 0,
        productCategory: "Module",
        manufacturer: "QCells",
        dcSize: 400,
        acSize: 0,
        energyStorageCapacity: 0,
      },
      {
        id: "li3",
        dealId: "d1",
        hubspotProductId: "hp-battery",
        name: "PW3",
        sku: "PW3",
        description: "",
        quantity: 2,
        price: 0,
        amount: 0,
        productCategory: "Battery",
        manufacturer: "Tesla",
        dcSize: 0,
        acSize: 0,
        energyStorageCapacity: 13.5,
      },
    ]);

    mockInternalProductFindMany.mockResolvedValue([
      {
        hubspotProductId: "hp-module",
        category: "MODULE",
        moduleSpec: { wattage: 400 },
        batterySpec: null,
      },
      {
        hubspotProductId: "hp-battery",
        category: "BATTERY",
        moduleSpec: null,
        batterySpec: { capacityKwh: 13.5 },
      },
    ]);

    const res = await callGet("123");
    expect(res.status).toBe(200);
    const body = await res.json();

    // Identity + geo
    expect(body.id).toBe("prop-cuid-1");
    expect(body.hubspotObjectId).toBe("123");
    expect(body.fullAddress).toBe("123 Main St, Denver, CO 80202");
    expect(body.lat).toBe(39.7392);
    expect(body.lng).toBe(-104.9903);
    expect(body.pbLocation).toBe("DTC");
    expect(body.ahjName).toBe("Denver");
    expect(body.utilityName).toBe("Xcel");

    // Rollup passthroughs
    expect(body.systemSizeKwDc).toBe(8.4);
    expect(body.hasBattery).toBe(true);
    expect(body.hasEvCharger).toBe(false);
    expect(body.openTicketsCount).toBe(1);
    expect(body.earliestWarrantyExpiry).toBeNull();

    // Link id projections
    expect(body.dealIds).toEqual(["d1", "d2"]);
    expect(body.ticketIds).toEqual(["t1"]);
    expect(body.contactIds).toEqual(["c-newer", "c-older"]);

    // Ownership = most recent contact link (already orderBy desc)
    expect(body.ownershipLabel).toBe("Current Owner");
    expect(new Date(body.associatedAt).toISOString()).toBe(
      mostRecentContactLinkAt.toISOString(),
    );

    // Equipment summary
    expect(body.equipmentSummary.modules).toEqual({
      count: 25,
      totalWattage: 10000,
    });
    expect(body.equipmentSummary.batteries).toEqual({
      count: 2,
      totalKwh: 27,
    });
    expect(body.equipmentSummary.inverters).toEqual({ count: 0 });
    expect(body.equipmentSummary.evChargers).toEqual({ count: 0 });

    // Verified the findUnique query targeted the HubSpot object id (not cuid)
    expect(mockPropertyFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { hubspotObjectId: "123" },
      }),
    );
  });
});
