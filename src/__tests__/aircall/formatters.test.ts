import { formatDelta, formatPercent, formatSeconds } from "@/components/calls/formatters";

describe("formatPercent", () => {
  test("formats fraction-of-1 as percent", () => {
    expect(formatPercent(0.123)).toBe("12.3%");
    expect(formatPercent(0)).toBe("0.0%");
    expect(formatPercent(1)).toBe("100.0%");
  });

  test("returns dash for null/undefined/non-finite", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(undefined)).toBe("—");
    expect(formatPercent(NaN)).toBe("—");
  });
});

describe("formatSeconds", () => {
  test("short mode: seconds, minutes, hours", () => {
    expect(formatSeconds(0)).toBe("0s");
    expect(formatSeconds(45)).toBe("45s");
    expect(formatSeconds(60)).toBe("1m");
    expect(formatSeconds(125)).toBe("2m 5s");
    expect(formatSeconds(3600)).toBe("1h");
    expect(formatSeconds(3725)).toBe("1h 2m");
  });

  test("returns dash for null/undefined/non-finite", () => {
    expect(formatSeconds(null)).toBe("—");
    expect(formatSeconds(undefined)).toBe("—");
    expect(formatSeconds(NaN)).toBe("—");
  });
});

describe("formatDelta", () => {
  test("zero returns 'no change vs prior'", () => {
    expect(formatDelta(0, "pp", true)).toBe("no change vs prior");
  });

  test("invert=true: negative value is improving (e.g. missed rate going down)", () => {
    const out = formatDelta(-0.05, "pp", true);
    expect(out).toContain("improving");
    expect(out).toContain("-5.0pp");
  });

  test("invert=true: positive value is worsening", () => {
    const out = formatDelta(0.05, "pp", true);
    expect(out).toContain("worsening");
  });
});
