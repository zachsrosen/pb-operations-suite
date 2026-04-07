"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  CAROUSEL_SECTIONS,
  type CarouselSection,
  type OfficePerformanceData,
} from "@/lib/office-performance-types";
import CarouselHeader from "./CarouselHeader";
import PipelineSection from "./PipelineSection";
import SurveysSection from "./SurveysSection";
import InstallsSection from "./InstallsSection";
import InspectionsSection from "./InspectionsSection";

const ROTATION_INTERVAL = 45_000; // 45 seconds

interface OfficeCarouselProps {
  data: OfficePerformanceData;
  connected: boolean;
  reconnecting: boolean;
  stale: boolean;
}

export default function OfficeCarousel({
  data,
  connected,
  reconnecting,
  stale,
}: OfficeCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPinned, setIsPinned] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [fadeIn, setFadeIn] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const currentSection = CAROUSEL_SECTIONS[currentIndex];

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
      setFadeIn(false);
      setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % CAROUSEL_SECTIONS.length);
        setFadeIn(true);
      }, 300);
    }, ROTATION_INTERVAL);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPinned, isVisible]);

  // Navigate to section
  const goToSection = useCallback(
    (section: CarouselSection) => {
      const index = CAROUSEL_SECTIONS.indexOf(section);
      if (index === currentIndex) {
        setIsPinned((prev) => !prev);
      } else {
        setFadeIn(false);
        setTimeout(() => {
          setCurrentIndex(index);
          setIsPinned(true);
          setFadeIn(true);
        }, 300);
      }
    },
    [currentIndex]
  );

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        setFadeIn(false);
        setTimeout(() => {
          setCurrentIndex((prev) => (prev + 1) % CAROUSEL_SECTIONS.length);
          setFadeIn(true);
        }, 300);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        setFadeIn(false);
        setTimeout(() => {
          setCurrentIndex(
            (prev) =>
              (prev - 1 + CAROUSEL_SECTIONS.length) % CAROUSEL_SECTIONS.length
          );
          setFadeIn(true);
        }, 300);
      } else if (e.key === " ") {
        e.preventDefault();
        setIsPinned((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const renderSection = () => {
    switch (currentSection) {
      case "pipeline":
        return <PipelineSection data={data.pipeline} />;
      case "surveys":
        return <SurveysSection data={data.surveys} />;
      case "installs":
        return <InstallsSection data={data.installs} />;
      case "inspections":
        return <InspectionsSection data={data.inspections} />;
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col" style={{
      background: "linear-gradient(135deg, #1e293b, #0f172a)",
      fontFamily: "system-ui, sans-serif",
      color: "#e2e8f0",
    }}>
      <CarouselHeader
        location={data.location}
        currentSection={currentSection}
        isPinned={isPinned}
        connected={connected}
        reconnecting={reconnecting}
        stale={stale}
        onDotClick={goToSection}
      />

      <div
        className="flex-1 min-h-0 overflow-hidden transition-opacity duration-300"
        style={{ opacity: fadeIn ? 1 : 0 }}
      >
        {renderSection()}
      </div>
    </div>
  );
}
