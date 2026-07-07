/**
 * Tests for Zuper customer resolution (resolveOrCreateZuperCustomer).
 *
 * Incident (7/7): every job created by the create-zuper-job action was
 * attached to "Kushaal Zuper" (Zuper's demo customer). Three stacked bugs:
 *  1. searchCustomers used `/customers?search=` — Zuper silently ignores
 *     that param and returns the same unfiltered first page for ANY query
 *     (the working param is `filter.keyword`).
 *  2. The resolver's fallback took "any customer with a customer_uid" —
 *     i.e. the first row of the unfiltered page (Kushaal).
 *  3. The action passed the raw deal name, so "SVC | PROJ-8135 | King,
 *     Jesse | addr" parsed to customer "SVC".
 *
 * The resolver must only accept REAL name matches and otherwise create a
 * new customer — never attach an arbitrary one.
 */
export {};

jest.mock("@/lib/db", () => ({ prisma: null }));
jest.mock("@/lib/zuper-property-sync", () => ({ linkJobToProperty: jest.fn() }));
jest.mock("@/lib/zuper-call-counter", () => ({ recordZuperCall: jest.fn() }));

type RecordedCall = { url: string; method: string; body?: unknown };
const calls: RecordedCall[] = [];

function mockFetch(handler: (url: string, method: string) => unknown) {
  global.fetch = jest.fn(async (url: unknown, init?: RequestInit) => {
    const method = String(init?.method || "GET");
    calls.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(handler(String(url), method)),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

// The unfiltered page Zuper returns when a query param is ignored.
const DEMO_FIRST_PAGE = [
  { customer_uid: "kushaal-uid", customer_first_name: "Kushaal", customer_last_name: "Zuper" },
  { customer_uid: "elder-uid", customer_first_name: "William", customer_last_name: "Elder" },
];

let zuperMod: typeof import("@/lib/zuper");

beforeAll(async () => {
  process.env.ZUPER_API_KEY = "test-key";
  process.env.ZUPER_API_URL = "https://zuper.test/api";
  zuperMod = await import("@/lib/zuper");
});

beforeEach(() => {
  calls.length = 0;
});

describe("ZuperClient.searchCustomers", () => {
  it("queries with filter.keyword (the only param Zuper honors), not search=", async () => {
    mockFetch(() => ({ type: "success", data: [] }));
    const client = new zuperMod.ZuperClient();
    await client.searchCustomers("King");
    expect(calls[0].url).toContain("filter.keyword=King");
    expect(calls[0].url).not.toContain("search=King");
  });
});

describe("resolveOrCreateZuperCustomer", () => {
  it("returns the exact-name match when present", async () => {
    mockFetch((url) => {
      if (url.includes("/customers?") || url.includes("/customers/search")) {
        return {
          type: "success",
          data: [
            ...DEMO_FIRST_PAGE,
            { customer_uid: "king-uid", customer_first_name: "Jesse", customer_last_name: "King" },
          ],
        };
      }
      return { type: "success", data: {} };
    });
    const uid = await zuperMod.resolveOrCreateZuperCustomer({
      id: "1",
      name: "PROJ-8135 | King, Jesse | 28118 Inspire Road",
      customerName: "King, Jesse",
    });
    expect(uid).toBe("king-uid");
  });

  it("NEVER attaches an unrelated customer when no name matches (Kushaal regression)", async () => {
    mockFetch((url, method) => {
      if (method === "POST" && url.endsWith("/customers")) {
        return { type: "success", data: { customer_uid: "created-uid" } };
      }
      if (url.includes("/customers")) {
        return { type: "success", data: DEMO_FIRST_PAGE };
      }
      return { type: "success", data: {} };
    });
    const uid = await zuperMod.resolveOrCreateZuperCustomer({
      id: "2",
      name: "SVC | PROJ-8135 | King, Jesse | 28118 Inspire Road",
      customerName: "King, Jesse",
      address: "28118 Inspire Road",
      city: "Evergreen",
      state: "CO",
      zipCode: "80439",
    });
    // Must create a real customer, not return kushaal-uid.
    expect(uid).toBe("created-uid");
    const create = calls.find((c) => c.method === "POST" && c.url.endsWith("/customers"));
    expect(create).toBeDefined();
    const body = create!.body as { customer: { customer_first_name: string; customer_last_name: string } } | { customer_first_name: string; customer_last_name: string };
    const payload = "customer" in body ? body.customer : body;
    expect(payload.customer_first_name).toBe("Jesse");
    expect(payload.customer_last_name).toBe("King");
  });

  it("matches last-name-only rows case-insensitively", async () => {
    mockFetch((url) => {
      if (url.includes("/customers")) {
        return {
          type: "success",
          data: [
            ...DEMO_FIRST_PAGE,
            { customer_uid: "king2-uid", customer_first_name: "JESSE", customer_last_name: "king" },
          ],
        };
      }
      return { type: "success", data: {} };
    });
    const uid = await zuperMod.resolveOrCreateZuperCustomer({
      id: "3",
      name: "whatever",
      customerName: "Jesse King",
    });
    expect(uid).toBe("king2-uid");
  });
});

describe("create-zuper-job customer name parsing", () => {
  it("derives the real customer from prefixed deal names", async () => {
    const { parseCustomerNameFromDealName } = await import(
      "@/lib/admin-workflows/actions/create-zuper-job"
    );
    expect(parseCustomerNameFromDealName("SVC | PROJ-8135 | King, Jesse | 28118 Inspire Road, Evergreen, CO 80439")).toBe("King, Jesse");
    expect(parseCustomerNameFromDealName("PROJ-10040 | Nelson, Jeannie | 16084 E Lehigh Cir, Aurora, CO 80013")).toBe("Nelson, Jeannie");
    expect(parseCustomerNameFromDealName("D&R | PROJ-7111 | Sawasdee, Thanthong | 295 N Duquesne St")).toBe("Sawasdee, Thanthong");
    expect(parseCustomerNameFromDealName("Sorensen, John | 841 Elk Rest Rd, Evergreen, CO 80439")).toBe("Sorensen, John");
    // No name segment → empty string (caller falls back / creates from deal)
    expect(parseCustomerNameFromDealName("test")).toBe("test");
  });
});
