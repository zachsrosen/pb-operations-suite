import { normalizePath, suiteForPath, KNOWN_PAGES, PATH_TO_SUITE } from "@/lib/page-traffic";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

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

describe("suiteForPath", () => {
  it("maps a known dashboard to its suite", () => {
    expect(suiteForPath("/dashboards/scheduler")).toBe("Operations");
  });
  it("buckets unknown paths to Other", () => {
    expect(suiteForPath("/dashboards/this-page-does-not-exist")).toBe("Other");
  });
  it("KNOWN_PAGES includes suite landing routes", () => {
    expect(KNOWN_PAGES).toContain("/admin/page-traffic");
  });
});

// Drift guard: every /dashboards/* href referenced by a suite landing page
// must be represented in PATH_TO_SUITE, so the map can't silently go stale.
describe("PATH_TO_SUITE drift guard", () => {
  it("covers every dashboard href used in suite pages", () => {
    const suitesDir = join(process.cwd(), "src/app/suites");
    const missing: string[] = [];
    for (const suite of readdirSync(suitesDir)) {
      let src: string;
      try { src = readFileSync(join(suitesDir, suite, "page.tsx"), "utf8"); }
      catch { continue; }
      const hrefs = [...src.matchAll(/href:\s*["'](\/dashboards\/[^"'?#]+)["']/g)].map((m) => m[1]);
      for (const h of hrefs) {
        const norm = h.replace(/\/$/, "");
        if (!(norm in PATH_TO_SUITE)) missing.push(`${suite}: ${norm}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
