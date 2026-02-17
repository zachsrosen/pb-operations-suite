"use client";

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useEffect } from "react";

export default function Error({
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
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="text-center bg-surface rounded-xl p-8 border border-t-border shadow-card max-w-md">
        <div className="text-red-500 text-5xl mb-4">!</div>
        <h2 className="text-xl font-bold text-foreground mb-2">
          Something went wrong
        </h2>
        <p className="text-muted mb-2">
          This page encountered an unexpected error.
        </p>
        {error.digest && (
          <p className="text-xs text-muted/60 mb-4 font-mono">
            Error ID: {error.digest}
          </p>
        )}
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors"
          >
            Try Again
          </button>
          <Link
            href="/"
            className="px-4 py-2 bg-surface-2 text-foreground rounded-lg hover:bg-surface-elevated transition-colors"
          >
            Go Home
          </Link>
        </div>
      </div>
    </div>
  );
}
