"use client";

import { use, useCallback, useState, useEffect, useRef } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useSSE } from "@/hooks/useSSE";
import { queryKeys } from "@/lib/query-keys";
import { LOCATION_SLUG_TO_CANONICAL } from "@/lib/locations";
import type { OfficePerformanceData, AllLocationsResponse } from "@/lib/office-performance-types";
import OfficeCarousel from "./OfficeCarousel";
import AllLocationsSection from "./AllLocationsSection";
import AllLocationsGoalsSection from "./AllLocationsGoalsSection";
import AmbientBackground from "./AmbientBackground";
import type { AllGoalsPipelineResponse } from "@/app/api/office-performance/goals-pipeline/all/route";

/** The API route returns OfficePerformanceData + cache metadata */
interface OfficePerformanceApiResponse extends OfficePerformanceData {
  cached: boolean;
  stale: boolean;
  lastUpdated: string;
}

interface PageProps {
  params: Promise<{ location: string }>;
}

// ---------------------------------------------------------------------------
// All-locations carousel: 2 slides (overview + goals)
// ---------------------------------------------------------------------------

type AllSlide = "overview" | "goals";
const ALL_SLIDES: AllSlide[] = ["overview", "goals"];
const ALL_SLIDE_COLORS: Record<AllSlide, string> = {
  overview: "#a855f7",  // purple
  goals: "#eab308",     // yellow
};
const ALL_SLIDE_LABELS: Record<AllSlide, string> = {
  overview: "PERFORMANCE",
  goals: "COMPANY GOALS",
};
const ALL_ROTATION_INTERVAL = 45_000;

function AllLocationsOverviewPage() {
  const [currentSlide, setCurrentSlide] = useState<AllSlide>("overview");
  const [isPinned, setIsPinned] = useState(false);
  const [transition, setTransition] = useState<"idle" | "exit" | "enter">("idle");
  const [direction, setDirection] = useState<"forward" | "backward">("forward");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [time, setTime] = useState(new Date());

  // Clock
  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // All-locations overview data
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.officePerformance.location("all"),
    queryFn: async (): Promise<AllLocationsResponse> => {
      const res = await fetch("/api/office-performance/all?refresh=true");
      if (!res.ok) throw new Error("Failed to fetch all-locations data");
      return res.json();
    },
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  // Goals data
  const { data: goalsData } = useQuery({
    queryKey: queryKeys.goalsPipeline.location("all"),
    queryFn: async (): Promise<AllGoalsPipelineResponse> => {
      const res = await fetch("/api/office-performance/goals-pipeline/all?refresh=true");
      if (!res.ok) throw new Error("Failed to fetch goals data");
      return res.json();
    },
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  // Transition logic
  const transitionTo = useCallback((newSlide: AllSlide, dir: "forward" | "backward") => {
    if (newSlide === currentSlide || transition !== "idle") return;
    setDirection(dir);
    setTransition("exit");
    setTimeout(() => {
      setCurrentSlide(newSlide);
      setTransition("enter");
      setTimeout(() => setTransition("idle"), 400);
    }, 300);
  }, [currentSlide, transition]);

  // Auto-rotation
  useEffect(() => {
    if (isPinned) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      return;
    }

    intervalRef.current = setInterval(() => {
      const currentIdx = ALL_SLIDES.indexOf(currentSlide);
      const nextIdx = (currentIdx + 1) % ALL_SLIDES.length;
      transitionTo(ALL_SLIDES[nextIdx], "forward");
    }, ALL_ROTATION_INTERVAL);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPinned, currentSlide, transitionTo]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        const idx = ALL_SLIDES.indexOf(currentSlide);
        const next = ALL_SLIDES[(idx + 1) % ALL_SLIDES.length];
        transitionTo(next, "forward");
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        const idx = ALL_SLIDES.indexOf(currentSlide);
        const prev = ALL_SLIDES[(idx - 1 + ALL_SLIDES.length) % ALL_SLIDES.length];
        transitionTo(prev, "backward");
      } else if (e.key === " ") {
        e.preventDefault();
        setIsPinned((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [currentSlide, transitionTo]);

  // Loading
  if (isLoading || !data) {
    return (
      <div className="h-screen w-screen flex items-center justify-center" style={{
        background: "linear-gradient(135deg, #1e293b, #0f172a)",
        color: "#e2e8f0",
        fontFamily: "system-ui, sans-serif",
      }}>
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <div className="text-lg font-semibold">All Locations</div>
          <div className="text-slate-400 text-sm mt-1">Loading performance data...</div>
        </div>
      </div>
    );
  }

  const sectionColor = ALL_SLIDE_COLORS[currentSlide];

  const getTransformStyle = (): React.CSSProperties => {
    const offset = direction === "forward" ? 60 : -60;
    if (transition === "exit") {
      return {
        opacity: 0,
        transform: `translateX(${-offset}px)`,
        transition: "opacity 300ms ease, transform 300ms ease",
      };
    }
    if (transition === "enter") {
      return {
        opacity: 1,
        transform: "translateX(0)",
        transition: "opacity 400ms ease, transform 400ms ease",
      };
    }
    return { opacity: 1, transform: "translateX(0)" };
  };

  const renderSlide = () => {
    switch (currentSlide) {
      case "overview":
        return <AllLocationsSection locations={data.locations} />;
      case "goals":
        if (!goalsData) {
          return (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="w-8 h-8 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                <div className="text-slate-400 text-sm">Loading goals...</div>
              </div>
            </div>
          );
        }
        return (
          <AllLocationsGoalsSection
            goals={goalsData.goals}
            perLocation={goalsData.perLocation}
            month={goalsData.month}
            year={goalsData.year}
            dayOfMonth={goalsData.dayOfMonth}
            daysInMonth={goalsData.daysInMonth}
          />
        );
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col relative" style={{
      fontFamily: "system-ui, sans-serif",
      color: "#e2e8f0",
    }}>
      <AmbientBackground sectionColor={sectionColor} />

      <div className="relative z-10 flex flex-col h-full">
        {/* Header */}
        <div>
          <div className="flex items-center justify-between px-8 py-4">
            <div className="flex items-center gap-4">
              <div
                className="w-3 h-3 rounded-full"
                style={{
                  backgroundColor: "#22c55e",
                  boxShadow: "0 0 8px #22c55e",
                  animation: "pulse 2s ease-in-out infinite",
                }}
              />
              <span className="text-2xl font-bold tracking-wider text-white uppercase">
                ALL LOCATIONS
              </span>
              <span
                className="text-sm font-semibold tracking-widest uppercase transition-colors duration-1000"
                style={{ color: sectionColor }}
              >
                {ALL_SLIDE_LABELS[currentSlide]}
              </span>
            </div>

            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                {ALL_SLIDES.map((slide) => (
                  <button
                    key={slide}
                    onClick={() => {
                      if (slide === currentSlide) {
                        setIsPinned((prev) => !prev);
                      } else {
                        const dir = ALL_SLIDES.indexOf(slide) > ALL_SLIDES.indexOf(currentSlide)
                          ? "forward" : "backward";
                        transitionTo(slide, dir);
                        setIsPinned(true);
                      }
                    }}
                    className="transition-all duration-300"
                    style={{
                      width: slide === currentSlide ? 24 : 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: slide === currentSlide
                        ? ALL_SLIDE_COLORS[slide]
                        : "rgba(255,255,255,0.15)",
                      boxShadow: slide === currentSlide
                        ? `0 0 8px ${ALL_SLIDE_COLORS[slide]}40`
                        : "none",
                    }}
                    aria-label={`Go to ${slide} section`}
                  />
                ))}
                {isPinned && (
                  <span className="text-xs text-slate-500 ml-1.5">📌</span>
                )}
              </div>

              <span className="text-base text-slate-300 font-medium tabular-nums">
                {time.toLocaleDateString("en-US", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })}{" "}
                <span className="text-slate-500">·</span>{" "}
                {time.toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                  second: "2-digit",
                  hour12: true,
                })}
              </span>
            </div>
          </div>

          <div
            className="h-0.5 transition-colors duration-1000"
            style={{ backgroundColor: sectionColor }}
          />
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-hidden" style={getTransformStyle()}>
          {renderSlide()}
        </div>
      </div>
    </div>
  );
}

export default function OfficePerformancePage({ params }: PageProps) {
  const { location: slug } = use(params);
  const isAll = slug === "all";
  const canonicalLocation = isAll ? null : LOCATION_SLUG_TO_CANONICAL[slug];

  // Track whether we're showing fallback data from a previous successful fetch
  const [hadSuccessfulFetch, setHadSuccessfulFetch] = useState(false);

  // Per-location data query — disabled when slug is "all"
  const {
    data,
    isLoading,
    refetch,
    isPlaceholderData,
  } = useQuery({
    queryKey: queryKeys.officePerformance.location(slug),
    queryFn: async (): Promise<OfficePerformanceApiResponse> => {
      const res = await fetch(`/api/office-performance/${slug}?refresh=true`);
      if (!res.ok) throw new Error("Failed to fetch office performance data");
      const result = await res.json();
      setHadSuccessfulFetch(true);
      return result;
    },
    enabled: !isAll,
    refetchInterval: isAll ? false : 120_000,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  // Dual refresh strategy:
  // 1. SSE — listens for "projects" cache key changes and triggers refetch()
  // 2. React Query polling (above) — catches Zuper-only updates
  // When slug is "all", SSE still connects but refetch is a no-op since the query is disabled
  const { connected, reconnecting } = useSSE(useCallback(() => refetch(), [refetch]), {
    url: "/api/stream",
    cacheKeyFilter: "projects",
  });

  // "All locations" overview — standalone page, no carousel
  if (isAll) {
    return <AllLocationsOverviewPage />;
  }

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
  if (isLoading && !hadSuccessfulFetch) {
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

  // isStale is true if: (1) the server says the cache entry is stale (stale-while-revalidate),
  // OR (2) we're showing placeholder data from a previous query while refetching.
  const isStale = (data?.stale === true) || isPlaceholderData;

  if (!data) {
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
      data={data}
      connected={connected}
      reconnecting={reconnecting}
      stale={isStale}
    />
  );
}
