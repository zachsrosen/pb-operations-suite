/**
 * Tests for PowerHub fleet-table ticket enrichment (lib/powerhub-tickets).
 */

import { buildSiteTicketsFromDeals, MAX_TICKETS_PER_SITE, type SiteTicket } from "@/lib/powerhub-tickets";

describe("buildSiteTicketsFromDeals", () => {
  it("unions open tickets across all of a site's deals", () => {
    const byDeal: Record<string, SiteTicket[]> = {
      "sales-deal": [{ id: "t1", subject: "Solar production limited" }],
      "svc-deal": [{ id: "t2", subject: "Site visit" }],
    };
    expect(buildSiteTicketsFromDeals(["svc-deal", "sales-deal"], byDeal)).toEqual([
      { id: "t2", subject: "Site visit" },
      { id: "t1", subject: "Solar production limited" },
    ]);
  });

  it("dedupes a ticket associated to more than one of the site's deals", () => {
    const shared: SiteTicket = { id: "t1", subject: "Shared" };
    const byDeal: Record<string, SiteTicket[]> = { a: [shared], b: [shared] };
    expect(buildSiteTicketsFromDeals(["a", "b"], byDeal)).toEqual([shared]);
  });

  it("returns [] when none of the site's deals have open tickets", () => {
    expect(buildSiteTicketsFromDeals(["x", "y"], { z: [{ id: "t1", subject: "s" }] })).toEqual([]);
    expect(buildSiteTicketsFromDeals([], {})).toEqual([]);
  });

  it("caps at MAX_TICKETS_PER_SITE", () => {
    const many = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`d${i}`, [{ id: `t${i}`, subject: `s${i}` }]])
    );
    const result = buildSiteTicketsFromDeals(Object.keys(many), many);
    expect(result).toHaveLength(MAX_TICKETS_PER_SITE);
  });
});
