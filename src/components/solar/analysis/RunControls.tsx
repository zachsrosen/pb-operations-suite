"use client";

import type { SimulationStatus, SimulationProgress } from "@/lib/solar/hooks/useSimulation";

interface RunControlsProps {
  status: SimulationStatus;
  progress: SimulationProgress;
  onRun: () => void;
  onCancel: () => void;
  isQuickEstimate: boolean;
  error: string | null;
}

export default function RunControls({
  status,
  progress,
  onRun,
  onCancel,
  isQuickEstimate,
  error,
}: RunControlsProps) {
  return (
    <div className="space-y-3" role="region" aria-label="Analysis controls">
      {/* Quick Estimate badge */}
      {isQuickEstimate && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/30" role="status">
          <span className="text-yellow-400 text-xs font-medium">
            ⚡ Quick Estimate
          </span>
          <span className="text-yellow-400/70 text-xs">
            Full accuracy requires design data (map or DXF layout)
          </span>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        {status === "idle" && (
          <button
            onClick={onRun}
            className="px-4 sm:px-5 py-2 sm:py-2.5 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400/50"
          >
            Run Analysis
          </button>
        )}

        {status === "running" && (
          <>
            <button
              onClick={onCancel}
              className="px-3 sm:px-4 py-2 rounded-lg bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 transition-colors text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50"
            >
              Cancel
            </button>
            <div className="flex-1 min-w-[120px] max-w-xs">
              <div className="flex items-center justify-between text-xs text-muted mb-1">
                <span>{progress.stage || "Starting..."}</span>
                <span aria-live="polite">{progress.percent}%</span>
              </div>
              <div className="h-2 rounded-full bg-zinc-800 overflow-hidden" role="progressbar" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100}>
                <div
                  className="h-full rounded-full bg-green-500 transition-all duration-300"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
            </div>
          </>
        )}

        {status === "complete" && (
          <div className="flex items-center gap-2" role="status">
            <span className="text-green-400 text-sm">✓ Analysis complete</span>
            <button
              onClick={onRun}
              className="px-3 py-1.5 rounded border border-t-border text-xs text-muted hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/50"
            >
              Re-run
            </button>
          </div>
        )}

        {status === "error" && (
          <div className="flex items-center gap-2" role="alert">
            <span className="text-red-400 text-sm">✗ Error</span>
            <button
              onClick={onRun}
              className="px-3 py-1.5 rounded border border-t-border text-xs text-muted hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/50"
            >
              Retry
            </button>
          </div>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3" role="alert">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}
    </div>
  );
}
