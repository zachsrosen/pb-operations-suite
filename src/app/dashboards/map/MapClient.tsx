"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useSSE } from "@/hooks/useSSE";
import type { MapMode, JobMarkerKind, MapMarkersResponse, JobMarker } from "@/lib/map-types";
import { FilterBar } from "./FilterBar";
import { DetailPanel } from "./DetailPanel";
import { JobMapCanvas } from "./JobMapCanvas";
import { JobMarkerTable } from "./JobMarkerTable";
import { MapLegend } from "./MapLegend";

const ALL_TYPES: JobMarkerKind[] = ["install", "service", "inspection", "survey", "dnr", "roofing"];
const PHASE_1_TYPES: JobMarkerKind[] = ["install", "service"];

interface MapClientProps {
  googleMapsApiKey: string | null;
}

export function MapClient({ googleMapsApiKey }: MapClientProps) {
  const [mode, setMode] = useState<MapMode>("today");
  const [enabledTypes, setEnabledTypes] = useState<JobMarkerKind[]>([...PHASE_1_TYPES]);
  const [selectedMarker, setSelectedMarker] = useState<JobMarker | null>(null);

  const typesKey = useMemo(() => enabledTypes.slice().sort().join(","), [enabledTypes]);

  const query = useQuery<MapMarkersResponse>({
    queryKey: queryKeys.map.markers(mode, enabledTypes),
    queryFn: async () => {
      const params = new URLSearchParams({ mode, types: typesKey });
      const res = await fetch(`/api/map/markers?${params}`);
      if (!res.ok) throw new Error("Failed to load markers");
      return res.json();
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  useSSE(() => query.refetch(), { cacheKeyFilter: "map" });

  const markers = query.data?.markers ?? [];
  const crews = query.data?.crews ?? [];
  const scheduledCount = markers.filter((m) => m.scheduled).length;
  const unscheduledCount = markers.length - scheduledCount;
  const workingCrewCount = crews.filter((c) => c.working).length;

  const onTypeToggle = (k: JobMarkerKind) => {
    setEnabledTypes((prev) =>
      prev.includes(k) ? prev.filter((t) => t !== k) : [...prev, k]
    );
  };

  const onMarkerClick = (m: JobMarker) => setSelectedMarker(m);
  const onClose = () => setSelectedMarker(null);

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      <FilterBar
        mode={mode}
        types={ALL_TYPES}
        enabledTypes={enabledTypes}
        onModeChange={setMode}
        onTypeToggle={onTypeToggle}
      />

      <div className="flex-1 relative">
        {query.isError ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="bg-surface-2 border border-t-border rounded-lg p-6 text-center max-w-sm">
              <div className="text-foreground font-semibold mb-1">Failed to load map data</div>
              <div className="text-xs text-muted mb-4">
                {query.error instanceof Error ? query.error.message : "Unknown error"}
              </div>
              <button
                onClick={() => query.refetch()}
                className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded text-sm font-semibold"
              >
                Retry
              </button>
            </div>
          </div>
        ) : googleMapsApiKey ? (
          <JobMapCanvas
            markers={markers}
            crews={crews}
            apiKey={googleMapsApiKey}
            onMarkerClick={onMarkerClick}
          />
        ) : (
          <JobMarkerTable markers={markers} onMarkerClick={onMarkerClick} />
        )}

        {!query.isError && query.data && (
          <MapLegend
            enabledTypes={enabledTypes}
            scheduledCount={scheduledCount}
            unscheduledCount={unscheduledCount}
            workingCrewCount={workingCrewCount}
          />
        )}

        {query.data?.droppedCount ? (
          <div className="absolute bottom-4 right-4 text-xs bg-surface-2 text-muted px-3 py-1.5 rounded border border-t-border z-10">
            {query.data.droppedCount} job{query.data.droppedCount === 1 ? "" : "s"} could not be placed
          </div>
        ) : null}

        {query.data?.partialFailures?.length ? (
          <div className="absolute top-2 left-2 text-xs bg-surface-2 text-yellow-400 px-3 py-1.5 rounded border border-yellow-600 z-10 max-w-sm">
            Partial data: {query.data.partialFailures.join("; ")}
          </div>
        ) : null}

        {selectedMarker && (
          <DetailPanel
            marker={selectedMarker}
            markers={markers}
            crews={crews}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}
