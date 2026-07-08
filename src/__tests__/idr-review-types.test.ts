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
