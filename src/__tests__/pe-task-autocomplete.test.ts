// Pure functions only; mock the DB so importing the module never needs a live client.
jest.mock("@/lib/db", () => ({ prisma: null }));

import {
  classifyPeTask,
  docToTeam,
  docToMilestone,
  subjectTeam,
} from "@/lib/pe-task-autocomplete";

describe("classifyPeTask", () => {
  it("classifies submit tasks", () => {
    expect(classifyPeTask("Submit M1 To Participate Energy - ZRS")).toEqual({ kind: "submit", milestone: "m1" });
    expect(classifyPeTask("Submit M2 To Participate Energy - ZRS")).toEqual({ kind: "submit", milestone: "m2" });
  });

  it("classifies per-team and generic PE rejection tasks", () => {
    expect(classifyPeTask("M1 Sales Rejection - ZRS")).toEqual({ kind: "rejection", milestone: "m1", flavor: "pe", team: "sales" });
    expect(classifyPeTask("M1 Operations Rejection - ZRS")).toEqual({ kind: "rejection", milestone: "m1", flavor: "pe", team: "ops" });
    expect(classifyPeTask("M1 Design Rejection - ZRS")).toEqual({ kind: "rejection", milestone: "m1", flavor: "pe", team: "design" });
    expect(classifyPeTask("M1 Rejected by Participate Energy #3 - ZRS")).toEqual({ kind: "rejection", milestone: "m1", flavor: "pe", team: undefined });
  });

  it("classifies resubmit and onboarding tasks", () => {
    expect(classifyPeTask("M1 Ready to Resubmit #2 - ZRS")).toEqual({ kind: "resubmit", milestone: "m1", flavor: "pe" });
    expect(classifyPeTask("Onboarding Ready to Resubmit - ZRS")).toEqual({ kind: "resubmit", milestone: "m1", flavor: "onboarding" });
    expect(classifyPeTask("Onboarding Rejected by Participate Energy - ZRS")).toEqual({ kind: "rejection", milestone: "m1", flavor: "onboarding", team: undefined });
  });

  it("classifies internal-QC tasks (recognized; completed=false handled by decideCompletion)", () => {
    expect(classifyPeTask("M1 Ops Internal Rejection - ZRS")).toEqual({ kind: "rejection", milestone: "m1", flavor: "internal", team: "ops" });
  });

  it("returns null for non-PE and ambiguous subjects", () => {
    for (const s of [
      "Onboard Project To Participate Energy - ZRS",
      "Send Notice of Cancellation for Participate - ZRS",
      "Share Monitoring with Participate - ZRS",
      "Submit As-Built Revision #2 to AHJ - ZRS",
      "Xcel PTO Photos Ready to Resubmit #1 - ZRS",
      "PTO Ready to Resubmit - ZRS",
      "Jeff Hirsch - Resubmit IA removing grid charging",
      "Participate Energy Rejected - ZRS",
      "Provide Itemized Receipt - ZRS",
      "Close Out Project - WMS",
    ]) {
      expect(classifyPeTask(s)).toBeNull();
    }
  });
});

describe("doc -> team / milestone", () => {
  it("maps docs to canonical teams incl. the BOM->ops override and PE typo fix", () => {
    expect(docToTeam("Design Plan")).toBe("design");
    expect(docToTeam("Signed Proposal")).toBe("sales");
    expect(docToTeam("Signed Interconnection Agreement")).toBe("interconnection"); // PE typo normalized
    expect(docToTeam("Bill of Materials")).toBe("ops"); // override (absent from PE_DOC_TO_TEAM_FIELD)
    expect(docToTeam("Conditional Progress Lien Waiver")).toBe("accounting");
    expect(docToTeam("Conditional Waiver — Final Payment")).toBe("accounting");
  });

  it("maps docs to milestones (accounting spans M1 and M2)", () => {
    expect(docToMilestone("Conditional Progress Lien Waiver")).toBe("m1");
    expect(docToMilestone("Conditional Waiver — Final Payment")).toBe("m2");
    expect(docToMilestone("Permission to Operate (PTO)")).toBe("m2");
    expect(docToMilestone("Bill of Materials")).toBe("m1");
  });

  it("maps subject team words", () => {
    expect(subjectTeam("M1 Operations Rejection")).toBe("ops");
    expect(subjectTeam("M2 Interconnection Rejection")).toBe("interconnection");
    expect(subjectTeam("M1 Rejected by Participate Energy #1")).toBeUndefined();
  });
});
