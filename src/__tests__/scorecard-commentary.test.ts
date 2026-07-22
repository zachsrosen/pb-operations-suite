import { validateSentence, extractDigestNumbers } from "@/lib/scorecard-commentary";

describe("scorecard commentary guardrail", () => {
  const digest = "Sustain: need $3.1M/mo; signing $2.9M/mo. Backlog: $8.2M across 186 deals, conversion 81.2% (median 85 days). Sales: 2025 975 deals $28.1M net.";
  const nums = extractDigestNumbers(digest);

  it("keeps sentences whose numbers all exist in the digest", () => {
    expect(validateSentence("Signing $2.9M against the $3.1M sustain rate leaves a gap.", nums)).toBe(true);
    expect(validateSentence("The backlog of $8.2M covers 186 deals at 81.2% conversion.", nums)).toBe(true);
  });

  it("drops sentences containing numbers absent from the digest", () => {
    expect(validateSentence("Cancellations cost $9.7M last year.", nums)).toBe(false);
    expect(validateSentence("Conversion improved to 92.4% this cohort.", nums)).toBe(false);
    // Derived/recombined figures are rejected too — the model must not do math.
    expect(validateSentence("That is a $0.2M monthly shortfall.", nums)).toBe(false);
  });

  it("allows years and small integers without digest presence", () => {
    expect(validateSentence("In 2025 the trend held for 3 months.", nums)).toBe(true);
    expect(validateSentence("Over the next 12 months in 2026.", nums)).toBe(true);
  });

  it("accepts digest numbers in comma or plain formats", () => {
    const d2 = extractDigestNumbers("Leads: 1,913 YTD.");
    expect(validateSentence("Lead volume reached 1,913 so far.", d2)).toBe(true);
    expect(validateSentence("Lead volume reached 1913 so far.", d2)).toBe(true);
  });
});
