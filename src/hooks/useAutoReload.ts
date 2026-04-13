// src/hooks/useAutoReload.ts

/**
 * Polls /api/health for the current deployId and reloads the page
 * when a new deployment is detected.
 *
 * Reload strategy (visibility-aware):
 *   1. Tab is hidden when deploy detected → reload immediately (user
 *      isn't looking, no work to lose).
 *   2. Tab is visible → defer. Reload the next time the tab becomes
 *      hidden (user switched away, safe to reload in background).
 *   3. Tab stays visible for >10 minutes after detection → reload
 *      anyway. This covers unattended TV displays that never hide.
 *
 * This avoids interrupting users mid-form, mid-chat, or mid-upload
 * while still ensuring TVs and background tabs get fresh code quickly.
 */

import { useEffect, useRef } from "react";

/** Default: check every 5 minutes */
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

/**
 * If the tab has been continuously visible for this long after detecting
 * a new deploy, reload anyway (covers unattended TV kiosks).
 */
const UNATTENDED_TIMEOUT_MS = 10 * 60 * 1000;

interface Options {
  /** Polling interval in ms (default 5 min) */
  intervalMs?: number;
  /** Set false to disable (e.g. in dev) */
  enabled?: boolean;
}

export function useAutoReload(options: Options = {}) {
  const { intervalMs = DEFAULT_INTERVAL_MS, enabled = true } = options;
  const baselineRef = useRef<string | null>(null);
  const pendingReloadRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setInterval> | null = null;
    let unattendedTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    function doReload() {
      if (cancelled) return;
      window.location.reload();
    }

    function scheduleReload() {
      if (pendingReloadRef.current) return; // Already scheduled
      pendingReloadRef.current = true;

      // Stop polling — we've detected the new deploy
      if (timer) {
        clearInterval(timer);
        timer = null;
      }

      if (document.hidden) {
        // Tab is hidden right now — reload immediately
        doReload();
        return;
      }

      // Tab is visible — wait for it to become hidden (user switches away)
      const onVisibilityChange = () => {
        if (document.hidden && !cancelled) {
          document.removeEventListener("visibilitychange", onVisibilityChange);
          if (unattendedTimer) clearTimeout(unattendedTimer);
          doReload();
        }
      };
      document.addEventListener("visibilitychange", onVisibilityChange);

      // Fallback: if tab stays visible for 10 min (unattended TV), reload anyway
      unattendedTimer = setTimeout(() => {
        document.removeEventListener("visibilitychange", onVisibilityChange);
        doReload();
      }, UNATTENDED_TIMEOUT_MS);
    }

    async function check() {
      try {
        const res = await fetch("/api/health");
        if (!res.ok) return;
        const data = await res.json();
        const deployId = data.deployId as string | undefined;
        if (!deployId) return;

        if (baselineRef.current === null) {
          baselineRef.current = deployId;
          return;
        }

        if (deployId !== baselineRef.current && !cancelled) {
          console.warn(
            `[useAutoReload] New deploy detected (${baselineRef.current} → ${deployId})`
          );
          scheduleReload();
        }
      } catch {
        // Network error — ignore, will retry next interval
      }
    }

    // Initial check, then poll
    check();
    timer = setInterval(check, intervalMs);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      if (unattendedTimer) clearTimeout(unattendedTimer);
    };
  }, [intervalMs, enabled]);
}
