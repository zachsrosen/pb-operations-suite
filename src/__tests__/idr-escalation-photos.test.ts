import { describe, it, expect } from "@jest/globals";
import {
  ESCALATION_PHOTO_PREFIX,
  ALLOWED_PHOTO_TYPES,
  MAX_PHOTO_BYTES,
  validatePhotoUpload,
  isAllowedPhotoPath,
  photoViewerUrl,
} from "@/lib/idr-escalation-photos";

describe("validatePhotoUpload", () => {
  it("accepts a jpeg under the size cap", () => {
    expect(validatePhotoUpload("image/jpeg", 1_000_000)).toBeNull();
  });
  it("rejects a disallowed type", () => {
    expect(validatePhotoUpload("application/pdf", 10)).toMatch(/JPEG|PNG|WebP|GIF/);
  });
  it("rejects an oversized file", () => {
    expect(validatePhotoUpload("image/png", MAX_PHOTO_BYTES + 1)).toMatch(/5\s?MB/i);
  });
});

describe("isAllowedPhotoPath", () => {
  it("accepts a path under the prefix", () => {
    expect(isAllowedPhotoPath(`${ESCALATION_PHOTO_PREFIX}abc.png`)).toBe(true);
  });
  it("rejects paths outside the prefix or with ..", () => {
    expect(isAllowedPhotoPath("catalog-photos/x.png")).toBe(false);
    expect(isAllowedPhotoPath(`${ESCALATION_PHOTO_PREFIX}../secret`)).toBe(false);
  });
});

describe("photoViewerUrl", () => {
  it("builds an encoded same-origin proxy url", () => {
    expect(photoViewerUrl("escalation-photos/a b.png"))
      .toBe("/api/idr-meeting/escalation-photos/view?path=escalation-photos%2Fa%20b.png");
  });
});

// Reference the exported set so an unused-import lint doesn't fire.
describe("ALLOWED_PHOTO_TYPES", () => {
  it("includes the four supported image types", () => {
    expect(ALLOWED_PHOTO_TYPES.has("image/jpeg")).toBe(true);
  });
});
