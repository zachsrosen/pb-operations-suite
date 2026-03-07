"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useActivityTracking } from "@/hooks/useActivityTracking";

export default function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { status } = useSession();
  const { trackPageView } = useActivityTracking();
  const lastTrackedPath = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || status !== "authenticated") return;

    const qs = searchParams?.toString();
    const fullPath = qs ? `${pathname}?${qs}` : pathname;
    if (lastTrackedPath.current === fullPath) return;

    lastTrackedPath.current = fullPath;
    trackPageView(fullPath, typeof document !== "undefined" ? document.title : undefined);
  }, [pathname, searchParams, status, trackPageView]);

  return null;
}
