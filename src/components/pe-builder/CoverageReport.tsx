"use client";

import type { CoverageReport as CoverageReportType, ShotStatus } from "@/lib/pe-photo-coverage";

interface CoverageReportProps {
  coverage: CoverageReportType;
}

const STATUS_STYLES: Record<ShotStatus, { icon: string; pill: string; label: string }> = {
  covered: {
    icon: "✅",
    pill: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    label: "Covered",
  },
  recheck: {
    icon: "⚠️",
    pill: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    label: "Recheck",
  },
  missing: {
    icon: "❌",
    pill: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    label: "Missing",
  },
};

const SYSTEM_TYPE_LABELS: Record<string, string> = {
  solar: "Solar",
  battery: "Battery Storage",
  "solar+battery": "Solar + Battery",
};

export function CoverageReport({ coverage }: CoverageReportProps) {
  const systemLabel = SYSTEM_TYPE_LABELS[coverage.systemType] ?? coverage.systemType;

  return (
    <div className="bg-surface border border-t-border rounded-xl shadow-card p-4 space-y-3">
      {/* Header: system type + completeness badge */}
      <div className="flex items-center gap-3 flex-wrap">
        <h3 className="text-sm font-semibold text-foreground">
          Coverage Report — {systemLabel}
        </h3>
        {coverage.complete ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            ✅ Complete
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
            Incomplete
          </span>
        )}
      </div>

      {/* Sales Order row — rendered distinctly */}
      <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-surface-2 border border-t-border">
        <span className="text-xs font-medium text-foreground">Sales Order (Invoice &amp; BOM)</span>
        {coverage.salesOrder === "covered" ? (
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            Covered
          </span>
        ) : (
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
            Missing
          </span>
        )}
      </div>

      {/* Required shots */}
      <div className="space-y-1.5">
        {coverage.shots.map((shot) => {
          const style = STATUS_STYLES[shot.status];
          const shotLabel = shot.pePhotoNumber != null
            ? `${shot.pePhotoNumber}. ${shot.label}`
            : shot.label;
          return (
            <div
              key={shot.id}
              className="flex items-center justify-between gap-2"
            >
              <span className="text-xs text-foreground flex-1 min-w-0 truncate" title={shotLabel}>
                <span className="mr-1">{style.icon}</span>
                {shotLabel}
              </span>
              <div className="flex items-center gap-2 shrink-0">
                {shot.count > 0 && (
                  <span className="text-[10px] text-muted">{shot.count}x</span>
                )}
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${style.pill}`}>
                  {style.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bonus shots */}
      {coverage.bonus.length > 0 && (
        <div className="border-t border-t-border pt-2 space-y-1">
          <p className="text-[10px] text-muted font-medium uppercase tracking-wide">
            Bonus Photos (kept, not required)
          </p>
          {coverage.bonus.map((b) => {
            const bonusLabel = b.pePhotoNumber != null ? `${b.pePhotoNumber}. ${b.label}` : b.label;
            return (
              <div key={b.id} className="flex items-center gap-1.5">
                <span className="text-xs text-muted">+</span>
                <span className="text-xs text-muted" title={bonusLabel}>{bonusLabel}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
