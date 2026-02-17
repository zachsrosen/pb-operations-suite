import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  // Edge runtime — lower sample rate
  tracesSampleRate: 0.1,
});
