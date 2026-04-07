"use client";

import { useEffect, useState } from "react";
import { CAROUSEL_SECTIONS, SECTION_COLORS, type CarouselSection } from "@/lib/office-performance-types";

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
    <div className="flex items-center justify-between px-6 py-3 border-b border-white/10">
      <div className="flex items-center gap-3">
        <div
          className="w-2.5 h-2.5 rounded-full animate-pulse"
          style={{ backgroundColor: statusColor }}
        />
        <span className="text-lg font-bold tracking-wider text-slate-200 uppercase">
          {location}
        </span>
        {statusLabel && (
          <span className="text-xs text-yellow-500 ml-2">{statusLabel}</span>
        )}
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          {CAROUSEL_SECTIONS.map((section) => (
            <button
              key={section}
              onClick={() => onDotClick(section)}
              className="w-2 h-2 rounded-full transition-all duration-200 hover:scale-150"
              style={{
                backgroundColor:
                  section === currentSection
                    ? SECTION_COLORS[section]
                    : "rgba(255,255,255,0.2)",
              }}
              aria-label={`Go to ${section} section${isPinned && section === currentSection ? " (pinned)" : ""}`}
            />
          ))}
          {isPinned && (
            <span className="text-xs text-slate-500 ml-1">📌</span>
          )}
        </div>

        <span className="text-sm text-slate-400">
          {time.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}{" "}
          · {time.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          })}
        </span>
      </div>
    </div>
  );
}
