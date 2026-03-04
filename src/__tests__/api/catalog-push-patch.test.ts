// src/__tests__/api/catalog-push-patch.test.ts

// ── Auth ──────────────────────────────────────────────────────────────────────
jest.mock("@/lib/api-auth", () => ({
  requireApiAuth: jest.fn().mockResolvedValue({ email: "admin@photonbrothers.com", role: "ADMIN" }),
}));

// ── Prisma ────────────────────────────────────────────────────────────────────
const mockFindUnique = jest.fn();
const mockUpdate = jest.fn();

jest.mock("@/lib/db", () => ({
  prisma: {
    pendingCatalogPush: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
  },
}));

// ── Route under test ──────────────────────────────────────────────────────────
import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/catalog/push-requests/[id]/route";

// ── Helpers ───────────────────────────────────────────────────────────────────
const FAKE_PUSH = {
  id: "push_1",
  status: "PENDING",
  brand: "Tesla",
  model: "Powerwall 3",
  description: "Battery",
  category: "BATTERY",
  systems: ["INTERNAL"],
  requestedBy: "user@photonbrothers.com",
};

function makePatch(body: unknown) {
  return new NextRequest("http://localhost/api/catalog/push-requests/push_1", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const routeContext = { params: Promise.resolve({ id: "push_1" }) };

beforeEach(() => {
  jest.clearAllMocks();
  mockFindUnique.mockResolvedValue(FAKE_PUSH);
  mockUpdate.mockImplementation(({ data }) => Promise.resolve({ ...FAKE_PUSH, ...data }));
});

// ── Physical dimension validation ─────────────────────────────────────────────

describe("PATCH physical dimension validation", () => {
  it("rejects invalid length with 400", async () => {
    const req = makePatch({ length: "not-a-number" });
    const res = await PATCH(req, routeContext);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/length/i);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects invalid width with 400", async () => {
    const req = makePatch({ width: "abc" });
    const res = await PATCH(req, routeContext);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/width/i);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects invalid weight with 400", async () => {
    const req = makePatch({ weight: "heavy" });
    const res = await PATCH(req, routeContext);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/weight/i);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("accepts valid numeric dimensions", async () => {
    const req = makePatch({ length: 65.5, width: 41, weight: 50.3 });
    const res = await PATCH(req, routeContext);
    expect(res.status).toBe(200);
    const data = mockUpdate.mock.calls[0][0].data;
    expect(data.length).toBe(65.5);
    expect(data.width).toBe(41);
    expect(data.weight).toBe(50.3);
  });

  it("accepts zero as a valid dimension", async () => {
    const req = makePatch({ length: 0, width: 0, weight: 0 });
    const res = await PATCH(req, routeContext);
    expect(res.status).toBe(200);
    const data = mockUpdate.mock.calls[0][0].data;
    expect(data.length).toBe(0);
    expect(data.width).toBe(0);
    expect(data.weight).toBe(0);
  });

  it("clears dimensions when set to null", async () => {
    const req = makePatch({ length: null, width: null, weight: null });
    const res = await PATCH(req, routeContext);
    expect(res.status).toBe(200);
    const data = mockUpdate.mock.calls[0][0].data;
    expect(data.length).toBeNull();
    expect(data.width).toBeNull();
    expect(data.weight).toBeNull();
  });

  it("clears dimensions when set to empty string", async () => {
    const req = makePatch({ length: "", width: "", weight: "" });
    const res = await PATCH(req, routeContext);
    expect(res.status).toBe(200);
    const data = mockUpdate.mock.calls[0][0].data;
    expect(data.length).toBeNull();
    expect(data.width).toBeNull();
    expect(data.weight).toBeNull();
  });
});

// ── hardToProcure validation ──────────────────────────────────────────────────

describe("PATCH hardToProcure validation", () => {
  it("rejects string value with 400", async () => {
    const req = makePatch({ hardToProcure: "true" });
    const res = await PATCH(req, routeContext);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/hardToProcure/i);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects numeric value with 400", async () => {
    const req = makePatch({ hardToProcure: 1 });
    const res = await PATCH(req, routeContext);
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects null value with 400", async () => {
    const req = makePatch({ hardToProcure: null });
    const res = await PATCH(req, routeContext);
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("accepts true", async () => {
    const req = makePatch({ hardToProcure: true });
    const res = await PATCH(req, routeContext);
    expect(res.status).toBe(200);
    expect(mockUpdate.mock.calls[0][0].data.hardToProcure).toBe(true);
  });

  it("accepts false", async () => {
    const req = makePatch({ hardToProcure: false });
    const res = await PATCH(req, routeContext);
    expect(res.status).toBe(200);
    expect(mockUpdate.mock.calls[0][0].data.hardToProcure).toBe(false);
  });
});

// ── unitCost / sellPrice validation (existing behavior) ───────────────────────

describe("PATCH price validation", () => {
  it("rejects invalid unitCost with 400", async () => {
    const req = makePatch({ unitCost: "expensive" });
    const res = await PATCH(req, routeContext);
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects invalid sellPrice with 400", async () => {
    const req = makePatch({ sellPrice: "cheap" });
    const res = await PATCH(req, routeContext);
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
