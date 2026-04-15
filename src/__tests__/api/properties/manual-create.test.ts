/**
 * Tests for POST /api/properties/manual-create — Task 5.4 of the HubSpot
 * Property plan.
 *
 * Covers:
 *   1. 403 for non-admin roles (uses REAL `normalizeRole`).
 *   2. 201 + `{ propertyId, created: true }` on successful creation.
 *   3. 201 + `{ propertyId, created: false }` when an existing Property matched.
 *   4. 422 when geocode fails.
 *   5. 400 when `street` is missing from the body.
 *
 * `upsertPropertyFromGeocode` is mocked at the module boundary — we don't drag
 * the real geocode/HubSpot stack into this unit.
 */

// ── Mock: auth + getUserByEmail + prisma ─────────────────────────────────────
const mockAuth = jest.fn();
jest.mock("@/auth", () => ({
  auth: () => mockAuth(),
}));

const mockGetUserByEmail = jest.fn();
const mockActivityLogCreate = jest.fn().mockResolvedValue({});

jest.mock("@/lib/db", () => ({
  prisma: {
    activityLog: {
      create: (...args: unknown[]) => mockActivityLogCreate(...args),
    },
  },
  getUserByEmail: (email: string) => mockGetUserByEmail(email),
}));

// ── Mock: upsertPropertyFromGeocode (boundary) ───────────────────────────────
const mockUpsert = jest.fn();
jest.mock("@/lib/property-sync", () => ({
  upsertPropertyFromGeocode: (...args: unknown[]) => mockUpsert(...args),
}));

// ── Route under test ─────────────────────────────────────────────────────────
import { POST } from "@/app/api/properties/manual-create/route";
import { NextRequest } from "next/server";

function makeReq(body: unknown): NextRequest {
  return new NextRequest("http://test/api/properties/manual-create", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

async function callPost(body: unknown) {
  return POST(makeReq(body));
}

const VALID_BODY = {
  street: "123 Main St",
  unit: null,
  city: "Denver",
  state: "CO",
  zip: "80205",
};

describe("POST /api/properties/manual-create", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { email: "admin@photonbrothers.com" } });
    mockGetUserByEmail.mockResolvedValue({ id: "u1", role: "ADMIN" });
  });

  it("returns 403 for non-admin roles", async () => {
    mockGetUserByEmail.mockResolvedValue({ id: "u1", role: "OPERATIONS_MANAGER" });

    const res = await callPost(VALID_BODY);

    expect(res.status).toBe(403);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("returns 201 + { propertyId, created: true } on successful creation", async () => {
    mockUpsert.mockResolvedValue({
      propertyCacheId: "abc",
      hubspotObjectId: "9001",
      created: true,
    });

    const res = await callPost(VALID_BODY);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ propertyId: "9001", created: true });
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  it("returns 201 + { propertyId, created: false } when an existing Property matched", async () => {
    mockUpsert.mockResolvedValue({
      propertyCacheId: "abc",
      hubspotObjectId: "9001",
      created: false,
    });

    const res = await callPost(VALID_BODY);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ propertyId: "9001", created: false });
  });

  it("returns 422 when geocode fails", async () => {
    mockUpsert.mockResolvedValue({
      status: "failed",
      reason: "geocode failed",
    });

    const res = await callPost(VALID_BODY);

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("Geocode failed");
    expect(body.reason).toBe("geocode failed");
  });

  it("returns 400 when `street` is missing", async () => {
    const res = await callPost({
      city: "Denver",
      state: "CO",
      zip: "80205",
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid address");
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});
