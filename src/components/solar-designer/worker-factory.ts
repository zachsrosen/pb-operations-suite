/**
 * Solar Designer — Worker Factory
 *
 * Extracted so that tests can mock this module without hitting
 * the `import.meta.url` parse issue in the Jest (CJS) environment.
 * In the browser bundle, Next.js/Turbopack resolves the URL statically.
 */

export function createAnalysisWorker(): Worker {
  return new Worker(
    new URL('@/lib/solar/v12-engine/worker.ts', import.meta.url),
    { type: 'module' },
  );
}
