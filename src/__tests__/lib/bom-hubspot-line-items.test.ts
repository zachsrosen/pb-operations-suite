import { parseBomTag } from "@/lib/hubspot";

describe("parseBomTag", () => {
  it("parses a valid BOM tag", () => {
    expect(parseBomTag("[BOM:clxyz123] Some equipment")).toEqual({
      isBomManaged: true,
      pushLogId: "clxyz123",
    });
  });

  it("returns not managed for null description", () => {
    expect(parseBomTag(null)).toEqual({ isBomManaged: false, pushLogId: null });
  });

  it("returns not managed for description without tag", () => {
    expect(parseBomTag("Regular line item")).toEqual({ isBomManaged: false, pushLogId: null });
  });

  it("returns not managed for malformed tag", () => {
    expect(parseBomTag("[BOM:] something")).toEqual({ isBomManaged: false, pushLogId: null });
  });

  it("handles tag at end of description", () => {
    expect(parseBomTag("Equipment [BOM:abc123]")).toEqual({
      isBomManaged: true,
      pushLogId: "abc123",
    });
  });
});
