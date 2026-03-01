import {
  RISK_SCORES,
  RISK_LEVELS_BY_SCORE,
  ACTIVITY_RISK_MAP,
  getActivityRiskLevel,
  detectEnvironment,
  detectClientType,
  isPrivateIP,
  maskIP,
} from "@/lib/audit/detect";

// ---------------------------------------------------------------------------
// RISK_SCORES
// ---------------------------------------------------------------------------
describe("RISK_SCORES", () => {
  it("maps risk levels to numeric scores", () => {
    expect(RISK_SCORES).toEqual({
      LOW: 1,
      MEDIUM: 2,
      HIGH: 3,
      CRITICAL: 4,
    });
  });

  it("has a reverse mapping via RISK_LEVELS_BY_SCORE", () => {
    expect(RISK_LEVELS_BY_SCORE[1]).toBe("LOW");
    expect(RISK_LEVELS_BY_SCORE[4]).toBe("CRITICAL");
  });
});

// ---------------------------------------------------------------------------
// getActivityRiskLevel
// ---------------------------------------------------------------------------
describe("getActivityRiskLevel", () => {
  it("returns CRITICAL for USER_DELETED", () => {
    expect(getActivityRiskLevel("USER_DELETED")).toEqual({
      riskLevel: "CRITICAL",
      riskScore: 4,
    });
  });

  it("returns HIGH for USER_ROLE_CHANGED", () => {
    expect(getActivityRiskLevel("USER_ROLE_CHANGED")).toEqual({
      riskLevel: "HIGH",
      riskScore: 3,
    });
  });

  it("returns MEDIUM for DATA_EXPORTED", () => {
    expect(getActivityRiskLevel("DATA_EXPORTED")).toEqual({
      riskLevel: "MEDIUM",
      riskScore: 2,
    });
  });

  it("defaults to LOW for unknown activity types", () => {
    expect(getActivityRiskLevel("PAGE_VIEWED")).toEqual({
      riskLevel: "LOW",
      riskScore: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// detectEnvironment
// ---------------------------------------------------------------------------
describe("detectEnvironment", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.VERCEL_ENV;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("returns PRODUCTION when VERCEL_ENV=production", () => {
    process.env.VERCEL_ENV = "production";
    expect(detectEnvironment()).toBe("PRODUCTION");
  });

  it("returns PREVIEW when VERCEL_ENV=preview", () => {
    process.env.VERCEL_ENV = "preview";
    expect(detectEnvironment()).toBe("PREVIEW");
  });

  it("returns PRODUCTION when no VERCEL_ENV and NODE_ENV=production", () => {
    delete process.env.VERCEL_ENV;
    process.env.NODE_ENV = "production";
    expect(detectEnvironment()).toBe("PRODUCTION");
  });

  it("returns LOCAL when NODE_ENV=development and no VERCEL_ENV", () => {
    delete process.env.VERCEL_ENV;
    process.env.NODE_ENV = "development";
    expect(detectEnvironment()).toBe("LOCAL");
  });
});

// ---------------------------------------------------------------------------
// detectClientType
// ---------------------------------------------------------------------------
describe("detectClientType", () => {
  it("returns BROWSER for browser UA with session", () => {
    expect(
      detectClientType({
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        xClientType: null,
        hasValidSession: true,
      })
    ).toBe("BROWSER");
  });

  it("honors X-Client-Type header when session is valid", () => {
    expect(
      detectClientType({
        userAgent: "custom-agent/1.0",
        xClientType: "CLAUDE_CODE",
        hasValidSession: true,
      })
    ).toBe("CLAUDE_CODE");
  });

  it("ignores X-Client-Type header without valid session", () => {
    expect(
      detectClientType({
        userAgent: "custom-agent/1.0",
        xClientType: "CLAUDE_CODE",
        hasValidSession: false,
      })
    ).toBe("API_CLIENT");
  });

  it("detects Claude Code from UA", () => {
    expect(
      detectClientType({
        userAgent: "claude-code/1.2.3",
        xClientType: null,
        hasValidSession: false,
      })
    ).toBe("CLAUDE_CODE");
  });

  it("detects Claude Code from anthropic UA", () => {
    expect(
      detectClientType({
        userAgent: "Anthropic-SDK/2.0",
        xClientType: null,
        hasValidSession: false,
      })
    ).toBe("CLAUDE_CODE");
  });

  it("detects Codex from UA", () => {
    expect(
      detectClientType({
        userAgent: "codex-agent/0.1",
        xClientType: null,
        hasValidSession: false,
      })
    ).toBe("CODEX");
  });

  it("detects OpenAI as Codex", () => {
    expect(
      detectClientType({
        userAgent: "OpenAI-Client/1.0",
        xClientType: null,
        hasValidSession: false,
      })
    ).toBe("CODEX");
  });

  it("returns API_CLIENT for non-browser UA without session", () => {
    expect(
      detectClientType({
        userAgent: "curl/7.68.0",
        xClientType: null,
        hasValidSession: false,
      })
    ).toBe("API_CLIENT");
  });

  it("returns UNKNOWN for null UA without session", () => {
    expect(
      detectClientType({
        userAgent: null,
        xClientType: null,
        hasValidSession: false,
      })
    ).toBe("UNKNOWN");
  });
});

// ---------------------------------------------------------------------------
// isPrivateIP
// ---------------------------------------------------------------------------
describe("isPrivateIP", () => {
  it.each([
    ["127.0.0.1", true],
    ["::1", true],
    ["localhost", true],
    ["unknown", true],
    ["10.0.0.1", true],
    ["10.255.255.255", true],
    ["192.168.1.42", true],
    ["192.168.0.1", true],
    ["172.16.0.1", true],
    ["172.31.255.255", true],
    ["::ffff:192.168.1.1", true],
    ["8.8.8.8", false],
    ["104.26.10.5", false],
    ["172.15.0.1", false],
    ["172.32.0.1", false],
  ])("isPrivateIP(%s) → %s", (ip, expected) => {
    expect(isPrivateIP(ip)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// maskIP
// ---------------------------------------------------------------------------
describe("maskIP", () => {
  it("masks IPv4 showing only last octet", () => {
    expect(maskIP("192.168.1.42")).toBe("***.***.***.42");
  });

  it("handles ::ffff: prefix", () => {
    expect(maskIP("::ffff:10.0.0.1")).toBe("***.***.***.1");
  });

  it("masks IPv6 showing only last segment", () => {
    expect(maskIP("2001:db8:85a3:0:0:8a2e:370:7334")).toBe(
      "****:****:****:****:****:****:****:7334"
    );
  });

  it("returns localhost as-is", () => {
    expect(maskIP("localhost")).toBe("localhost");
  });
});
