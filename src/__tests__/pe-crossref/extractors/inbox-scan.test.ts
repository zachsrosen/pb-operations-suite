import { dealRegion, customerLastName, buildDealQuery } from "@/lib/pe-crossref/extractors/inbox-scan";
import type { ResolvedPEDeal } from "@/lib/pe-turnover";

const deal = (overrides: Partial<ResolvedPEDeal> = {}): ResolvedPEDeal => ({
  dealId: "d1",
  dealName: "PROJ-9542 | Brownell, Matt | 16578 W 55th Dr, Golden, CO 80403",
  address: "16578 W 55th Dr, Golden, CO 80403",
  systemType: "solar+battery",
  stageName: "PTO",
  peM1Status: null,
  peM2Status: null,
  rootFolderId: "root",
  designFolderId: null,
  ...overrides,
});

describe("dealRegion", () => {
  it("returns 'co' for Colorado addresses", () => {
    expect(dealRegion(deal({ address: "16578 W 55th Dr, Golden, CO 80403" }))).toBe("co");
  });

  it("returns 'ca' for California addresses", () => {
    expect(dealRegion(deal({ address: "123 Main St, Camarillo, CA 93010" }))).toBe("ca");
  });

  it("returns 'ca' for SLO California address", () => {
    expect(dealRegion(deal({ address: "456 Higuera St, San Luis Obispo, CA 93401" }))).toBe("ca");
  });
});

describe("customerLastName", () => {
  it("extracts last name from 'PROJ-XXXX | Last, First | Address' format", () => {
    expect(customerLastName(deal())).toBe("Brownell");
  });

  it("returns empty string when dealName doesn't follow the pattern", () => {
    expect(customerLastName(deal({ dealName: "Random Deal Name" }))).toBe("");
  });

  it("handles multi-word last names", () => {
    expect(customerLastName(deal({ dealName: "PROJ-1234 | Van Horne, Brita | 1 Main St" }))).toBe("Van Horne");
  });
});

describe("buildDealQuery", () => {
  it("includes has:attachment + filename:pdf + customer name in the Gmail query", () => {
    const q = buildDealQuery(deal());
    expect(q).toContain("has:attachment");
    expect(q).toContain("filename:pdf");
    expect(q).toContain('"Brownell"');
  });

  it("uses newer_than:180d to bound the search", () => {
    expect(buildDealQuery(deal())).toContain("newer_than:180d");
  });

  it("omits the quoted last-name clause when name can't be parsed", () => {
    const q = buildDealQuery(deal({ dealName: "no-pipe-delimited-name" }));
    expect(q).not.toContain('""');
    expect(q).toContain("has:attachment");
  });
});
