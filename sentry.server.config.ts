import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  // Performance monitoring — sample 20% of transactions
  tracesSampleRate: 0.2,
});
