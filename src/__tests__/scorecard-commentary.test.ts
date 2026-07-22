import { validateSentence } from "@/lib/scorecard-commentary";

describe("scorecard commentary guardrail (verbatim unit-aware)", () => {
  const digest =
    "Sustain: need $3.1M/mo; signing $2.9M/mo ($2.3M net). Backlog: $8.2M across 186 deals, conversion 81.2% (median 85 days). " +
    "Sales: 2025 975 deals $28.1M net; YTD 525 deals $15.3M net. Consults YTD 1,524 (same point 2025: 1,784). Same-age 8.0% vs 14.5%.";

  it("keeps sentences whose figures appear verbatim with their units", () => {
    expect(validateSentence("Signing $2.9M against the $3.1M sustain rate.", digest)).toBe(true);
    expect(validateSentence("Conversion held at 81.2% across 186 deals.", digest)).toBe(true);
    expect(validateSentence("Cancellations reached 14.5% vs 8.0% last year.", digest)).toBe(true);
    expect(validateSentence("Consults are 1,524 versus 1,784 at the same point.", digest)).toBe(true);
  });

  it("rejects derived figures even when they collide with unrelated digest numbers", () => {
    // "15%" is not in the digest even though "$15.3M" is — the old guardrail's hole.
    expect(validateSentence("Consults declined 15% year over year.", digest)).toBe(false);
    // "$81.2M" is not a digest dollar figure even though "81.2%" exists.
    expect(validateSentence("The backlog is worth $81.2M.", digest)).toBe(false);
    // "$2.5M" appears nowhere.
    expect(validateSentence("Burn is $2.5M per month.", digest)).toBe(false);
  });

  it("rejects bare numbers that only exist inside other figures", () => {
    expect(validateSentence("There were 15.3 completions.", digest)).toBe(false);
    expect(validateSentence("About 28.1 percent cancelled.", digest)).toBe(false);
  });

  it("allows years and small integers", () => {
    expect(validateSentence("In 2025 the trend held for 3 months.", digest)).toBe(true);
    expect(validateSentence("Over the next 12 months in 2026.", digest)).toBe(true);
  });

  it("is comma-insensitive on counts", () => {
    expect(validateSentence("Lead volume reached 1524 so far.", digest)).toBe(true);
  });
});
