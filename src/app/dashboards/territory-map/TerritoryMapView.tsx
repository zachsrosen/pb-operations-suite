"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { APIProvider, Map, useMap, InfoWindow } from "@vis.gl/react-google-maps";
import { MarkerClusterer } from "@googlemaps/markerclusterer";
import type { TerritoryDeal } from "./page";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface TerritoryMapViewProps {
  deals: (TerritoryDeal & { computedLocation: string })[];
  boundaries: { westminster: number; centennial: number };
  locationColors: Record<string, { tw: string; hex: string }>;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const COLORADO_CENTER = { lat: 39.5, lng: -104.8 };
const DEFAULT_ZOOM = 7;
const MAP_ID = "territory-map";

// Longitude bounds for boundary lines — extends west to include Breckenridge / Summit County
const LNG_WEST = -106.6;
const LNG_EAST = -103.8;

// Photon Brothers office locations
const OFFICES = [
  { name: "Westminster", lat: 39.8397, lng: -105.0353 },
  { name: "Centennial", lat: 39.5977, lng: -104.8722 },
  { name: "Colorado Springs", lat: 38.8609, lng: -104.7905 },
] as const;

/* ------------------------------------------------------------------ */
/*  Zone overlay component                                             */
/* ------------------------------------------------------------------ */

function ZoneOverlays({
  boundaries,
  locationColors,
}: {
  boundaries: { westminster: number; centennial: number };
  locationColors: Record<string, { tw: string; hex: string }>;
}) {
  const map = useMap(MAP_ID);
  const overlaysRef = useRef<google.maps.Rectangle[]>([]);
  const polylinesRef = useRef<google.maps.Polyline[]>([]);

  useEffect(() => {
    if (!map) return;

    // Clean up previous overlays
    overlaysRef.current.forEach((r) => r.setMap(null));
    polylinesRef.current.forEach((p) => p.setMap(null));
    overlaysRef.current = [];
    polylinesRef.current = [];

    const zones = [
      {
        name: "Westminster",
        north: 41.0,
        south: boundaries.westminster,
        color: locationColors.Westminster?.hex || "#3B82F6",
      },
      {
        name: "Centennial",
        north: boundaries.westminster,
        south: boundaries.centennial,
        color: locationColors.Centennial?.hex || "#10B981",
      },
      {
        name: "Colorado Springs",
        north: boundaries.centennial,
        south: 37.5,
        color: locationColors["Colorado Springs"]?.hex || "#F59E0B",
      },
    ];

    // Zone rectangles
    for (const zone of zones) {
      const rect = new google.maps.Rectangle({
        bounds: {
          north: zone.north,
          south: zone.south,
          east: LNG_EAST,
          west: LNG_WEST,
        },
        strokeColor: zone.color,
        strokeOpacity: 0.3,
        strokeWeight: 1,
        fillColor: zone.color,
        fillOpacity: 0.1,
        map,
        clickable: false,
      });
      overlaysRef.current.push(rect);
    }

    // Boundary lines — thick solid white + colored dashed overlay for visibility
    const lineLatitudes = [boundaries.westminster, boundaries.centennial];

    for (let i = 0; i < lineLatitudes.length; i++) {
      // Thick white underline for contrast
      const bgLine = new google.maps.Polyline({
        path: [
          { lat: lineLatitudes[i], lng: LNG_WEST },
          { lat: lineLatitudes[i], lng: LNG_EAST },
        ],
        strokeColor: "#ffffff",
        strokeOpacity: 0.85,
        strokeWeight: 4,
        map,
        clickable: false,
        zIndex: 10,
      });
      polylinesRef.current.push(bgLine);

      // Colored dashed line on top
      const dashLine = new google.maps.Polyline({
        path: [
          { lat: lineLatitudes[i], lng: LNG_WEST },
          { lat: lineLatitudes[i], lng: LNG_EAST },
        ],
        strokeColor: "#000000",
        strokeOpacity: 0,
        strokeWeight: 0,
        icons: [
          {
            icon: {
              path: "M 0,-1 0,1",
              strokeOpacity: 1,
              strokeColor: i === 0
                ? (locationColors.Westminster?.hex || "#3B82F6")
                : (locationColors["Colorado Springs"]?.hex || "#F59E0B"),
              strokeWeight: 3,
              scale: 4,
            },
            offset: "0",
            repeat: "12px",
          },
        ],
        map,
        clickable: false,
        zIndex: 11,
      });
      polylinesRef.current.push(dashLine);
    }

    return () => {
      overlaysRef.current.forEach((r) => r.setMap(null));
      polylinesRef.current.forEach((p) => p.setMap(null));
    };
  }, [map, boundaries, locationColors]);

  return null;
}

/* ------------------------------------------------------------------ */
/*  Marker layer with clustering                                       */
/* ------------------------------------------------------------------ */

function DealMarkers({
  deals,
  locationColors,
  onMarkerClick,
}: {
  deals: (TerritoryDeal & { computedLocation: string })[];
  locationColors: Record<string, { tw: string; hex: string }>;
  onMarkerClick: (deal: TerritoryDeal & { computedLocation: string }) => void;
}) {
  const map = useMap(MAP_ID);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const clustererRef = useRef<MarkerClusterer | null>(null);

  useEffect(() => {
    if (!map) return;

    // Clean up previous markers
    if (clustererRef.current) {
      clustererRef.current.clearMarkers();
    }
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    const markers = deals.map((deal) => {
      const color = locationColors[deal.computedLocation]?.hex || "#71717A";

      const marker = new google.maps.Marker({
        position: { lat: deal.latitude, lng: deal.longitude },
        title: deal.name,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          fillColor: color,
          fillOpacity: 0.9,
          strokeColor: "#fff",
          strokeWeight: 1.5,
          scale: 5,
        },
      });

      marker.addListener("click", () => onMarkerClick(deal));
      return marker;
    });

    markersRef.current = markers;

    // Set up clusterer
    if (!clustererRef.current) {
      clustererRef.current = new MarkerClusterer({
        map,
        markers,
      });
    } else {
      clustererRef.current.clearMarkers();
      clustererRef.current.addMarkers(markers);
    }

    return () => {
      if (clustererRef.current) {
        clustererRef.current.clearMarkers();
      }
      markersRef.current.forEach((m) => m.setMap(null));
    };
  }, [map, deals, locationColors, onMarkerClick]);

  return null;
}

/* ------------------------------------------------------------------ */
/*  Office location markers                                            */
/* ------------------------------------------------------------------ */

function OfficeMarkers({
  locationColors,
}: {
  locationColors: Record<string, { tw: string; hex: string }>;
}) {
  const map = useMap(MAP_ID);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const labelsRef = useRef<google.maps.InfoWindow[]>([]);

  useEffect(() => {
    if (!map) return;

    // Clean up
    markersRef.current.forEach((m) => m.setMap(null));
    labelsRef.current.forEach((l) => l.close());
    markersRef.current = [];
    labelsRef.current = [];

    for (const office of OFFICES) {
      const color = locationColors[office.name]?.hex || "#71717A";

      // Large star marker for the office
      const marker = new google.maps.Marker({
        position: { lat: office.lat, lng: office.lng },
        map,
        title: `PB ${office.name} Office`,
        icon: {
          path: "M 0,-8 2,-2.5 8,-2.5 3.5,1 5.5,7 0,3.5 -5.5,7 -3.5,1 -8,-2.5 -2,-2.5 Z",
          fillColor: color,
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2.5,
          scale: 2.2,
          anchor: new google.maps.Point(0, 0),
        },
        zIndex: 1000,
      });
      markersRef.current.push(marker);

      // Always-visible label
      const label = new google.maps.InfoWindow({
        content: `<div style="
          font-family: system-ui, sans-serif;
          font-size: 11px;
          font-weight: 700;
          color: ${color};
          background: rgba(0,0,0,0.75);
          padding: 3px 8px;
          border-radius: 4px;
          white-space: nowrap;
          text-shadow: 0 1px 2px rgba(0,0,0,0.5);
          letter-spacing: 0.02em;
        ">PB ${office.name}</div>`,
        position: { lat: office.lat + 0.06, lng: office.lng },
        disableAutoPan: true,
        pixelOffset: new google.maps.Size(0, -8),
      });
      label.open({ map });
      labelsRef.current.push(label);
    }

    return () => {
      markersRef.current.forEach((m) => m.setMap(null));
      labelsRef.current.forEach((l) => l.close());
    };
  }, [map, locationColors]);

  return null;
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function TerritoryMapView({
  deals,
  boundaries,
  locationColors,
}: TerritoryMapViewProps) {
  const [selectedDeal, setSelectedDeal] = useState<
    (TerritoryDeal & { computedLocation: string }) | null
  >(null);

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";

  const handleMarkerClick = useCallback(
    (deal: TerritoryDeal & { computedLocation: string }) => {
      setSelectedDeal(deal);
    },
    [],
  );

  if (!apiKey) {
    return (
      <div
        className="flex items-center justify-center bg-surface rounded-xl border border-t-border text-muted"
        style={{ height: "calc(100vh - 340px)" }}
      >
        <div className="text-center">
          <p className="font-medium text-foreground mb-1">Google Maps API key not configured</p>
          <p className="text-sm">Set <code className="text-xs bg-surface-2 px-1.5 py-0.5 rounded">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> in your environment.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative rounded-xl overflow-hidden border border-t-border" style={{ height: "calc(100vh - 340px)" }}>
      <APIProvider apiKey={apiKey}>
        <Map
          id={MAP_ID}
          defaultCenter={COLORADO_CENTER}
          defaultZoom={DEFAULT_ZOOM}
          gestureHandling="greedy"
          disableDefaultUI={false}
          zoomControl
          mapTypeControl
          streetViewControl={false}
          fullscreenControl
          style={{ width: "100%", height: "100%" }}
        >
          <ZoneOverlays
            boundaries={boundaries}
            locationColors={locationColors}
          />
          <OfficeMarkers locationColors={locationColors} />
          <DealMarkers
            deals={deals}
            locationColors={locationColors}
            onMarkerClick={handleMarkerClick}
          />
          {selectedDeal && (
            <InfoWindow
              position={{
                lat: selectedDeal.latitude,
                lng: selectedDeal.longitude,
              }}
              onCloseClick={() => setSelectedDeal(null)}
            >
              <div style={{ maxWidth: 280, fontFamily: "system-ui, sans-serif" }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6, color: "#1a1a2e" }}>
                  {selectedDeal.name}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <span
                    style={{
                      display: "inline-block",
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      backgroundColor:
                        locationColors[selectedDeal.computedLocation]?.hex || "#71717A",
                    }}
                  />
                  <span style={{ fontSize: 12, color: "#555" }}>
                    {selectedDeal.computedLocation}
                  </span>
                  {selectedDeal.amount > 0 && (
                    <>
                      <span style={{ color: "#ccc" }}>·</span>
                      <span style={{ fontSize: 12, color: "#555", fontWeight: 500 }}>
                        ${selectedDeal.amount.toLocaleString()}
                      </span>
                    </>
                  )}
                </div>
                <button
                  onClick={() => window.open(selectedDeal.url, "_blank")}
                  style={{
                    display: "inline-block",
                    padding: "5px 12px",
                    fontSize: 12,
                    fontWeight: 500,
                    color: "#fff",
                    backgroundColor: "#f97316",
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer",
                    marginTop: 2,
                  }}
                >
                  Open in HubSpot
                </button>
              </div>
            </InfoWindow>
          )}
        </Map>
      </APIProvider>

      {/* ---- Legend ---- */}
      <div className="absolute bottom-4 left-4 bg-black/70 backdrop-blur-sm rounded-lg px-3 py-2 flex gap-4 text-xs text-white pointer-events-none">
        {(["Westminster", "Centennial", "Colorado Springs"] as const).map((name) => (
          <span key={name} className="flex items-center gap-1.5">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ backgroundColor: locationColors[name]?.hex || "#71717A" }}
            />
            {name}
          </span>
        ))}
        <span className="flex items-center gap-1.5 border-l border-white/30 pl-3 ml-1">
          <span className="text-yellow-300 text-[10px] leading-none">&#9733;</span>
          Office
        </span>
      </div>
    </div>
  );
}
