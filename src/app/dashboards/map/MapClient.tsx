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
import { MorningBriefing } from "./MorningBriefing";
import { OfficePicker } from "./OfficePicker";
import { downloadMarkersCsv } from "./exportMarkers";
import { useOfficePreferences } from "./useOfficePreferences";

const ALL_TYPES: JobMarkerKind[] = ["install", "service", "inspection", "survey", "dnr", "roofing"];
const DEFAULT_TYPES: JobMarkerKind[] = ["install", "service", "inspection", "survey", "dnr", "roofing"];

interface MapClientProps {
  googleMapsApiKey: string | null;
  userPbLocation?: string | null;
}

export function MapClient({ googleMapsApiKey, userPbLocation }: MapClientProps) {
  const [mode, setMode] = useState<MapMode>("today");
  const [enabledTypes, setEnabledTypes] = useState<JobMarkerKind[]>([...DEFAULT_TYPES]);
  const [enabledLocations, setEnabledLocations] = useState<string[]>([]);
  const [selectedMarker, setSelectedMarker] = useState<JobMarker | null>(null);
  const { office, radiusMiles, setOfficeId, setRadiusMiles } = useOfficePreferences(userPbLocation);
  const [officePickerOpenSignal, setOfficePickerOpenSignal] = useState(0);

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

  const rawMarkers = query.data?.markers ?? [];
  const crews = query.data?.crews ?? [];

  // Union of pbLocation values present in the current data (sorted).
  const availableLocations = useMemo(() => {
    const set = new Set<string>();
    for (const m of rawMarkers) if (m.pbLocation) set.add(m.pbLocation);
    return Array.from(set).sort();
  }, [rawMarkers]);

  // Apply location filter client-side (no refetch needed).
  const markers = useMemo(() => {
    if (enabledLocations.length === 0) return rawMarkers;
    const set = new Set(enabledLocations);
    return rawMarkers.filter((m) => !m.pbLocation || set.has(m.pbLocation));
  }, [rawMarkers, enabledLocations]);

  const scheduledCount = markers.filter((m) => m.scheduled).length;
  const unscheduledCount = markers.length - scheduledCount;
  const workingCrewCount = crews.filter((c) => c.working).length;

  const onTypeToggle = (k: JobMarkerKind) => {
    setEnabledTypes((prev) =>
      prev.includes(k) ? prev.filter((t) => t !== k) : [...prev, k]
    );
  };

  const onLocationToggle = (loc: string) => {
    setEnabledLocations((prev) =>
      prev.includes(loc) ? prev.filter((l) => l !== loc) : [...prev, loc]
    );
  };

  const onLocationsReset = () => setEnabledLocations([]);

  const onMarkerClick = (m: JobMarker) => setSelectedMarker(m);
  const onClose = () => setSelectedMarker(null);

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      <FilterBar
        mode={mode}
        types={ALL_TYPES}
        enabledTypes={enabledTypes}
        availableLocations={availableLocations}
        enabledLocations={enabledLocations}
        onModeChange={setMode}
        onTypeToggle={onTypeToggle}
        onLocationToggle={onLocationToggle}
        onLocationsReset={onLocationsReset}
        exportDisabled={markers.length === 0}
        onExport={() => downloadMarkersCsv(markers, `map-jobs-${mode}-${new Date().toISOString().slice(0, 10)}.csv`)}
      />

      {/* Office picker is a stand-alone row so it has its own dropdown layer. */}
      <div className="flex items-center gap-2 px-3 sm:px-4 py-1.5 border-b border-t-border bg-surface">
        <OfficePicker
          key={officePickerOpenSignal /* force-open via remount when briefing "Change" clicked */}
          office={office}
          radiusMiles={radiusMiles}
          onOfficeChange={setOfficeId}
          onRadiusChange={setRadiusMiles}
        />
        <span className="text-[10px] text-muted">
          {office ? `Viewing from ${office.label} · ${radiusMiles} mi radius` : "Set your office to highlight nearby ready work"}
        </span>
      </div>

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
            office={office}
            nearRadiusMiles={radiusMiles}
          />
        ) : (
          <JobMarkerTable markers={markers} onMarkerClick={onMarkerClick} />
        )}

        {office && !query.isError && query.data && mode === "today" && (
          <MorningBriefing
            office={office}
            markers={markers}
            radiusMiles={radiusMiles}
            onMarkerClick={onMarkerClick}
            onChangeOffice={() => setOfficePickerOpenSignal((n) => n + 1)}
          />
        )}

        {!query.isError && query.data && (
          <MapLegend
            enabledTypes={enabledTypes}
            scheduledCount={scheduledCount}
            unscheduledCount={unscheduledCount}
            workingCrewCount={workingCrewCount}
          />
        )}

        {!query.isError && !query.isLoading && query.data && markers.length === 0 && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-10">
            <div className="bg-surface/95 backdrop-blur border border-t-border rounded-lg px-5 py-4 text-center shadow-xl pointer-events-auto max-w-xs">
              <div className="text-foreground font-semibold mb-1">No jobs for this view</div>
              <div className="text-xs text-muted mb-3">
                {mode === "today" && "Nothing is scheduled or ready-to-schedule for today."}
                {mode === "week" && "No work in the next 7 days matches your filters."}
                {mode === "backlog" && "No pre-construction work in the backlog matches your filters."}
              </div>
              <div className="text-[10px] text-muted">Try toggling more work types or switch modes.</div>
            </div>
          </div>
        )}

        {query.data?.droppedCount ? (
          <div className="absolute top-2 right-2 text-xs bg-surface-2 text-muted px-3 py-1.5 rounded border border-t-border z-10">
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
