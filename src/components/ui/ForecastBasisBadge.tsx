"use client";

import { memo } from "react";
import type { ForecastBasis } from "@/lib/forecasting";

const BASIS_CONFIG: Record<
  ForecastBasis,
  { label: string; className: string; title: string }
> = {
  actual: {
    label: "Actual",
    className: "bg-green-500/20 text-green-400 border-green-500/30",
    title: "Date confirmed — milestone completed",
  },
  segment: {
    label: "Segment",
    className: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    title: "Forecast based on similar projects (same location, AHJ, utility)",
  },
  location: {
    label: "Location",
    className: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
    title: "Forecast based on projects in the same location",
  },
  global: {
    label: "Global",
    className: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    title: "Forecast based on all historical projects",
  },
  insufficient: {
    label: "No data",
    className: "bg-surface-2 text-muted border-border",
    title: "Insufficient historical data to forecast",
  },
};

interface ForecastBasisBadgeProps {
  basis: ForecastBasis | string;
  /** Compact mode: just the dot indicator, no label text */
  compact?: boolean;
}

/**
 * Badge showing the confidence basis of a forecast date.
 * Follows the existing badge pattern (px-2 py-1 rounded-full text-xs).
 */
export const ForecastBasisBadge = memo(function ForecastBasisBadge({
  basis,
  compact = false,
}: ForecastBasisBadgeProps) {
  const config = BASIS_CONFIG[basis as ForecastBasis] ?? BASIS_CONFIG.insufficient;

  if (compact) {
    return (
      <span
        className={`inline-block w-2 h-2 rounded-full ${config.className.split(" ")[0].replace("/20", "")}`}
        title={config.title}
      />
    );
  }

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${config.className}`}
      title={config.title}
    >
      {config.label}
    </span>
  );
});
