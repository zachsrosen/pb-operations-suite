// src/components/AutoReload.tsx

"use client";

import { useAutoReload } from "@/hooks/useAutoReload";

/**
 * Global auto-reload component — polls /api/health every 5 minutes and
 * reloads the page when a new deployment is detected. Drop into the root
 * layout so all pages on all devices pick up new code without a manual
 * browser refresh.
 */
export default function AutoReload() {
  useAutoReload({
    // Disable in dev to avoid annoying reloads during hot-reload
    enabled: process.env.NODE_ENV === "production",
  });
  return null;
}
