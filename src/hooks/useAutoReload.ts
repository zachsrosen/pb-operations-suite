// src/hooks/useAutoReload.ts

/**
 * Polls /api/health for the current deployId and reacts when a new deployment
 * is detected.
 *
 * Read-only TV routes can auto-reload with visibility/idle guards:
 *   1. Tab is hidden when deploy detected → reload immediately.
 *   2. Tab is visible → defer until the tab becomes hidden.
 *   3. Tab stays visible but user is idle for 10 min → reload.
 *
 * Interactive routes should use `mode: "manual"` so they only show a
 * "new version available" banner and never discard unsaved work.
 */

import { useEffect, useRef } from "react";

/** Default: check every 5 minutes */
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

/**
 * If the user has had zero interaction for this long after a deploy
 * is detected, treat the tab as unattended and reload.
 */
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

/** User-activity events that reset the idle timer */
const ACTIVITY_EVENTS: Array<keyof DocumentEventMap> = [
  "mousemove",
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
];

interface Options {
  /** Polling interval in ms (default 5 min) */
  intervalMs?: number;
  /** Set false to disable (e.g. in dev) */
  enabled?: boolean;
  /** Read-only TV routes can auto-reload; interactive routes should notify instead. */
  mode?: "auto" | "manual";
  /** Dirty pages should never auto-reload. */
  isDirty?: boolean;
  /** Called when a deploy is detected but the page should not auto-reload. */
  onUpdateAvailable?: () => void;
}

export function useAutoReload(options: Options = {}) {
  const {
    intervalMs = DEFAULT_INTERVAL_MS,
    enabled = true,
    mode = "auto",
    isDirty = false,
    onUpdateAvailable,
  } = options;
  const baselineRef = useRef<string | null>(null);
  const pendingReloadRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setInterval> | null = null;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    let visibilityHandler: (() => void) | null = null;
    let activityHandler: (() => void) | null = null;

    function cleanup() {
      if (visibilityHandler) {
        document.removeEventListener("visibilitychange", visibilityHandler);
        visibilityHandler = null;
      }
      if (activityHandler) {
        for (const evt of ACTIVITY_EVENTS) {
          document.removeEventListener(evt, activityHandler);
        }
        activityHandler = null;
      }
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
    }

    function doReload() {
      if (cancelled) return;
      cleanup();
      window.location.reload();
    }

    function startIdleTimer() {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        // User has been idle for the full duration — safe to reload
        doReload();
      }, IDLE_TIMEOUT_MS);
    }

    function notifyUpdateAvailable() {
      if (pendingReloadRef.current) return;
      pendingReloadRef.current = true;

      // Stop polling — we know there's a new deploy.
      if (timer) {
        clearInterval(timer);
        timer = null;
      }

      onUpdateAvailable?.();
    }

    function scheduleReload() {
      notifyUpdateAvailable();

      if (mode === "manual" || isDirty) {
        return;
      }

      // If the tab is already hidden, reload now
      if (document.hidden) {
        doReload();
        return;
      }

      // --- Tab is visible: set up two reload triggers ---

      // Trigger 1: tab becomes hidden (user switches away)
      visibilityHandler = () => {
        if (document.hidden && !cancelled) doReload();
      };
      document.addEventListener("visibilitychange", visibilityHandler);

      // Trigger 2: user goes idle for 10 min (unattended TV)
      // Any activity resets the timer, so active users are never interrupted.
      activityHandler = () => {
        startIdleTimer();
      };
      for (const evt of ACTIVITY_EVENTS) {
        document.addEventListener(evt, activityHandler, { passive: true });
      }
      startIdleTimer();
    }

    async function check() {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
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

    check();
    timer = setInterval(check, intervalMs);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      cleanup();
    };
  }, [enabled, intervalMs, isDirty, mode, onUpdateAvailable]);
}
