/**
 * safeWaitUntil — background execution that works on Vercel + local
 *
 * On Vercel: uses waitUntil() to keep the function alive after the response.
 * Locally/CI: falls back to fire-and-forget (non-durable — if the process
 * exits mid-review, the RUNNING row is cleaned up by stale recovery).
 */
export function safeWaitUntil(promise: Promise<void>) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { waitUntil } = require("@vercel/functions");
    waitUntil(promise);
  } catch {
    // Not on Vercel — run in background without waitUntil (non-durable)
    promise.catch((err) => console.error("[background] Error:", err));
  }
}
