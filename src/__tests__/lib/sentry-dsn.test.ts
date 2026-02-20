import { resolveSentryDsn } from "@/lib/sentry-dsn";

describe("resolveSentryDsn", () => {
  it("prefers SENTRY_DSN when both values are set", () => {
    expect(
      resolveSentryDsn({
        SENTRY_DSN: "https://server-key@o1.ingest.sentry.io/1",
        NEXT_PUBLIC_SENTRY_DSN: "https://public-key@o1.ingest.sentry.io/1",
      }),
    ).toBe("https://server-key@o1.ingest.sentry.io/1");
  });

  it("falls back to NEXT_PUBLIC_SENTRY_DSN", () => {
    expect(
      resolveSentryDsn({
        NEXT_PUBLIC_SENTRY_DSN: "https://public-key@o1.ingest.sentry.io/1",
      }),
    ).toBe("https://public-key@o1.ingest.sentry.io/1");
  });

  it("normalizes blank values to undefined", () => {
    expect(
      resolveSentryDsn({
        SENTRY_DSN: "   ",
        NEXT_PUBLIC_SENTRY_DSN: "",
      }),
    ).toBeUndefined();
  });
});
