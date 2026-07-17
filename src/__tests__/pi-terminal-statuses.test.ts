import {
  IC_STATUS_APPROVED,
  PERMIT_STATUS_ISSUED,
  PERMIT_ACTION_STATUSES,
  IC_ACTION_STATUSES,
} from "@/lib/pi-statuses";

/**
 * The hub's two "mark done" actions wrote values that HubSpot rejects:
 *   permitting_status      "Permit Issued"  <- a LABEL; the value is "Complete"
 *   interconnection_status "Approved"       <- not an option at all
 *
 * Nobody caught it because nobody had ever completed a hub action (zero
 * PermitHubDraft rows all-time). These pin the corrected values.
 *
 * Values verified against the live HubSpot property option lists 2026-07-17.
 */
describe("P&I terminal status values", () => {
  it("permit issued uses the VALUE, not the 'Permit Issued' label", () => {
    expect(PERMIT_STATUS_ISSUED).toBe("Complete");
    // Guard the exact regression: the label must never be used as the value.
    expect(PERMIT_STATUS_ISSUED).not.toBe("Permit Issued");
  });

  it("ic approved uses a real option, not the invented 'Approved'", () => {
    expect(IC_STATUS_APPROVED).toBe("Application Approved");
    expect(IC_STATUS_APPROVED).not.toBe("Approved");
  });

  it("terminal statuses are not action statuses", () => {
    // A deal that is issued/approved is done — it should not also be
    // advertising an action for the team to take.
    expect(PERMIT_ACTION_STATUSES[PERMIT_STATUS_ISSUED]).toBeUndefined();
    expect(IC_ACTION_STATUSES[IC_STATUS_APPROVED]).toBeUndefined();
  });
});
