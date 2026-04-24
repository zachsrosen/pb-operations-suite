"use client";

import { useState } from "react";
import { MARKER_COLORS, CREW_COLOR_WORKING, CREW_COLOR_IDLE } from "@/lib/map-colors";
import type { JobMarkerKind } from "@/lib/map-types";

interface MapLegendProps {
  enabledTypes: readonly JobMarkerKind[];
  scheduledCount: number;
  unscheduledCount: number;
  workingCrewCount: number;
}

const ROW_LABELS: Record<JobMarkerKind, string> = {
  install: "Install",
  service: "Service",
  inspection: "Inspection",
  survey: "Survey",
  dnr: "D&R",
  roofing: "Roofing",
};

export function MapLegend({
  enabledTypes,
  scheduledCount,
  unscheduledCount,
  workingCrewCount,
}: MapLegendProps) {
  const [open, setOpen] = useState(true);

  return (
    <div className="absolute bottom-4 left-4 z-10 bg-surface/95 backdrop-blur border border-t-border rounded-lg shadow-lg text-xs overflow-hidden max-w-[240px]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 border-b border-t-border hover:bg-surface-2"
      >
        <span className="font-semibold text-foreground">Legend</span>
        <span className="text-muted text-[10px]">
          {scheduledCount + unscheduledCount} marker{scheduledCount + unscheduledCount === 1 ? "" : "s"}
          {workingCrewCount > 0 && ` · ${workingCrewCount} crew`}
        </span>
        <span className="text-muted">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="p-3 space-y-2.5">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted mb-1.5 font-semibold">
              Status
            </div>
            <LegendRow
              swatch={
                <span
                  className="inline-block w-3.5 h-3.5 rounded-full"
                  style={{ background: MARKER_COLORS.install, border: "2px solid #0b1220" }}
                />
              }
              label="Scheduled"
              count={scheduledCount}
            />
            <LegendRow
              swatch={
                <span
                  className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full"
                  style={{
                    background: "white",
                    border: `2.5px solid ${MARKER_COLORS.install}`,
                  }}
                >
                  <span
                    className="w-1 h-1 rounded-full"
                    style={{ background: MARKER_COLORS.install }}
                  />
                </span>
              }
              label="Ready to schedule"
              count={unscheduledCount}
            />
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted mb-1.5 font-semibold">
              Work type
            </div>
            {enabledTypes.map((kind) => (
              <LegendRow
                key={kind}
                swatch={
                  <span
                    className="inline-block w-3 h-3 rounded-full"
                    style={{ background: MARKER_COLORS[kind] }}
                  />
                }
                label={ROW_LABELS[kind]}
              />
            ))}
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted mb-1.5 font-semibold">
              Crews
            </div>
            <LegendRow
              swatch={
                <span
                  className="inline-block w-3.5 h-3.5 rounded-sm"
                  style={{ background: CREW_COLOR_WORKING, border: "2px solid #0b1220" }}
                />
              }
              label="Working today"
            />
            <LegendRow
              swatch={
                <span
                  className="inline-block w-3.5 h-3.5 rounded-sm"
                  style={{ background: CREW_COLOR_IDLE, border: "2px solid #0b1220" }}
                />
              }
              label="At shop"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function LegendRow({
  swatch,
  label,
  count,
}: {
  swatch: React.ReactNode;
  label: string;
  count?: number;
}) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="flex-shrink-0 flex items-center justify-center w-4">{swatch}</span>
      <span className="text-foreground flex-1">{label}</span>
      {count != null && <span className="text-muted">{count}</span>}
    </div>
  );
}
