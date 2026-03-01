import { scorePair, crossMatch } from "@/lib/catalog-matcher";
import type { HarvestedProduct } from "@/lib/catalog-harvest";
import type { DedupeCluster } from "@/lib/catalog-dedupe";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeCluster(overrides: {
  source: string;
  externalId: string;
  brand: string;
  model: string;
  category?: string;
  price?: number;
  vpn?: string;
}): DedupeCluster {
  const product: HarvestedProduct = {
    source: overrides.source as HarvestedProduct["source"],
    externalId: overrides.externalId,
    rawName: `${overrides.brand} ${overrides.model}`,
    rawBrand: overrides.brand,
    rawModel: overrides.model,
    category: overrides.category || "MODULE",
    price: overrides.price ?? null,
    description: null,
    rawPayload: overrides.vpn ? { vendorPartNumber: overrides.vpn } : {},
  };
  return {
    canonicalKey: `${overrides.category || "MODULE"}|${overrides.brand.toLowerCase().replace(/[^a-z0-9]/g, "")}|${overrides.model.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
    representative: product,
    members: [product],
    dedupeReason: "singleton",
    sourceIds: [overrides.externalId],
    ambiguityCount: 0,
  };
}

// ---------------------------------------------------------------------------
// scorePair tests
// ---------------------------------------------------------------------------

describe("scorePair", () => {
  it("scores >= 40 for matching canonical brand+model", () => {
    const a = makeCluster({ source: "zoho", externalId: "z1", brand: "Tesla", model: "Powerwall 3" });
    const b = makeCluster({ source: "hubspot", externalId: "h1", brand: "Tesla", model: "Powerwall 3" });
    const score = scorePair(a.representative, b.representative);
    expect(score).toBeGreaterThanOrEqual(40);
  });

  it("scores 0 for completely different products", () => {
    const a = makeCluster({ source: "zoho", externalId: "z1", brand: "Tesla", model: "Powerwall 3", category: "BATTERY" });
    const b = makeCluster({ source: "hubspot", externalId: "h1", brand: "Enphase", model: "IQ8M", category: "INVERTER" });
    const score = scorePair(a.representative, b.representative);
    expect(score).toBe(0);
  });

  it("adds 25 for VPN match", () => {
    const a = makeCluster({ source: "zoho", externalId: "z1", brand: "Tesla", model: "Powerwall 3", vpn: "PW3-US" });
    const b = makeCluster({ source: "hubspot", externalId: "h1", brand: "Tesla", model: "Powerwall 3", vpn: "PW3-US" });
    // Brand+model (40) + name (20) + category (10) + VPN (25) = 95
    const withVpn = scorePair(a.representative, b.representative);

    const c = makeCluster({ source: "zoho", externalId: "z2", brand: "Tesla", model: "Powerwall 3" });
    const d = makeCluster({ source: "hubspot", externalId: "h2", brand: "Tesla", model: "Powerwall 3" });
    const withoutVpn = scorePair(c.representative, d.representative);

    expect(withVpn - withoutVpn).toBe(25);
  });

  it("adds 10 for category match", () => {
    const a = makeCluster({ source: "zoho", externalId: "z1", brand: "Tesla", model: "Powerwall 3", category: "BATTERY" });
    const b = makeCluster({ source: "hubspot", externalId: "h1", brand: "Tesla", model: "Powerwall 3", category: "BATTERY" });
    const sameCategory = scorePair(a.representative, b.representative);

    const c = makeCluster({ source: "zoho", externalId: "z2", brand: "Tesla", model: "Powerwall 3", category: "BATTERY" });
    const d = makeCluster({ source: "hubspot", externalId: "h2", brand: "Tesla", model: "Powerwall 3", category: "INVERTER" });
    const diffCategory = scorePair(c.representative, d.representative);

    expect(sameCategory - diffCategory).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// crossMatch tests
// ---------------------------------------------------------------------------

describe("crossMatch", () => {
  it("groups matching clusters from different sources into one MatchGroup with HIGH confidence", () => {
    const clusters = [
      makeCluster({ source: "zoho", externalId: "z1", brand: "Tesla", model: "Powerwall 3", category: "BATTERY", vpn: "PW3-US" }),
      makeCluster({ source: "hubspot", externalId: "h1", brand: "Tesla", model: "Powerwall 3", category: "BATTERY", vpn: "PW3-US" }),
    ];

    const groups = crossMatch(clusters);

    expect(groups).toHaveLength(1);
    expect(groups[0].confidence).toBe("HIGH");
    expect(groups[0].memberClusters).toHaveLength(2);
    expect(groups[0].memberSources).toHaveLength(2);
    expect(groups[0].score).toBeGreaterThanOrEqual(80);
  });

  it("keeps unrelated clusters as separate groups", () => {
    const clusters = [
      makeCluster({ source: "zoho", externalId: "z1", brand: "Tesla", model: "Powerwall 3", category: "BATTERY" }),
      makeCluster({ source: "hubspot", externalId: "h1", brand: "Enphase", model: "IQ8M", category: "INVERTER" }),
    ];

    const groups = crossMatch(clusters);

    expect(groups).toHaveLength(2);
    groups.forEach((g) => {
      expect(g.memberClusters).toHaveLength(1);
      expect(g.confidence).toBe("LOW"); // singletons
    });
  });

  it("produces a stable matchGroupKey (same input -> same key)", () => {
    const clusters = [
      makeCluster({ source: "zoho", externalId: "z1", brand: "Tesla", model: "Powerwall 3", category: "BATTERY", vpn: "PW3-US" }),
      makeCluster({ source: "hubspot", externalId: "h1", brand: "Tesla", model: "Powerwall 3", category: "BATTERY", vpn: "PW3-US" }),
    ];

    const groups1 = crossMatch(clusters);
    const groups2 = crossMatch(clusters);

    expect(groups1[0].matchGroupKey).toBe(groups2[0].matchGroupKey);
    expect(groups1[0].matchGroupKey).toHaveLength(16);
  });
});
