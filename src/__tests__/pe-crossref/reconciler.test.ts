import { computeReconcileActions, type ExistingTaskRow } from "@/lib/pe-crossref/reconciler";
import type { DetectedTask } from "@/lib/pe-crossref/types";

const detected = (overrides: Partial<DetectedTask> = {}): DetectedTask => ({
  pCode: "P1",
  identityKey: "P1@v1:test",
  severity: "critical",
  category: "hardware",
  analyzer: "HardwareAnalyzer",
  title: "WRONG HARDWARE",
  message: "msg",
  action: "act",
  evidence: {},
  ...overrides,
});

const existing = (overrides: Partial<ExistingTaskRow> = {}): ExistingTaskRow => ({
  id: "t1",
  identityKey: "P1@v1:test",
  status: "OPEN",
  ...overrides,
});

describe("computeReconcileActions", () => {
  it("creates new task when identity has no existing row", () => {
    const actions = computeReconcileActions({
      runId: "r1",
      detected: [detected()],
      existing: [],
    });
    expect(actions.creates).toHaveLength(1);
    expect(actions.creates[0].identityKey).toBe("P1@v1:test");
    expect(actions.creates[0].firstSeenRunId).toBe("r1");
    expect(actions.updates).toHaveLength(0);
    expect(actions.autoResolves).toHaveLength(0);
  });

  it("keeps OPEN status when re-detected (just bumps lastSeenRunId)", () => {
    const actions = computeReconcileActions({
      runId: "r2",
      detected: [detected()],
      existing: [existing({ status: "OPEN" })],
    });
    expect(actions.creates).toHaveLength(0);
    expect(actions.updates).toHaveLength(1);
    expect(actions.updates[0].previousStatus).toBe("OPEN");
    expect(actions.updates[0].nextStatus).toBe("OPEN");
    expect(actions.updates[0].lastSeenRunId).toBe("r2");
  });

  it("auto-resolves OPEN task when source no longer flags it", () => {
    const actions = computeReconcileActions({
      runId: "r2",
      detected: [],
      existing: [existing({ status: "OPEN" })],
    });
    expect(actions.autoResolves).toHaveLength(1);
    expect(actions.autoResolves[0].id).toBe("t1");
  });

  it("reopens RESOLVED_AUTO when source flags again", () => {
    const actions = computeReconcileActions({
      runId: "r2",
      detected: [detected()],
      existing: [existing({ status: "RESOLVED_AUTO" })],
    });
    expect(actions.updates).toHaveLength(1);
    expect(actions.updates[0].previousStatus).toBe("RESOLVED_AUTO");
    expect(actions.updates[0].nextStatus).toBe("OPEN");
  });

  it("reopens RESOLVED_MANUAL when source still flags (PM's manual resolve doesn't stick against source)", () => {
    const actions = computeReconcileActions({
      runId: "r2",
      detected: [detected()],
      existing: [existing({ status: "RESOLVED_MANUAL" })],
    });
    expect(actions.updates).toHaveLength(1);
    expect(actions.updates[0].previousStatus).toBe("RESOLVED_MANUAL");
    expect(actions.updates[0].nextStatus).toBe("OPEN");
  });

  it("preserves RESOLVED_MANUAL when source no longer flags", () => {
    const actions = computeReconcileActions({
      runId: "r2",
      detected: [],
      existing: [existing({ status: "RESOLVED_MANUAL" })],
    });
    expect(actions.updates).toHaveLength(0);
    expect(actions.autoResolves).toHaveLength(0);
  });

  it("preserves RESOLVED_AUTO when source still does not flag", () => {
    const actions = computeReconcileActions({
      runId: "r2",
      detected: [],
      existing: [existing({ status: "RESOLVED_AUTO" })],
    });
    expect(actions.updates).toHaveLength(0);
    expect(actions.autoResolves).toHaveLength(0);
  });

  it("preserves DISMISSED even when re-detected", () => {
    const actions = computeReconcileActions({
      runId: "r2",
      detected: [detected()],
      existing: [existing({ status: "DISMISSED" })],
    });
    expect(actions.creates).toHaveLength(0);
    expect(actions.updates).toHaveLength(0);
  });

  it("preserves DISMISSED when not detected", () => {
    const actions = computeReconcileActions({
      runId: "r2",
      detected: [],
      existing: [existing({ status: "DISMISSED" })],
    });
    expect(actions.updates).toHaveLength(0);
    expect(actions.autoResolves).toHaveLength(0);
  });

  it("handles a mix of detected and undetected existing tasks in one call", () => {
    const actions = computeReconcileActions({
      runId: "r2",
      detected: [detected({ identityKey: "A" }), detected({ identityKey: "B" })],
      existing: [
        existing({ id: "x", identityKey: "A", status: "OPEN" }),
        existing({ id: "y", identityKey: "C", status: "OPEN" }),
        existing({ id: "z", identityKey: "D", status: "DISMISSED" }),
      ],
    });
    expect(actions.creates.map((c) => c.identityKey)).toEqual(["B"]);
    expect(actions.updates.map((u) => u.id)).toEqual(["x"]);
    expect(actions.autoResolves.map((r) => r.id)).toEqual(["y"]);
  });
});
