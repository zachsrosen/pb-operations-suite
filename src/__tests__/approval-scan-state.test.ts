/**
 * Unit tests for the approval-scan verdict → signal mapping (the spec's
 * candidate table, incl. all IC flavours and the inspection candidate rule)
 * and the three-strikes dismissal state machine.
 */

// scan.ts transitively pulls the generated Prisma client (via idr-meeting →
// db) which Jest's CJS runtime can't parse; the pure helpers under test never
// touch it.
jest.mock("@/lib/idr-meeting", () => ({ locationInBucket: () => false }));

import {
  isInspectionCandidate,
  signalForVerdict,
} from "@/lib/approval-scan/classify";
import {
  applyDismiss,
  CANDIDATE_STATUSES,
  evidenceAction,
  type SignalDismissState,
} from "@/lib/approval-scan/scan";

// ========== signalForVerdict mapping table ==========

describe("signalForVerdict", () => {
  describe("permit", () => {
    it.each(["Submitted to AHJ", "Resubmitted to AHJ", "Awaiting Utility Approval"])(
      "approved in waiting status %s → permit_issued / Complete",
      (status) => {
        expect(signalForVerdict("permit", status, "approved")).toEqual({
          signalType: "permit_issued",
          proposedStatus: "Complete",
        });
      },
    );

    it("returns null outside the waiting group", () => {
      expect(signalForVerdict("permit", "Ready For Permitting", "approved")).toBeNull();
      expect(signalForVerdict("permit", "Complete", "approved")).toBeNull();
    });

    it("returns null for non-permit verdicts", () => {
      expect(signalForVerdict("permit", "Submitted to AHJ", "pto_granted")).toBeNull();
      expect(signalForVerdict("permit", "Submitted to AHJ", "photos_approved")).toBeNull();
    });
  });

  describe("ic flavours", () => {
    it.each([
      ["approved", "Application Approved"],
      ["conditional_approved", "Conditional Application Approval"],
      ["approved_pending_signatures", "Application Approved - Pending Signatures"],
    ] as const)("%s → ic_approved proposing %s", (verdict, proposed) => {
      for (const status of CANDIDATE_STATUSES.ic) {
        expect(signalForVerdict("ic", status, verdict)).toEqual({
          signalType: "ic_approved",
          proposedStatus: proposed,
        });
      }
    });

    it("returns null outside the waiting group", () => {
      expect(signalForVerdict("ic", "Ready for Interconnection", "approved")).toBeNull();
      expect(signalForVerdict("ic", "Application Approved", "approved")).toBeNull();
    });
  });

  describe("pto", () => {
    it.each([
      "Inspection Submitted to Utility",
      "Resubmitted to Utility",
      "Xcel Photos Submitted",
      "Xcel Photos Resubmitted",
    ])("pto_granted in waiting status %s → PTO", (status) => {
      expect(signalForVerdict("pto", status, "pto_granted")).toEqual({
        signalType: "pto_granted",
        proposedStatus: "PTO",
      });
    });

    it("photos_approved only from the Xcel photo statuses", () => {
      expect(signalForVerdict("pto", "Xcel Photos Submitted", "photos_approved")).toEqual({
        signalType: "xcel_photos_approved",
        proposedStatus: "Xcel Photos Approved",
      });
      expect(signalForVerdict("pto", "Xcel Photos Resubmitted", "photos_approved")).toEqual({
        signalType: "xcel_photos_approved",
        proposedStatus: "Xcel Photos Approved",
      });
      expect(
        signalForVerdict("pto", "Inspection Submitted to Utility", "photos_approved"),
      ).toBeNull();
    });

    it("inspection_passed only when the deal has no pto_status at all", () => {
      // Inspection rides the PERMIT team (evidence is AHJ mail).
      expect(signalForVerdict("permit", "Complete", "inspection_passed")).toEqual({
        signalType: "inspection_passed",
        proposedStatus: "Inspection Passed - Ready for Utility",
      });
      // The pto team no longer maps inspection verdicts at all.
      expect(signalForVerdict("pto", "", "inspection_passed")).toBeNull();
      // ANY pto_status means the PTO team already owns the deal — no signal.
      expect(
        signalForVerdict("pto", "Pending Truck Roll", "inspection_passed"),
      ).toBeNull();
      // At/past: ready, waiting, resubmit, terminal → null.
      for (const status of [
        "Inspection Passed - Ready for Utility",
        "Xcel Photos Ready to Submit",
        "Inspection Submitted to Utility",
        "Ready to Resubmit",
        "PTO",
        "Not Needed",
      ]) {
        expect(signalForVerdict("pto", status, "inspection_passed")).toBeNull();
      }
    });
  });

  it("never signals on negative or unknown verdicts", () => {
    for (const verdict of ["rejected", "info_needed", "other"] as const) {
      expect(signalForVerdict("permit", "Submitted to AHJ", verdict)).toBeNull();
      expect(signalForVerdict("ic", "Submitted To Utility", verdict)).toBeNull();
      expect(signalForVerdict("pto", "Xcel Photos Submitted", verdict)).toBeNull();
    }
  });
});

describe("isInspectionCandidate", () => {
  it("requires permitting_status Complete", () => {
    expect(isInspectionCandidate("Submitted to AHJ", "")).toBe(false);
    expect(isInspectionCandidate(null, "")).toBe(false);
    expect(isInspectionCandidate("Complete", "")).toBe(true);
  });

  it("excludes any deal with a pto_status — the PTO team already owns it", () => {
    for (const status of [
      "PTO",
      "Inspection Passed - Ready for Utility",
      "Xcel Photos Submitted",
      "Pending Truck Roll",
      "PTO Waiting on Interconnection Approval",
      "Waiting on New Construction",
      "Inspection Rejected By Utility",
      "Xcel Photos Approved",
      "Conditional PTO - Pending Transformer Upgrade",
    ]) {
      expect(isInspectionCandidate("Complete", status)).toBe(false);
    }
    expect(isInspectionCandidate("Complete", "  ")).toBe(true);
    expect(isInspectionCandidate("Complete", null)).toBe(true);
  });
});

// ========== Three-strikes state machine ==========

describe("applyDismiss", () => {
  const open: SignalDismissState = {
    status: "OPEN",
    dismissedMessageIds: [],
    dismissCount: 0,
  };

  it("first and second dismissals → DISMISSED with the messageId suppressed", () => {
    const one = applyDismiss(open, "msg-1");
    expect(one.status).toBe("DISMISSED");
    expect(one.dismissedMessageIds).toEqual(["msg-1"]);
    expect(one.dismissCount).toBe(1);

    const two = applyDismiss(one, "msg-2");
    expect(two.status).toBe("DISMISSED");
    expect(two.dismissedMessageIds).toEqual(["msg-1", "msg-2"]);
    expect(two.dismissCount).toBe(2);
  });

  it("third DISTINCT dismissal → MUTED", () => {
    const two: SignalDismissState = {
      status: "DISMISSED",
      dismissedMessageIds: ["msg-1", "msg-2"],
      dismissCount: 2,
    };
    const three = applyDismiss(two, "msg-3");
    expect(three.status).toBe("MUTED");
    expect(three.dismissCount).toBe(3);
  });

  it("re-dismissing an already-suppressed messageId does not add a strike", () => {
    const two: SignalDismissState = {
      status: "DISMISSED",
      dismissedMessageIds: ["msg-1", "msg-2"],
      dismissCount: 2,
    };
    const still = applyDismiss(two, "msg-2");
    expect(still.status).toBe("DISMISSED");
    expect(still.dismissCount).toBe(2);
  });
});

describe("evidenceAction", () => {
  it("creates when no row exists", () => {
    expect(evidenceAction(null, "msg-1")).toBe("create");
  });

  it("refreshes an OPEN signal on new evidence", () => {
    expect(
      evidenceAction(
        { status: "OPEN", dismissedMessageIds: [], evidenceMessageId: "msg-1" },
        "msg-2",
      ),
    ).toBe("refresh");
  });

  it("same-message re-find on a dismissed signal is a no-op", () => {
    expect(
      evidenceAction(
        { status: "DISMISSED", dismissedMessageIds: ["msg-1"], evidenceMessageId: "msg-1" },
        "msg-1",
      ),
    ).toBe("skip");
  });

  it("new evidence reopens RESOLVED", () => {
    expect(
      evidenceAction(
        { status: "RESOLVED", dismissedMessageIds: [], evidenceMessageId: "msg-1" },
        "msg-2",
      ),
    ).toBe("reopen");
  });

  it("the resolving message itself never re-flags a RESOLVED signal", () => {
    expect(
      evidenceAction(
        { status: "RESOLVED", dismissedMessageIds: [], evidenceMessageId: "msg-1" },
        "msg-1",
      ),
    ).toBe("skip");
  });

  it("new evidence reopens DISMISSED (when the message is not suppressed)", () => {
    expect(
      evidenceAction(
        { status: "DISMISSED", dismissedMessageIds: ["msg-1"], evidenceMessageId: "msg-1" },
        "msg-2",
      ),
    ).toBe("reopen");
  });

  it("MUTED never reopens", () => {
    expect(
      evidenceAction(
        { status: "MUTED", dismissedMessageIds: ["a", "b", "c"], evidenceMessageId: "a" },
        "msg-9",
      ),
    ).toBe("skip");
  });
});
