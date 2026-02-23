// src/__tests__/api/catalog-push-requests.test.ts

// ── Auth ──────────────────────────────────────────────────────────────────────
jest.mock("@/lib/api-auth", () => ({
  requireApiAuth: jest.fn().mockResolvedValue({ email: "test@photonbrothers.com", role: "ADMIN" }),
}));

// ── Prisma ────────────────────────────────────────────────────────────────────
const mockCreate = jest.fn();
const mockFindMany = jest.fn();

jest.mock("@/lib/db", () => ({
  prisma: {
    pendingCatalogPush: {
      create: (...args: unknown[]) => mockCreate(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
  },
}));

// ── Route under test ──────────────────────────────────────────────────────────
import { NextRequest } from "next/server";
import { POST as postRequest, GET as getRequests } from "@/app/api/catalog/push-requests/route";

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
    });
    const res = await postRequest(req);

    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledTimes(1);
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
