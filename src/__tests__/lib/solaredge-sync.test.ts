import { apiSiteToRow } from "@/lib/solaredge";

describe("apiSiteToRow", () => {
  it("maps a SolarEdge API site to a DB row with PROJ + alert summary", () => {
    const row = apiSiteToRow({
      id: 123456,
      name: "PROJ-2166 Kevin Bruer",
      peakPower: 9.99,
      type: "Residential",
      status: "Active",
      location: { address: "7556 South Elk Court", city: "Denver", state: "CO", zip: "80016" },
      alertQuantity: 3,
      alertSeverity: "HIGH",
    });
    expect(row).toMatchObject({
      siteId: 123456,
      siteName: "PROJ-2166 Kevin Bruer",
      portalUrl: "https://monitoring.solaredge.com/solaredge-web/p/site/123456",
      siteType: "Residential",
      activationStatus: "Active",
      peakPowerKw: 9.99,
      city: "Denver",
      projNumber: "PROJ-2166",
      highestAlertImpact: 9,
      openAlertCount: 3,
    });
  });

  it("handles a site with no PROJ and no alerts", () => {
    const row = apiSiteToRow({ id: 9, name: "Doug Dunham", status: "Active" });
    expect(row.projNumber).toBeNull();
    expect(row.highestAlertImpact).toBe(0);
    expect(row.openAlertCount).toBe(0);
  });
});
