/**
 * Solar Engine — React Hook for Worker Lifecycle
 *
 * Wraps the Web Worker with:
 * - Automatic cleanup on unmount
 * - Cancel/restart support
 * - Progress state tracking
 * - runId guard to prevent stale responses [P2-F5]
 * - Schema version validation [P2-F4]
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  WorkerRunMessage,
  WorkerProgressMessage,
  WorkerResultMessage,
  WorkerErrorMessage,
} from "../types";
import { SCHEMA_VERSION, runAnalysis } from "../engine/runner";
import { mapPayloadToRunnerInput } from "../engine/payload-mapper";

export type SimulationStatus = "idle" | "running" | "complete" | "error";

export interface SimulationProgress {
  percent: number;
  stage: string;
}

export interface SimulationState {
  status: SimulationStatus;
  progress: SimulationProgress;
  result: WorkerResultMessage["payload"] | null;
  error: string | null;
}

export interface UseSimulationReturn {
  state: SimulationState;
  run: (payload: WorkerRunMessage["payload"]) => void;
  cancel: () => void;
}

/**
 * React hook for running the solar simulation engine in a Web Worker.
 *
 * Features:
 * - Terminates previous worker on re-run (no stale responses [P2-F5])
 * - Validates schemaVersion on result (rejects unknown versions)
 * - Cleans up on unmount
 *
 * @example
 * ```tsx
 * const { state, run, cancel } = useSimulation();
 *
 * // Start simulation
 * run(payload);
 *
 * // Read state
 * state.status    // "idle" | "running" | "complete" | "error"
 * state.progress  // { percent: 42, stage: "Model A" }
 * state.result    // WorkerResultMessage payload (when complete)
 * state.error     // Error message string (when error)
 *
 * // Optional: result.modelB is null for micro/optimizer [P1-F3]
 * state.result?.modelB?.mismatchLossPct  // use optional chaining
 * ```
 */
export function useSimulation(): UseSimulationReturn {
  const workerRef = useRef<Worker | null>(null);
  const runIdRef = useRef(0); // [P2-F5] monotonic counter

  const [state, setState] = useState<SimulationState>({
    status: "idle",
    progress: { percent: 0, stage: "" },
    result: null,
    error: null,
  });

  const cancel = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    runIdRef.current++; // invalidate any pending responses
    setState((prev) => ({
      ...prev,
      status: "idle",
      progress: { percent: 0, stage: "" },
    }));
  }, []);

  /**
   * Run the engine inline on the main thread.
   * Used as fallback when the Web Worker fails to load (e.g., Turbopack dev).
   */
  const runInline = useCallback(
    (payload: WorkerRunMessage["payload"], currentRunId: number) => {
      // Use setTimeout to avoid blocking the React commit
      setTimeout(() => {
        if (runIdRef.current !== currentRunId) return;
        try {
          const input = mapPayloadToRunnerInput(payload);
          const result = runAnalysis(input, (progress) => {
            if (runIdRef.current !== currentRunId) return;
            setState((prev) => ({
              ...prev,
              progress: {
                percent: progress.payload.percent,
                stage: progress.payload.stage,
              },
            }));
          });

          if (runIdRef.current !== currentRunId) return;

          if (result.schemaVersion !== SCHEMA_VERSION) {
            setState({
              status: "error",
              progress: { percent: 0, stage: "" },
              result: null,
              error: `Unsupported schema version: ${result.schemaVersion} (expected ${SCHEMA_VERSION}).`,
            });
            return;
          }

          setState({
            status: "complete",
            progress: { percent: 100, stage: "Complete" },
            result: { ...result },
            error: null,
          });
        } catch (err) {
          if (runIdRef.current !== currentRunId) return;
          setState({
            status: "error",
            progress: { percent: 0, stage: "" },
            result: null,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }, 0);
    },
    []
  );

  const run = useCallback(
    (payload: WorkerRunMessage["payload"]) => {
      // Terminate previous worker if running
      workerRef.current?.terminate();

      const currentRunId = ++runIdRef.current; // [P2-F5] increment on every run

      setState({
        status: "running",
        progress: { percent: 0, stage: "Starting" },
        result: null,
        error: null,
      });

      // Try Web Worker first, fall back to inline if it fails to load
      let worker: Worker;
      try {
        worker = new Worker(
          new URL("../worker.ts", import.meta.url)
        );
      } catch {
        // Worker construction failed (e.g., Turbopack dev, CSP, unsupported)
        console.warn("[solar] Web Worker unavailable, running engine inline");
        runInline(payload, currentRunId);
        return;
      }
      workerRef.current = worker;

      worker.onmessage = (event: MessageEvent) => {
        // [P2-F5] Stale response guard — ignore if runId has changed
        if (runIdRef.current !== currentRunId) return;

        const msg = event.data;
        if (!msg || !msg.type) return;

        switch (msg.type) {
          case "SIMULATION_PROGRESS": {
            const progress = (msg as WorkerProgressMessage).payload;
            setState((prev) => ({
              ...prev,
              progress: {
                percent: progress.percent,
                stage: progress.stage,
              },
            }));
            break;
          }

          case "SIMULATION_RESULT": {
            const result = (msg as WorkerResultMessage).payload;

            // [P2-F4] Schema version validation — reject unknown versions
            if (result.schemaVersion !== SCHEMA_VERSION) {
              setState({
                status: "error",
                progress: { percent: 0, stage: "" },
                result: null,
                error: `Unsupported schema version: ${result.schemaVersion} (expected ${SCHEMA_VERSION}). Please update the application.`,
              });
              worker.terminate();
              workerRef.current = null;
              return;
            }

            setState({
              status: "complete",
              progress: { percent: 100, stage: "Complete" },
              result,
              error: null,
            });
            worker.terminate();
            workerRef.current = null;
            break;
          }

          case "SIMULATION_ERROR": {
            const errorPayload = (msg as WorkerErrorMessage).payload;
            setState({
              status: "error",
              progress: { percent: 0, stage: "" },
              result: null,
              error: errorPayload.message,
            });
            worker.terminate();
            workerRef.current = null;
            break;
          }
        }
      };

      worker.onerror = (event) => {
        if (runIdRef.current !== currentRunId) return;
        // Worker loaded but crashed — fall back to inline
        console.warn("[solar] Worker error, falling back to inline:", event.message);
        worker.terminate();
        workerRef.current = null;
        runInline(payload, currentRunId);
      };

      // Send the run message
      worker.postMessage({
        type: "RUN_SIMULATION",
        payload,
      } satisfies WorkerRunMessage);
    },
    [runInline]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  return { state, run, cancel };
}
