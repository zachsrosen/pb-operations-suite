// src/lib/map-colors.ts
import type { JobMarkerKind, CrewShopId } from "./map-types";

/**
 * Color palette for map markers. Google Maps JS API requires concrete color
 * strings — CSS variable tokens are not usable at the marker level. This file
 * is the single source of truth for the map color palette; do NOT inline these
 * hex values anywhere else.
 */
export const MARKER_COLORS: Record<JobMarkerKind, string> = {
  install: "#f97316",      // orange
  service: "#22c55e",      // green
  inspection: "#3b82f6",   // blue
  survey: "#a855f7",       // purple
  dnr: "#eab308",          // yellow
  roofing: "#ef4444",      // red
};

export const CREW_COLOR_WORKING = "#38bdf8";  // cyan
export const CREW_COLOR_IDLE = "#64748b";     // grey

export const CLUSTER_COLORS = {
  small: "rgba(249, 115, 22, 0.85)",   // 2–9
  medium: "rgba(249, 115, 22, 0.92)",  // 10–49
  large: "rgba(239, 68, 68, 0.92)",    // 50+
};

export const CLUSTER_THRESHOLDS = { medium: 10, large: 50 } as const;

export function markerFillStyle(
  kind: JobMarkerKind,
  scheduled: boolean
): { fillColor: string; strokeColor: string; fillOpacity: number; strokeWeight: number; strokeDashArray?: string } {
  const color = MARKER_COLORS[kind];
  if (scheduled) {
    return { fillColor: color, strokeColor: "#0b1220", fillOpacity: 1, strokeWeight: 2 };
  }
  return { fillColor: "transparent", strokeColor: color, fillOpacity: 0, strokeWeight: 2, strokeDashArray: "4 2" };
}

// Shop → hex for the idle home-shop pin hover label
export const SHOP_LABELS: Record<CrewShopId, string> = {
  dtc: "DTC",
  westy: "Westy",
  cosp: "COSP",
  ca: "CA (SLO/Camarillo)",
  camarillo: "Camarillo",
};
