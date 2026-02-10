/**
 * Data Prefetching Utilities
 *
 * Prefetch data in the background when users hover over navigation links.
 * This warms the cache so the data is ready when they actually navigate.
 */

// Track what's been prefetched to avoid duplicate requests
const prefetchedUrls = new Set<string>();

/**
 * Prefetch an API endpoint's data in the background.
 * Uses low priority fetch to not interfere with current page operations.
 */
export async function prefetchData(url: string): Promise<void> {
  // Don't prefetch the same URL twice in a session
  if (prefetchedUrls.has(url)) return;

  prefetchedUrls.add(url);

  try {
    // Simple fetch to warm the cache
    const response = await fetch(url);

    // Just reading the response warms the cache
    if (response.ok) {
      // Read but don't parse - just warm the cache
      await response.text();
      console.debug(`[Prefetch] Warmed cache for: ${url}`);
    }
  } catch (error) {
    // Silently fail - prefetching is best-effort
    console.debug(`[Prefetch] Failed for ${url}:`, error);
  }
}

/**
 * Prefetch data for a specific dashboard context.
 * Call this on hover over navigation links.
 */
export function prefetchDashboard(dashboard: string): void {
  const apiMap: Record<string, string> = {
    "command-center": "/api/projects?context=executive",
    "scheduler": "/api/projects?context=scheduling",
    "site-survey-scheduler": "/api/projects?context=scheduling",
    "construction-scheduler": "/api/projects?context=scheduling",
    "inspection-scheduler": "/api/projects?context=scheduling",
    "optimizer": "/api/projects?context=scheduling",
    "pe": "/api/projects?context=pe",
    "executive": "/api/projects?context=executive",
    "construction": "/api/projects?context=executive",
    "permitting": "/api/projects?context=executive",
    "inspections": "/api/projects?context=executive",
    "interconnection": "/api/projects?context=executive",
    "incentives": "/api/projects?context=executive",
    "site-survey": "/api/projects?context=executive",
    "design": "/api/projects?context=executive",
    "at-risk": "/api/projects?context=at-risk",
    "locations": "/api/projects?context=executive",
    "timeline": "/api/projects?context=executive",
    "mobile": "/api/projects?context=executive",
    "sales": "/api/deals?pipeline=sales",
    "dnr": "/api/deals?pipeline=dnr",
    "service": "/api/deals?pipeline=service",
  };

  const apiUrl = apiMap[dashboard];
  if (apiUrl) {
    prefetchData(apiUrl);
  }
}

/**
 * React hook-friendly prefetch handler.
 * Returns event handlers for onMouseEnter/onFocus.
 */
export function getPrefetchHandlers(dashboard: string): {
  onMouseEnter: () => void;
  onFocus: () => void;
} {
  return {
    onMouseEnter: () => prefetchDashboard(dashboard),
    onFocus: () => prefetchDashboard(dashboard),
  };
}

/**
 * Clear prefetch tracking (useful for testing or session reset).
 */
export function clearPrefetchTracking(): void {
  prefetchedUrls.clear();
}
