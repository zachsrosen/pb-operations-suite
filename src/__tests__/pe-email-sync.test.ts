// Mock modules that require runtime dependencies (Prisma client)
jest.mock("@/lib/db", () => ({ prisma: null }));
jest.mock("@/lib/gmail-shared-inbox", () => ({
  fetchSharedInboxMessages: jest.fn(),
}));

import {
  parsePeNotificationEmail,
  EMAIL_DOC_NAME_MAP,
  EMAIL_STATUS_MAP,
  CANONICAL_PE_DOC_NAMES,
} from "@/lib/pe-email-sync";
import type { SharedInboxMessage } from "@/lib/gmail-shared-inbox";
import { PeDocStatus } from "@/generated/prisma/enums";

// ---------------------------------------------------------------------------
// Helper: build a SharedInboxMessage fixture
// ---------------------------------------------------------------------------

function makeMsg(overrides: Partial<SharedInboxMessage> = {}): SharedInboxMessage {
  return {
    id: "msg-001",
    threadId: "thread-001",
    subject: "David Rose - Photos",
    from: "noreply@participate.energy",
    date: "2026-05-10T14:30:00.000Z",
    plainTextBody: [
      "Hi Photon Brothers Inc,",
      "",
      "We have updated the status of the submitted Photos:",
      "",
      "Reviewer - Jane Smith",
      "Photos Status - Approved",
      "Partner Comments - Looks good",
      "Approver Comments - All clear",
    ].join("\n"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("EMAIL_DOC_NAME_MAP", () => {
  it("maps email subject terms to canonical doc names", () => {
    expect(EMAIL_DOC_NAME_MAP["photos"]).toBe("Photos per Policy");
    expect(EMAIL_DOC_NAME_MAP["photo"]).toBe("Photos per Policy");
    expect(EMAIL_DOC_NAME_MAP["proposal"]).toBe("Signed Proposal");
    expect(EMAIL_DOC_NAME_MAP["pto"]).toBe("Permission to Operate (PTO)");
    expect(EMAIL_DOC_NAME_MAP["customer agreement"]).toBe(
      "Customer Agreement (PPA/ESA)",
    );
    expect(EMAIL_DOC_NAME_MAP["attestation"]).toBe(
      "Attestation of Customer Payment",
    );
  });
});

describe("EMAIL_STATUS_MAP", () => {
  it("maps email status strings to PeDocStatus enum values", () => {
    expect(EMAIL_STATUS_MAP["approved"]).toBe(PeDocStatus.APPROVED);
    expect(EMAIL_STATUS_MAP["response needed"]).toBe(
      PeDocStatus.ACTION_REQUIRED,
    );
    expect(EMAIL_STATUS_MAP["under review"]).toBe(PeDocStatus.UNDER_REVIEW);
    expect(EMAIL_STATUS_MAP["uploaded"]).toBe(PeDocStatus.UPLOADED);
    expect(EMAIL_STATUS_MAP["document uploaded"]).toBe(PeDocStatus.UPLOADED);
    expect(EMAIL_STATUS_MAP["not uploaded"]).toBe(PeDocStatus.NOT_UPLOADED);
  });
});

describe("CANONICAL_PE_DOC_NAMES", () => {
  it("contains exactly 15 canonical doc names", () => {
    expect(CANONICAL_PE_DOC_NAMES.size).toBe(15);
  });

  it("includes all milestone groups", () => {
    // Onboarding (5)
    expect(CANONICAL_PE_DOC_NAMES.has("Customer Agreement (PPA/ESA)")).toBe(
      true,
    );
    expect(CANONICAL_PE_DOC_NAMES.has("Installation Order")).toBe(true);
    expect(CANONICAL_PE_DOC_NAMES.has("State Disclosures")).toBe(true);
    expect(CANONICAL_PE_DOC_NAMES.has("Utility Bill")).toBe(true);
    expect(CANONICAL_PE_DOC_NAMES.has("Signed Proposal")).toBe(true);
    // IC (4)
    expect(CANONICAL_PE_DOC_NAMES.has("Design Plan")).toBe(true);
    expect(CANONICAL_PE_DOC_NAMES.has("Photos per Policy")).toBe(true);
    expect(CANONICAL_PE_DOC_NAMES.has("Signed Final Permit")).toBe(true);
    expect(CANONICAL_PE_DOC_NAMES.has("Access to Monitoring")).toBe(true);
    // PC (6)
    expect(CANONICAL_PE_DOC_NAMES.has("Certificate of Acceptance")).toBe(true);
    expect(CANONICAL_PE_DOC_NAMES.has("Attestation of Customer Payment")).toBe(
      true,
    );
    expect(
      CANONICAL_PE_DOC_NAMES.has("Conditional Progress Lien Waiver"),
    ).toBe(true);
    expect(
      CANONICAL_PE_DOC_NAMES.has("Signed Interconnection Agreement"),
    ).toBe(true);
    expect(
      CANONICAL_PE_DOC_NAMES.has("Conditional Waiver — Final Payment"),
    ).toBe(true);
    expect(CANONICAL_PE_DOC_NAMES.has("Permission to Operate (PTO)")).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

describe("parsePeNotificationEmail", () => {
  it("parses a standard PE notification email", () => {
    const result = parsePeNotificationEmail(makeMsg());
    expect(result).not.toBeNull();
    expect(result!.customerName).toBe("David Rose");
    expect(result!.docType).toBe("Photos per Policy");
    expect(result!.status).toBe(PeDocStatus.APPROVED);
    expect(result!.reviewer).toBe("Jane Smith");
    expect(result!.partnerComments).toBe("Looks good");
    expect(result!.approverComments).toBe("All clear");
    expect(result!.messageId).toBe("msg-001");
  });

  it("handles Response Needed status (maps to ACTION_REQUIRED)", () => {
    const result = parsePeNotificationEmail(
      makeMsg({
        subject: "Benjamin Randolph - Certificate of Acceptance",
        plainTextBody: [
          "Hi Photon Brothers Inc,",
          "",
          "We have updated the status of the submitted Certificate of Acceptance:",
          "",
          "Reviewer - John Doe",
          "Certificate of Acceptance Status - Response Needed",
          "Partner Comments - Please fix the dates",
          "Approver Comments -",
        ].join("\n"),
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.customerName).toBe("Benjamin Randolph");
    expect(result!.docType).toBe("Certificate of Acceptance");
    expect(result!.status).toBe(PeDocStatus.ACTION_REQUIRED);
    expect(result!.partnerComments).toBe("Please fix the dates");
    expect(result!.approverComments).toBeNull(); // empty after dash = null
  });

  it("handles Under Review status", () => {
    const result = parsePeNotificationEmail(
      makeMsg({
        subject: "Mary Watson - Proposal",
        plainTextBody: [
          "Hi Layla,",
          "",
          "We have updated the status of the submitted Proposal:",
          "",
          "Reviewer - Auto",
          "Proposal Status - Under Review",
          "Partner Comments -",
          "Approver Comments -",
        ].join("\n"),
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.docType).toBe("Signed Proposal");
    expect(result!.status).toBe(PeDocStatus.UNDER_REVIEW);
    expect(result!.partnerComments).toBeNull();
    expect(result!.approverComments).toBeNull();
  });

  it("handles no-space-before-dash subject variant", () => {
    const result = parsePeNotificationEmail(
      makeMsg({
        subject: "Benjamin Randolph- Certificate of Acceptance",
        plainTextBody: [
          "Hi PB,",
          "",
          "We have updated the status of the submitted Certificate of Acceptance:",
          "",
          "Reviewer - PE Auto",
          "Certificate of Acceptance Status - Approved",
          "Partner Comments -",
          "Approver Comments -",
        ].join("\n"),
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.customerName).toBe("Benjamin Randolph");
    expect(result!.docType).toBe("Certificate of Acceptance");
  });

  it("handles passthrough doc types (canonical name in subject)", () => {
    const result = parsePeNotificationEmail(
      makeMsg({
        subject: "Josh Whitmore - Design Plan",
        plainTextBody: [
          "Hi Kaitlyn,",
          "",
          "We have updated the status of the submitted Design Plan:",
          "",
          "Reviewer - PE Admin",
          "Design Plan Status - Approved",
          "Partner Comments -",
          "Approver Comments -",
        ].join("\n"),
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.docType).toBe("Design Plan");
    expect(result!.status).toBe(PeDocStatus.APPROVED);
  });

  it("handles name with hyphen (last separator split)", () => {
    const result = parsePeNotificationEmail(
      makeMsg({
        subject: "Mary-Jane Watson - Photos",
        plainTextBody: [
          "Hi PB,",
          "",
          "We have updated the status of the submitted Photos:",
          "",
          "Reviewer - Reviewer X",
          "Photos Status - Approved",
          "Partner Comments -",
          "Approver Comments -",
        ].join("\n"),
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.customerName).toBe("Mary-Jane Watson");
    expect(result!.docType).toBe("Photos per Policy");
  });

  it("returns null for unknown doc type", () => {
    const consoleSpy = jest
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    const result = parsePeNotificationEmail(
      makeMsg({ subject: "Someone - Unknown Document Type" }),
    );
    expect(result).toBeNull();
    consoleSpy.mockRestore();
  });

  it("returns null for missing subject separator", () => {
    const consoleSpy = jest
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    const result = parsePeNotificationEmail(
      makeMsg({ subject: "No separator at all" }),
    );
    expect(result).toBeNull();
    consoleSpy.mockRestore();
  });

  it("returns null for unparseable status", () => {
    const consoleSpy = jest
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    const result = parsePeNotificationEmail(
      makeMsg({
        plainTextBody: [
          "Hi PB,",
          "",
          "Some random email body without status lines.",
        ].join("\n"),
      }),
    );
    expect(result).toBeNull();
    consoleSpy.mockRestore();
  });

  it("maps PTO shorthand correctly", () => {
    const result = parsePeNotificationEmail(
      makeMsg({
        subject: "Alice Johnson - PTO",
        plainTextBody: [
          "Hi PB,",
          "",
          "We have updated the status of the submitted PTO:",
          "",
          "Reviewer - Admin",
          "PTO Status - Approved",
          "Partner Comments - Complete",
          "Approver Comments - Verified",
        ].join("\n"),
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.docType).toBe("Permission to Operate (PTO)");
  });
});
