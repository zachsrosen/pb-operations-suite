// Mock modules that require runtime dependencies (Prisma client)
jest.mock("@/lib/db", () => ({ prisma: null }));
jest.mock("@/lib/pe-scraper-sync", () => ({
  buildPeDealMap: jest.fn(),
  matchProjectToDeal: jest.fn(),
}));

import { mapApiDocStatus } from "@/lib/pe-api-sync";
import { PeDocStatus } from "@/generated/prisma/enums";

describe("mapApiDocStatus", () => {
  it("maps absent docs to NOT_UPLOADED regardless of status", () => {
    expect(mapApiDocStatus(null, false)).toBe(PeDocStatus.NOT_UPLOADED);
    expect(mapApiDocStatus("APPROVED", false)).toBe(PeDocStatus.NOT_UPLOADED);
    expect(mapApiDocStatus(undefined, false)).toBe(PeDocStatus.NOT_UPLOADED);
  });

  it("maps the four observed PE statuses", () => {
    expect(mapApiDocStatus("APPROVED", true)).toBe(PeDocStatus.APPROVED);
    expect(mapApiDocStatus("RESPONSE_NEEDED", true)).toBe(PeDocStatus.ACTION_REQUIRED);
    expect(mapApiDocStatus("PENDING_REVIEW", true)).toBe(PeDocStatus.UNDER_REVIEW);
    expect(mapApiDocStatus("PENDING_APPROVAL", true)).toBe(PeDocStatus.UNDER_REVIEW);
  });

  it("returns null for missing or unrecognized statuses so callers fall back to inference", () => {
    expect(mapApiDocStatus(null, true)).toBeNull();
    expect(mapApiDocStatus(undefined, true)).toBeNull();
    expect(mapApiDocStatus("SOMETHING_NEW", true)).toBeNull();
  });
});
