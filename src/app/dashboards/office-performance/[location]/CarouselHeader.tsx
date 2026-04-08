"use client";

import { useEffect, useState } from "react";
import { CAROUSEL_SECTIONS, SECTION_COLORS, SECTION_LABELS, type CarouselSection } from "@/lib/office-performance-types";

interface CarouselHeaderProps {
  location: string;
  currentSection: CarouselSection;
  isPinned: boolean;
  connected: boolean;
  reconnecting: boolean;
  stale: boolean;
  onDotClick: (section: CarouselSection) => void;
}

export default function CarouselHeader({
  location,
  currentSection,
  isPinned,
  connected,
  reconnecting,
  stale,
  onDotClick,
}: CarouselHeaderProps) {
  const [time, setTime] = useState(new Date());
  const sectionColor = SECTION_COLORS[currentSection];

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const statusColor = reconnecting
    ? "#eab308"
    : connected
      ? "#22c55e"
      : "#ef4444";

  const statusLabel = reconnecting
    ? "Reconnecting..."
    : stale
      ? "Data may be stale"
      : "";

  return (
    <div>
      <div className="flex items-center justify-between px-8 py-4">
        {/* Left: Location + status */}
        <div className="flex items-center gap-4">
          <div
            className="w-3 h-3 rounded-full"
            style={{
              backgroundColor: statusColor,
              boxShadow: `0 0 8px ${statusColor}`,
              animation: connected ? "pulse 2s ease-in-out infinite" : "none",
            }}
          />
          <span className="text-2xl font-bold tracking-wider text-white uppercase">
            {location}
          </span>
          <span
            className="text-sm font-semibold tracking-widest uppercase transition-colors duration-1000"
            style={{ color: sectionColor }}
          >
            {SECTION_LABELS[currentSection]}
          </span>
          {statusLabel && (
            <span className="text-xs text-yellow-500/80 ml-2">{statusLabel}</span>
          )}
        </div>

        {/* Right: Nav dots + clock */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            {CAROUSEL_SECTIONS.map((section) => (
              <button
                key={section}
                onClick={() => onDotClick(section)}
                className="transition-all duration-300"
                style={{
                  width: section === currentSection ? 24 : 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor:
                    section === currentSection
                      ? SECTION_COLORS[section]
                      : "rgba(255,255,255,0.15)",
                  boxShadow: section === currentSection ? `0 0 8px ${SECTION_COLORS[section]}40` : "none",
                }}
                aria-label={`Go to ${section} section${isPinned && section === currentSection ? " (pinned)" : ""}`}
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

      {/* Section color accent bar */}
      <div
        className="h-0.5 transition-colors duration-1000"
        style={{ backgroundColor: sectionColor }}
      />
    </div>
  );
}
