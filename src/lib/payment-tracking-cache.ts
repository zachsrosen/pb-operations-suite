/**
 * Singleton cache cascade listener for the accounting payment-tracking view.
 * Watches upstream `deals:*` invalidations and debounces invalidation of the
 * payment-tracking cache.
 *
 * Imported once at module scope by the API route; listener is process-local
 * and long-lived.
 */

import { appCache, CACHE_KEYS } from "@/lib/cache";

const DEBOUNCE_MS = 500;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let initialized = false;

export function initPaymentTrackingCascade(): void {
  if (initialized) return;
  initialized = true;

  appCache.subscribe((key: string, _timestamp: number) => {
    if (!key.startsWith("deals:")) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      appCache.invalidate(CACHE_KEYS.PAYMENT_TRACKING);
      debounceTimer = null;
    }, DEBOUNCE_MS);
  });
}
