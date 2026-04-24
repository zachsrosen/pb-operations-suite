"use client";

import { useState } from "react";
import type { JobMarker } from "@/lib/map-types";
import type { OfficeLocation } from "@/lib/map-offices";
import { nearbyMarkers } from "@/lib/map-proximity";
import { MARKER_COLORS } from "@/lib/map-colors";

interface MorningBriefingProps {
  office: OfficeLocation;
  markers: JobMarker[];
  radiusMiles: number;
  onMarkerClick: (m: JobMarker) => void;
  onChangeOffice: () => void;
}

/**
 * Top-of-map banner: "N ready-to-schedule jobs within X mi — closest is..."
 * Uses the existing Haversine proximity helper.
 */
export function MorningBriefing({
  office,
  markers,
  radiusMiles,
  onMarkerClick,
  onChangeOffice,
}: MorningBriefingProps) {
  const [collapsed, setCollapsed] = useState(false);

  const ready = nearbyMarkers(
    { lat: office.lat, lng: office.lng },
    markers.filter((m) => !m.scheduled),
    { maxMiles: radiusMiles, limit: 50 }
  );

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="absolute top-2 left-1/2 -translate-x-1/2 z-10 bg-surface/95 backdrop-blur border border-t-border rounded-full px-3 py-1 text-xs text-muted hover:text-foreground shadow-md"
      >
        {ready.length > 0 ? `${ready.length} ready nearby` : "No ready work nearby"} · Show briefing
      </button>
    );
  }

  return (
    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 bg-surface/95 backdrop-blur border border-t-border rounded-lg shadow-xl px-4 py-3 min-w-[320px] max-w-[min(540px,calc(100%-24px))]">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-8 h-8 rounded bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400 text-sm font-semibold">
          🏢
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-foreground font-semibold text-sm">{office.label}</span>
            <button
              onClick={onChangeOffice}
              className="text-[10px] text-muted hover:text-foreground underline decoration-dotted"
            >
              Change
            </button>
          </div>
          <div className="text-xs text-muted mt-0.5">
            {ready.length > 0 ? (
              <>
                <span className="text-foreground font-semibold">{ready.length}</span> ready-to-schedule job{ready.length === 1 ? "" : "s"} within {radiusMiles} mi
              </>
            ) : (
              <>No ready-to-schedule jobs within {radiusMiles} mi.</>
            )}
          </div>
          {ready.length > 0 && (
            <div className="mt-2 space-y-1 max-h-[160px] overflow-y-auto">
              {ready.slice(0, 6).map((m) => (
                <button
                  key={m.id}
                  onClick={() => onMarkerClick(m)}
                  className="w-full flex items-center gap-2 text-xs py-1 px-1.5 -mx-1.5 rounded hover:bg-surface-2"
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ background: "white", border: `2px solid ${MARKER_COLORS[m.kind]}` }}
                  />
                  <span className="text-foreground flex-1 text-left truncate">{m.title}</span>
                  <span className="text-blue-400 font-semibold">{m.distanceMiles.toFixed(1)} mi</span>
                </button>
              ))}
              {ready.length > 6 && (
                <div className="text-[10px] text-muted text-center pt-0.5">
                  +{ready.length - 6} more on the map
                </div>
              )}
            </div>
          )}
        </div>
        <button
          onClick={() => setCollapsed(true)}
          className="flex-shrink-0 text-muted hover:text-foreground"
          aria-label="Collapse briefing"
        >
          ×
        </button>
      </div>
    </div>
  );
}
