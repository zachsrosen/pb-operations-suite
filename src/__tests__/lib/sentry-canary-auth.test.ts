import { isSentryCanaryAuthorized } from "@/lib/sentry-canary-auth";

describe("isSentryCanaryAuthorized", () => {
  it("accepts matching bearer token from SENTRY_CANARY_TOKEN", () => {
    expect(
      isSentryCanaryAuthorized("Bearer canary-token", {
        NODE_ENV: "production",
        SENTRY_CANARY_TOKEN: "canary-token",
      }),
    ).toBe(true);
  });

  it("falls back to CRON_SECRET when canary token is unset", () => {
    expect(
      isSentryCanaryAuthorized("Bearer cron-secret", {
        NODE_ENV: "production",
        CRON_SECRET: "cron-secret",
      }),
    ).toBe(true);
  });

  it("rejects invalid bearer token in production", () => {
    expect(
      isSentryCanaryAuthorized("Bearer wrong", {
        NODE_ENV: "production",
        SENTRY_CANARY_TOKEN: "expected",
      }),
    ).toBe(false);
  });

  it("allows requests in non-production when no secret is configured", () => {
    expect(
      isSentryCanaryAuthorized(null, {
        NODE_ENV: "development",
      }),
    ).toBe(true);
  });

  it("rejects requests in production when no secret is configured", () => {
    expect(
      isSentryCanaryAuthorized(null, {
        NODE_ENV: "production",
      }),
    ).toBe(false);
  });
});
