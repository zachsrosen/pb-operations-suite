import {
  resolveSessionMatch,
  computeConfidence,
  hashCode,
  SESSION_INACTIVITY_TIMEOUT_MS,
} from "@/lib/audit/session";

// ---------------------------------------------------------------------------
// SESSION_INACTIVITY_TIMEOUT_MS
// ---------------------------------------------------------------------------
describe("SESSION_INACTIVITY_TIMEOUT_MS", () => {
  it("equals 30 minutes in milliseconds", () => {
    expect(SESSION_INACTIVITY_TIMEOUT_MS).toBe(30 * 60 * 1000);
  });
});

// ---------------------------------------------------------------------------
// resolveSessionMatch
// ---------------------------------------------------------------------------
describe("resolveSessionMatch", () => {
  const now = new Date("2026-03-01T12:00:00Z");

  const baseCandidate = {
    id: "sess-1",
    clientType: "BROWSER" as const,
    ipAddress: "8.8.8.8",
    endedAt: null as Date | null,
    lastActiveAt: new Date(now.getTime() - 5 * 60 * 1000), // 5 min ago
  };

  const baseCtx = {
    clientType: "BROWSER" as const,
    ipAddress: "8.8.8.8",
    now,
  };

  it("reuses session when user, clientType, IP match and within timeout", () => {
    expect(resolveSessionMatch(baseCandidate, baseCtx)).toBe("REUSE");
  });

  it("returns NEW if beyond inactivity timeout (31 min ago)", () => {
    const oldCandidate = {
      ...baseCandidate,
      lastActiveAt: new Date(now.getTime() - 31 * 60 * 1000),
    };
    expect(resolveSessionMatch(oldCandidate, baseCtx)).toBe("NEW");
  });

  it("returns NEW if IP changed", () => {
    const ctx = { ...baseCtx, ipAddress: "1.2.3.4" };
    expect(resolveSessionMatch(baseCandidate, ctx)).toBe("NEW");
  });

  it("returns NEW if clientType changed", () => {
    const ctx = { ...baseCtx, clientType: "CLAUDE_CODE" as const };
    expect(resolveSessionMatch(baseCandidate, ctx)).toBe("NEW");
  });

  it("returns NEW if session already ended", () => {
    const endedCandidate = {
      ...baseCandidate,
      endedAt: new Date(now.getTime() - 10 * 60 * 1000),
    };
    expect(resolveSessionMatch(endedCandidate, baseCtx)).toBe("NEW");
  });
});

// ---------------------------------------------------------------------------
// computeConfidence
// ---------------------------------------------------------------------------
describe("computeConfidence", () => {
  it("returns HIGH for BROWSER + fingerprint + public IP", () => {
    expect(
      computeConfidence({
        clientType: "BROWSER",
        hasFingerprint: true,
        ipAddress: "8.8.8.8",
      })
    ).toBe("HIGH");
  });

  it("returns MEDIUM for BROWSER without fingerprint", () => {
    expect(
      computeConfidence({
        clientType: "BROWSER",
        hasFingerprint: false,
        ipAddress: "8.8.8.8",
      })
    ).toBe("MEDIUM");
  });

  it("returns MEDIUM for CLAUDE_CODE", () => {
    expect(
      computeConfidence({
        clientType: "CLAUDE_CODE",
        hasFingerprint: false,
        ipAddress: "8.8.8.8",
      })
    ).toBe("MEDIUM");
  });

  it("returns LOW for API_CLIENT", () => {
    expect(
      computeConfidence({
        clientType: "API_CLIENT",
        hasFingerprint: false,
        ipAddress: "8.8.8.8",
      })
    ).toBe("LOW");
  });

  it("returns LOW for UNKNOWN", () => {
    expect(
      computeConfidence({
        clientType: "UNKNOWN",
        hasFingerprint: false,
        ipAddress: "8.8.8.8",
      })
    ).toBe("LOW");
  });
});

// ---------------------------------------------------------------------------
// hashCode
// ---------------------------------------------------------------------------
describe("hashCode", () => {
  it("returns consistent integer for same input", () => {
    const a = hashCode("hello world");
    const b = hashCode("hello world");
    expect(a).toBe(b);
  });

  it("returns different integers for different inputs", () => {
    const a = hashCode("hello");
    const b = hashCode("world");
    expect(a).not.toBe(b);
  });

  it("returns a number", () => {
    expect(typeof hashCode("test")).toBe("number");
  });
});
