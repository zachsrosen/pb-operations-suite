// src/__tests__/api/products-seed.test.ts

// ── Auth ──────────────────────────────────────────────────────────────────────
const mockRequireApiAuth = jest.fn().mockResolvedValue({ email: "admin@photonbrothers.com", role: "ADMIN" });
jest.mock("@/lib/api-auth", () => ({
  requireApiAuth: (...args: unknown[]) => mockRequireApiAuth(...args),
}));

// ── DB ───────────────────────────────────────────────────────────────────────
const mockGetUserByEmail = jest.fn().mockResolvedValue({ role: "ADMIN" });
jest.mock("@/lib/db", () => ({
  getUserByEmail: (...args: unknown[]) => mockGetUserByEmail(...args),
  prisma: {
    catalogProduct: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      upsert: (...args: unknown[]) => mockUpsert(...args),
    },
  },
}));

const mockFindMany = jest.fn();
const mockUpsert = jest.fn();

// ── Route under test ──────────────────────────────────────────────────────────
import { NextRequest } from "next/server";
import { POST } from "@/app/api/products/seed/route";

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/products/seed", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireApiAuth.mockResolvedValue({ email: "admin@photonbrothers.com", role: "ADMIN" });
  mockGetUserByEmail.mockResolvedValue({ role: "ADMIN" });
  mockFindMany.mockResolvedValue([]);
  mockUpsert.mockResolvedValue({ id: "cat_1" });
});

describe("POST /api/products/seed", () => {
  // ── Auth tests ────────────────────────────────────────────────────────────
  it("rejects non-admin/owner roles with 403", async () => {
    mockGetUserByEmail.mockResolvedValue({ role: "VIEWER" });
    const res = await POST(makeRequest({ products: [{ name: "Test" }] }));
    expect(res.status).toBe(403);
  });

  it("allows OWNER role", async () => {
    mockGetUserByEmail.mockResolvedValue({ role: "OWNER" });
    const res = await POST(makeRequest({ products: [{ name: "Test", sku: "T-1" }] }));
    expect(res.status).toBe(200);
  });

  // ── Validation tests ──────────────────────────────────────────────────────
  it("rejects empty products array", async () => {
    const res = await POST(makeRequest({ products: [] }));
    expect(res.status).toBe(400);
  });

  it("rejects products missing name", async () => {
    const res = await POST(makeRequest({ products: [{ sku: "ABC" }] }));
    expect(res.status).toBe(400);
  });

  it("rejects whitespace-only product names", async () => {
    const res = await POST(makeRequest({ products: [{ name: "   " }] }));
    expect(res.status).toBe(400);
  });

  // ── Counting tests ────────────────────────────────────────────────────────
  it("seeds valid products and returns counts", async () => {
    const res = await POST(
      makeRequest({
        products: [
          { name: "Powerwall 3", sku: "PW3-001", price: 8500, type: "Non-inventory", description: "Tesla battery" },
          { name: "IQ8 Microinverter", sku: "IQ8-MICRO", price: 200, type: "Non-inventory" },
        ],
      })
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.inserted).toBe(2);
    expect(data.updated).toBe(0);
    expect(data.skipped).toBe(0);
    expect(data.total).toBe(2);
    expect(data.uniqueTotal).toBe(2);
  });

  it("counts updates when products already exist", async () => {
    mockFindMany.mockResolvedValue([
      { source: "QUICKBOOKS", externalId: "PW3001" },
    ]);

    const res = await POST(
      makeRequest({
        products: [
          { name: "Powerwall 3", sku: "PW3-001", price: 8500 },
          { name: "IQ8 Microinverter", sku: "IQ8-MICRO", price: 200 },
        ],
      })
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.inserted).toBe(1);
    expect(data.updated).toBe(1);
  });

  // ── Deduplication tests ───────────────────────────────────────────────────
  it("deduplicates by externalId and reports collisions", async () => {
    const res = await POST(
      makeRequest({
        products: [
          { name: "Powerwall 3", sku: "PW3-001", price: 8500 },
          { name: "Powerwall 3 Updated", sku: "PW3-001", price: 9000 },
        ],
      })
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total).toBe(2);
    expect(data.uniqueTotal).toBe(1);
    expect(data.inserted).toBe(1);
    expect(data.duplicates).toHaveLength(1);
    expect(data.duplicates[0].externalId).toBe("PW3001");
    expect(data.duplicates[0].occurrences).toBe(2);
    // Last occurrence wins
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  // ── Deterministic ID tests ────────────────────────────────────────────────
  it("generates deterministic externalId when no SKU", async () => {
    await POST(makeRequest({ products: [{ name: "Labor - Install", price: 150, type: "Service" }] }));
    const firstCall = mockUpsert.mock.calls[0][0];

    jest.clearAllMocks();
    mockFindMany.mockResolvedValue([]);
    mockUpsert.mockResolvedValue({ id: "cat_2" });
    mockGetUserByEmail.mockResolvedValue({ role: "ADMIN" });
    mockRequireApiAuth.mockResolvedValue({ email: "admin@photonbrothers.com", role: "ADMIN" });

    await POST(makeRequest({ products: [{ name: "Labor - Install", price: 150, type: "Service" }] }));
    const secondCall = mockUpsert.mock.calls[0][0];

    expect(firstCall.where.source_externalId.externalId).toBe(secondCall.where.source_externalId.externalId);
  });

  it("generates same externalId regardless of whitespace/case", async () => {
    await POST(makeRequest({ products: [{ name: "  Labor - Install  ", price: 150.0, type: "  Service  " }] }));
    const call1 = mockUpsert.mock.calls[0][0];

    jest.clearAllMocks();
    mockFindMany.mockResolvedValue([]);
    mockUpsert.mockResolvedValue({ id: "cat_2" });
    mockGetUserByEmail.mockResolvedValue({ role: "ADMIN" });
    mockRequireApiAuth.mockResolvedValue({ email: "admin@photonbrothers.com", role: "ADMIN" });

    await POST(makeRequest({ products: [{ name: "labor - install", price: 150, type: "service" }] }));
    const call2 = mockUpsert.mock.calls[0][0];

    expect(call1.where.source_externalId.externalId).toBe(call2.where.source_externalId.externalId);
  });

  it("canonicalizes SKU-based externalId (case + punctuation insensitive)", async () => {
    const res = await POST(
      makeRequest({
        products: [
          { name: "Widget A", sku: "pw3-001" },
          { name: "Widget B", sku: "PW3 001" },
        ],
      })
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    // Both SKUs canonicalize to "PW3001", so they collide
    expect(data.uniqueTotal).toBe(1);
    expect(data.duplicates).toHaveLength(1);
    expect(data.duplicates[0].externalId).toBe("PW3001");
  });

  it("hardcodes source as QUICKBOOKS regardless of input", async () => {
    await POST(makeRequest({ products: [{ name: "Test Product", sku: "TP-1" }] }));

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { source_externalId: { source: "QUICKBOOKS", externalId: "TP1" } },
      })
    );
  });
});
