import * as Sentry from "@sentry/nextjs";
import { NextRequest, NextResponse } from "next/server";
import { tagSentryRequest } from "@/lib/sentry-request";
import { isSentryCanaryAuthorized } from "@/lib/sentry-canary-auth";

type CanaryKind = "error" | "message" | "transaction";

function parseKind(value: string | null): CanaryKind {
  if (value === "message" || value === "transaction") {
    return value;
  }
  return "error";
}

export async function POST(request: NextRequest) {
  if (!isSentryCanaryAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  tagSentryRequest(request);

  const kind = parseKind(request.nextUrl.searchParams.get("kind"));
  const timestamp = new Date().toISOString();
  const client = Sentry.getClient();
  const dsnConfigured = Boolean(client?.getOptions().dsn);
  const environment = String(client?.getOptions().environment || process.env.NODE_ENV || "unknown");

  let eventId: string | undefined;
  if (kind === "message") {
    eventId = Sentry.captureMessage(`SENTRY_CANARY_MESSAGE ${timestamp}`, "warning");
  } else if (kind === "transaction") {
    await Sentry.startSpan({ name: "sentry.canary.transaction", op: "task" }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  } else {
    const canaryError = new Error(`SENTRY_CANARY_ERROR ${timestamp}`);
    eventId = Sentry.captureException(canaryError, {
      tags: { canary: "true", source: "api" },
      fingerprint: ["sentry-canary-error"],
    });
  }

  const flushed = await Sentry.flush(2000);

  return NextResponse.json({
    success: true,
    kind,
    eventId: eventId ?? null,
    timestamp,
    debug: {
      clientConfigured: Boolean(client),
      dsnConfigured,
      environment,
      flushed,
    },
  });
}
