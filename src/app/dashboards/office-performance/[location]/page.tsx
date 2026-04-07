"use client";

import { use, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSSE } from "@/hooks/useSSE";
import { queryKeys } from "@/lib/query-keys";
import { LOCATION_SLUG_TO_CANONICAL } from "@/lib/locations";
import type { OfficePerformanceData } from "@/lib/office-performance-types";
import OfficeCarousel from "./OfficeCarousel";

/** The API route returns OfficePerformanceData + cache metadata */
interface OfficePerformanceApiResponse extends OfficePerformanceData {
  cached: boolean;
  stale: boolean;
  lastUpdated: string;
}

interface PageProps {
  params: Promise<{ location: string }>;
}

export default function OfficePerformancePage({ params }: PageProps) {
  const { location: slug } = use(params);
  const canonicalLocation = LOCATION_SLUG_TO_CANONICAL[slug];
  const previousDataRef = useRef<OfficePerformanceApiResponse | null>(null);

  const {
    data,
    error,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: queryKeys.officePerformance.location(slug),
    queryFn: async (): Promise<OfficePerformanceApiResponse> => {
      // Always pass refresh=true so polling bypasses the server's 5-min appCache.
      // Without this, the 2-min poll would return stale cached data for up to 5 min,
      // defeating the purpose of catching Zuper-only updates that don't emit SSE.
      const res = await fetch(`/api/office-performance/${slug}?refresh=true`);
      if (!res.ok) throw new Error("Failed to fetch office performance data");
      return res.json();
    },
    refetchInterval: 120_000, // Fallback polling every 2 minutes
    staleTime: 60_000,
  });

  // Store last good data for stale display on error
  useEffect(() => {
    if (data) previousDataRef.current = data;
  }, [data]);

  // Dual refresh strategy:
  // 1. SSE — useSSE listens for "projects" cache key changes (prefix match).
  //    When HubSpot deal/project data updates, the SSE server emits "projects:*"
  //    events, which match our filter and trigger refetch().
  // 2. React Query polling — refetchInterval: 120_000 (2 minutes) catches
  //    Zuper job completions and other changes that don't emit SSE events.
  //
  // The server-side appCache has a 5-min TTL. The 2-min client poll ensures
  // reasonably fresh data even without SSE triggers. SSE gives instant
  // updates for the project/pipeline data which changes most often.
  const { connected, reconnecting } = useSSE(() => refetch(), {
    url: "/api/stream",
    cacheKeyFilter: "projects",
  });

  // Unknown location
  if (!canonicalLocation) {
    return (
      <div className="h-screen w-screen flex items-center justify-center" style={{
        background: "linear-gradient(135deg, #1e293b, #0f172a)",
        color: "#e2e8f0",
        fontFamily: "system-ui, sans-serif",
      }}>
        <div className="text-center">
          <div className="text-2xl font-bold mb-2">Unknown Location</div>
          <div className="text-slate-400">&quot;{slug}&quot; is not a valid office location.</div>
        </div>
      </div>
    );
  }

  // Loading state
  if (isLoading && !previousDataRef.current) {
    return (
      <div className="h-screen w-screen flex items-center justify-center" style={{
        background: "linear-gradient(135deg, #1e293b, #0f172a)",
        color: "#e2e8f0",
        fontFamily: "system-ui, sans-serif",
      }}>
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <div className="text-lg font-semibold">{canonicalLocation}</div>
          <div className="text-slate-400 text-sm mt-1">Loading performance data...</div>
        </div>
      </div>
    );
  }

  // Use current data, or fall back to previous data on error.
  // isStale is true if: (1) the server says the cache entry is stale (stale-while-revalidate),
  // OR (2) we have no fresh data and are using the previous ref as a fallback.
  const displayData = data || previousDataRef.current;
  const isStale = (data?.stale === true) || (!data && !!previousDataRef.current);

  if (!displayData) {
    return (
      <div className="h-screen w-screen flex items-center justify-center" style={{
        background: "linear-gradient(135deg, #1e293b, #0f172a)",
        color: "#e2e8f0",
        fontFamily: "system-ui, sans-serif",
      }}>
        <div className="text-center">
          <div className="text-2xl font-bold mb-2">No Data Available</div>
          <div className="text-slate-400">Unable to load performance data for {canonicalLocation}.</div>
        </div>
      </div>
    );
  }

  return (
    <OfficeCarousel
      data={displayData}
      connected={connected}
      reconnecting={reconnecting}
      stale={isStale}
    />
  );
}
