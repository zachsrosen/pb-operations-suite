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
    const sections = buildTeamSections("permitting", dd, [], NOW);
    expect(sections[0].lines.map((l) => l.id)).toEqual(["1"]);
    expect(sections[1].lines.map((l) => l.id)).toEqual(["2"]);
    expect(sections[1].lines[0].needsFollowUp).toBe(true);
    expect(sections[1].lines[0].lead).toBe("Katie Permit");

    const design = buildTeamSections("design", dd, [], NOW);
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
    expect(buildTeamSections("sales", dd, [], NOW)[0].lines[0].lead).toBe("Sally Sales");
    expect(buildTeamSections("pm", dd, [], NOW)[0].lines[0].lead).toBe("Pat PM");
    expect(buildTeamSections("ic", dd, [], NOW)[0].lines[0].lead).toBe("Ian IC");
    // Ops sections are now [overdue surveys, overdue installs, inspections].
    expect(buildTeamSections("ops", dd, [], NOW)[2].lines[0].lead).toBe("Ira Inspect");
  });

  it("ops overdue sections only include deals PAST their scheduled date, aged from that date", () => {
    const past = new Date(NOW - 6 * 86_400_000).toISOString().slice(0, 10);
    const future = new Date(NOW + 3 * 86_400_000).toISOString().slice(0, 10);
    const dd = {
      ...EMPTY_DD,
      awaitingSurvey: [
        ddDeal({ id: 1, scheduledDate: past, siteSurveyor: "Sam Surveyor" }),
        ddDeal({ id: 2, scheduledDate: future }), // on plan — excluded (no negative days)
        ddDeal({ id: 3, scheduledDate: null }),   // unscheduled — not "overdue"
      ],
      awaitingConstructionComplete: [ddDeal({ id: 4, scheduledDate: past })],
    };
    const [surveys, installs] = buildTeamSections("ops", dd, [], NOW);
    expect(surveys.lines.map((l: { id: string }) => l.id)).toEqual(["1"]);
    expect(surveys.lines[0].daysWaiting).toBeGreaterThanOrEqual(5);
    expect(surveys.lines[0].needsFollowUp).toBe(true);
    expect(surveys.lines[0].lead).toBe("Sam Surveyor");
    expect(installs.lines.map((l: { id: string }) => l.id)).toEqual(["4"]);
  });

  it("skips parked (On Hold) deals but keeps non-parked blocked deals with their reason", () => {
    const dd = {
      ...EMPTY_DD,
      awaitingReadyToBuild: [
        ddDeal({ id: 1, flag: { label: "On hold", tone: "yellow", reason: "roof", note: null, parked: true } }),
        ddDeal({ id: 2, flag: { label: "RTB blocked", tone: "red", reason: "HOA", note: null, parked: false } }),
      ],
    };
    const [rtb] = buildTeamSections("pm", dd, [], NOW);
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
    const sections = buildTeamSections("compliance", rows.length ? { ...EMPTY_DD } : EMPTY_DD, rows, NOW);
    expect(sections[0].lines.map((l) => l.id)).toEqual(["r1"]);
    expect(sections[1].lines.map((l) => l.id)).toEqual(["s1"]);
    expect(sections[1].lines[0].needsFollowUp).toBe(true); // 20d > 14d
    expect(sections[1].lines[0].lead).toBe("");
    expect(sections[1].groupBy).toBe("location");
  });
});

describe("renderTeamDigest", () => {
  it("renders sections with links, follow-up marks, leads, and the preset dashboard link", () => {
    const dd = {
      ...EMPTY_DD,
      awaitingPermitIssue: [ddDeal({ id: 2, daysWaiting: 34 })],
    };
    const msg = renderTeamDigest("permitting", buildTeamSections("permitting", dd, [], NOW), NOW)!;
    expect(msg).toContain("🚧 Permitting worklist");
    expect(msg).toContain("Submitted — follow up with AHJ (1 — 1 past 21d)");
    expect(msg).toContain("Katie Permit (1)"); // group header = responsible party
    expect(msg).toContain("/record/0-3/2|PROJ-1000 — Test, Casey>");
    expect(msg).toContain("— Permitting & Interconnection — 34d ⚠"); // deal stage on the line
    expect(msg).toContain("?tab=bottlenecks&view=permitting");
  });

  it("returns null when nothing is waiting", () => {
    expect(renderTeamDigest("sales", buildTeamSections("sales", EMPTY_DD, [], NOW), NOW)).toBeNull();
  });
});

describe("buildPersonalWorklists", () => {
  const { buildPersonalWorklists, renderPersonalWorklist } = jest.requireActual("@/lib/bottleneck-team-digest");
  it("pivots team sections into per-person worklists across teams", () => {
    const dd = {
      ...EMPTY_DD,
      awaitingPermitSubmit: [ddDeal({ id: 1, permitLead: "Peter Zaun" }), ddDeal({ id: 2, permitLead: "Alexis Severson" })],
      awaitingPermitIssue: [ddDeal({ id: 3, permitLead: "Peter Zaun", daysWaiting: 40 })],
      awaitingReadyToBuild: [ddDeal({ id: 4, projectManager: "Peter Zaun" })], // same person, different team hat
    };
    const byTeam = (["permitting", "pm"] as const).map((team) => ({
      team,
      sections: buildTeamSections(team, dd, [], NOW),
    }));
    const lists = buildPersonalWorklists(byTeam);
    const peter = lists.find((w: { person: string }) => w.person === "Peter Zaun")!;
    expect(peter.totalDeals).toBe(3);
    expect(peter.sections.map((s: { team: string }) => s.team).sort()).toEqual(["permitting", "permitting", "pm"]);
    const msg = renderPersonalWorklist(peter, NOW);
    expect(msg).toContain("👋 Peter — your pipeline worklist");
    expect(msg).toContain("Permitting — Submitted — follow up with AHJ (1)");
    expect(msg).toContain("PM — Ready to build — clear blockers (1)");
    expect(lists.find((w: { person: string }) => w.person === "Alexis Severson")!.totalDeals).toBe(1);
  });
});

describe("overdue-survey ops-director fanout", () => {
  const { buildPersonalWorklists } = jest.requireActual("@/lib/bottleneck-team-digest");
  it("puts an overdue survey in BOTH the surveyor's and the ops director's personal lists", () => {
    const past = new Date(NOW - 4 * 86_400_000).toISOString().slice(0, 10);
    const dd = {
      ...EMPTY_DD,
      awaitingSurvey: [
        ddDeal({ id: 9, scheduledDate: past, siteSurveyor: "Sam Surveyor", operationsManager: "Drew Perry" }),
      ],
    };
    const byTeam = [{ team: "ops" as const, sections: buildTeamSections("ops", dd, [], NOW) }];
    const lists = buildPersonalWorklists(byTeam);
    const names = lists.map((w: { person: string }) => w.person).sort();
    expect(names).toEqual(["Drew Perry", "Sam Surveyor"]);
    for (const w of lists) {
      expect(w.sections[0].section.lines.map((l: { id: string }) => l.id)).toEqual(["9"]);
    }
  });
});
