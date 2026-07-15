/**
 * Tests for the pure half of the SolarEdge named-alert import
 * (row normalization + site matching). The DB writer is not exercised here.
 */

import { parseAlertRow, resolveSiteId, type SiteMatchMaps } from "@/lib/solaredge-alerts-import";

describe("parseAlertRow", () => {
  it("normalizes a full export row", () => {
    expect(
      parseAlertRow({
        Impact: 9,
        "Site Name": "PROJ-1265 Charles Baker",
        "Alert Type": "Battery not charging",
        Component: "Battery 1.1",
        "RMA Status": null,
        "RMA Case Number": "",
        Status: "Open",
      })
    ).toEqual({
      siteName: "PROJ-1265 Charles Baker",
      alertType: "Battery not charging",
      component: "Battery 1.1",
      impact: 9,
      rmaStatus: null,
      rmaCaseNumber: null,
      status: "Open",
      isActive: true,
    });
  });

  it("defaults status to Open and impact to 0 when absent/non-numeric", () => {
    const r = parseAlertRow({ "Site Name": "X", "Alert Type": "No communication", Impact: "n/a" });
    expect(r).toMatchObject({ impact: 0, status: "Open", isActive: true, component: null });
  });

  it("treats a non-Open status as inactive", () => {
    expect(parseAlertRow({ "Site Name": "X", "Alert Type": "Y", Status: "Closed" })?.isActive).toBe(false);
  });

  it("drops rows missing site name or alert type", () => {
    expect(parseAlertRow({ "Alert Type": "Y" })).toBeNull();
    expect(parseAlertRow({ "Site Name": "X" })).toBeNull();
  });
});

describe("resolveSiteId", () => {
  const maps: SiteMatchMaps = {
    byName: new Map([["PROJ-1265 Charles Baker", 111]]),
    byProj: new Map([["PROJ-1230", 222]]),
  };

  it("matches on exact site name first", () => {
    expect(resolveSiteId("PROJ-1265 Charles Baker", maps)).toBe(111);
  });

  it("falls back to a unique PROJ number when the name differs", () => {
    // Export formats the name differently ("PROJ 1230 -") but PROJ resolves.
    expect(resolveSiteId("PROJ 1230 - Rudolph 4440", maps)).toBe(222);
  });

  it("returns null when neither name nor PROJ matches", () => {
    expect(resolveSiteId("Some Unknown Site", maps)).toBeNull();
  });
});
