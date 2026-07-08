import { describe, it, expect } from "@jest/globals";

// Mock runtime dependencies pulled in transitively by idr-meeting.ts
// (same pattern as idr-adder-serialization.test.ts)
jest.mock("@/lib/db", () => ({ prisma: null }));
jest.mock("@/lib/hubspot", () => ({
  hubspotClient: { crm: { deals: { basicApi: {} }, objects: { notes: { basicApi: {} } } } },
  searchWithRetry: jest.fn(),
  resolveHubSpotOwnerContact: jest.fn(),
}));

import {
  REVIEW_TYPES,
  NC_READY_FOR_REVIEW_STATUS,
  deriveItemTypeFromStatus,
  buildHubSpotPropertyUpdates,
  buildHubSpotNoteBody,
} from "@/lib/idr-meeting";

describe("REVIEW_TYPES registry", () => {
  it("IDR routes revisions to the design branch and idr_revision_reason", () => {
    expect(REVIEW_TYPES.IDR.taskSubject).toBe("Complete Initial Design Review");
    expect(REVIEW_TYPES.IDR.revisionType).toBe("design");
    expect(REVIEW_TYPES.IDR.revisionReasonProperty).toBe("idr_revision_reason");
    expect(REVIEW_TYPES.IDR.noteLabel).toBe("IDR Meeting");
  });

  it("NEW_CONSTRUCTION completes the NC task and routes revisions to the as-built track", () => {
    expect(REVIEW_TYPES.NEW_CONSTRUCTION.taskSubject).toBe("New Construction Design Review");
    expect(REVIEW_TYPES.NEW_CONSTRUCTION.revisionType).toBe("escalation");
    expect(REVIEW_TYPES.NEW_CONSTRUCTION.revisionReasonProperty).toBe("inspection_rejection_reason");
    expect(REVIEW_TYPES.NEW_CONSTRUCTION.noteLabel).toBe("New Construction Review");
  });

  it("ESCALATION encodes today's behavior exactly (no behavior change)", () => {
    expect(REVIEW_TYPES.ESCALATION.taskSubject).toBe("Complete Initial Design Review");
    expect(REVIEW_TYPES.ESCALATION.revisionType).toBe("escalation");
    expect(REVIEW_TYPES.ESCALATION.revisionReasonProperty).toBe("inspection_rejection_reason");
    expect(REVIEW_TYPES.ESCALATION.noteLabel).toBe("IDR Meeting");
  });
});

describe("deriveItemTypeFromStatus", () => {
  it("derives NEW_CONSTRUCTION for the NC ready-for-review status", () => {
    expect(deriveItemTypeFromStatus(NC_READY_FOR_REVIEW_STATUS)).toBe("NEW_CONSTRUCTION");
    expect(NC_READY_FOR_REVIEW_STATUS).toBe("New Construction - Ready for Review");
  });

  it("derives IDR for every other status (status wins over filter-group membership)", () => {
    expect(deriveItemTypeFromStatus("Initial Review")).toBe("IDR");
    expect(deriveItemTypeFromStatus("IDR Revision Complete")).toBe("IDR");
    expect(deriveItemTypeFromStatus(null)).toBe("IDR");
    expect(deriveItemTypeFromStatus(undefined)).toBe("IDR");
  });
});

describe("buildHubSpotPropertyUpdates revision routing", () => {
  const base = {
    difficulty: null, installerCount: null, installerDays: null,
    electricianCount: null, electricianDays: null, discoReco: null,
    interiorAccess: null, operationsNotes: null, needsSurveyInfo: null,
    needsResurvey: null, salesChangeRequested: null, salesChangeNotes: null,
    opsChangeNotes: null, designRevisionNeeded: true,
    designRevisionReason: "Panel layout wrong", needsReReview: false,
    reviewed: true,
  } as const;

  it("IDR revisions write idr_revision_reason", () => {
    const u = buildHubSpotPropertyUpdates({ ...base, itemType: "IDR" });
    expect(u.idr_revision_reason).toBe("Revision Reason: Panel layout wrong");
    expect(u.inspection_rejection_reason).toBeUndefined();
  });

  it("ESCALATION revisions write inspection_rejection_reason (unchanged behavior)", () => {
    const u = buildHubSpotPropertyUpdates({ ...base, itemType: "ESCALATION" });
    expect(u.inspection_rejection_reason).toBe("Revision Reason: Panel layout wrong");
    expect(u.idr_revision_reason).toBeUndefined();
  });

  it("NEW_CONSTRUCTION revisions write inspection_rejection_reason (as-built track)", () => {
    const u = buildHubSpotPropertyUpdates({ ...base, itemType: "NEW_CONSTRUCTION" });
    expect(u.inspection_rejection_reason).toBe("Revision Reason: Panel layout wrong");
    expect(u.idr_revision_reason).toBeUndefined();
  });

  it("missing itemType defaults to IDR routing", () => {
    const u = buildHubSpotPropertyUpdates({ ...base });
    expect(u.idr_revision_reason).toBe("Revision Reason: Panel layout wrong");
  });
});

describe("buildHubSpotNoteBody header", () => {
  const fields = {
    difficulty: null, installerCount: null, installerDays: null,
    electricianCount: null, electricianDays: null, discoReco: false,
    interiorAccess: false, customerNotes: null, operationsNotes: null,
    salesChangeRequested: null, salesChangeNotes: null, opsChangeNotes: null,
    needsSurveyInfo: null, designNotes: null, conclusion: null,
    designRevisionNeeded: false, designRevisionReason: null,
    adderSummary: null, adderAmount: null,
  } as never; // NoteFields shape — only the header is under test

  it("defaults to the IDR Meeting header", () => {
    expect(buildHubSpotNoteBody(fields, "2026-07-08")).toContain("<strong>IDR Meeting -- 7/8/2026</strong>");
  });

  it("uses the New Construction Review label when passed", () => {
    expect(buildHubSpotNoteBody(fields, "2026-07-08", "New Construction Review"))
      .toContain("<strong>New Construction Review -- 7/8/2026</strong>");
  });
});
