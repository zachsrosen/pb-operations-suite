"use client";

import type { AnalysisResult } from "@/lib/solar/adapters/worker-to-ui";
import { formatPercent, formatKwh } from "@/lib/solar/adapters/worker-to-ui";

interface MismatchCardProps {
  result: AnalysisResult;
}

/**
 * String-only mismatch display.
 * Shows N/A for micro/optimizer architectures where modelB is null [P1-F3].
 */
export default function MismatchCard({ result }: MismatchCardProps) {
  const hasMismatch = result.mismatchLossPct !== null;

  return (
    <div className="rounded-lg border border-t-border bg-card p-3 sm:p-5 space-y-3" role="region" aria-label="String mismatch analysis">
      <h3 className="text-sm font-medium text-foreground">
        String Mismatch
      </h3>

      {hasMismatch ? (
        <>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-foreground">
              {formatPercent(result.mismatchLossPct)}
            </span>
            <span className="text-xs text-muted">mismatch loss</span>
          </div>
          {result.modelBAnnualKwh !== null && (
            <div className="flex items-center justify-between text-xs text-muted border-t border-t-border pt-3">
              <span>Post-mismatch annual</span>
              <span>{formatKwh(result.modelBAnnualKwh)}</span>
            </div>
          )}
        </>
      ) : (
        <div className="space-y-2">
          <span className="text-2xl font-semibold text-muted/50">N/A</span>
          <p className="text-xs text-muted/60">
            Mismatch analysis not applicable for micro-inverter or optimizer architectures.
          </p>
        </div>
      )}
    </div>
  );
}
