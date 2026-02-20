"use client";

import Link from "next/link";

import { UPDATES, type UpdateEntry } from "@/lib/product-updates";

const TYPE_STYLES: Record<UpdateEntry["changes"][number]["type"], { bg: string; text: string; label: string }> = {
  feature: { bg: "bg-emerald-500/10", text: "text-emerald-400", label: "New" },
  improvement: { bg: "bg-blue-500/10", text: "text-blue-400", label: "Improved" },
  fix: { bg: "bg-orange-500/10", text: "text-orange-400", label: "Fixed" },
  internal: { bg: "bg-zinc-500/10", text: "text-muted", label: "Internal" },
};

export default function UpdatesPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur border-b border-t-border">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="p-2 hover:bg-surface-2 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <h1 className="text-xl font-bold">Product Updates</h1>
              <p className="text-xs text-muted">Changelog & Release Notes</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/roadmap"
              className="flex items-center gap-2 text-xs text-muted hover:text-orange-400 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
              Roadmap
            </Link>
            <div className="text-xs text-muted">
              v{UPDATES[0].version}
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Intro */}
        <div className="mb-8 p-4 bg-surface/50 border border-t-border rounded-xl">
          <p className="text-muted text-sm">
            Stay up to date with the latest features, improvements, and fixes to PB Operations Suite.
            We continuously improve based on your feedback.
          </p>
        </div>

        {/* Updates Timeline */}
        <div className="space-y-8">
          {UPDATES.map((update, index) => (
            <div key={update.version} className="relative">
              {/* Timeline line */}
              {index < UPDATES.length - 1 && (
                <div className="absolute left-[19px] top-12 bottom-0 w-px bg-surface-2" />
              )}

              {/* Update Card */}
              <div className="flex gap-4">
                {/* Version badge */}
                <div className="flex-shrink-0">
                  <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-orange-600 rounded-full flex items-center justify-center text-xs font-bold shadow-lg shadow-orange-500/20">
                    {update.version.split(".")[0]}.{update.version.split(".")[1]}
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 pb-8">
                  <div className="bg-surface border border-t-border rounded-xl overflow-hidden">
                    {/* Header */}
                    <div className="p-4 border-b border-t-border">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h2 className="text-lg font-semibold">{update.title}</h2>
                          <p className="text-sm text-muted mt-1">{update.description}</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="text-xs font-mono text-orange-400">v{update.version}</div>
                          <div className="text-xs text-muted/70 mt-0.5">{update.date}</div>
                        </div>
                      </div>
                    </div>

                    {/* Changes */}
                    <div className="p-4">
                      <ul className="space-y-2">
                        {update.changes.map((change, i) => {
                          const style = TYPE_STYLES[change.type];
                          return (
                            <li key={i} className="flex items-start gap-2">
                              <span
                                className={`text-[0.65rem] px-1.5 py-0.5 rounded font-medium flex-shrink-0 mt-0.5 ${style.bg} ${style.text}`}
                              >
                                {style.label}
                              </span>
                              <span className="text-sm text-foreground/80">{change.text}</span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Roadmap CTA */}
        <div className="mt-12 p-6 bg-gradient-to-br from-orange-500/10 to-orange-500/5 border border-orange-500/30 rounded-xl text-center">
          <h3 className="text-lg font-semibold text-foreground mb-2">Want to shape what&apos;s next?</h3>
          <p className="text-muted text-sm mb-4">
            Vote on upcoming features and submit your own ideas on the Product Roadmap.
          </p>
          <Link
            href="/roadmap"
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-medium transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
            View Roadmap & Vote
          </Link>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-sm text-muted/70">
          <p>Have a specific bug report or urgent request?</p>
          <p className="mt-1">
            Contact:{" "}
            <a href="mailto:zach@photonbrothers.com" className="text-orange-400 hover:underline">
              zach@photonbrothers.com
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}
