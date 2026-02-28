import { NextRequest } from "next/server";

const mockRequireApiAuth = jest.fn();
const mockFetchCustomerPage = jest.fn();
const mockIsConfigured = jest.fn();

jest.mock("@/lib/api-auth", () => ({
  requireApiAuth: (...args: unknown[]) => mockRequireApiAuth(...args),
}));

jest.mock("@/lib/zoho-inventory", () => ({
  zohoInventory: {
    isConfigured: (...args: unknown[]) => mockIsConfigured(...args),
    fetchCustomerPage: (...args: unknown[]) => mockFetchCustomerPage(...args),
  },
}));

type RouteModule = typeof import("@/app/api/bom/zoho-customers/route");

async function loadGetHandler(): Promise<RouteModule["GET"]> {
  const routeModule = await import("@/app/api/bom/zoho-customers/route");
  return routeModule.GET;
}

function makeRequest(query = ""): NextRequest {
  return new NextRequest(`http://localhost:3000/api/bom/zoho-customers${query ? `?${query}` : ""}`);
}

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  mockRequireApiAuth.mockResolvedValue({
    email: "admin@example.com",
    role: "ADMIN",
    ip: "127.0.0.1",
    userAgent: "jest",
  });
  mockIsConfigured.mockReturnValue(true);
});

describe("GET /api/bom/zoho-customers", () => {
  it("matches hubspot_contact_id from flexible custom_fields keys", async () => {
    mockFetchCustomerPage.mockImplementation(async (page: number) => {
      if (page === 1) {
        return {
          contacts: [
            {
              contact_id: "1001",
              contact_name: "Acme Solar",
              custom_fields: [
                { api_name: "cf_hubspot_id", value: "98,765.0" },
              ],
            },
          ],
          hasMore: false,
        };
      }
      return { contacts: [], hasMore: false };
    });

    const GET = await loadGetHandler();
    const response = await GET(makeRequest("hubspot_contact_id=98765"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.customer).toEqual({
      contact_id: "1001",
      contact_name: "Acme Solar",
    });
  });

  it("returns debug counts and sample records", async () => {
    mockFetchCustomerPage.mockImplementation(async (page: number) => {
      if (page === 1) {
        return {
          contacts: [
            {
              contact_id: "2001",
              contact_name: "One",
              cf_hubspot_record_id: "1234",
            },
            {
              contact_id: "2002",
              contact_name: "Two",
            },
          ],
          hasMore: false,
        };
      }
      return { contacts: [], hasMore: false };
    });

    const GET = await loadGetHandler();
    const response = await GET(makeRequest("debug=1"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.totalCustomers).toBe(2);
    expect(payload.hubspotIdCustomers).toBe(1);
    expect(payload.sourceCounts).toEqual({
      direct: 1,
      custom_field_hash: 0,
      custom_fields: 0,
      none: 1,
    });
    expect(payload.sample).toHaveLength(1);
  });

  it("does not return partial customer cache when a page repeatedly fails", async () => {
    const callCounts = new Map<number, number>();
    mockFetchCustomerPage.mockImplementation(async (page: number) => {
      callCounts.set(page, (callCounts.get(page) ?? 0) + 1);

      if (page === 3) {
        throw new Error("Rate limited");
      }

      return {
        contacts: page === 1 ? [{ contact_id: "3001", contact_name: "Partial Corp" }] : [],
        hasMore: true,
      };
    });

    const GET = await loadGetHandler();
    const response = await GET(makeRequest("search=Partial"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.customers).toEqual([]);
    expect(String(payload.error || "")).toContain("Failed to fetch Zoho customers page 3");
    expect(callCounts.get(3)).toBe(3);
  });

  it("passes through auth response when authentication fails", async () => {
    const nextServer = await import("next/server");
    const authError = nextServer.NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    mockRequireApiAuth.mockResolvedValue(authError);

    const GET = await loadGetHandler();
    const response = await GET(makeRequest("search=acme"));

    expect(response.status).toBe(401);
    expect(mockFetchCustomerPage).not.toHaveBeenCalled();
  });
});
