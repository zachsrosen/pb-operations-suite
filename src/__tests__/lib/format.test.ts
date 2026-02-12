import {
  formatMoney,
  formatCurrency,
  formatCurrencyCompact,
  formatNumber,
  formatDate,
  formatRelativeDate,
  formatPercent,
} from "@/lib/format";

describe("formatMoney", () => {
  it("formats millions with one decimal", () => {
    expect(formatMoney(1_500_000)).toBe("$1.5M");
    expect(formatMoney(2_000_000)).toBe("$2.0M");
    expect(formatMoney(10_750_000)).toBe("$10.8M");
  });

  it("formats thousands with no decimals", () => {
    expect(formatMoney(450_000)).toBe("$450k");
    expect(formatMoney(1_000)).toBe("$1k");
    expect(formatMoney(999_999)).toBe("$1000k");
  });

  it("formats small values as plain dollars", () => {
    expect(formatMoney(500)).toBe("$500");
    expect(formatMoney(0)).toBe("$0");
    expect(formatMoney(999)).toBe("$999");
  });
});

describe("formatCurrency", () => {
  it("formats millions with two decimal places", () => {
    expect(formatCurrency(1_500_000)).toBe("$1.50M");
    expect(formatCurrency(5_000_000)).toBe("$5.00M");
  });

  it("formats thousands with one decimal place", () => {
    expect(formatCurrency(750_000)).toBe("$750.0K");
    expect(formatCurrency(50_000)).toBe("$50.0K");
    expect(formatCurrency(1_000)).toBe("$1.0K");
  });

  it("formats small values as plain dollars", () => {
    expect(formatCurrency(500)).toBe("$500");
    expect(formatCurrency(0)).toBe("$0");
  });
});

describe("formatCurrencyCompact", () => {
  it("formats millions", () => {
    expect(formatCurrencyCompact(2_500_000)).toBe("$2.5M");
  });

  it("formats thousands", () => {
    expect(formatCurrencyCompact(450_000)).toBe("$450K");
    expect(formatCurrencyCompact(1_000)).toBe("$1K");
  });

  it("formats zero as $0", () => {
    expect(formatCurrencyCompact(0)).toBe("$0");
  });
});

describe("formatNumber", () => {
  it("adds locale separators", () => {
    // Result depends on locale, but should be a string containing the number
    const result = formatNumber(1234567);
    expect(result).toContain("1");
    expect(result).toContain("234");
    expect(result).toContain("567");
  });
});

describe("formatDate", () => {
  it("formats a date string", () => {
    const result = formatDate("2025-06-15");
    // Should be a non-dash string
    expect(result).not.toBe("-");
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns dash for null or undefined", () => {
    expect(formatDate(null)).toBe("-");
    expect(formatDate(undefined)).toBe("-");
    expect(formatDate("")).toBe("-");
  });
});

describe("formatRelativeDate", () => {
  it("returns 'today' for today's date", () => {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect(formatRelativeDate(today)).toBe("today");
  });

  it("returns 'Xd ago' for past dates", () => {
    const past = new Date(Date.now() - 5 * 86_400_000).toISOString().split("T")[0];
    const result = formatRelativeDate(past);
    expect(result).toMatch(/\d+d ago/);
  });

  it("returns 'in Xd' for future dates", () => {
    const future = new Date(Date.now() + 10 * 86_400_000).toISOString().split("T")[0];
    const result = formatRelativeDate(future);
    expect(result).toMatch(/in \d+d/);
  });
});

describe("formatPercent", () => {
  it("formats without decimals by default", () => {
    expect(formatPercent(45.678)).toBe("46%");
  });

  it("formats with specified decimals", () => {
    expect(formatPercent(45.678, 1)).toBe("45.7%");
    expect(formatPercent(45.678, 2)).toBe("45.68%");
  });

  it("formats zero", () => {
    expect(formatPercent(0)).toBe("0%");
  });

  it("formats 100", () => {
    expect(formatPercent(100)).toBe("100%");
  });
});
