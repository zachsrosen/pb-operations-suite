/**
 * Tests for POST /api/properties/resolve — Task 5.2 of the HubSpot Property
 * plan.
 *
 * Covers:
 *   1. 200 happy path — cache row exists → { propertyId }
 *   2. 200 no-match — findUnique returns null → { propertyId: null }
 *      (NOT 404 — "no match" is a normal result for this endpoint)
 *   3. 400 when `street` is missing/empty
 *   4. 400 when `zip` is missing/empty
 *   5. Normalization equivalence — two requests with different whitespace /
 *      casing / null-vs-empty-string unit resolve to the same addressHash.
 *      Proves the shared `@/lib/address-hash` normalizer is wired in.
 *
 * No geocoding test is needed by construction: the route file imports only
 * `@/lib/address-hash`, `@/lib/db`, `@/auth`, and `@/lib/role-permissions`.
 * It never touches Google Maps, HubSpot, or any external service.
 */

// ── Mock: auth + getUserByEmail + prisma ──────────────────────────────────────
const mockAuth = jest.fn();
jest.mock("@/auth", () => ({
  auth: () => mockAuth(),
}));

const mockGetUserByEmail = jest.fn();
const mockPropertyFindUnique = jest.fn();

jest.mock("@/lib/db", () => ({
  prisma: {
    hubSpotPropertyCache: {
      findUnique: (...args: unknown[]) => mockPropertyFindUnique(...args),
    },
  },
  getUserByEmail: (email: string) => mockGetUserByEmail(email),
}));

// ── Route under test ──────────────────────────────────────────────────────────
import { POST } from "@/app/api/properties/resolve/route";
import { NextRequest } from "next/server";

function makeReq(body: unknown): NextRequest {
  return new NextRequest("http://test/api/properties/resolve", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

async function callPost(body: unknown) {
  return POST(makeReq(body));
}

describe("POST /api/properties/resolve", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { email: "user@photonbrothers.com" } });
    mockGetUserByEmail.mockResolvedValue({ id: "u1", role: "ADMIN" });
  });

  it("returns 200 + { propertyId } when a cache row matches", async () => {
    mockPropertyFindUnique.mockResolvedValue({ hubspotObjectId: "9001" });

    const res = await callPost({
      street: "123 Main St",
      unit: null,
      city: "Denver",
      state: "CO",
      zip: "80205",
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ propertyId: "9001" });
    expect(mockPropertyFindUnique).toHaveBeenCalledTimes(1);
  });

  it("returns 200 + { propertyId: null } when no cache row matches (not 404)", async () => {
    mockPropertyFindUnique.mockResolvedValue(null);

    const res = await callPost({
      street: "999 Nowhere Ln",
      city: "Denver",
      state: "CO",
      zip: "80205",
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ propertyId: null });
  });

  it("returns 400 when `street` is empty", async () => {
    const res = await callPost({
      street: "",
      city: "Denver",
      state: "CO",
      zip: "80205",
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid address");
    expect(mockPropertyFindUnique).not.toHaveBeenCalled();
  });

  it("returns 400 when `zip` is missing", async () => {
    const res = await callPost({
      street: "123 Main St",
      city: "Denver",
      state: "CO",
      // zip omitted
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid address");
    expect(mockPropertyFindUnique).not.toHaveBeenCalled();
  });

  it("normalizes whitespace / casing / null-vs-empty unit to the same addressHash", async () => {
    mockPropertyFindUnique.mockResolvedValue({ hubspotObjectId: "abc" });

    await callPost({
      street: "123 Main St",
      unit: null,
      city: "Denver",
      state: "CO",
      zip: "80205",
    });

    await callPost({
      street: "  123 MAIN ST  ",
      unit: "",
      city: " denver ",
      state: "co",
      zip: "80205",
    });

    expect(mockPropertyFindUnique).toHaveBeenCalledTimes(2);

    const firstArg = mockPropertyFindUnique.mock.calls[0]?.[0];
    const secondArg = mockPropertyFindUnique.mock.calls[1]?.[0];

    // Both calls must target addressHash and produce the same hash value.
    expect(firstArg.where.addressHash).toEqual(expect.any(String));
    expect(secondArg.where.addressHash).toEqual(firstArg.where.addressHash);
  });
});
