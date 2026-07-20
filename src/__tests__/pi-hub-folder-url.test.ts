import { normalizeDriveFolderUrl } from "@/lib/pi-hub/drive";

/**
 * pto___closeout_documents holds a BARE Drive folder id on ~75% of deals,
 * unlike permit/interconnection/design folder properties which are always
 * full URLs (measured over a 100-deal sample, 2026-07-17). A bare id rendered
 * as an href is a relative link that 404s, so the detail fetch coerces it.
 */
describe("normalizeDriveFolderUrl", () => {
  const BARE_ID = "1-foz19I8VJFLtf-s_Y-FUK87HB7bwbWk"; // real pto value
  const FULL_URL = "https://drive.google.com/drive/folders/1pDby2ojJ2YDO8KTFSCMr";

  it("wraps a bare Drive folder id into a real URL", () => {
    expect(normalizeDriveFolderUrl(BARE_ID)).toBe(
      `https://drive.google.com/drive/folders/${BARE_ID}`,
    );
  });

  it("passes a full URL through untouched", () => {
    expect(normalizeDriveFolderUrl(FULL_URL)).toBe(FULL_URL);
  });

  it("returns null for blank, missing, or unusable values", () => {
    expect(normalizeDriveFolderUrl(null)).toBeNull();
    expect(normalizeDriveFolderUrl(undefined)).toBeNull();
    expect(normalizeDriveFolderUrl("")).toBeNull();
    expect(normalizeDriveFolderUrl("   ")).toBeNull();
    // too short to be a Drive id, and not a URL
    expect(normalizeDriveFolderUrl("n/a")).toBeNull();
  });
});
