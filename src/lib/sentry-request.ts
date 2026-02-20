import * as Sentry from "@sentry/nextjs";
import { resolveSentryDsn } from "@/lib/sentry-dsn";

function ensureSentryInitialized() {
  if (Sentry.getClient()) {
    return;
  }
  const dsn = resolveSentryDsn();
  if (!dsn) {
    return;
  }
  Sentry.init({
    dsn,
    tracesSampleRate: 0.2,
  });
}

/**
 * Tag the current Sentry scope with the request ID injected by middleware.
 * Call at the top of route handlers for end-to-end correlation.
 */
export function tagSentryRequest(request: Request) {
  ensureSentryInitialized();
  const requestId = request.headers.get("x-request-id") ?? "unknown";
  Sentry.getCurrentScope().setTag("request_id", requestId);
}
