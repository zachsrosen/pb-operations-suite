"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import {
  CAROUSEL_SECTIONS,
  SECTION_COLORS,
  type CarouselSection,
  type OfficePerformanceData,
  type AllLocationsResponse,
} from "@/lib/office-performance-types";
import AmbientBackground from "./AmbientBackground";
import CarouselHeader from "./CarouselHeader";
import TeamResultsSection from "./TeamResultsSection";
import SurveysSection from "./SurveysSection";
import InstallsSection from "./InstallsSection";
import InspectionsSection from "./InspectionsSection";
import AllLocationsSection from "./AllLocationsSection";

const ROTATION_INTERVAL = 45_000;

interface OfficeCarouselProps {
  data: OfficePerformanceData;
  connected: boolean;
  reconnecting: boolean;
  stale: boolean;
}

type TransitionState = "idle" | "exit" | "enter";
type Direction = "forward" | "backward";

export default function OfficeCarousel({
  data,
  connected,
  reconnecting,
  stale,
}: OfficeCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [displayIndex, setDisplayIndex] = useState(0);
  const [isPinned, setIsPinned] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [transition, setTransition] = useState<TransitionState>("idle");
  const [direction, setDirection] = useState<Direction>("forward");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch all-locations data for the "allLocations" carousel slide
  const { data: allLocationsData } = useQuery({
    queryKey: queryKeys.officePerformance.location("all"),
    queryFn: async (): Promise<AllLocationsResponse> => {
      const res = await fetch("/api/office-performance/all?refresh=true");
      if (!res.ok) throw new Error("Failed to fetch all-locations data");
      return res.json();
    },
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  const currentSection = CAROUSEL_SECTIONS[displayIndex];
  const sectionColor = SECTION_COLORS[currentSection];

  // Transition orchestration — guard against overlapping transitions (P2-3)
  const transitionTo = useCallback((newIndex: number, dir: Direction) => {
    if (newIndex === displayIndex || transition !== "idle") return;
    setDirection(dir);
    setTransition("exit");
    setTimeout(() => {
      setDisplayIndex(newIndex);
      setCurrentIndex(newIndex);
      setTransition("enter");
      setTimeout(() => setTransition("idle"), 400);
    }, 300);
  }, [displayIndex, transition]);

  // Page Visibility API
  useEffect(() => {
    const handler = () => setIsVisible(!document.hidden);
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  // Auto-rotation
  useEffect(() => {
    if (isPinned || !isVisible) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      return;
    }

    intervalRef.current = setInterval(() => {
      const nextIndex = (currentIndex + 1) % CAROUSEL_SECTIONS.length;
      transitionTo(nextIndex, "forward");
    }, ROTATION_INTERVAL);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPinned, isVisible, currentIndex, transitionTo]);

  // Navigate to section via dots
  const goToSection = useCallback(
    (section: CarouselSection) => {
      const index = CAROUSEL_SECTIONS.indexOf(section);
      if (index === displayIndex) {
        setIsPinned((prev) => !prev);
      } else {
        const dir = index > displayIndex ? "forward" : "backward";
        transitionTo(index, dir);
        setIsPinned(true);
      }
    },
    [displayIndex, transitionTo]
  );

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        const next = (currentIndex + 1) % CAROUSEL_SECTIONS.length;
        transitionTo(next, "forward");
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        const prev = (currentIndex - 1 + CAROUSEL_SECTIONS.length) % CAROUSEL_SECTIONS.length;
        transitionTo(prev, "backward");
      } else if (e.key === " ") {
        e.preventDefault();
        setIsPinned((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [currentIndex, transitionTo]);

  const renderSection = () => {
    switch (currentSection) {
      case "teamResults":
        return <TeamResultsSection data={data.teamResults} />;
      case "surveys":
        return <SurveysSection data={data.surveys} />;
      case "installs":
        return <InstallsSection data={data.installs} />;
      case "inspections":
        return <InspectionsSection data={data.inspections} />;
      case "allLocations":
        if (!allLocationsData?.locations) {
          return (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                <div className="text-slate-400 text-sm">Loading all locations...</div>
              </div>
            </div>
          );
        }
        return <AllLocationsSection locations={allLocationsData.locations} />;
    }
  };

  // Transition styles
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

  return (
    <div className="h-screen w-screen flex flex-col relative" style={{
      fontFamily: "system-ui, sans-serif",
      color: "#e2e8f0",
    }}>
      <AmbientBackground sectionColor={sectionColor} />

      <div className="relative z-10 flex flex-col h-full">
        <CarouselHeader
          location={data.location}
          currentSection={currentSection}
          isPinned={isPinned}
          connected={connected}
          reconnecting={reconnecting}
          stale={stale}
          onDotClick={goToSection}
        />

        <div className="flex-1 min-h-0 overflow-hidden" style={getTransformStyle()}>
          {renderSection()}
        </div>
      </div>
    </div>
  );
}
