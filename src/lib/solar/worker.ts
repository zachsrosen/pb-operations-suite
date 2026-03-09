/**
 * Solar Engine — Web Worker Entry Point
 *
 * Next.js 16 Turbopack handles `new URL('./worker.ts', import.meta.url)`
 * natively, bundling this as a separate chunk.
 *
 * The worker receives RUN_SIMULATION messages, runs the analysis pipeline,
 * and posts back SIMULATION_PROGRESS / SIMULATION_RESULT / SIMULATION_ERROR.
 */

/// <reference lib="webworker" />

import { runAnalysis } from "./engine/runner";
import { mapPayloadToRunnerInput } from "./engine/payload-mapper";
import type { WorkerRunMessage, WorkerProgressMessage } from "./types";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.addEventListener("message", (event: MessageEvent) => {
  const msg = event.data;
  if (!msg || msg.type !== "RUN_SIMULATION") return;

  try {
    const payload = (msg as WorkerRunMessage).payload;

    // Map the loose WorkerRunMessage payload to typed RunnerInput
    const input = mapPayloadToRunnerInput(payload);

    const result = runAnalysis(input, (progress: WorkerProgressMessage) => {
      ctx.postMessage(progress);
    });

    ctx.postMessage({
      type: "SIMULATION_RESULT",
      payload: result,
    });
  } catch (err) {
    ctx.postMessage({
      type: "SIMULATION_ERROR",
      payload: {
        message: err instanceof Error ? err.message : String(err),
        code: "ENGINE_ERROR",
      },
    });
  }
});
