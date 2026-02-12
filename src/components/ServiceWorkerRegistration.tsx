"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Disable service worker caching to avoid stale app-route/navigation behavior.
    navigator.serviceWorker.getRegistrations()
      .then((registrations) => Promise.all(registrations.map((reg) => reg.unregister())))
      .catch(() => {
        // Best effort only.
      });

    if ("caches" in window) {
      caches.keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter((key) => key.startsWith("pb-ops-"))
              .map((key) => caches.delete(key))
          )
        )
        .catch(() => {
          // Best effort only.
        });
    }
  }, []);

  return null;
}
