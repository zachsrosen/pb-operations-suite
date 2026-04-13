// src/hooks/useAutoReload.ts

/**
 * Polls /api/health for the current deployId and reloads the page
 * when a new deployment is detected. Designed for unattended TV
 * displays that never get manually refreshed.
 *
 * On first poll the hook captures the baseline deployId. Subsequent
 * polls compare against it — if the value changes, the page reloads
 * after a short grace period to let the new deployment stabilize.
 */

import { useEffect, useRef } from "react";

/** Default: check every 5 minutes */
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

/** Wait 10 s after detecting a new deploy before reloading */
const RELOAD_DELAY_MS = 10_000;

interface Options {
  /** Polling interval in ms (default 5 min) */
  intervalMs?: number;
  /** Set false to disable (e.g. in dev) */
  enabled?: boolean;
}

export function useAutoReload(options: Options = {}) {
  const { intervalMs = DEFAULT_INTERVAL_MS, enabled = true } = options;
  const baselineRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch("/api/health");
        if (!res.ok) return;
        const data = await res.json();
        const deployId = data.deployId as string | undefined;
        if (!deployId) return;

        if (baselineRef.current === null) {
          // First poll — capture baseline
          baselineRef.current = deployId;
          return;
        }

        if (deployId !== baselineRef.current && !cancelled) {
          // New deployment detected — reload after grace period
          console.warn(
            `[useAutoReload] New deploy detected (${baselineRef.current} → ${deployId}), reloading in ${RELOAD_DELAY_MS / 1000}s...`
          );
          setTimeout(() => {
            if (!cancelled) window.location.reload();
          }, RELOAD_DELAY_MS);
          // Stop polling once reload is scheduled
          if (timer) clearInterval(timer);
        }
      } catch {
        // Network error — ignore, will retry next interval
      }
    }

    // Initial check immediately
    check();
    timer = setInterval(check, intervalMs);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [intervalMs, enabled]);
}
