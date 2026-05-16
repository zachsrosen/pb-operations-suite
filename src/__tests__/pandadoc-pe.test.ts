import { PE_TEMPLATE_PATTERNS } from "@/lib/pandadoc";

describe("PE template patterns", () => {
  it("has 4 templates", () => {
    expect(PE_TEMPLATE_PATTERNS).toHaveLength(4);
  });

  it("has unique keys", () => {
    const keys = PE_TEMPLATE_PATTERNS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("each pattern is non-empty", () => {
    for (const t of PE_TEMPLATE_PATTERNS) {
      expect(t.pattern.length).toBeGreaterThan(0);
    }
  });
});
