jest.mock("@/lib/db", () => ({ prisma: null }));

import { buildTeamSections, renderTeamDigest } from "@/lib/bottleneck-team-digest";
import type { ProjectFunnelDrillDown, ProjectFunnelDrillDownDeal } from "@/lib/project-funnel-aggregation";
import type { BottleneckDealRow } from "@/lib/bottlenecks";

const NOW = Date.parse("2026-07-08T14:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000);

function ddDeal(overrides: Partial<ProjectFunnelDrillDownDeal>): ProjectFunnelDrillDownDeal {
  return {
    id: 1, name: "PROJ-1000 | Test, Casey | 1 Main St", projectNumber: "PROJ-1000",
    amount: 10000, pbLocation: "Westminster", closeDate: "2026-01-01", stage: "Permitting & Interconnection",
    url: "", daysWaiting: 10, status: "Submitted to AHJ",
    projectManager: "Pat PM", dealOwner: "Sally Sales", siteSurveyor: "",
    designLead: "Dana Design", permitLead: "Katie Permit", operationsManager: "Oscar Ops",
    inspectionsLead: "Ira Inspect", interconnectionsLead: "Ian IC",
    interconnectionStatus: null, flag: null,
    ...overrides,
  };
}

const EMPTY_DD: ProjectFunnelDrillDown = {
  awaitingSurveySchedule: [], awaitingSurvey: [], awaitingDaSend: [], awaitingApproval: [],
  awaitingDesignComplete: [], awaitingPermitSubmit: [], awaitingPermitIssue: [],
  awaitingInterconnection: [], awaitingReadyToBuild: [], awaitingConstructionSchedule: [],
  awaitingConstructionComplete: [], awaitingInspection: [], awaitingPto: [], awaitingCloseOut: [],
};

describe("buildTeamSections", () => {
  it("permitting: splits AHJ follow-ups from design revisions and marks past-threshold deals", () => {
    const dd = {
      ...EMPTY_DD,
      awaitingPermitSubmit: [ddDeal({ id: 1, status: "Ready For Permitting" })],
      awaitingPermitIssue: [
        ddDeal({ id: 2, daysWaiting: 34 }), // > 21d → follow-up mark
        ddDeal({ id: 3, status: "Design Revision In Progress" }), // design's, not permitting's
      ],
    };
    const sections = buildTeamSections("permitting", dd, [], new Map(), NOW);
    expect(sections[0].lines.map((l) => l.id)).toEqual(["1"]);
    expect(sections[1].lines.map((l) => l.id)).toEqual(["2"]);
    expect(sections[1].lines[0].needsFollowUp).toBe(true);
    expect(sections[1].lines[0].lead).toBe("Katie Permit");

    const design = buildTeamSections("design", dd, [], new Map(), NOW);
    expect(design[2].title).toBe("Permit revisions in design");
    expect(design[2].lines.map((l) => l.id)).toEqual(["3"]);
    expect(design[2].lines[0].lead).toBe("Dana Design");
  });

  it("assigns the right lead per team", () => {
    const dd = {
      ...EMPTY_DD,
      awaitingSurveySchedule: [ddDeal({ id: 1 })],
      awaitingReadyToBuild: [ddDeal({ id: 2 })],
      awaitingInterconnection: [ddDeal({ id: 3 })],
      awaitingInspection: [ddDeal({ id: 4 })],
    };
    expect(buildTeamSections("sales", dd, [], new Map(), NOW)[0].lines[0].lead).toBe("Sally Sales");
    expect(buildTeamSections("pm", dd, [], new Map(), NOW)[0].lines[0].lead).toBe("Pat PM");
    expect(buildTeamSections("ic", dd, [], new Map(), NOW)[0].lines[0].lead).toBe("Ian IC");
    expect(buildTeamSections("ops", dd, [], new Map(), NOW)[1].lines[0].lead).toBe("Ira Inspect");
  });

  it("skips parked (On Hold) deals but keeps non-parked blocked deals with their reason", () => {
    const dd = {
      ...EMPTY_DD,
      awaitingReadyToBuild: [
        ddDeal({ id: 1, flag: { label: "On hold", tone: "yellow", reason: "roof", note: null, parked: true } }),
        ddDeal({ id: 2, flag: { label: "RTB blocked", tone: "red", reason: "HOA", note: null, parked: false } }),
      ],
    };
    const [rtb] = buildTeamSections("pm", dd, [], new Map(), NOW);
    expect(rtb.lines.map((l) => l.id)).toEqual(["2"]);
    expect(rtb.lines[0].blockedNote).toBe("RTB blocked: HOA");
  });

  it("compliance: buckets PE deals into ready vs submitted with PM as lead", () => {
    const pe = (id: string, status: string, passDaysAgo: number): BottleneckDealRow =>
      ({
        hubspotDealId: id, dealName: `PROJ-${id} | PE, Deal | 2 Main St`, projectNumber: `PROJ-${id}`,
        pbLocation: "Centennial", dealOwnerName: null, hubspotOwnerId: null,
        stage: "Close Out", isParticipateEnergy: true, hubspotUpdatedAt: daysAgo(1),
        rawProperties: { pe_m1_status: status },
        designStatus: null, permittingStatus: null, icStatus: null, installStatus: null,
        finalInspectionStatus: null, ptoStatus: null,
        siteSurveyCompletionDate: null, designStartDate: null, designCompletionDate: null,
        permitSubmitDate: null, permitIssueDate: null, icSubmitDate: null, icApprovalDate: null,
        rtbDate: null, installScheduleDate: null, constructionCompleteDate: null,
        inspectionPassDate: daysAgo(passDaysAgo), ptoCompletionDate: null, ptoStartDate: null,
      }) as BottleneckDealRow;

    const rows = [pe("r1", "Ready to Submit", 5), pe("s1", "Submitted", 20)];
    const pm = new Map([["s1", "Pat PM"]]);
    const sections = buildTeamSections("compliance", rows.length ? { ...EMPTY_DD } : EMPTY_DD, rows, pm, NOW);
    expect(sections[0].lines.map((l) => l.id)).toEqual(["r1"]);
    expect(sections[1].lines.map((l) => l.id)).toEqual(["s1"]);
    expect(sections[1].lines[0].needsFollowUp).toBe(true); // 20d > 14d
    expect(sections[1].lines[0].lead).toBe("Pat PM");
  });
});

describe("renderTeamDigest", () => {
  it("renders sections with links, follow-up marks, leads, and the preset dashboard link", () => {
    const dd = {
      ...EMPTY_DD,
      awaitingPermitIssue: [ddDeal({ id: 2, daysWaiting: 34 })],
    };
    const msg = renderTeamDigest("permitting", buildTeamSections("permitting", dd, [], new Map(), NOW), NOW)!;
    expect(msg).toContain("🚧 Permitting worklist");
    expect(msg).toContain("Submitted — follow up with AHJ (1 — 1 past 21d)");
    expect(msg).toContain("/record/0-3/2|PROJ-1000 — Test, Casey>");
    expect(msg).toContain("34d ⚠");
    expect(msg).toContain("Katie Permit");
    expect(msg).toContain("?tab=bottlenecks&view=permitting");
  });

  it("returns null when nothing is waiting", () => {
    expect(renderTeamDigest("sales", buildTeamSections("sales", EMPTY_DD, [], new Map(), NOW), NOW)).toBeNull();
  });
});
