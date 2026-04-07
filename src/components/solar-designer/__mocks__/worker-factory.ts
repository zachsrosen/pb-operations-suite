/**
 * Jest manual mock for worker-factory.ts
 *
 * Avoids `import.meta.url` parse errors in the Jest (CJS) environment.
 * Tests that need to verify Worker behavior should use jest.mock() explicitly.
 */
export const createAnalysisWorker = jest.fn(() => {
  const worker = {
    postMessage: jest.fn(),
    terminate: jest.fn(),
    onmessage: null as ((e: MessageEvent) => void) | null,
    onerror: null as ((e: ErrorEvent) => void) | null,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  };
  return worker as unknown as Worker;
});
