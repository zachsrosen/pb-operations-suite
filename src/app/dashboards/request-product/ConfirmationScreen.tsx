"use client";

import Link from "next/link";

export default function ConfirmationScreen({
  title,
  onSubmitAnother,
}: {
  title: string;
  onSubmitAnother: () => void;
}) {
  return (
    <div className="rounded-xl border border-t-border bg-surface p-8 flex flex-col items-center text-center">
      <div className="h-14 w-14 rounded-full bg-cyan-500/20 flex items-center justify-center mb-4">
        <svg
          className="h-7 w-7 text-cyan-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h2 className="text-xl font-semibold text-foreground mb-2">Request submitted</h2>
      <p className="text-sm text-muted max-w-md mb-1">
        Tech Ops has been notified about{" "}
        <span className="text-foreground font-medium">{title}</span>.
      </p>
      <p className="text-sm text-muted max-w-md mb-6">
        You&apos;ll get an email when it&apos;s added to OpenSolar.
      </p>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onSubmitAnother}
          className="rounded-lg bg-cyan-600 px-5 py-2 text-sm font-medium text-white hover:bg-cyan-500 transition-colors"
        >
          Submit another
        </button>
        <Link
          href="/suites/sales-marketing"
          className="rounded-lg border border-t-border bg-surface-2 px-5 py-2 text-sm font-medium text-foreground hover:bg-surface-elevated transition-colors"
        >
          Back to Sales &amp; Marketing
        </Link>
      </div>
    </div>
  );
}
