import {
  FRESHSERVICE_STATUS_LABELS,
  FRESHSERVICE_PRIORITY_LABELS,
} from "@/lib/freshservice";

beforeEach(() => {
  jest.resetModules();
  process.env.FRESHSERVICE_API_KEY = "test-key";
  process.env.FRESHSERVICE_DOMAIN = "testdomain";
  global.fetch = jest.fn() as unknown as typeof fetch;
});

describe("FRESHSERVICE_STATUS_LABELS", () => {
  it("maps status codes to labels", () => {
    expect(FRESHSERVICE_STATUS_LABELS[2]).toBe("Open");
    expect(FRESHSERVICE_STATUS_LABELS[5]).toBe("Closed");
  });
});

describe("FRESHSERVICE_PRIORITY_LABELS", () => {
  it("maps priority codes to labels", () => {
    expect(FRESHSERVICE_PRIORITY_LABELS[1]).toBe("Low");
    expect(FRESHSERVICE_PRIORITY_LABELS[4]).toBe("Urgent");
  });
});

describe("fetchAgentIdByEmail", () => {
  it("returns null when no agent matches", async () => {
    const { fetchAgentIdByEmail } = await import("@/lib/freshservice");
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ agents: [] }),
    });
    const id = await fetchAgentIdByEmail("nobody@example.com");
    expect(id).toBeNull();
  });

  it("returns the first agent's id", async () => {
    const { fetchAgentIdByEmail } = await import("@/lib/freshservice");
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        agents: [
          { id: 42, email: "x@y.com", first_name: "X", last_name: "Y" },
        ],
      }),
    });
    const id = await fetchAgentIdByEmail("x@y.com");
    expect(id).toBe(42);
  });

  it("sends HTTP Basic auth header built from API key + X", async () => {
    const { fetchAgentIdByEmail } = await import("@/lib/freshservice");
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ agents: [] }),
    });
    await fetchAgentIdByEmail("x@y.com");
    const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
    const expected = `Basic ${Buffer.from("test-key:X").toString("base64")}`;
    expect(opts.headers.Authorization).toBe(expected);
  });

  it("url-encodes the email in the query string", async () => {
    const { fetchAgentIdByEmail } = await import("@/lib/freshservice");
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ agents: [] }),
    });
    await fetchAgentIdByEmail("zach+test@y.com");
    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain("email=zach%2Btest%40y.com");
  });
});

describe("fetchTicketsByAgentId", () => {
  it("paginates through /tickets/filter until a short page", async () => {
    const { fetchTicketsByAgentId } = await import("@/lib/freshservice");
    const mk = (id: number, status: number) => ({
      id,
      subject: `t${id}`,
      status,
      priority: 2,
      created_at: "",
      updated_at: "",
      due_by: null,
      fr_due_by: null,
      description_text: "",
      requester_id: 1,
      responder_id: 42,
      type: null,
      category: null,
    });
    const page1 = Array.from({ length: 30 }, (_, i) => mk(i, 2));
    const page2 = [mk(1000, 3)];
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ tickets: page1 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ tickets: page2 }),
      });

    const tickets = await fetchTicketsByAgentId(42);
    expect(tickets).toHaveLength(31);
  });

  it("encodes the agent_id query correctly", async () => {
    const { fetchTicketsByAgentId } = await import("@/lib/freshservice");
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ tickets: [] }),
    });
    await fetchTicketsByAgentId(42);
    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain("/tickets/filter");
    expect(url).toContain("agent_id");
    expect(url).toContain("42");
  });
});

describe("freshserviceFetch error handling", () => {
  it("retries on 429 and eventually succeeds", async () => {
    const { fetchAgentIdByEmail } = await import("@/lib/freshservice");
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => "",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          agents: [
            { id: 1, email: "a@b.c", first_name: "A", last_name: "B" },
          ],
        }),
      });
    const id = await fetchAgentIdByEmail("a@b.c");
    expect(id).toBe(1);
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(2);
  }, 10_000);

  it("throws when API key is missing", async () => {
    delete process.env.FRESHSERVICE_API_KEY;
    const { fetchAgentIdByEmail } = await import("@/lib/freshservice");
    await expect(fetchAgentIdByEmail("x@y.com")).rejects.toThrow(
      "FRESHSERVICE_API_KEY not set"
    );
  });
});
