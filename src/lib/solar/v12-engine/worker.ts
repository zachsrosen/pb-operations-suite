/**
 * Solar Designer V12 Engine — Web Worker Entry Point
 *
 * Wires the CoreRunner to the existing worker protocol.
 * ZERO DOM/browser API imports — runs in worker context.
 */
import { runCoreAnalysis } from './runner';
import type { CoreSolarDesignerInput } from './types';
import type {
  WorkerProgressMessage,
  WorkerResultMessage,
  WorkerErrorMessage,
} from '../types';

type PostMessageFn = (
  msg: WorkerResultMessage | WorkerProgressMessage | WorkerErrorMessage
) => void;

/**
 * Handle an incoming worker message.
 * Exported for testability — tests call this directly with a mock postMessage.
 */
export function handleWorkerMessage(
  msg: { type: string; payload: any },
  postMessage: PostMessageFn
): void {
  if (msg.type !== 'RUN_SIMULATION') return;

  try {
    const result = runCoreAnalysis(
      msg.payload as CoreSolarDesignerInput,
      (progress) => postMessage(progress)
    );
    postMessage({
      type: 'SIMULATION_RESULT',
      payload: result,
    } as unknown as WorkerResultMessage);
  } catch (err: any) {
    postMessage({
      type: 'SIMULATION_ERROR',
      payload: { message: err?.message || 'Unknown error' },
    });
  }
}

// Worker self-registration — only executes in actual worker context.
// In jsdom (Jest), self.onmessage assignment is harmless.
if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  self.onmessage = (e: MessageEvent) => {
    handleWorkerMessage(e.data, (msg) => self.postMessage(msg));
  };
}
