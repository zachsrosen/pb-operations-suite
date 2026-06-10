import { normalizePath } from "@/lib/page-traffic";

describe("normalizePath", () => {
  it("strips query string", () => {
    expect(normalizePath("/dashboards/deals?loc=Westminster")).toBe("/dashboards/deals");
  });
  it("collapses numeric id segments", () => {
    expect(normalizePath("/dashboards/catalog/edit/42")).toBe("/dashboards/catalog/edit/[id]");
  });
  it("collapses hubspot-style and uuid ids in reviews", () => {
    expect(normalizePath("/dashboards/reviews/12345678901")).toBe("/dashboards/reviews/[dealId]");
    expect(normalizePath("/dashboards/reviews/abc123-def")).toBe("/dashboards/reviews/[dealId]");
  });
  it("leaves static dashboard paths untouched", () => {
    expect(normalizePath("/dashboards/service-tickets")).toBe("/dashboards/service-tickets");
  });
  it("normalizes trailing slash", () => {
    expect(normalizePath("/dashboards/deals/")).toBe("/dashboards/deals");
  });
});
