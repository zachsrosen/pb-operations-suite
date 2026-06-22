import {
  rejectionTaskMilestone,
  isOpenTask,
  isCompletedTask,
  advanceDecision,
  mergeAdvanceLedger,
  type AdvanceLedger,
} from "@/lib/pe-rejection-advance";

describe("rejectionTaskMilestone", () => {
  it("maps M1/M2 PE rejection subjects to their milestone", () => {
    expect(rejectionTaskMilestone("M1 Rejected by Participate Energy #2 - ZRS")).toBe("m1");
    expect(rejectionTaskMilestone("M2 Rejected by Participate Energy - ZRS")).toBe("m2");
  });
  it("ignores onboarding-rejection and non-rejection tasks", () => {
    expect(rejectionTaskMilestone("Onboarding Rejected by Participate Energy - ZRS")).toBeNull();
    expect(rejectionTaskMilestone("M1 Ready to Resubmit - ZRS")).toBeNull();
    expect(rejectionTaskMilestone("Follow Up On Permit")).toBeNull();
  });
});

describe("open/completed", () => {
  it("treats NOT_STARTED / IN_PROGRESS / WAITING as open", () => {
    expect(isOpenTask("NOT_STARTED")).toBe(true);
    expect(isOpenTask("IN_PROGRESS")).toBe(true);
    expect(isOpenTask("WAITING")).toBe(true);
    expect(isOpenTask("COMPLETED")).toBe(false);
    expect(isOpenTask("DEFERRED")).toBe(false);
  });
  it("treats only COMPLETED as completed", () => {
    expect(isCompletedTask("COMPLETED")).toBe(true);
    expect(isCompletedTask("NOT_STARTED")).toBe(false);
  });
});

const T = (subject: string, status: string) => ({ subject, status });

describe("advanceDecision", () => {
  it("advances M1 to Ready to Resubmit when all M1 rejection tasks are completed (>=1, 0 open)", () => {
    const out = advanceDecision({
      m1Status: "Rejected",
      m2Status: "",
      tasks: [
        T("M1 Rejected by Participate Energy #1 - ZRS", "COMPLETED"),
        T("M1 Rejected by Participate Energy #2 - ZRS", "COMPLETED"),
      ],
    });
    expect(out).toEqual({ pe_m1_status: "Ready to Resubmit" });
  });

  it("does NOT advance while any M1 rejection task is still open", () => {
    const out = advanceDecision({
      m1Status: "Rejected",
      m2Status: "",
      tasks: [
        T("M1 Rejected by Participate Energy #1 - ZRS", "COMPLETED"),
        T("M1 Rejected by Participate Energy #2 - ZRS", "NOT_STARTED"),
      ],
    });
    expect(out).toEqual({});
  });

  it("does NOT advance a Rejected deal that has NO rejection tasks (guard against premature flip)", () => {
    const out = advanceDecision({ m1Status: "Rejected", m2Status: "", tasks: [] });
    expect(out).toEqual({});
  });

  it("does NOT advance when M1 status is not 'Rejected'", () => {
    const out = advanceDecision({
      m1Status: "Resubmitted",
      m2Status: "",
      tasks: [T("M1 Rejected by Participate Energy #1 - ZRS", "COMPLETED")],
    });
    expect(out).toEqual({});
  });

  it("advances M1 and M2 independently", () => {
    const out = advanceDecision({
      m1Status: "Rejected",
      m2Status: "Rejected",
      tasks: [
        T("M1 Rejected by Participate Energy #1 - ZRS", "COMPLETED"),
        T("M2 Rejected by Participate Energy #1 - ZRS", "NOT_STARTED"),
      ],
    });
    expect(out).toEqual({ pe_m1_status: "Ready to Resubmit" });
  });

  it("ignores onboarding tasks when deciding M1 (they are not M1 rejection tasks)", () => {
    const out = advanceDecision({
      m1Status: "Rejected",
      m2Status: "",
      tasks: [
        T("Onboarding Rejected by Participate Energy - ZRS", "NOT_STARTED"),
        T("M1 Rejected by Participate Energy #1 - ZRS", "COMPLETED"),
      ],
    });
    expect(out).toEqual({ pe_m1_status: "Ready to Resubmit" });
  });

  it("returns empty when nothing qualifies", () => {
    expect(advanceDecision({ m1Status: "Approved", m2Status: "Paid", tasks: [] })).toEqual({});
  });
});

describe("mergeAdvanceLedger", () => {
  const adv = (id: string, m: "m1" | "m2" = "m1") => ({
    dealId: id,
    dealName: `PROJ-${id}`,
    changes: { [`pe_${m}_status`]: "Ready to Resubmit" },
  });

  it("starts the lifetime total from a null ledger", () => {
    const out = mergeAdvanceLedger(null, [adv("1"), adv("2")], "2026-06-22T03:00:00.000Z");
    expect(out.totalAdvanced).toBe(2);
    expect(out.lastRunAt).toBe("2026-06-22T03:00:00.000Z");
    expect(out.entries).toHaveLength(2);
    expect(out.entries[0]).toMatchObject({ dealId: "1", at: "2026-06-22T03:00:00.000Z" });
  });

  it("accumulates the lifetime total across runs", () => {
    const r1 = mergeAdvanceLedger(null, [adv("1")], "2026-06-22T03:00:00.000Z");
    const r2 = mergeAdvanceLedger(r1, [adv("2"), adv("3")], "2026-06-22T04:00:00.000Z");
    expect(r2.totalAdvanced).toBe(3);
    expect(r2.lastRunAt).toBe("2026-06-22T04:00:00.000Z");
    expect(r2.entries.map((e) => e.dealId)).toEqual(["1", "2", "3"]);
  });

  it("a no-advance run keeps the total but refreshes lastRunAt", () => {
    const r1 = mergeAdvanceLedger(null, [adv("1")], "2026-06-22T03:00:00.000Z");
    const r2 = mergeAdvanceLedger(r1, [], "2026-06-22T05:00:00.000Z");
    expect(r2.totalAdvanced).toBe(1);
    expect(r2.lastRunAt).toBe("2026-06-22T05:00:00.000Z");
    expect(r2.entries).toHaveLength(1);
  });

  it("caps stored entries but never the lifetime total", () => {
    let ledger: AdvanceLedger | null = null;
    for (let i = 0; i < 2100; i++) {
      ledger = mergeAdvanceLedger(ledger, [adv(String(i))], "2026-06-22T03:00:00.000Z");
    }
    expect(ledger!.totalAdvanced).toBe(2100);
    expect(ledger!.entries).toHaveLength(2000);
    expect(ledger!.entries[ledger!.entries.length - 1].dealId).toBe("2099"); // newest retained
    expect(ledger!.entries[0].dealId).toBe("100"); // oldest 100 trimmed
  });
});
