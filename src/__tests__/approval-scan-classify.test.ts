/**
 * Unit tests for the approval-scan classifier (pure module) — Xcel chatter
 * rule templates, negative-signal suppression, the foreign-identifier guard,
 * and the Claude-pass quote-grounding check.
 */

import {
  classifyByRules,
  classifyWithClaude,
  extractCitedIdentifiers,
  isForeignEvidence,
  quoteIsGrounded,
  type ClaudeMessagesClient,
} from "@/lib/approval-scan/classify";

// ========== Fixtures ==========

const COMPLETENESS_APPROVED_BODY = `CO Engineering Admin (Xcel Energy)

@PB Interconnections (Photon Brothers)

The Completeness Review for this interconnection application is approved and Xcel Energy made the following assumptions in order to deem this application complete: the inverter will be programmed to the required IEEE 1547-2018 settings.

Reference IA214354.`;

const PTO_GRANTED_BODY = `CO Engineering Admin (Xcel Energy)

@PB Interconnections (Photon Brothers)

This interconnection application has been granted Permission to Operate effective 07/18/2026. The meter has been set and the system may be energized.

Reference IA214354.`;

const PHOTOS_APPROVED_BODY = `CO Engineering Admin (Xcel Energy)

@PB Interconnections (Photon Brothers)

The photos submitted for this interconnection application have been approved. No further action is required at this time.

Reference IA214354.`;

const INFO_NEEDED_SUBJECT =
  "ACTION REQUIRED: Additional Information Needed for Project #SBP-179859";
const INFO_NEEDED_BODY = `CO Engineering Admin (Xcel Energy)

Additional Information Needed for this interconnection application: please provide an updated single line diagram within 10 business days.`;

const REJECTION_BODY = `CO Engineering Admin (Xcel Energy)

This interconnection application has been rejected. The proposed system size exceeds the service entrance rating.`;

// ========== Rules pass ==========

describe("classifyByRules", () => {
  it("classifies the completeness-approved chatter template as approved", () => {
    const result = classifyByRules(
      "New chatter notification received",
      COMPLETENESS_APPROVED_BODY,
    );
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe("approved");
    expect(result!.confidence).toBe("high");
    // Quote must be verbatim from the body (grounding by construction).
    expect(COMPLETENESS_APPROVED_BODY).toContain(result!.quote);
    expect(result!.quote).toMatch(/Completeness Review/i);
  });

  it("classifies granted-Permission-to-Operate chatter as pto_granted", () => {
    const result = classifyByRules(
      "New chatter notification received",
      PTO_GRANTED_BODY,
    );
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe("pto_granted");
    expect(result!.confidence).toBe("high");
    expect(PTO_GRANTED_BODY).toContain(result!.quote);
  });

  it("photos-approved chatter is NOT rule-matched — it falls through to the LLM", () => {
    // The loose photos_approved positive rule was removed (it fired on
    // negated/future-conditional text); photo approvals go to the LLM.
    expect(
      classifyByRules("New chatter notification received", PHOTOS_APPROVED_BODY),
    ).toBeNull();
  });

  it("does NOT produce a positive verdict for Additional Information Needed", () => {
    const result = classifyByRules(INFO_NEEDED_SUBJECT, INFO_NEEDED_BODY);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe("info_needed");
  });

  it("suppresses via the negative rules even when approval words appear in quoted history", () => {
    const body = `${INFO_NEEDED_BODY}\n\n---- Forwarded ----\n${COMPLETENESS_APPROVED_BODY}`;
    const result = classifyByRules(INFO_NEEDED_SUBJECT, body);
    expect(result!.verdict).toBe("info_needed");
  });

  it("does NOT produce a positive verdict for a rejection", () => {
    const result = classifyByRules(
      "New chatter notification received",
      REJECTION_BODY,
    );
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe("rejected");
  });

  it("does not treat negated photo language as an approval", () => {
    const result = classifyByRules(
      "Photo review update",
      "The photos submitted were not approved by the reviewer.",
    );
    expect(result?.verdict === "photos_approved").toBe(false);
  });

  describe("negated / future-conditional phrasings never rule-match positive", () => {
    it.each([
      [
        "negated PTO",
        "This interconnection application has not been granted Permission to Operate at this time.",
      ],
      [
        "future-conditional PTO",
        "Your system will be granted Permission to Operate once the meter is set.",
      ],
      [
        "conditional photos → PTO promise",
        "Once your photos are reviewed and approved, we will issue PTO.",
      ],
      [
        "future photo approval",
        "Your photos will be approved after review.",
      ],
    ])("%s falls through to the LLM (no high-confidence positive)", (_name, body) => {
      const result = classifyByRules("New chatter notification received", body);
      expect(result).toBeNull();
    });
  });

  it("a futurity cue in the pre-match window suppresses an otherwise-matching template", () => {
    const body =
      "Pending final review, the interconnection application has been granted Permission to Operate.";
    expect(classifyByRules("Chatter", body)).toBeNull();
  });

  it("returns null for non-template mail (goes to the LLM)", () => {
    expect(
      classifyByRules(
        "RE: 123 Main St",
        "Thanks, we received your documents and will review shortly.",
      ),
    ).toBeNull();
  });
});

// ========== Cited identifiers + foreign guard ==========

describe("extractCitedIdentifiers", () => {
  it("extracts IA numbers, case numbers, and permit-ish tokens (normalized)", () => {
    const cited = extractCitedIdentifiers(
      "Re IA214354 and case 06405260, permit B2404681, project #SBP-179859",
    );
    expect(cited).toContain("IA214354");
    expect(cited).toContain("6405260"); // leading zero stripped
    expect(cited).toContain("B2404681");
    expect(cited).toContain("SBP-179859");
  });

  it("returns nothing for plain prose", () => {
    expect(extractCitedIdentifiers("Thanks, see you Tuesday at 10am")).toEqual([]);
  });
});

describe("isForeignEvidence", () => {
  const dealIdentifiers = ["IA214354"];

  it("skips a message citing only another project's IA number", () => {
    const text = "The Completeness Review ... approved.\nReference IA214352.";
    expect(isForeignEvidence(text, dealIdentifiers)).toBe(true);
  });

  it("keeps a message citing the deal's own IA number", () => {
    expect(
      isForeignEvidence(COMPLETENESS_APPROVED_BODY, dealIdentifiers),
    ).toBe(false);
  });

  it("keeps a message citing no identifiers at all", () => {
    expect(
      isForeignEvidence("Your application is approved.", dealIdentifiers),
    ).toBe(false);
  });

  it("never flags when the deal has no identifiers to compare", () => {
    expect(isForeignEvidence("Reference IA214352.", [])).toBe(false);
  });

  it("is leading-zero-insensitive (legacy un-padded case numbers)", () => {
    expect(isForeignEvidence("case 06405260 approved", ["6405260"])).toBe(false);
  });
});

// ========== Claude pass — grounding ==========

function stubClient(responseText: string): ClaudeMessagesClient {
  return {
    messages: {
      create: jest.fn().mockResolvedValue({
        content: [{ type: "text", text: responseText }],
      }),
    },
  };
}

describe("classifyWithClaude", () => {
  const msg = {
    subject: "Permit B2404681 status",
    body: "Your permit B2404681 has passed final review and the permit is issued.",
  };

  it("accepts a positive verdict with a grounded verbatim quote", async () => {
    const client = stubClient(
      JSON.stringify({
        verdict: "approved",
        confidence: "high",
        quote: "the permit is issued",
        reasoning: "explicit issuance statement",
      }),
    );
    const result = await classifyWithClaude(client, msg);
    expect(result.verdict).toBe("approved");
    expect(result.confidence).toBe("high");
  });

  it("degrades a positive verdict to other when the quote is fabricated", async () => {
    const client = stubClient(
      JSON.stringify({
        verdict: "approved",
        confidence: "high",
        quote: "Congratulations, your permit has been approved!",
      }),
    );
    const result = await classifyWithClaude(client, msg);
    expect(result.verdict).toBe("other");
    expect(result.confidence).toBe("low");
  });

  it("returns other on unparseable model output", async () => {
    const result = await classifyWithClaude(stubClient("I think it looks approved"), msg);
    expect(result.verdict).toBe("other");
  });

  it("returns other on an out-of-vocabulary verdict", async () => {
    const result = await classifyWithClaude(
      stubClient(JSON.stringify({ verdict: "definitely_approved", confidence: "high", quote: "x" })),
      msg,
    );
    expect(result.verdict).toBe("other");
  });
});

describe("quoteIsGrounded", () => {
  it("is whitespace-insensitive", () => {
    expect(
      quoteIsGrounded(
        "the permit  is\nissued",
        "subject",
        "Your permit has passed and the permit is issued.",
      ),
    ).toBe(true);
  });

  it("rejects an empty quote", () => {
    expect(quoteIsGrounded("", "s", "body")).toBe(false);
  });
});
