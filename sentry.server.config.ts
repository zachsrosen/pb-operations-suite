import * as Sentry from "@sentry/nextjs";
import { resolveSentryDsn } from "./src/lib/sentry-dsn";

Sentry.init({
  dsn: resolveSentryDsn(),

  // Performance monitoring — sample 20% of transactions
  tracesSampleRate: 0.2,
});
