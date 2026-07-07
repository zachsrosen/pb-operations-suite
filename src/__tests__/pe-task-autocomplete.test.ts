// Pure functions only; mock the DB so importing the module never needs a live client.
jest.mock("@/lib/db", () => ({ prisma: null }));

import {
  classifyPeTask,
  docToTeam,
  docToMilestone,
  subjectTeam,
  bodyTeam,
  decideCompletion,
  type DealPeState,
  mergeAutocompleteLedger,
  type CompletionEntry,
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

  it("resolves the team from the BODY when a generic-titled rejection task names it", () => {
    // The 'M1 Rejected by Participate Energy' tasks carry the team in the body.
    expect(classifyPeTask("M1 Rejected by Participate Energy #1 - ZRS",
      "<p>Participate Energy rejected the sales documents. Please see below...</p>"))
      .toEqual({ kind: "rejection", milestone: "m1", flavor: "pe", team: "sales" });
    expect(classifyPeTask("M1 Rejected by Participate Energy #2 - ZRS",
      "Participate Energy rejected the operations documents."))
      .toEqual({ kind: "rejection", milestone: "m1", flavor: "pe", team: "ops" });
    // A milestone-level body stays generic (team undefined).
    expect(classifyPeTask("M1 Rejected by Participate Energy # - ZRS",
      "Participate Energy rejected the M1 documents."))
      .toEqual({ kind: "rejection", milestone: "m1", flavor: "pe", team: undefined });
    // Subject team wins over body when both are present.
    expect(classifyPeTask("M1 Design Rejection - ZRS",
      "Participate Energy rejected the sales documents."))
      .toEqual({ kind: "rejection", milestone: "m1", flavor: "pe", team: "design" });
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

  it("maps body team words (HTML tolerated); milestone-level body is generic", () => {
    expect(bodyTeam("<div>Participate Energy rejected the sales documents.</div>")).toBe("sales");
    expect(bodyTeam("rejected the operations documents")).toBe("ops");
    expect(bodyTeam("rejected the compliance documents")).toBe("compliance");
    expect(bodyTeam("Participate Energy rejected the M1 documents.")).toBeUndefined();
    expect(bodyTeam("")).toBeUndefined();
  });
});

describe("decideCompletion", () => {
  const C = 1_000_000; // task hs_createdate (ms)
  const base = (over: Partial<DealPeState> = {}): DealPeState => ({
    m1Status: "Submitted", m2Status: "",
    m1SubmissionDate: "1699999999999", m2SubmissionDate: null,
    unresolvedDocsByMilestone: { m1: new Set(), m2: new Set() },
    latestUploadByDoc: new Map(),
    ...over,
  });

  it("submit: closes when the milestone submission date is set, not before", () => {
    expect(decideCompletion({ kind: "submit", milestone: "m1" }, C, base({ m1SubmissionDate: "123" })).complete).toBe(true);
    expect(decideCompletion({ kind: "submit", milestone: "m1" }, C, base({ m1SubmissionDate: null })).complete).toBe(false);
    // per-milestone independence
    expect(decideCompletion({ kind: "submit", milestone: "m2" }, C, base({ m2SubmissionDate: null })).complete).toBe(false);
  });

  it("per-team rejection: closes only when team's docs are resolved AND a post-C resubmission exists", () => {
    const task = { kind: "rejection" as const, milestone: "m1" as const, flavor: "pe" as const, team: "sales" as const };
    // Sales owns "Signed Proposal" (m1). Unresolved -> stays open.
    expect(decideCompletion(task, C, base({ unresolvedDocsByMilestone: { m1: new Set(["Signed Proposal"]), m2: new Set() } })).complete).toBe(false);
    // Resolved but no post-C upload -> stays open.
    expect(decideCompletion(task, C, base({ latestUploadByDoc: new Map([["Signed Proposal", C - 1]]) })).complete).toBe(false);
    // Resolved + post-C upload -> closes.
    expect(decideCompletion(task, C, base({ latestUploadByDoc: new Map([["Signed Proposal", C + 1]]) })).complete).toBe(true);
  });

  it("per-team rejection: an M2 resubmission never closes an M1 accounting task", () => {
    const m1acct = { kind: "rejection" as const, milestone: "m1" as const, flavor: "pe" as const, team: "accounting" as const };
    // Only the M2 accounting doc was resubmitted; M1 accounting doc (Progress Lien) has no post-C upload.
    const state = base({ latestUploadByDoc: new Map([["Conditional Waiver — Final Payment", C + 1]]) });
    expect(decideCompletion(m1acct, C, state).complete).toBe(false);
  });

  it("generic rejection: waits until no unresolved docs remain on the milestone", () => {
    const task = { kind: "rejection" as const, milestone: "m1" as const, flavor: "pe" as const, team: undefined };
    expect(decideCompletion(task, C, base({ unresolvedDocsByMilestone: { m1: new Set(["Design Plan"]), m2: new Set() } })).complete).toBe(false);
    expect(decideCompletion(task, C, base({ latestUploadByDoc: new Map([["Design Plan", C + 1]]) })).complete).toBe(true);
  });

  it("resubmit: closes once the milestone left Ready to Resubmit", () => {
    const task = { kind: "resubmit" as const, milestone: "m1" as const, flavor: "pe" as const };
    expect(decideCompletion(task, C, base({ m1Status: "Ready to Resubmit" })).complete).toBe(false);
    expect(decideCompletion(task, C, base({ m1Status: "Submitted" })).complete).toBe(true);
  });

  it("onboarding resubmit: closes once m1 left Onboarding Ready to Resubmit", () => {
    const task = { kind: "resubmit" as const, milestone: "m1" as const, flavor: "onboarding" as const };
    expect(decideCompletion(task, C, base({ m1Status: "Onboarding Ready to Resubmit" })).complete).toBe(false);
    expect(decideCompletion(task, C, base({ m1Status: "Onboarding Resubmitted" })).complete).toBe(true);
  });

  it("BOM rejection counts toward the Ops team task", () => {
    const opsTask = { kind: "rejection" as const, milestone: "m1" as const, flavor: "pe" as const, team: "ops" as const };
    // BOM is an Ops doc (override) resubmitted post-C, and no Ops doc is unresolved.
    expect(decideCompletion(opsTask, C, base({ latestUploadByDoc: new Map([["Bill of Materials", C + 1]]) })).complete).toBe(true);
  });

  it("internal flavor is never completed in v1", () => {
    const task = { kind: "rejection" as const, milestone: "m1" as const, flavor: "internal" as const, team: "ops" as const };
    expect(decideCompletion(task, C, base()).complete).toBe(false);
  });
});

describe("mergeAutocompleteLedger", () => {
  const entry = (taskId: string): CompletionEntry => ({
    taskId, dealId: "1", dealName: "D", kind: "submit", milestone: "m1", reason: "x",
  });

  it("folds entries and keeps a lifetime total", () => {
    const l1 = mergeAutocompleteLedger(null, [entry("a"), entry("b")], "2026-07-07T00:00:00Z");
    expect(l1.totalCompleted).toBe(2);
    expect(l1.entries).toHaveLength(2);
    const l2 = mergeAutocompleteLedger(l1, [entry("c")], "2026-07-07T01:00:00Z");
    expect(l2.totalCompleted).toBe(3);
    expect(l2.lastRunAt).toBe("2026-07-07T01:00:00Z");
  });

  it("caps stored entries but not the lifetime total", () => {
    const many = Array.from({ length: 2100 }, (_, i) => entry(String(i)));
    const l = mergeAutocompleteLedger(null, many, "2026-07-07T00:00:00Z");
    expect(l.totalCompleted).toBe(2100);
    expect(l.entries.length).toBe(2000);
  });
});
