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
        {googleMapsApiKey ? (
          <JobMapCanvas
            markers={markers}
            crews={crews}
            apiKey={googleMapsApiKey}
            onMarkerClick={onMarkerClick}
          />
        ) : (
          <JobMarkerTable markers={markers} onMarkerClick={onMarkerClick} />
        )}

        {query.data?.droppedCount ? (
          <div className="absolute bottom-2 left-2 text-xs bg-surface-2 text-muted px-3 py-1.5 rounded border border-t-border">
            {query.data.droppedCount} job{query.data.droppedCount === 1 ? "" : "s"} could not be placed
          </div>
        ) : null}

        {query.data?.partialFailures?.length ? (
          <div className="absolute top-2 right-2 text-xs bg-surface-2 text-yellow-400 px-3 py-1.5 rounded border border-yellow-600">
            Partial data: {query.data.partialFailures.join("; ")}
          </div>
        ) : null}
      </div>

      {selectedMarker && (
        <DetailPanel
          marker={selectedMarker}
          markers={markers}
          crews={crews}
          onClose={onClose}
        />
      )}
    </div>
  );
}
