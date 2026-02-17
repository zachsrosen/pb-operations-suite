"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-background text-foreground">
        <div className="min-h-screen flex items-center justify-center p-6">
          <div className="text-center bg-surface rounded-xl p-8 border border-t-border shadow-card max-w-md">
            <div className="text-red-500 text-5xl mb-4">!</div>
            <h2 className="text-xl font-bold mb-2">Something went wrong</h2>
            <p className="text-muted mb-4">
              A critical error occurred. Our team has been notified.
            </p>
            {error.digest && (
              <p className="text-xs text-muted/60 mb-4 font-mono">
                Error ID: {error.digest}
              </p>
            )}
            <button
              onClick={reset}
              className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
