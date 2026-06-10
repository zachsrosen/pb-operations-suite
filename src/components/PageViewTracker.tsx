"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useActivityTracking } from "@/hooks/useActivityTracking";

export default function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { status } = useSession();
  const { trackPageView, trackPageDwell } = useActivityTracking();
  const lastTrackedPath = useRef<string | null>(null);
  const currentPath = useRef<string | null>(null);
  const enteredAt = useRef<number>(0);

  // Page-view + dwell-on-navigation
  useEffect(() => {
    if (!pathname || status !== "authenticated") return;
    const qs = searchParams?.toString();
    const fullPath = qs ? `${pathname}?${qs}` : pathname;
    if (lastTrackedPath.current === fullPath) return;

    // emit dwell for the page we're leaving
    if (currentPath.current && enteredAt.current) {
      trackPageDwell(currentPath.current, performance.now() - enteredAt.current);
    }
    lastTrackedPath.current = fullPath;
    currentPath.current = pathname; // dwell keyed on pathname (no query) to match aggregation
    enteredAt.current = performance.now();
    trackPageView(fullPath, typeof document !== "undefined" ? document.title : undefined);
  }, [pathname, searchParams, status, trackPageView, trackPageDwell]);

  // Dwell-on-hide/close
  useEffect(() => {
    if (status !== "authenticated") return;
    const flush = () => {
      if (currentPath.current && enteredAt.current) {
        trackPageDwell(currentPath.current, performance.now() - enteredAt.current);
        enteredAt.current = performance.now(); // avoid double-counting if it returns
      }
    };
    const onVis = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", flush);
    };
  }, [status, trackPageDwell]);

  return null;
}
