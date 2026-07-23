import { attachAssignments, type AssignmentRow } from "@/lib/design-hub/assignments";
import type { QueueItem } from "@/lib/design-hub/types";

jest.mock("@/lib/db", () => ({ prisma: {} }));

const statusLabels = new Map([
  ["Initial Review", "Initial Design Review"],
  ["Ready for Review", "Final Review/Stamping"],
]);

function row(overrides: Partial<AssignmentRow> = {}): AssignmentRow {
  return {
    id: "a1",
    dealId: "d1",
    assigneeEmail: "jacob.campbell@photonbrothers.com",
    assignedBy: "zach@photonbrothers.com",
    note: "do this today",
    dueDate: null,
    tab: "design",
    statusAtAssignment: "Initial Review",
    createdAt: new Date("2026-07-22T12:00:00Z"),
    ...overrides,
  };
}

function item(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    dealId: "d1",
    name: "Torpey",
    address: null,
    pbLocation: null,
    status: "Initial Review",
    statusLabel: "Initial Design Review",
    dealStage: null,
    group: "idr",
    subGroup: null,
    daysInStatus: 3,
    isStale: false,
    lead: null,
    leadOwnerId: null,
    pm: null,
    amount: null,
    ...overrides,
  };
}

describe("attachAssignments", () => {
  it("attaches an open assignment to its deal", () => {
    const [result] = attachAssignments(
      [item()],
      new Map([["d1", row()]]),
      statusLabels,
    );
    expect(result.assignment).toMatchObject({
      id: "a1",
      assigneeName: "Jacob Campbell",
      note: "do this today",
    });
  });

  it("sets assignment to null on deals with no open ask", () => {
    const [result] = attachAssignments([item()], new Map(), statusLabels);
    expect(result.assignment).toBeNull();
  });

  it("does not flag a status that hasn't moved", () => {
    const [result] = attachAssignments(
      [item({ status: "Initial Review" })],
      new Map([["d1", row({ statusAtAssignment: "Initial Review" })]]),
      statusLabels,
    );
    expect(result.assignment?.statusMoved).toBe(false);
  });

  it("flags a status that moved, and keeps the assignment open", () => {
    const [result] = attachAssignments(
      [item({ status: "Ready for Review" })],
      new Map([["d1", row({ statusAtAssignment: "Initial Review" })]]),
      statusLabels,
    );
    // The hint fires, but the assignment is still attached — auto-clearing on
    // a status change would let a HubSpot workflow silently eat the ask.
    expect(result.assignment).not.toBeNull();
    expect(result.assignment?.statusMoved).toBe(true);
    expect(result.assignment?.statusAtAssignmentLabel).toBe(
      "Initial Design Review",
    );
  });

  it("resolves the label for the status at assignment time, not the current one", () => {
    const [result] = attachAssignments(
      [item({ status: "Ready for Review", statusLabel: "Final Review/Stamping" })],
      new Map([["d1", row({ statusAtAssignment: "Initial Review" })]]),
      statusLabels,
    );
    expect(result.assignment?.statusAtAssignmentLabel).toBe(
      "Initial Design Review",
    );
  });

  it("never flags moved when there was no baseline status (global-search assign)", () => {
    const [result] = attachAssignments(
      [item({ status: "Ready for Design" })],
      // Assigned before the deal had any design status — statusAtAssignment "".
      new Map([["d1", row({ statusAtAssignment: "" })]]),
      statusLabels,
    );
    expect(result.assignment?.statusMoved).toBe(false);
    expect(result.assignment?.statusAtAssignmentLabel).toBe("no status yet");
  });

  it("falls back to the raw email when the assignee is off the roster", () => {
    const [result] = attachAssignments(
      [item()],
      new Map([["d1", row({ assigneeEmail: "someone@example.com" })]]),
      statusLabels,
    );
    expect(result.assignment?.assigneeName).toBe("someone@example.com");
  });

  it("leaves rows unmatched by dealId untouched", () => {
    const results = attachAssignments(
      [item({ dealId: "d1" }), item({ dealId: "d2" })],
      new Map([["d1", row()]]),
      statusLabels,
    );
    expect(results[0].assignment).not.toBeNull();
    expect(results[1].assignment).toBeNull();
  });
});
