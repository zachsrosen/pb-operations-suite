import { fmtAmount, fmtDateShort } from "@/lib/format-helpers";

describe("fmtAmount", () => {
  it("formats a positive number as USD with no decimals", () => {
    expect(fmtAmount(52247)).toBe("$52,247");
  });
  it("formats zero", () => {
    expect(fmtAmount(0)).toBe("$0");
  });
  it("returns -- for null", () => {
    expect(fmtAmount(null)).toBe("--");
  });
  it("returns -- for undefined", () => {
    expect(fmtAmount(undefined)).toBe("--");
  });
});

describe("fmtDateShort", () => {
  it("formats a date string as short US date", () => {
    expect(fmtDateShort("2026-03-15")).toBe("Mar 15, 2026");
  });
  it("returns -- for null", () => {
    expect(fmtDateShort(null)).toBe("--");
  });
  it("returns -- for undefined", () => {
    expect(fmtDateShort(undefined)).toBe("--");
  });
  it("returns -- for empty string", () => {
    expect(fmtDateShort("")).toBe("--");
  });
});
