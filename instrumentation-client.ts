import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Performance monitoring — sample 20% of transactions
  tracesSampleRate: 0.2,

  // Session replay — capture replays on error only
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,

  // Reduce bundle size
  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],

  // Attach session context to all events
  beforeSend(event) {
    const sessionId =
      typeof window !== "undefined"
        ? sessionStorage.getItem("pb_session_id")
        : null;
    if (sessionId) {
      event.tags = { ...event.tags, pb_session_id: sessionId };
    }
    return event;
  },
});

// Instrument client-side navigations
export const onRouterTransitionStart =
  Sentry.captureRouterTransitionStart;
