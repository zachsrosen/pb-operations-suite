"use client";

import type { PeTemplateStatus } from "@/lib/pandadoc";

const STATUS_DISPLAY = {
  completed: { label: "Downloaded to GDrive", color: "text-green-700 dark:text-green-400", bg: "bg-green-50 dark:bg-green-950/30" },
  sent: { label: "Sent, awaiting signature", color: "text-blue-700 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-950/30" },
  viewed: { label: "Viewed, awaiting signature", color: "text-blue-700 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-950/30" },
  draft: { label: "Draft — not yet sent", color: "text-yellow-700 dark:text-yellow-400", bg: "bg-yellow-50 dark:bg-yellow-950/30" },
} as const;

const KEY_LABELS: Record<string, string> = {
  attestation: "Installer Attestation (Exhibit A)",
  acceptance: "Customer Acceptance (Exhibit B)",
  progress_waiver: "Conditional Progress Lien Waiver",
  final_waiver: "Conditional Final Lien Waiver",
};

interface Props {
  statuses: PeTemplateStatus[];
}

export function PePandaDocSection({ statuses }: Props) {
  if (statuses.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">PandaDoc Templates</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {statuses.map((s) => {
          const display = s.document
            ? STATUS_DISPLAY[s.document.status as keyof typeof STATUS_DISPLAY] ?? { label: s.document.status, color: "text-muted", bg: "bg-surface" }
            : { label: "Not yet created", color: "text-red-700 dark:text-red-400", bg: "bg-red-50 dark:bg-red-950/30" };

          const pandaUrl = s.document
            ? `https://app.pandadoc.com/a/#/documents/${s.document.id}`
            : null;

          return (
            <div key={s.key} className={`rounded-lg border border-t-border p-3 ${display.bg}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground">{KEY_LABELS[s.key] ?? s.key}</p>
                {pandaUrl && (
                  <a
                    href={pandaUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors shrink-0"
                  >
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                    PandaDoc
                  </a>
                )}
              </div>
              <p className={`text-xs mt-1 ${display.color}`}>{display.label}</p>
              {s.document?.dateCompleted && (
                <p className="text-xs text-muted mt-0.5">
                  Completed: {new Date(s.document.dateCompleted).toLocaleDateString()}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
