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

          return (
            <div key={s.key} className={`rounded-lg border border-t-border p-3 ${display.bg}`}>
              <p className="text-sm font-medium text-foreground">{KEY_LABELS[s.key] ?? s.key}</p>
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
