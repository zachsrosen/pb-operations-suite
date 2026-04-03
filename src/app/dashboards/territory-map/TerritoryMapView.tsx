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
// Cloud Map ID enables vector maps + AdvancedMarkerElement.
// Set NEXT_PUBLIC_GOOGLE_MAP_ID in env, or falls back to DEMO_MAP_ID for development.
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID || "DEMO_MAP_ID";

// Longitude bounds for boundary lines (covers most of Colorado Front Range)
const LNG_WEST = -105.8;
const LNG_EAST = -103.8;

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
        fillOpacity: 0.06,
        map,
        clickable: false,
      });
      overlaysRef.current.push(rect);
    }

    // Boundary lines (dashed)
    const lineLatitudes = [boundaries.westminster, boundaries.centennial];
    const lineColors = [
      locationColors.Centennial?.hex || "#10B981",
      locationColors["Colorado Springs"]?.hex || "#F59E0B",
    ];

    for (let i = 0; i < lineLatitudes.length; i++) {
      const line = new google.maps.Polyline({
        path: [
          { lat: lineLatitudes[i], lng: LNG_WEST },
          { lat: lineLatitudes[i], lng: LNG_EAST },
        ],
        strokeColor: lineColors[i],
        strokeOpacity: 0.8,
        strokeWeight: 2,
        icons: [
          {
            icon: { path: "M 0,-1 0,1", strokeOpacity: 1, scale: 3 },
            offset: "0",
            repeat: "15px",
          },
        ],
        map,
        clickable: false,
      });
      // Make the main stroke invisible — the icons create the dashed effect
      line.setOptions({ strokeOpacity: 0 });
      polylinesRef.current.push(line);
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
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const clustererRef = useRef<MarkerClusterer | null>(null);

  useEffect(() => {
    if (!map) return;

    // Clean up previous markers
    if (clustererRef.current) {
      clustererRef.current.clearMarkers();
    }
    markersRef.current.forEach((m) => (m.map = null));
    markersRef.current = [];

    const markers = deals.map((deal) => {
      const color = locationColors[deal.computedLocation]?.hex || "#71717A";

      // Create a small colored circle as the marker content
      const pin = document.createElement("div");
      pin.style.width = "10px";
      pin.style.height = "10px";
      pin.style.borderRadius = "50%";
      pin.style.backgroundColor = color;
      pin.style.border = "1.5px solid rgba(255,255,255,0.8)";
      pin.style.boxShadow = "0 1px 3px rgba(0,0,0,0.3)";
      pin.style.cursor = "pointer";

      const marker = new google.maps.marker.AdvancedMarkerElement({
        position: { lat: deal.latitude, lng: deal.longitude },
        map: null, // Clusterer will manage map assignment
        content: pin,
        title: deal.name,
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
      markersRef.current.forEach((m) => (m.map = null));
    };
  }, [map, deals, locationColors, onMarkerClick]);

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
          mapId={MAP_ID}
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
      </div>
    </div>
  );
}
