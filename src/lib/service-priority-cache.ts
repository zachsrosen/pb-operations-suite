/**
 * Singleton cache cascade listener for the service priority queue.
 *
 * Watches upstream cache keys (deals:service, and later service-tickets:*)
 * and debounces invalidation of the priority queue cache key.
 *
 * IMPORTANT: This module is imported once at the app level (e.g., in the
 * priority queue API route's module scope). The listener is process-local
 * and long-lived — it must NOT be created inside a request handler.
 */

import { appCache } from "@/lib/cache";

const QUEUE_CACHE_KEY = "service:priority-queue";
const DEBOUNCE_MS = 500;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let initialized = false;

/**
 * Initialize the cascade listener. Safe to call multiple times —
 * only registers the listener once.
 */
export function initPriorityQueueCascade(): void {
  if (initialized) return;
  initialized = true;

  // CacheListener signature is (key: string, timestamp: number) => void
  appCache.subscribe((key: string, _timestamp: number) => {
    // Phase 1: watch deals:service
    // Phase 2: will add service-tickets:* prefix check
    const isUpstream = key.startsWith("deals:service");

    if (!isUpstream) return;

    // Debounce: multiple upstream invalidations within 500ms
    // trigger a single queue rebuild
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      appCache.invalidate(QUEUE_CACHE_KEY);
      debounceTimer = null;
    }, DEBOUNCE_MS);
  });
}

export { QUEUE_CACHE_KEY };
