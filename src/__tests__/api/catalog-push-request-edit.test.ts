// src/__tests__/api/catalog-push-request-edit.test.ts

const mockRequireApiAuth = jest.fn();
jest.mock("@/lib/api-auth", () => ({
  requireApiAuth: (...args: unknown[]) => mockRequireApiAuth(...args),
}));

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

import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/catalog/push-requests/[id]/route";

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/catalog/push-requests/push-1", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function makeCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

const ADMIN_USER = { email: "admin@test.com", role: "ADMIN", ip: "127.0.0.1", userAgent: "test" };
const NON_ADMIN_USER = { email: "pm@test.com", role: "PROJECT_MANAGER", ip: "127.0.0.1", userAgent: "test" };
const EXISTING_PENDING = { id: "push-1", status: "PENDING", category: "MODULE" };

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireApiAuth.mockResolvedValue(ADMIN_USER);
  mockFindUnique.mockResolvedValue(EXISTING_PENDING);
  mockUpdate.mockResolvedValue({ id: "push-1", status: "PENDING" });
});

describe("PATCH /api/catalog/push-requests/[id]", () => {
  it("returns 403 when user is not admin", async () => {
    mockRequireApiAuth.mockResolvedValue(NON_ADMIN_USER);

    const res = await PATCH(makeRequest({ brand: "REC" }), makeCtx("push-1"));

    expect(res.status).toBe(403);
  });

  it("returns 404 when request is not found", async () => {
    mockFindUnique.mockResolvedValue(null);

    const res = await PATCH(makeRequest({ brand: "REC" }), makeCtx("missing"));

    expect(res.status).toBe(404);
  });

  it("returns 409 when request is not pending", async () => {
    mockFindUnique.mockResolvedValue({ id: "push-1", status: "APPROVED", category: "MODULE" });

    const res = await PATCH(makeRequest({ brand: "REC" }), makeCtx("push-1"));

    expect(res.status).toBe(409);
  });

  it("updates full editable field surface including normalized metadata", async () => {
    await PATCH(
      makeRequest({
        brand: "  REC  ",
        model: " Alpha 400 ",
        description: "  Module description ",
        category: "MODULE",
        unitSpec: " 400 ",
        unitLabel: " W ",
        sku: "  REC-400 ",
        vendorName: "  BayWa  ",
        vendorPartNumber: "  BW-400 ",
        unitCost: "123.45",
        sellPrice: 210.5,
        hardToProcure: "true",
        length: "68.5",
        width: "40.2",
        weight: "46",
        metadata: {
          wattage: "410",
          efficiency: "21.3",
          cellType: "Mono PERC",
          unknownKey: "ignored",
        },
        systems: ["INTERNAL", "HUBSPOT"],
      }),
      makeCtx("push-1")
    );

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "push-1" },
      data: {
        brand: "REC",
        model: "Alpha 400",
        description: "Module description",
        category: "MODULE",
        unitSpec: "400",
        unitLabel: "W",
        sku: "REC-400",
        vendorName: "BayWa",
        vendorPartNumber: "BW-400",
        unitCost: 123.45,
        sellPrice: 210.5,
        hardToProcure: true,
        length: 68.5,
        width: 40.2,
        weight: 46,
        metadata: {
          wattage: 410,
          efficiency: 21.3,
          cellType: "Mono PERC",
        },
        systems: ["INTERNAL", "HUBSPOT"],
      },
    });
  });

  it("allows clearing metadata with null", async () => {
    await PATCH(makeRequest({ metadata: null }), makeCtx("push-1"));

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ metadata: null }),
      })
    );
  });

  it("returns 400 for invalid numeric field", async () => {
    const res = await PATCH(makeRequest({ unitCost: "not-a-number" }), makeCtx("push-1"));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/unitCost/i);
  });

  it("returns 400 for invalid boolean field", async () => {
    const res = await PATCH(makeRequest({ hardToProcure: "sometimes" }), makeCtx("push-1"));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/hardToProcure/i);
  });

  it("returns 400 for invalid metadata value type", async () => {
    const res = await PATCH(makeRequest({ metadata: { wattage: "NaN" } }), makeCtx("push-1"));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/wattage/i);
  });

  it("returns 400 when no editable fields are provided", async () => {
    const res = await PATCH(makeRequest({}), makeCtx("push-1"));

    expect(res.status).toBe(400);
  });
});
