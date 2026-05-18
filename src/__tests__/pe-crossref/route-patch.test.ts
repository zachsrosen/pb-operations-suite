import { computeManualStatusChange } from "@/app/api/pe-crossref/tasks/[taskId]/_lifecycle";

describe("computeManualStatusChange", () => {
  it("resolves OPEN → RESOLVED_MANUAL with userEmail + timestamps", () => {
    const out = computeManualStatusChange({
      currentStatus: "OPEN",
      action: "resolve",
      userEmail: "u@p.com",
    });
    expect(out.status).toBe("RESOLVED_MANUAL");
    expect(out.resolvedBy).toBe("u@p.com");
    expect(out.manualResolvedAt).toBeInstanceOf(Date);
  });

  it("dismisses OPEN → DISMISSED with reason", () => {
    const out = computeManualStatusChange({
      currentStatus: "OPEN",
      action: "dismiss",
      userEmail: "u@p.com",
      reason: "Not applicable to this deal",
    });
    expect(out.status).toBe("DISMISSED");
    expect(out.dismissedReason).toBe("Not applicable to this deal");
  });

  it("reopens RESOLVED_MANUAL → OPEN clearing resolved fields", () => {
    const out = computeManualStatusChange({
      currentStatus: "RESOLVED_MANUAL",
      action: "reopen",
      userEmail: "u@p.com",
    });
    expect(out.status).toBe("OPEN");
    expect(out.resolvedAt).toBeNull();
    expect(out.resolvedBy).toBeNull();
  });

  it("rejects invalid action", () => {
    expect(() =>
      computeManualStatusChange({
        currentStatus: "OPEN",
        // @ts-expect-error testing invalid input
        action: "delete",
        userEmail: "u@p.com",
      }),
    ).toThrow(/invalid action/i);
  });

  it("rejects dismiss without reason", () => {
    expect(() =>
      computeManualStatusChange({
        currentStatus: "OPEN",
        action: "dismiss",
        userEmail: "u@p.com",
      }),
    ).toThrow(/reason required/i);
  });
});
