// src/components/AutoReload.tsx

"use client";

import { useCallback } from "react";
import { usePathname } from "next/navigation";
import { useAutoReload } from "@/hooks/useAutoReload";
import { useDeployRefreshStore } from "@/stores/deploy-refresh";

const AUTO_RELOAD_PATH_PREFIXES = ["/dashboards/office-performance"];

function canAutoReloadPath(pathname: string | null) {
  return AUTO_RELOAD_PATH_PREFIXES.some((prefix) => pathname?.startsWith(prefix));
}

/**
 * Global deploy update awareness.
 *
 * Read-only TV routes can still auto-reload in the background. Interactive
 * pages switch to a manual refresh banner so unsaved work is never discarded
 * just because the user checked another tab.
 */
export default function AutoReload() {
  const pathname = usePathname();
  const mode = canAutoReloadPath(pathname) ? "auto" : "manual";
  const isDirty = useDeployRefreshStore((state) => state.isDirty);
  const updateAvailable = useDeployRefreshStore((state) => state.updateAvailable);
  const setUpdateAvailable = useDeployRefreshStore(
    (state) => state.setUpdateAvailable
  );
  const handleUpdateAvailable = useCallback(() => {
    setUpdateAvailable(true);
  }, [setUpdateAvailable]);

  useAutoReload({
    enabled: process.env.NODE_ENV === "production",
    mode,
    isDirty,
    onUpdateAvailable: handleUpdateAvailable,
  });

  if (!updateAvailable || (mode === "auto" && !isDirty)) return null;

  return (
    <div className="fixed left-1/2 top-4 z-[10000] flex w-[min(92vw,40rem)] -translate-x-1/2 items-center justify-between gap-4 rounded-2xl border border-orange-500/30 bg-[#18120d]/95 px-4 py-3 text-white shadow-2xl backdrop-blur">
      <div className="min-w-0">
        <p className="text-sm font-semibold">A new version is available</p>
        <p className="text-xs text-orange-100/80">
          {isDirty
            ? "Finish saving your changes before refreshing."
            : "Refresh when you're ready to pick up the latest deploy."}
        </p>
      </div>
      <button
        type="button"
        onClick={() => window.location.reload()}
        disabled={isDirty}
        className="shrink-0 rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white transition hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Refresh now
      </button>
    </div>
  );
}
