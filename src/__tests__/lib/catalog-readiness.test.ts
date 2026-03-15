import { getDownstreamReadiness, type SystemReadiness } from "@/lib/catalog-readiness";

// Mock zoho-taxonomy so tests don't depend on live mapping data
jest.mock("@/lib/zoho-taxonomy", () => ({
  hasVerifiedZohoMapping: (cat: string) => cat === "MODULE" || cat === "INVERTER",
  getZohoGroupName: (cat: string) => {
    if (cat === "MODULE") return "Module";
    if (cat === "INVERTER") return "Inverter";
    return undefined;
  },
}));

function findSystem(results: SystemReadiness[], system: string) {
  return results.find((r) => r.system === system);
}

describe("getDownstreamReadiness", () => {
  const allSystems = new Set(["INTERNAL", "HUBSPOT", "ZUPER", "ZOHO"]);

  it("INTERNAL is always ready", () => {
    const results = getDownstreamReadiness({
      category: "MODULE",
      systems: new Set(["INTERNAL"]),
      specValues: {},
    });
    const internal = findSystem(results, "INTERNAL");
    expect(internal?.status).toBe("ready");
  });

  it("ZOHO returns ready for MODULE (confirmed mapping)", () => {
    const results = getDownstreamReadiness({
      category: "MODULE",
      systems: allSystems,
      specValues: { wattage: 400 },
    });
    const zoho = findSystem(results, "ZOHO");
    expect(zoho?.status).toBe("ready");
    expect(zoho?.details[0]).toContain("Module");
  });

  it("ZOHO returns limited for BATTERY (unresolved mapping)", () => {
    const results = getDownstreamReadiness({
      category: "BATTERY",
      systems: allSystems,
      specValues: { capacityKwh: 13.5 },
    });
    const zoho = findSystem(results, "ZOHO");
    expect(zoho?.status).toBe("limited");
    expect(zoho?.details[0]).toContain("No confirmed");
  });

  it("HUBSPOT returns ready when all filled fields have hubspotProperty", () => {
    // MODULE: wattage has hubspotProperty "dc_size" — only filled field
    const results = getDownstreamReadiness({
      category: "MODULE",
      systems: allSystems,
      specValues: { wattage: 400 },
    });
    const hubspot = findSystem(results, "HUBSPOT");
    expect(hubspot?.status).toBe("ready");
  });

  it("HUBSPOT returns partial when some filled fields lack hubspotProperty", () => {
    // MODULE: wattage (mapped) + efficiency (not mapped) both filled
    const results = getDownstreamReadiness({
      category: "MODULE",
      systems: allSystems,
      specValues: { wattage: 400, efficiency: 21.5 },
    });
    const hubspot = findSystem(results, "HUBSPOT");
    expect(hubspot?.status).toBe("partial");
    expect(hubspot?.details.join(" ")).toContain("won't sync");
  });

  it("ZUPER returns ready with spec string for MODULE with wattage", () => {
    const results = getDownstreamReadiness({
      category: "MODULE",
      systems: allSystems,
      specValues: { wattage: 400, cellType: "Mono PERC" },
    });
    const zuper = findSystem(results, "ZUPER");
    expect(zuper?.status).toBe("ready");
    expect(zuper?.details[0]).toContain("400W");
  });

  it("ZUPER returns limited for MODULE without wattage", () => {
    const results = getDownstreamReadiness({
      category: "MODULE",
      systems: allSystems,
      specValues: {},
    });
    const zuper = findSystem(results, "ZUPER");
    expect(zuper?.status).toBe("limited");
  });

  it("only evaluates toggled-on systems", () => {
    const results = getDownstreamReadiness({
      category: "MODULE",
      systems: new Set(["INTERNAL", "ZOHO"]),
      specValues: { wattage: 400 },
    });
    expect(results.map((r) => r.system)).toEqual(["INTERNAL", "ZOHO"]);
    expect(findSystem(results, "HUBSPOT")).toBeUndefined();
    expect(findSystem(results, "ZUPER")).toBeUndefined();
  });

  it("HUBSPOT returns limited for category with no hubspotProperty fields", () => {
    // RACKING has fields but none have hubspotProperty
    const results = getDownstreamReadiness({
      category: "RACKING",
      systems: allSystems,
      specValues: { mountType: "Roof" },
    });
    const hubspot = findSystem(results, "HUBSPOT");
    expect(hubspot?.status).toBe("limited");
  });
});
