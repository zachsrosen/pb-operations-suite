import * as Sentry from "@sentry/nextjs";
import { resolveSentryDsn } from "./src/lib/sentry-dsn";

Sentry.init({
  dsn: resolveSentryDsn(),

  // Edge runtime — lower sample rate
  tracesSampleRate: 0.1,
});
