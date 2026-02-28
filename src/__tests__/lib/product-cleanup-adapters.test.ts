import {
  archiveHubSpotProduct,
  archiveQuickBooksItem,
  runCleanupAdapter,
} from "@/lib/product-cleanup-adapters";

const mockDeleteZohoItem = jest.fn();
jest.mock("@/lib/zoho-inventory", () => ({
  deleteZohoItem: (...args: unknown[]) => mockDeleteZohoItem(...args),
}));

type MockFetch = jest.MockedFunction<typeof fetch>;

function makeResponse(payload: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    text: async () => (typeof payload === "string" ? payload : JSON.stringify(payload)),
  } as Response;
}

describe("product-cleanup-adapters", () => {
  const originalEnv = process.env;
  let mockFetch: MockFetch;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      HUBSPOT_ACCESS_TOKEN: "hs_token",
      QUICKBOOKS_ACCESS_TOKEN: "qb_token",
      QUICKBOOKS_COMPANY_ID: "company_1",
    };
    mockFetch = jest.fn() as MockFetch;
    global.fetch = mockFetch;
    mockDeleteZohoItem.mockReset();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("maps HubSpot success to archived", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({}, true, 204));

    const result = await archiveHubSpotProduct("123", mockFetch);

    expect(result.status).toBe("archived");
    expect(result.source).toBe("hubspot");
  });

  it("maps HubSpot 404 to not_found", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({ message: "not found" }, false, 404));

    const result = await archiveHubSpotProduct("123", mockFetch);

    expect(result.status).toBe("not_found");
  });

  it("archives QuickBooks item by setting Active=false", async () => {
    mockFetch
      .mockResolvedValueOnce(
        makeResponse({
          QueryResponse: {
            Item: [{ Id: "123", SyncToken: "7", Active: true }],
          },
        })
      )
      .mockResolvedValueOnce(
        makeResponse({
          Item: { Id: "123", SyncToken: "8", Active: false },
        })
      );

    const result = await archiveQuickBooksItem("123", mockFetch);

    expect(result.status).toBe("archived");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("runCleanupAdapter delegates Zoho cleanup to zoho-inventory", async () => {
    mockDeleteZohoItem.mockResolvedValue({
      status: "deleted",
      message: "deleted",
      httpStatus: 200,
    });

    const result = await runCleanupAdapter("zoho", "zoho_1");

    expect(mockDeleteZohoItem).toHaveBeenCalledWith("zoho_1");
    expect(result.status).toBe("deleted");
    expect(result.source).toBe("zoho");
  });
});

