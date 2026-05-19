import { computePortalUrl } from "@/lib/tesla-powerhub";

describe("computePortalUrl", () => {
  const originalEnv = process.env.TESLA_POWERHUB_PORTAL_URL_TEMPLATE;
  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.TESLA_POWERHUB_PORTAL_URL_TEMPLATE;
    } else {
      process.env.TESLA_POWERHUB_PORTAL_URL_TEMPLATE = originalEnv;
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
