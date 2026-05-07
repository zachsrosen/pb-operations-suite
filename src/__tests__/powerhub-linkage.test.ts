/**
 * PowerHub site-to-deal linkage logic tests.
 * Tests address normalization, three-tier matching, and confidence scoring.
 */
import {
  normalizeAddress,
  computeAddressHash,
  matchSiteToProperty,
  matchSiteToDeals,
} from "@/lib/powerhub-linkage";

describe("Address Normalization", () => {
  it("should lowercase and trim", () => {
    expect(normalizeAddress("  123 Main St  ")).toBe("123 main st");
  });

  it("should remove unit/apt/suite suffixes", () => {
    expect(normalizeAddress("456 Oak Ave Apt 2B")).toBe("456 oak ave");
    expect(normalizeAddress("789 Pine Rd Suite 100")).toBe("789 pine rd");
    expect(normalizeAddress("321 Elm St #4")).toBe("321 elm st");
    expect(normalizeAddress("555 Birch Unit A")).toBe("555 birch");
  });

  it("should remove periods", () => {
    expect(normalizeAddress("123 N. Main St.")).toBe("123 n main st");
  });

  it("should collapse whitespace", () => {
    expect(normalizeAddress("123   Main    St")).toBe("123 main st");
  });
});

describe("Address Hash", () => {
  it("should produce consistent SHA-256 for same input", () => {
    const hash1 = computeAddressHash("123 main st", "denver", "co", "80202");
    const hash2 = computeAddressHash("123 main st", "denver", "co", "80202");
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex
  });

  it("should produce different hashes for different addresses", () => {
    const hash1 = computeAddressHash("123 main st", "denver", "co", "80202");
    const hash2 = computeAddressHash("456 oak ave", "denver", "co", "80202");
    expect(hash1).not.toBe(hash2);
  });
});

describe("Tier 1: Property Match", () => {
  it("should match when addressHash matches a HubSpotPropertyCache row", async () => {
    const mockPrisma = {
      hubSpotPropertyCache: {
        findFirst: jest.fn().mockResolvedValue({
          id: "prop-1",
          addressHash: "abc123hash",
          fullAddress: "123 Main St, Denver, CO 80202",
        }),
      },
    };

    const result = await matchSiteToProperty(
      { addressHash: "abc123hash" },
      mockPrisma as any
    );

    expect(result).toEqual({
      method: "PROPERTY",
      confidence: "HIGH",
      propertyId: "prop-1",
      dealId: null,
    });
  });

  it("should return null when no property matches", async () => {
    const mockPrisma = {
      hubSpotPropertyCache: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    const result = await matchSiteToProperty(
      { addressHash: "no-match" },
      mockPrisma as any
    );

    expect(result).toBeNull();
  });
});

describe("Tier 2: Address Match to Deals", () => {
  it("should match HIGH confidence when street+city+state+zip all match", async () => {
    const result = matchSiteToDeals(
      { street: "123 main st", city: "denver", state: "co", zip: "80202" },
      [
        {
          dealId: "deal-1",
          street: "123 main st",
          city: "denver",
          state: "co",
          zip: "80202",
        },
      ]
    );

    expect(result).toEqual({
      method: "ADDRESS_MATCH",
      confidence: "HIGH",
      propertyId: null,
      dealId: "deal-1",
    });
  });

  it("should match MEDIUM confidence when street+city match but zip differs", async () => {
    const result = matchSiteToDeals(
      { street: "123 main st", city: "denver", state: "co", zip: "80202" },
      [
        {
          dealId: "deal-2",
          street: "123 main st",
          city: "denver",
          state: "co",
          zip: "80203",
        },
      ]
    );

    expect(result).toEqual({
      method: "ADDRESS_MATCH",
      confidence: "MEDIUM",
      propertyId: null,
      dealId: "deal-2",
    });
  });

  it("should return null when no deals match", () => {
    const result = matchSiteToDeals(
      { street: "999 nowhere ln", city: "denver", state: "co", zip: "80202" },
      [
        {
          dealId: "deal-1",
          street: "123 main st",
          city: "denver",
          state: "co",
          zip: "80202",
        },
      ]
    );

    expect(result).toBeNull();
  });
});
