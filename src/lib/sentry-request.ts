import * as Sentry from "@sentry/nextjs";

/**
 * Tag the current Sentry scope with the request ID injected by middleware.
 * Call at the top of route handlers for end-to-end correlation.
 */
export function tagSentryRequest(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? "unknown";
  Sentry.getCurrentScope().setTag("request_id", requestId);
}
