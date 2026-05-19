import { computePortalUrl } from "@/lib/tesla-powerhub";
import { parseSteDateFromName, pickPrimarySite } from "@/lib/powerhub-crosslink";

describe("computePortalUrl", () => {
  // Capture per-test, not at module load — protects against ordering with
  // sibling tests that also mutate this env var.
  let savedTemplate: string | undefined;
  beforeEach(() => {
    savedTemplate = process.env.TESLA_POWERHUB_PORTAL_URL_TEMPLATE;
  });
  afterEach(() => {
    if (savedTemplate === undefined) {
      delete process.env.TESLA_POWERHUB_PORTAL_URL_TEMPLATE;
    } else {
      process.env.TESLA_POWERHUB_PORTAL_URL_TEMPLATE = savedTemplate;
    }
  });

  it("uses the default template when env var is unset", () => {
    delete process.env.TESLA_POWERHUB_PORTAL_URL_TEMPLATE;
    expect(computePortalUrl("abc-123")).toBe("https://gridlogic.tesla.com/sites/abc-123");
  });

  it("uses the configured template when env var is set", () => {
    process.env.TESLA_POWERHUB_PORTAL_URL_TEMPLATE = "https://example.com/site/{siteId}/view";
    expect(computePortalUrl("xyz-789")).toBe("https://example.com/site/xyz-789/view");
  });

  it("returns null for empty siteId", () => {
    expect(computePortalUrl("")).toBeNull();
  });

  it("returns null for whitespace-only siteId", () => {
    expect(computePortalUrl("   ")).toBeNull();
  });

  it("encodes special characters safely", () => {
    // Tesla site UUIDs are alphanumeric+dashes but be defensive
    expect(computePortalUrl("a b/c")).toBe("https://gridlogic.tesla.com/sites/a%20b%2Fc");
  });
});

describe("parseSteDateFromName", () => {
  it("parses standard STE pattern STE20240105-008", () => {
    expect(parseSteDateFromName("STE20240105-008")).toEqual(new Date("2024-01-05T00:00:00Z"));
  });

  it("returns null for non-STE names", () => {
    expect(parseSteDateFromName("PB-Custom-001")).toBeNull();
    expect(parseSteDateFromName("")).toBeNull();
  });

  it("returns null for malformed STE (bad date)", () => {
    expect(parseSteDateFromName("STE20240230-001")).toBeNull(); // Feb 30
    expect(parseSteDateFromName("STE99999999-001")).toBeNull();
  });
});

describe("pickPrimarySite", () => {
  type S = { id: string; siteName: string; createdAt: Date };
  const mk = (id: string, siteName: string, createdAt: string): S => ({
    id, siteName, createdAt: new Date(createdAt),
  });

  it("returns null for empty array", () => {
    expect(pickPrimarySite([])).toBeNull();
  });

  it("returns the only site when there's one", () => {
    const sites = [mk("a", "STE20240105-008", "2024-01-10")];
    expect(pickPrimarySite(sites)?.id).toBe("a");
  });

  it("picks newest STE date", () => {
    const sites = [
      mk("a", "STE20230101-001", "2023-01-10"),
      mk("b", "STE20240105-008", "2024-01-10"),
      mk("c", "STE20220601-002", "2022-06-15"),
    ];
    expect(pickPrimarySite(sites)?.id).toBe("b");
  });

  it("tie-breaks lexicographically on siteName when STE dates tie", () => {
    const sites = [
      mk("a", "STE20240105-005", "2024-01-10"),
      mk("b", "STE20240105-008", "2024-01-10"),
      mk("c", "STE20240105-003", "2024-01-10"),
    ];
    expect(pickPrimarySite(sites)?.id).toBe("b"); // 008 sorts last
  });

  it("falls back to createdAt when STE pattern is missing", () => {
    const sites = [
      mk("a", "Custom-A", "2024-01-10"),
      mk("b", "Custom-B", "2024-05-10"),
    ];
    expect(pickPrimarySite(sites)?.id).toBe("b");
  });

  it("STE-named sites beat fallback-named sites", () => {
    const sites = [
      mk("a", "Custom-A", "2024-06-01"),
      mk("b", "STE20230101-001", "2023-01-10"),
    ];
    expect(pickPrimarySite(sites)?.id).toBe("b"); // STE wins even if older createdAt
  });

  it("final tie-break is id (lexicographic)", () => {
    const sites = [
      mk("c", "Custom-X", "2024-01-10"),
      mk("a", "Custom-X", "2024-01-10"),
      mk("b", "Custom-X", "2024-01-10"),
    ];
    expect(pickPrimarySite(sites)?.id).toBe("c"); // lexicographic max
  });
});
