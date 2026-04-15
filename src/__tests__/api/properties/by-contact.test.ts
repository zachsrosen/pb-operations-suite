/**
 * Tests for GET /api/properties/by-contact/[contactId] — Task 5.3 of the
 * HubSpot Property plan.
 *
 * Covers:
 *   1. Empty: `propertyContactLink.findMany` returns `[]` → 200 with
 *      `{ properties: [] }`.
 *   2. Sort: two links (2026-01-01 and 2026-02-01) — response must be
 *      most-recent first, and the route must request `orderBy associatedAt
 *      desc` from Prisma so the ordering isn't a happy accident.
 *   3. Role gate: VIEWER → 403 (REAL `canAccessRoute`, no mock).
 *   4. Per-link ownership label: the same contact tied to two properties
 *      with different labels — each PropertyDetail reflects ITS link's label.
 */

// ── Mock: auth + getUserByEmail + prisma ─────────────────────────────────────
const mockAuth = jest.fn();
jest.mock("@/auth", () => ({
  auth: () => mockAuth(),
}));

const mockGetUserByEmail = jest.fn();
const mockPropertyContactLinkFindMany = jest.fn();

jest.mock("@/lib/db", () => ({
  prisma: {
    propertyContactLink: {
      findMany: (...args: unknown[]) => mockPropertyContactLinkFindMany(...args),
    },
  },
  getUserByEmail: (email: string) => mockGetUserByEmail(email),
}));

// ── Mock: computeEquipmentSummary (module-level export on property-detail) ──
// Keep `normalizeOwnershipLabel` and `mapCacheRowToPropertyDetail` real — the
// endpoint's behavior is what we care about, and those are pure functions.
const mockComputeEquipmentSummary = jest.fn();
jest.mock("@/lib/property-detail", () => {
  const actual = jest.requireActual("@/lib/property-detail");
  return {
    ...actual,
    computeEquipmentSummary: (dealIds: string[]) =>
      mockComputeEquipmentSummary(dealIds),
  };
});

// ── Route under test ─────────────────────────────────────────────────────────
import { GET } from "@/app/api/properties/by-contact/[contactId]/route";
import { NextRequest } from "next/server";

function makeReq(contactId: string): NextRequest {
  return new NextRequest(`http://test/api/properties/by-contact/${contactId}`, {
    method: "GET",
  });
}

async function callGet(contactId: string) {
  return GET(makeReq(contactId), {
    params: Promise.resolve({ contactId }),
  });
}

function zeroSummary() {
  return {
    modules: { count: 0, totalWattage: 0 },
    inverters: { count: 0 },
    batteries: { count: 0, totalKwh: 0 },
    evChargers: { count: 0 },
  };
}

function makeCacheRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "prop-cuid",
    hubspotObjectId: "hs-1",
    fullAddress: "1 Main St, Denver, CO 80202",
    latitude: 39.7,
    longitude: -104.9,
    pbLocation: "DTC",
    ahjName: "Denver",
    utilityName: "Xcel",
    firstInstallDate: null,
    mostRecentInstallDate: null,
    systemSizeKwDc: null,
    hasBattery: false,
    hasEvCharger: false,
    openTicketsCount: 0,
    lastServiceDate: null,
    earliestWarrantyExpiry: null,
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    contactLinks: [],
    dealLinks: [],
    ticketLinks: [],
    ...overrides,
  };
}

describe("GET /api/properties/by-contact/[contactId]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { email: "user@photonbrothers.com" } });
    mockComputeEquipmentSummary.mockResolvedValue(zeroSummary());
  });

  it("returns { properties: [] } when the contact has no linked properties", async () => {
    mockGetUserByEmail.mockResolvedValue({ id: "u1", role: "ADMIN" });
    mockPropertyContactLinkFindMany.mockResolvedValue([]);

    const res = await callGet("contact-empty");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ properties: [] });
    expect(mockComputeEquipmentSummary).not.toHaveBeenCalled();
  });

  it("returns properties sorted most-recently-associated first via Prisma orderBy", async () => {
    mockGetUserByEmail.mockResolvedValue({ id: "u1", role: "ADMIN" });

    const newer = new Date("2026-02-01T00:00:00.000Z");
    const older = new Date("2026-01-01T00:00:00.000Z");

    // Mimic Prisma's orderBy desc — the route must request it, and we return
    // the rows in that order so the assertion on the response ordering tests
    // the real endpoint contract.
    mockPropertyContactLinkFindMany.mockResolvedValue([
      {
        contactId: "c1",
        label: "Current Owner",
        associatedAt: newer,
        property: makeCacheRow({
          id: "prop-newer",
          hubspotObjectId: "hs-newer",
        }),
      },
      {
        contactId: "c1",
        label: "Current Owner",
        associatedAt: older,
        property: makeCacheRow({
          id: "prop-older",
          hubspotObjectId: "hs-older",
        }),
      },
    ]);

    const res = await callGet("c1");
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.properties.map((p: { hubspotObjectId: string }) => p.hubspotObjectId))
      .toEqual(["hs-newer", "hs-older"]);

    // Assert the orderBy clause — catches a regression where someone drops
    // it and the test happens to pass because the mock is pre-sorted.
    expect(mockPropertyContactLinkFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { contactId: "c1" },
        orderBy: { associatedAt: "desc" },
      }),
    );
  });

  it("returns 403 when the caller's role fails the /api/service gate (real canAccessRoute)", async () => {
    // VIEWER has no /api/service route access — the real role matrix is
    // exercised so a permission regression fails this test.
    mockGetUserByEmail.mockResolvedValue({ id: "u1", role: "VIEWER" });

    const res = await callGet("c1");

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Forbidden");
    expect(mockPropertyContactLinkFindMany).not.toHaveBeenCalled();
  });

  it("uses each link's label for its property's ownershipLabel (not a global default)", async () => {
    mockGetUserByEmail.mockResolvedValue({ id: "u1", role: "ADMIN" });

    const t1 = new Date("2026-02-01T00:00:00.000Z");
    const t2 = new Date("2026-01-15T00:00:00.000Z");

    mockPropertyContactLinkFindMany.mockResolvedValue([
      {
        contactId: "c1",
        label: "Current Owner",
        associatedAt: t1,
        property: makeCacheRow({
          id: "prop-current",
          hubspotObjectId: "hs-current",
          // Even if the property's most-recent contactLink says something
          // else, the by-contact endpoint must surface THIS link's label.
          contactLinks: [
            {
              contactId: "c-other",
              label: "Authorized Contact",
              associatedAt: new Date("2026-03-01T00:00:00.000Z"),
            },
          ],
        }),
      },
      {
        contactId: "c1",
        label: "Previous Owner",
        associatedAt: t2,
        property: makeCacheRow({
          id: "prop-previous",
          hubspotObjectId: "hs-previous",
        }),
      },
    ]);

    const res = await callGet("c1");
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.properties).toHaveLength(2);
    const [first, second] = body.properties;

    expect(first.hubspotObjectId).toBe("hs-current");
    expect(first.ownershipLabel).toBe("Current Owner");
    expect(new Date(first.associatedAt).toISOString()).toBe(t1.toISOString());

    expect(second.hubspotObjectId).toBe("hs-previous");
    expect(second.ownershipLabel).toBe("Previous Owner");
    expect(new Date(second.associatedAt).toISOString()).toBe(t2.toISOString());
  });
});
