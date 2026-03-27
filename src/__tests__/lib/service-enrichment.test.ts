import { resolveLastContact } from "@/lib/service-enrichment";

describe("resolveLastContact", () => {
  it("returns contact-level timestamp when available", () => {
    const result = resolveLastContact(
      { "c1": "2026-03-20T00:00:00Z", "c2": "2026-03-25T00:00:00Z" },
      ["c1", "c2"],
      null
    );
    expect(result).toEqual({
      lastContactDate: "2026-03-25T00:00:00Z",
      lastContactSource: "contact",
    });
  });

  it("falls back to deal-level when no contacts have timestamps", () => {
    const result = resolveLastContact(
      {},
      [],
      "2026-03-15T00:00:00Z"
    );
    expect(result).toEqual({
      lastContactDate: "2026-03-15T00:00:00Z",
      lastContactSource: "deal",
    });
  });

  it("falls back to ticket-level for ticket items", () => {
    const result = resolveLastContact(
      {},
      [],
      null,
      "2026-03-18T00:00:00Z"
    );
    expect(result).toEqual({
      lastContactDate: "2026-03-18T00:00:00Z",
      lastContactSource: "ticket",
    });
  });

  it("returns null when all sources empty", () => {
    const result = resolveLastContact({}, [], null);
    expect(result).toEqual({
      lastContactDate: null,
      lastContactSource: null,
    });
  });
});
