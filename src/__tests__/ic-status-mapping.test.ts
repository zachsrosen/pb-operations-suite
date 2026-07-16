import {
  IC_ACTION_STATUSES,
  IC_DESIGN_OWNED_STATUSES,
  icActionKindForStatus,
} from "@/lib/pi-statuses";

/**
 * interconnection_status stores VALUES that differ from the LABELS the team
 * sees in HubSpot, and the two rejection statuses invert:
 *
 *   value "Rejected"        -> label "Rejected - Revisions Needed"  (design's)
 *   value "Rejected (New)"  -> label "Rejected"                     (IC's)
 *
 * These pin the mapping so a future edit can't silently swap them.
 */
describe("IC rejection value/label mapping", () => {
  it("treats the value 'Rejected' (shown as 'Rejected - Revisions Needed') as design's", () => {
    expect(IC_DESIGN_OWNED_STATUSES.has("Rejected")).toBe(true);
  });

  it("does NOT treat 'Rejected (New)' (shown as plain 'Rejected') as design's", () => {
    expect(IC_DESIGN_OWNED_STATUSES.has("Rejected (New)")).toBe(false);
  });

  it("does NOT treat a non-design rejection as design's", () => {
    expect(IC_DESIGN_OWNED_STATUSES.has("Non-Design Related Rejection")).toBe(false);
  });

  it("keeps the in-flight IC revision with design", () => {
    expect(IC_DESIGN_OWNED_STATUSES.has("In Design For Revisions")).toBe(true);
  });
});

describe("IC as-built round trip", () => {
  it("is ours to resubmit, then the utility's to review", () => {
    expect(icActionKindForStatus("As-Built Ready to Resubmit")).toBe(
      "RESUBMIT_TO_UTILITY",
    );
    expect(icActionKindForStatus("As-Built Resubmitted")).toBe("FOLLOW_UP_UTILITY");
  });

  it("gives both an action label so rows don't render blank", () => {
    expect(IC_ACTION_STATUSES["As-Built Ready to Resubmit"]).toBeTruthy();
    expect(IC_ACTION_STATUSES["As-Built Resubmitted"]).toBeTruthy();
  });
});

describe("IC action label coverage", () => {
  it("every status with an action kind also has an action label", () => {
    // A kind without a label renders an empty action column — the bug that hit
    // permit's "Awaiting Utility Approval".
    for (const status of Object.keys(IC_ACTION_STATUSES)) {
      expect(icActionKindForStatus(status)).not.toBeNull();
    }
  });
});
