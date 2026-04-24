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
import { MARKER_COLORS, CREW_COLOR_WORKING, CREW_COLOR_IDLE } from "@/lib/map-colors";
import type { OfficeLocation } from "@/lib/map-offices";
import { haversineMiles } from "@/lib/map-proximity";

interface JobMapCanvasProps {
  markers: JobMarker[];
  crews: CrewPin[];
  apiKey: string;
  onMarkerClick: (marker: JobMarker) => void;
  defaultCenter?: { lat: number; lng: number };
  defaultZoom?: number;
  office?: OfficeLocation | null;
  nearRadiusMiles?: number;
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
  office,
  nearRadiusMiles = 15,
}: JobMapCanvasProps) {
  // When an office is set, center on it and zoom tighter so "nearby" is immediately visible.
  const center = office ? { lat: office.lat, lng: office.lng } : defaultCenter;
  const zoom = office ? 9 : defaultZoom;

  return (
    <APIProvider apiKey={apiKey}>
      <Map
        mapId="pb-jobs-map"
        defaultCenter={center}
        defaultZoom={zoom}
        gestureHandling="greedy"
        disableDefaultUI={false}
        className="w-full h-full"
      >
        <ClusteredMarkers
          markers={markers}
          onMarkerClick={onMarkerClick}
          office={office ?? null}
          nearRadiusMiles={nearRadiusMiles}
        />
        <CrewMarkers crews={crews} />
        {office && <OfficeMarker office={office} nearRadiusMiles={nearRadiusMiles} />}
      </Map>
    </APIProvider>
  );
}

/**
 * Big cyan building icon at the dispatcher's shop with a translucent
 * nearby-radius circle. The circle is imperative google.maps.Circle since
 * @vis.gl/react-google-maps doesn't expose a Circle component.
 */
function OfficeMarker({
  office,
  nearRadiusMiles,
}: {
  office: OfficeLocation;
  nearRadiusMiles: number;
}) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;
    const circle = new google.maps.Circle({
      map,
      center: { lat: office.lat, lng: office.lng },
      radius: nearRadiusMiles * 1609.34, // miles → meters
      strokeColor: CREW_COLOR_WORKING,
      strokeOpacity: 0.55,
      strokeWeight: 1.5,
      fillColor: CREW_COLOR_WORKING,
      fillOpacity: 0.06,
      clickable: false,
    });
    return () => {
      circle.setMap(null);
    };
  }, [map, office, nearRadiusMiles]);

  return (
    <AdvancedMarker
      position={{ lat: office.lat, lng: office.lng }}
      title={`${office.label} — your shop (${nearRadiusMiles} mi radius)`}
      zIndex={1000}
    >
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: 8,
          background: CREW_COLOR_WORKING,
          border: "3px solid #0b1220",
          boxShadow: "0 0 0 2px rgba(56,189,248,0.35), 0 4px 10px rgba(0,0,0,0.4)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 16,
          color: "white",
        }}
      >
        🏢
      </div>
    </AdvancedMarker>
  );
}

function ClusteredMarkers({
  markers,
  onMarkerClick,
  office,
  nearRadiusMiles,
}: {
  markers: JobMarker[];
  onMarkerClick: (m: JobMarker) => void;
  office: OfficeLocation | null;
  nearRadiusMiles: number;
}) {
  const map = useMap();
  const [, setVersion] = useState(0);

  // Split markers: scheduled-today markers ALWAYS render individually (never
  // cluster) so the dispatcher can see today's slate exactly. Everything else
  // (ready-to-schedule / backlog) still clusters to keep the map readable.
  const { scheduledToday, clusterable } = useMemo(() => {
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const scheduledToday: JobMarker[] = [];
    const clusterable: JobMarker[] = [];
    for (const m of markers) {
      if (m.scheduled && m.scheduledAt) {
        const at = new Date(m.scheduledAt);
        if (at >= dayStart && at < dayEnd) {
          scheduledToday.push(m);
          continue;
        }
      }
      clusterable.push(m);
    }
    return { scheduledToday, clusterable };
  }, [markers]);

  const supercluster = useMemo(() => {
    const sc = new Supercluster({ radius: 60, maxZoom: 13 });
    sc.load(
      clusterable.map((m) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [m.lng, m.lat] },
        properties: { marker: m },
      }))
    );
    return sc;
  }, [clusterable]);

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

  // Renderer shared between the cluster list and the scheduled-today list.
  const renderMarker = (marker: JobMarker) => renderSingleMarker(
    marker,
    office,
    nearRadiusMiles,
    onMarkerClick
  );

  return (
    <>
      {/* Scheduled-today pins — always rendered individually */}
      {scheduledToday.map(renderMarker)}

      {clusters.map((c) => {
        const [lng, lat] = c.geometry.coordinates;
        if (c.properties && "cluster" in c.properties && c.properties.cluster) {
          const count = c.properties.point_count as number;
          // Sample up to 3 markers inside the cluster to show a preview.
          const leaves = supercluster.getLeaves(c.id as number, 3) as unknown as Array<{
            properties: { marker: JobMarker };
          }>;
          return (
            <AdvancedMarker
              key={`cluster-${c.id}`}
              position={{ lat, lng }}
              onClick={() => {
                const expZoom = supercluster.getClusterExpansionZoom(c.id as number);
                map.setZoom(expZoom);
                map.panTo({ lat, lng });
              }}
              title={`${count} ready-to-schedule nearby — click to expand`}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "3px 8px 3px 5px",
                  borderRadius: 999,
                  background: "rgba(15,23,42,0.92)",
                  border: "1.5px solid rgba(148,163,184,0.55)",
                  gap: 4,
                  fontSize: 11,
                  color: "white",
                  fontWeight: 600,
                  boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
                }}
              >
                {leaves.slice(0, 3).map((l, i) => {
                  const m = l.properties.marker;
                  const c2 = MARKER_COLORS[m.kind];
                  return (
                    <span
                      key={i}
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        background: "white",
                        border: `2px solid ${c2}`,
                      }}
                    />
                  );
                })}
                <span style={{ marginLeft: 2 }}>{count}</span>
              </div>
            </AdvancedMarker>
          );
        }
        const marker = (c.properties as { marker: JobMarker }).marker;
        return renderMarker(marker);
      })}
    </>
  );
}

/**
 * Render a single JobMarker as an AdvancedMarker. Shared between the
 * scheduled-today pass (always-individual pins) and the cluster breakout
 * pass so the two kinds of pins always look identical.
 */
function renderSingleMarker(
  marker: JobMarker,
  office: OfficeLocation | null,
  nearRadiusMiles: number,
  onMarkerClick: (m: JobMarker) => void
) {
  const color = MARKER_COLORS[marker.kind];
  const nearOffice =
    !!office &&
    !marker.scheduled &&
    haversineMiles({ lat: office.lat, lng: office.lng }, { lat: marker.lat, lng: marker.lng }) <=
      nearRadiusMiles;
  const tooltipLines = [
    marker.title,
    marker.subtitle,
    marker.scheduled ? "Scheduled" : "Ready to schedule",
    `${marker.address.street}, ${marker.address.city}, ${marker.address.state} ${marker.address.zip}`,
    marker.status ? `Stage: ${marker.status}` : null,
    nearOffice ? `Near ${office?.label ?? "office"} (${nearRadiusMiles} mi)` : null,
  ].filter(Boolean);
  return (
    <AdvancedMarker
      key={marker.id}
      position={{ lat: marker.lat, lng: marker.lng }}
      onClick={() => onMarkerClick(marker)}
      title={tooltipLines.join("\n")}
    >
      {marker.scheduled ? (
        // Scheduled: solid filled circle with dark outline
        <div style={{
          width: 20, height: 20, borderRadius: "50%",
          background: color,
          border: "2px solid #0b1220",
          boxShadow: "0 0 0 1px rgba(255,255,255,0.25), 0 2px 4px rgba(0,0,0,0.3)",
        }} />
      ) : (
        // Ready to schedule: ring marker. Cyan halo + pulse when within
        // the office "nearby" radius.
        <div style={{
          width: nearOffice ? 26 : 22, height: nearOffice ? 26 : 22, borderRadius: "50%",
          background: "white",
          border: `3px solid ${color}`,
          boxShadow: nearOffice
            ? "0 0 0 4px rgba(56,189,248,0.35), 0 0 0 1px rgba(56,189,248,0.8), 0 2px 6px rgba(0,0,0,0.4)"
            : "0 2px 4px rgba(0,0,0,0.3)",
          animation: nearOffice ? "mapPulse 2s ease-in-out infinite" : undefined,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}>
          <div style={{
            width: 6, height: 6, borderRadius: "50%",
            background: color,
          }} />
        </div>
      )}
    </AdvancedMarker>
  );
}

function CrewMarkers({ crews }: { crews: CrewPin[] }) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <>
      {crews.map((c) => {
        if (c.currentLat == null || c.currentLng == null) return null;
        return (
          <AdvancedMarker
            key={`crew:${c.id}`}
            position={{ lat: c.currentLat, lng: c.currentLng }}
            title={`${c.name} — ${c.working ? `${c.routeStops.length} stops today` : "Off today"}`}
          >
            <div
              onMouseEnter={() => setHoveredId(c.id)}
              onMouseLeave={() => setHoveredId((prev) => (prev === c.id ? null : prev))}
              style={{
                width: 22, height: 22, borderRadius: 5,
                background: c.working ? CREW_COLOR_WORKING : CREW_COLOR_IDLE,
                border: "2px solid #0b1220",
                boxShadow: hoveredId === c.id ? "0 0 0 3px rgba(56,189,248,0.4)" : "0 2px 4px rgba(0,0,0,0.3)",
                transition: "box-shadow 120ms",
              }}
            />
          </AdvancedMarker>
        );
      })}
      {hoveredId && <CrewRouteLine crew={crews.find((c) => c.id === hoveredId) ?? null} />}
    </>
  );
}

/**
 * Draws a dashed polyline through a crew's scheduled stops for today.
 * Uses raw google.maps.Polyline because @vis.gl/react-google-maps does not
 * expose a polyline component.
 */
function CrewRouteLine({ crew }: { crew: CrewPin | null }) {
  const map = useMap();

  useEffect(() => {
    if (!map || !crew || crew.routeStops.length < 1 || crew.currentLat == null || crew.currentLng == null) {
      return;
    }
    const path: google.maps.LatLngLiteral[] = [
      { lat: crew.currentLat, lng: crew.currentLng },
      ...crew.routeStops.map((s) => ({ lat: s.lat, lng: s.lng })),
    ];
    const polyline = new google.maps.Polyline({
      map,
      path,
      strokeColor: CREW_COLOR_WORKING,
      strokeOpacity: 0,
      strokeWeight: 2,
      icons: [
        {
          icon: { path: "M 0,-1 0,1", strokeOpacity: 1, scale: 3 },
          offset: "0",
          repeat: "10px",
        },
      ],
    });
    return () => {
      polyline.setMap(null);
    };
  }, [map, crew]);

  return null;
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
