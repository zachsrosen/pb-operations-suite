// src/__tests__/api/catalog-push-requests.test.ts

// ── Auth ──────────────────────────────────────────────────────────────────────
jest.mock("@/lib/api-auth", () => ({
  requireApiAuth: jest.fn().mockResolvedValue({ email: "test@photonbrothers.com", role: "ADMIN" }),
}));

// ── Prisma ────────────────────────────────────────────────────────────────────
const mockCreate = jest.fn();
const mockFindMany = jest.fn();
const mockFindUnique = jest.fn();

jest.mock("@/lib/db", () => ({
  prisma: {
    pendingCatalogPush: {
      create: (...args: unknown[]) => mockCreate(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
    vendorLookup: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
  },
}));

// ── Route under test ──────────────────────────────────────────────────────────
import { NextRequest } from "next/server";
import { POST as postRequest, GET as getRequests } from "@/app/api/catalog/push-requests/route";
import { prisma } from "@/lib/db";

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeRequest(body: unknown, method = "POST") {
  return new NextRequest("http://localhost/api/catalog/push-requests", {
    method,
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function makeGetRequest(status?: string) {
  const url = status
    ? `http://localhost/api/catalog/push-requests?status=${status}`
    : "http://localhost/api/catalog/push-requests";
  return new NextRequest(url, { method: "GET" });
}

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
});

// ── POST tests ────────────────────────────────────────────────────────────────

describe("POST /api/catalog/push-requests", () => {
  it("creates a push request with valid data", async () => {
    const fakePush = { id: "push_1", status: "PENDING" };
    mockCreate.mockResolvedValue(fakePush);

    const req = makeRequest({
      brand: "Tesla",
      model: "1707000-XX-Y",
      description: "Powerwall 3",
      category: "BATTERY",
      systems: ["INTERNAL", "ZOHO"],
      metadata: { capacityKwh: 13.5 },
    });
    const res = await postRequest(req);

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.push.id).toBe("push_1");
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("passes correct fields to prisma create", async () => {
    mockCreate.mockResolvedValue({ id: "push_2", status: "PENDING" });

    const req = makeRequest({
      brand: "  Enphase  ",
      model: "IQ8Plus",
      description: "Microinverter",
      category: "INVERTER",
      systems: ["INTERNAL"],
      metadata: { acOutputKw: 0.29 },
    });
    await postRequest(req);

    const createArg = mockCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(createArg.data.brand).toBe("Enphase");
    expect(createArg.data.model).toBe("IQ8Plus");
    expect(createArg.data.requestedBy).toBe("test@photonbrothers.com");
  });

  it("returns 400 if systems is empty", async () => {
    const req = makeRequest({
      brand: "Tesla",
      model: "1707000-XX-Y",
      description: "Powerwall 3",
      category: "BATTERY",
      systems: [],
    });
    const res = await postRequest(req);

    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 400 if required fields are missing", async () => {
    const req = makeRequest({ brand: "Tesla", systems: ["INTERNAL"] });
    const res = await postRequest(req);

    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid system name", async () => {
    const req = makeRequest({
      brand: "Tesla",
      model: "1707000-XX-Y",
      description: "Powerwall 3",
      category: "BATTERY",
      systems: ["INVALID_SYSTEM"],
    });
    const res = await postRequest(req);

    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid category value", async () => {
    const req = makeRequest({
      brand: "Tesla",
      model: "1707000-XX-Y",
      description: "Powerwall 3",
      category: "NOT_A_REAL_CATEGORY",
      systems: ["INTERNAL"],
    });
    const res = await postRequest(req);

    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 400 for systems containing non-string values", async () => {
    const req = makeRequest({
      brand: "Tesla",
      model: "1707000-XX-Y",
      description: "Powerwall 3",
      category: "BATTERY",
      systems: ["INTERNAL", 42],
    });
    const res = await postRequest(req);

    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 400 when systems is not an array", async () => {
    const req = makeRequest({
      brand: "Tesla",
      model: "1707000-XX-Y",
      description: "Powerwall 3",
      category: "BATTERY",
      systems: "INTERNAL",
    });
    const res = await postRequest(req);

    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("accepts all valid system names in a single request", async () => {
    mockCreate.mockResolvedValue({ id: "push_3", status: "PENDING" });

    const req = makeRequest({
      brand: "SolarEdge",
      model: "SE7600H",
      description: "Inverter",
      category: "INVERTER",
      systems: ["INTERNAL", "ZOHO", "HUBSPOT", "ZUPER"],
      metadata: { acOutputKw: 7.6 },
    });
    const res = await postRequest(req);

    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("preserves zero numeric values", async () => {
    mockCreate.mockResolvedValue({ id: "push_4", status: "PENDING" });

    const req = makeRequest({
      brand: "Tesla",
      model: "Powerwall 3",
      description: "Battery",
      category: "BATTERY",
      systems: ["INTERNAL"],
      unitCost: 0,
      sellPrice: 0,
      length: 0,
      width: 0,
      weight: 0,
      metadata: { capacityKwh: 13.5 },
    });
    const res = await postRequest(req);

    expect(res.status).toBe(201);
    const createArg = mockCreate.mock.calls.at(-1)?.[0] as { data: Record<string, unknown> };
    expect(createArg.data.unitCost).toBe(0);
    expect(createArg.data.sellPrice).toBe(0);
    expect(createArg.data.length).toBe(0);
    expect(createArg.data.width).toBe(0);
    expect(createArg.data.weight).toBe(0);
  });

  it("returns 400 when required spec field is missing for BATTERY", async () => {
    const req = makeRequest({
      brand: "Tesla",
      model: "Powerwall 3",
      description: "Battery",
      category: "BATTERY",
      systems: ["INTERNAL"],
      metadata: {},
    });
    const res = await postRequest(req);

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Capacity");
    expect(data.missingFields).toContain("spec.capacityKwh");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 400 when required spec field is missing for MODULE", async () => {
    const req = makeRequest({
      brand: "Hanwha",
      model: "Q.PEAK 400",
      description: "Module",
      category: "MODULE",
      systems: ["INTERNAL"],
      metadata: { efficiency: 21.5 },
    });
    const res = await postRequest(req);

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Wattage");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("passes when required spec field is present in metadata", async () => {
    mockCreate.mockResolvedValue({ id: "push_5", status: "PENDING" });

    const req = makeRequest({
      brand: "Hanwha",
      model: "Q.PEAK 400",
      description: "400W Module",
      category: "MODULE",
      systems: ["INTERNAL"],
      metadata: { wattage: 400, efficiency: 21.5 },
    });
    const res = await postRequest(req);

    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("returns 400 for whitespace-only required fields", async () => {
    const req = makeRequest({
      brand: "  ",
      model: "Test",
      description: "Test",
      category: "MODULE",
      systems: ["INTERNAL"],
      metadata: { wattage: 400 },
    });
    const res = await postRequest(req);

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("brand");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("accepts RACKING without metadata (no required spec fields)", async () => {
    mockCreate.mockResolvedValue({ id: "push_6", status: "PENDING" });

    const req = makeRequest({
      brand: "IronRidge",
      model: "XR100",
      description: "Roof mount",
      category: "RACKING",
      systems: ["INTERNAL"],
    });
    const res = await postRequest(req);

    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});

// ── Vendor pair validation tests ──────────────────────────────────────────────

function validPayload() {
  return {
    brand: "Tesla",
    model: "Powerwall 3",
    description: "Battery",
    category: "BATTERY",
    systems: ["INTERNAL"],
    metadata: { capacityKwh: 13.5 },
  };
}

describe("vendor pair validation", () => {
  it("rejects vendorName without zohoVendorId", async () => {
    const res = await postRequest(
      makeRequest({
        ...validPayload(),
        vendorName: "Rell Power",
        zohoVendorId: "",
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("selected from the list");
  });

  it("rejects zohoVendorId without vendorName", async () => {
    const res = await postRequest(
      makeRequest({
        ...validPayload(),
        vendorName: "",
        zohoVendorId: "v123",
      })
    );
    expect(res.status).toBe(400);
  });

  it("rejects mismatched vendorName vs VendorLookup", async () => {
    mockFindUnique.mockResolvedValue({
      zohoVendorId: "v123",
      name: "Rell Power",
    });

    const res = await postRequest(
      makeRequest({
        ...validPayload(),
        vendorName: "Wrong Name",
        zohoVendorId: "v123",
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("does not match");
  });

  it("accepts valid vendor pair", async () => {
    mockCreate.mockResolvedValue({ id: "push_v1", status: "PENDING" });
    mockFindUnique.mockResolvedValue({
      zohoVendorId: "v123",
      name: "Rell Power",
    });

    const res = await postRequest(
      makeRequest({
        ...validPayload(),
        vendorName: "Rell Power",
        zohoVendorId: "v123",
      })
    );
    expect(res.status).toBe(201);
  });

  it("accepts both blank (vendor is optional)", async () => {
    mockCreate.mockResolvedValue({ id: "push_v2", status: "PENDING" });

    const res = await postRequest(
      makeRequest({
        ...validPayload(),
        vendorName: "",
        zohoVendorId: "",
      })
    );
    expect(res.status).toBe(201);
  });
});

// ── GET tests ─────────────────────────────────────────────────────────────────

describe("GET /api/catalog/push-requests", () => {
  it("returns pushes for a valid status", async () => {
    mockFindMany.mockResolvedValue([{ id: "p1", status: "PENDING" }]);

    const req = makeGetRequest("PENDING");
    const res = await getRequests(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.pushes).toHaveLength(1);
    expect(data.count).toBe(1);
  });

  it("defaults to PENDING status when no status param is provided", async () => {
    mockFindMany.mockResolvedValue([]);

    const req = makeGetRequest();
    const res = await getRequests(req);

    expect(res.status).toBe(200);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "PENDING" } })
    );
  });

  it("returns 400 for an invalid status value", async () => {
    const req = makeGetRequest("DELETED");
    const res = await getRequests(req);

    expect(res.status).toBe(400);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("returns results for APPROVED status", async () => {
    mockFindMany.mockResolvedValue([
      { id: "p2", status: "APPROVED" },
      { id: "p3", status: "APPROVED" },
    ]);

    const req = makeGetRequest("APPROVED");
    const res = await getRequests(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.count).toBe(2);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "APPROVED" } })
    );
  });

  it("returns results for REJECTED status", async () => {
    mockFindMany.mockResolvedValue([{ id: "p4", status: "REJECTED" }]);

    const req = makeGetRequest("REJECTED");
    const res = await getRequests(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.pushes[0].id).toBe("p4");
  });

  it("returns empty array when no pushes match", async () => {
    mockFindMany.mockResolvedValue([]);

    const req = makeGetRequest("PENDING");
    const res = await getRequests(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.pushes).toHaveLength(0);
    expect(data.count).toBe(0);
  });

  it("orders results by createdAt descending", async () => {
    mockFindMany.mockResolvedValue([]);

    const req = makeGetRequest("PENDING");
    await getRequests(req);

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: "desc" } })
    );
  });
});
