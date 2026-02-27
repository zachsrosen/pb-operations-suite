import { createOrUpdateZuperPart } from "@/lib/zuper-catalog";

type MockFetch = jest.MockedFunction<typeof fetch>;

function makeResponse(payload: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    text: async () => JSON.stringify(payload),
  } as Response;
}

describe("zuper-catalog", () => {
  const originalEnv = process.env;
  let mockFetch: MockFetch;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      ZUPER_API_KEY: "test-zuper-key",
      ZUPER_API_URL: "https://zuper.example.com/api",
    };
    mockFetch = jest.fn() as MockFetch;
    global.fetch = mockFetch;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("returns an existing Zuper item ID when lookup by SKU matches", async () => {
    mockFetch.mockResolvedValueOnce(
      makeResponse({
        type: "success",
        data: [
          {
            item_uid: "zuper_existing_1",
            sku: "REC400",
            name: "REC REC-400AA",
          },
        ],
      })
    );

    const result = await createOrUpdateZuperPart({
      brand: "REC",
      model: "REC-400AA",
      sku: "REC400",
      category: "Module",
    });

    expect(result).toEqual({ zuperItemId: "zuper_existing_1", created: false });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0]?.[0]).toContain("/items?search=REC400");
  });

  it("retries create with core payload when optional payload is rejected", async () => {
    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = String(init?.method || "GET").toUpperCase();

      if (method === "GET") {
        return makeResponse({ type: "success", data: [] });
      }

      const body = String(init?.body || "");
      if (method === "POST" && url.includes("/items") && body.includes("category_name")) {
        return makeResponse({ type: "error", message: "Invalid category field" }, false, 400);
      }
      if (method === "POST" && url.includes("/items")) {
        return makeResponse({
          type: "success",
          item: { item_uid: "zuper_created_1" },
        });
      }

      return makeResponse({ type: "error", message: "Unhandled endpoint" }, false, 404);
    });

    const result = await createOrUpdateZuperPart({
      brand: "REC",
      model: "REC-400AA",
      sku: "REC400",
      description: "400W module",
      category: "Module",
      vendorName: "BayWa",
      unitLabel: "W",
      sellPrice: 180,
      unitCost: 120,
      specification: "400W Mono",
    });

    expect(result).toEqual({ zuperItemId: "zuper_created_1", created: true });

    const postCalls = mockFetch.mock.calls.filter((call) => {
      const init = call[1];
      return String(init?.method || "GET").toUpperCase() === "POST";
    });
    expect(postCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("stops create fallbacks after first success-without-ID and resolves via re-search", async () => {
    let postCount = 0;
    mockFetch.mockImplementation(async (_input, init) => {
      const method = String(init?.method || "GET").toUpperCase();
      if (method === "GET") {
        if (postCount === 0) return makeResponse({ type: "success", data: [] });
        return makeResponse({
          type: "success",
          data: [{ item_uid: "zuper_created_research", sku: "REC400", name: "REC REC-400AA" }],
        });
      }

      postCount += 1;
      if (postCount === 1) {
        return makeResponse({ type: "success", message: "created" });
      }
      return makeResponse({ type: "error", message: "unexpected extra create call" }, false, 500);
    });

    const result = await createOrUpdateZuperPart({
      brand: "REC",
      model: "REC-400AA",
      sku: "REC400",
      category: "Module",
      sellPrice: 180,
    });

    expect(result).toEqual({ zuperItemId: "zuper_created_research", created: true });
    expect(postCount).toBe(1);
  });

  it("does not name-match categoryless record when a category is required", async () => {
    let postCount = 0;
    mockFetch.mockImplementation(async (_input, init) => {
      const method = String(init?.method || "GET").toUpperCase();
      if (method === "GET") {
        return makeResponse({
          type: "success",
          data: [{ item_uid: "zuper_name_only", name: "REC REC-400AA" }],
        });
      }
      postCount += 1;
      return makeResponse({
        type: "success",
        item: { item_uid: "zuper_created_category_guard" },
      });
    });

    const result = await createOrUpdateZuperPart({
      brand: "REC",
      model: "REC-400AA",
      category: "Module",
    });

    expect(result).toEqual({ zuperItemId: "zuper_created_category_guard", created: true });
    expect(postCount).toBeGreaterThanOrEqual(1);
  });

  it("throws when ZUPER_API_KEY is not configured", async () => {
    delete process.env.ZUPER_API_KEY;

    await expect(
      createOrUpdateZuperPart({
        brand: "REC",
        model: "REC-400AA",
      })
    ).rejects.toThrow(/ZUPER_API_KEY/i);
  });
});
