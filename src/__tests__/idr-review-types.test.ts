import { describe, it, expect } from "@jest/globals";

// Mock runtime dependencies pulled in transitively by idr-meeting.ts
// (same pattern as idr-adder-serialization.test.ts, plus callable fns for the
// syncItemToHubSpot gating tests below)
jest.mock("@/lib/db", () => ({
  prisma: { idrMeetingItem: { update: jest.fn(async () => ({})) } },
}));
jest.mock("@/lib/hubspot", () => ({
  hubspotClient: {
    crm: {
      deals: { basicApi: { update: jest.fn(async () => ({})) } },
      objects: { notes: { basicApi: {} } },
    },
  },
  searchWithRetry: jest.fn(),
  resolveHubSpotOwnerContact: jest.fn(),
}));

import { hubspotClient } from "@/lib/hubspot";
import {
  SERVICE_PIPELINE_ID,
  DNR_PIPELINE_ID,
  reviewTypePillLabel,
} from "@/app/dashboards/idr-meeting/review-type-labels";
import {
  REVIEW_TYPES,
  NC_READY_FOR_REVIEW_STATUS,
  deriveItemType,
  buildQueueFilterGroups,
  buildHubSpotPropertyUpdates,
  buildHubSpotNoteBody,
  syncItemToHubSpot,
} from "@/lib/idr-meeting";

describe("reviewTypePillLabel", () => {
  it("maps DNR_SERVICE by pipeline", () => {
    expect(reviewTypePillLabel("DNR_SERVICE", SERVICE_PIPELINE_ID)).toBe("SVC");
    expect(reviewTypePillLabel("DNR_SERVICE", DNR_PIPELINE_ID)).toBe("D&R");
    expect(reviewTypePillLabel("DNR_SERVICE", null)).toBe("D&R/SVC");
  });
  it("maps NEW_CONSTRUCTION to NC and passes other types through", () => {
    expect(reviewTypePillLabel("NEW_CONSTRUCTION", null)).toBe("NC");
    expect(reviewTypePillLabel("IDR", null)).toBe("IDR");
    expect(reviewTypePillLabel("ESCALATION", "whatever")).toBe("ESCALATION");
  });
});

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

describe("deriveItemType (pipeline-first)", () => {
  it("Service/D&R pipeline always derives DNR_SERVICE", () => {
    expect(deriveItemType(SERVICE_PIPELINE_ID, "Initial Review")).toBe("DNR_SERVICE");
    expect(deriveItemType(DNR_PIPELINE_ID, "IDR Revision Complete")).toBe("DNR_SERVICE");
    expect(deriveItemType(SERVICE_PIPELINE_ID, NC_READY_FOR_REVIEW_STATUS)).toBe("DNR_SERVICE");
  });
  it("Project pipeline falls through to status rules", () => {
    expect(deriveItemType("6900017", NC_READY_FOR_REVIEW_STATUS)).toBe("NEW_CONSTRUCTION");
    expect(deriveItemType("6900017", "Initial Review")).toBe("IDR");
    expect(deriveItemType(null, "Initial Review")).toBe("IDR");
    expect(deriveItemType(null, NC_READY_FOR_REVIEW_STATUS)).toBe("NEW_CONSTRUCTION");
  });
});

describe("DNR_SERVICE registry row", () => {
  it("syncs via the combined task and the IDR revision track", () => {
    expect(REVIEW_TYPES.DNR_SERVICE.taskSubject).toBe("D&R/Service Design Review");
    expect(REVIEW_TYPES.DNR_SERVICE.revisionType).toBe("design");
    expect(REVIEW_TYPES.DNR_SERVICE.revisionReasonProperty).toBe("idr_revision_reason");
    expect(REVIEW_TYPES.DNR_SERVICE.noteLabel).toBe("D&R/Service Design Review");
    expect(REVIEW_TYPES.DNR_SERVICE.autoBomExtract).toBe(false);
    expect(REVIEW_TYPES.DNR_SERVICE.pushRevisionFlagsWithoutTask).toBe(false);
  });
  it("NC keeps push-without-task; IDR/ESCALATION stay task-gated with auto-extract only on IDR/NC", () => {
    expect(REVIEW_TYPES.NEW_CONSTRUCTION.pushRevisionFlagsWithoutTask).toBe(true);
    expect(REVIEW_TYPES.IDR.pushRevisionFlagsWithoutTask).toBe(false);
    expect(REVIEW_TYPES.IDR.autoBomExtract).toBe(true);
    expect(REVIEW_TYPES.NEW_CONSTRUCTION.autoBomExtract).toBe(true);
    expect(REVIEW_TYPES.ESCALATION.autoBomExtract).toBe(false);
  });
});

describe("buildQueueFilterGroups", () => {
  it("builds one group per status-driven type plus the re-review group", () => {
    const groups = buildQueueFilterGroups();
    expect(groups).toHaveLength(4);
    const dnr = groups.find((g) =>
      g.filters.some((f) => f.propertyName === "pipeline" && f.values?.includes(SERVICE_PIPELINE_ID)) &&
      g.filters.some((f) => f.propertyName === "design_status"));
    expect(dnr).toBeDefined();
    expect(dnr!.filters.some((f) => f.propertyName === "design_status" && f.value === "Initial Review")).toBe(true);
    expect(dnr!.filters.some((f) => f.propertyName === "dealstage" && f.values?.includes("56217769") && f.values?.includes("72700977"))).toBe(true);
    // re-review group spans all registry pipelines
    const rr = groups.find((g) => g.filters.some((f) => f.propertyName === "idr_re_review_needed"));
    expect(rr!.filters.some((f) => f.propertyName === "pipeline" && f.values?.includes(SERVICE_PIPELINE_ID) && f.values?.includes("6900017"))).toBe(true);
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

  it("DNR_SERVICE revisions write idr_revision_reason", () => {
    const u = buildHubSpotPropertyUpdates({ ...base, itemType: "DNR_SERVICE" });
    expect(u.idr_revision_reason).toBe("Revision Reason: Panel layout wrong");
    expect(u.inspection_rejection_reason).toBeUndefined();
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

  it("uses the D&R/Service label when passed", () => {
    expect(buildHubSpotNoteBody(fields, "2026-07-08", "D&R/Service Design Review"))
      .toContain("<strong>D&R/Service Design Review -- 7/8/2026</strong>");
  });
});

describe("syncItemToHubSpot revision-flag gating", () => {
  const dealsUpdate = hubspotClient.crm.deals.basicApi.update as jest.Mock;

  const makeItem = (overrides: Record<string, unknown> = {}) => ({
    id: "item-1",
    dealId: "9001",
    dealName: "PROJ-1234 Test Customer",
    type: "IDR",
    difficulty: null, installerCount: null, installerDays: null,
    electricianCount: null, electricianDays: null,
    discoReco: null, interiorAccess: null, operationsNotes: null,
    needsSurveyInfo: null, needsResurvey: null,
    salesChangeRequested: null, salesChangeNotes: null, salesChangeAmount: null,
    opsChangeNotes: null, customerNotes: null, customerNotesCreateTask: false,
    designNotes: null, conclusion: null,
    shitShowFlagged: false, shitShowReason: null, opsRevisionNotes: null,
    designRevisionNeeded: true, designRevisionReason: "Panel layout wrong",
    needsReReview: false, reviewed: true,
    adderTileRoof: false, adderMetalRoof: false, adderFlatFoamRoof: false,
    adderShakeRoof: false, adderSteepPitch: false, adderTwoStorey: false,
    adderTrenching: false, adderGroundMount: false, adderMpuUpgrade: false,
    adderEvCharger: false, adderTier1: false, adderTier2: false,
    systemSizeKw: null, dealAmount: null, customAdders: [],
    ...overrides,
  });

  const sessionDate = new Date("2026-07-08T12:00:00Z");

  /** Find the pushDealProperties call carrying the revision flag pair, if any. */
  const findFlagPush = () =>
    dealsUpdate.mock.calls.find(
      ([, body]) => body?.properties?.idr_revision_requested === "true",
    );

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.HUBSPOT_ACCESS_TOKEN = "test-token";
    // Task search returns no open task — the "missing task" case for every test.
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ results: [] }),
    })) as unknown as typeof fetch;
  });

  it("NEW_CONSTRUCTION pushes revision flags even when no task is found", async () => {
    const result = await syncItemToHubSpot(
      makeItem({ type: "NEW_CONSTRUCTION" }) as Parameters<typeof syncItemToHubSpot>[0],
      sessionDate,
    );

    expect(result.ok).toBe(true);
    expect(result.taskWarning).toContain("No design review task found");

    const flagPush = findFlagPush();
    expect(flagPush).toBeDefined();
    expect(flagPush![1].properties.idr_revision_type).toBe("escalation");

    // The task search used the NC subject, not the IDR one
    const searchBody = (global.fetch as jest.Mock).mock.calls[0][1].body as string;
    expect(searchBody).toContain("New Construction Design Review");
    expect(searchBody).not.toContain("Complete Initial Design Review");
  });

  it("IDR stays task-gated: no revision-flag push when the task is missing", async () => {
    const result = await syncItemToHubSpot(
      makeItem() as Parameters<typeof syncItemToHubSpot>[0],
      sessionDate,
    );

    expect(result.ok).toBe(true);
    expect(result.taskWarning).toContain("No design review task found");
    expect(findFlagPush()).toBeUndefined();

    const searchBody = (global.fetch as jest.Mock).mock.calls[0][1].body as string;
    expect(searchBody).toContain("Complete Initial Design Review");
  });

  it("NEW_CONSTRUCTION also pushes flags when task completion throws", async () => {
    process.env.HUBSPOT_ACCESS_TOKEN = "test-token";
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("HubSpot 500"));

    const result = await syncItemToHubSpot(
      makeItem({ type: "NEW_CONSTRUCTION" }) as Parameters<typeof syncItemToHubSpot>[0],
      sessionDate,
    );

    expect(result.ok).toBe(true);
    expect(result.taskWarning).toContain("Failed to complete design review task");
    expect(findFlagPush()).toBeDefined();
  });

  it("DNR_SERVICE stays task-gated and searches the combined subject", async () => {
    const result = await syncItemToHubSpot(
      makeItem({ type: "DNR_SERVICE" }) as Parameters<typeof syncItemToHubSpot>[0],
      sessionDate,
    );
    expect(result.ok).toBe(true);
    expect(findFlagPush()).toBeUndefined();   // no task found → no flag push
    const searchBody = (global.fetch as jest.Mock).mock.calls[0][1].body as string;
    expect(searchBody).toContain("D&R/Service Design Review");
  });

  it("DNR_SERVICE pushes design-type flags when the task IS found and completed", async () => {
    // Task search returns one open task; the PATCH completion also goes through fetch.
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [{ id: "task-9" }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    const result = await syncItemToHubSpot(
      makeItem({ type: "DNR_SERVICE" }) as Parameters<typeof syncItemToHubSpot>[0],
      sessionDate,
    );
    expect(result.ok).toBe(true);
    const flagPush = findFlagPush();
    expect(flagPush).toBeDefined();
    expect(flagPush![1].properties.idr_revision_type).toBe("design");
  });
});
