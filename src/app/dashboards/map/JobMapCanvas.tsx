"use client";

import { useMemo, useState, useCallback, useEffect } from "react";
import {
  APIProvider,
  Map,
  useMap,
  AdvancedMarker,
} from "@vis.gl/react-google-maps";
import Supercluster from "supercluster";
import type { JobMarker, CrewPin } from "@/lib/map-types";
import { MARKER_COLORS, CREW_COLOR_WORKING, CREW_COLOR_IDLE, CLUSTER_COLORS, CLUSTER_THRESHOLDS } from "@/lib/map-colors";

interface JobMapCanvasProps {
  markers: JobMarker[];
  crews: CrewPin[];
  apiKey: string;
  onMarkerClick: (marker: JobMarker) => void;
  defaultCenter?: { lat: number; lng: number };
  defaultZoom?: number;
}

const DEFAULT_CENTER = { lat: 39.6, lng: -105.3 }; // Rough Colorado center
const DEFAULT_ZOOM = 7;

export function JobMapCanvas({
  markers,
  crews,
  apiKey,
  onMarkerClick,
  defaultCenter = DEFAULT_CENTER,
  defaultZoom = DEFAULT_ZOOM,
}: JobMapCanvasProps) {
  return (
    <APIProvider apiKey={apiKey}>
      <Map
        mapId="pb-jobs-map"
        defaultCenter={defaultCenter}
        defaultZoom={defaultZoom}
        gestureHandling="greedy"
        disableDefaultUI={false}
        className="w-full h-full"
      >
        <ClusteredMarkers markers={markers} onMarkerClick={onMarkerClick} />
        <CrewMarkers crews={crews} />
      </Map>
    </APIProvider>
  );
}

function ClusteredMarkers({
  markers,
  onMarkerClick,
}: {
  markers: JobMarker[];
  onMarkerClick: (m: JobMarker) => void;
}) {
  const map = useMap();
  const [, setVersion] = useState(0);

  const supercluster = useMemo(() => {
    const sc = new Supercluster({ radius: 60, maxZoom: 13 });
    sc.load(
      markers.map((m) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [m.lng, m.lat] },
        properties: { marker: m },
      }))
    );
    return sc;
  }, [markers]);

  // Re-render on zoom/move — MUST come before any early return so hook order is stable
  const onChange = useCallback(() => setVersion((v) => v + 1), []);
  useMapEvent(map, "idle", onChange);

  if (!map) return null;
  const bounds = map.getBounds();
  if (!bounds) return null;
  const ne = bounds.getNorthEast();
  const sw = bounds.getSouthWest();
  const zoom = Math.round(map.getZoom() ?? DEFAULT_ZOOM);

  const clusters = supercluster.getClusters(
    [sw.lng(), sw.lat(), ne.lng(), ne.lat()],
    zoom
  );

  return (
    <>
      {clusters.map((c) => {
        const [lng, lat] = c.geometry.coordinates;
        if (c.properties && "cluster" in c.properties && c.properties.cluster) {
          const count = c.properties.point_count as number;
          const color =
            count >= CLUSTER_THRESHOLDS.large
              ? CLUSTER_COLORS.large
              : count >= CLUSTER_THRESHOLDS.medium
              ? CLUSTER_COLORS.medium
              : CLUSTER_COLORS.small;
          const size = count >= CLUSTER_THRESHOLDS.large ? 60 : count >= CLUSTER_THRESHOLDS.medium ? 52 : 44;
          return (
            <AdvancedMarker
              key={`cluster-${c.id}`}
              position={{ lat, lng }}
              onClick={() => {
                const expZoom = supercluster.getClusterExpansionZoom(c.id as number);
                map.setZoom(expZoom);
                map.panTo({ lat, lng });
              }}
            >
              <div style={{
                width: size, height: size, borderRadius: "50%",
                background: color, color: "white",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 700, border: "3px solid #0b1220",
              }}>
                {count}
              </div>
            </AdvancedMarker>
          );
        }
        const marker = (c.properties as { marker: JobMarker }).marker;
        const color = MARKER_COLORS[marker.kind];
        return (
          <AdvancedMarker
            key={marker.id}
            position={{ lat, lng }}
            onClick={() => onMarkerClick(marker)}
          >
            <div style={{
              width: 18, height: 18, borderRadius: "50%",
              background: marker.scheduled ? color : "transparent",
              border: `2px ${marker.scheduled ? "solid" : "dashed"} ${marker.scheduled ? "#0b1220" : color}`,
            }} />
          </AdvancedMarker>
        );
      })}
    </>
  );
}

function CrewMarkers({ crews }: { crews: CrewPin[] }) {
  return (
    <>
      {crews.map((c) => {
        if (c.currentLat == null || c.currentLng == null) return null;
        return (
          <AdvancedMarker
            key={`crew:${c.id}`}
            position={{ lat: c.currentLat, lng: c.currentLng }}
            title={c.name}
          >
            <div style={{
              width: 22, height: 22, borderRadius: 5,
              background: c.working ? CREW_COLOR_WORKING : CREW_COLOR_IDLE,
              border: "2px solid #0b1220",
            }} />
          </AdvancedMarker>
        );
      })}
    </>
  );
}

// Helper to subscribe to a google.maps.Map event — useEffect (NOT useMemo) so
// cleanup runs; otherwise listeners leak on every render.
function useMapEvent(map: google.maps.Map | null, event: string, handler: () => void) {
  useEffect(() => {
    if (!map) return;
    const l = map.addListener(event, handler);
    return () => l.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, event]);
}
