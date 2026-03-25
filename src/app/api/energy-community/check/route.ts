import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/energy-community/check?zip=80203
 *
 * Checks whether a US zip code falls within an IRA Energy Community zone.
 * Queries two DOE/NETL ArcGIS feature layers:
 *   1. Coal Closure Energy Communities (census tract level)
 *   2. MSA/Non-MSA Statistical Area Energy Communities (county level)
 *
 * A location qualifies if it intersects EITHER layer.
 */

const COAL_CLOSURE_URL =
  "https://arcgis.netl.doe.gov/server/rest/services/Hosted/2024_Coal_Closure_Energy_Communities/FeatureServer/0/query";

const STATISTICAL_AREA_URL =
  "https://arcgis.netl.doe.gov/server/rest/services/Hosted/2024_MSAs_NonMSAs_that_are_Energy_Communities/FeatureServer/0/query";

// Zippopotam.us — free zip-to-centroid, no API key needed
const ZIP_API_URL = "https://api.zippopotam.us/us";

interface GeocodeResult {
  lat: number;
  lng: number;
  matchedAddress: string;
}

async function geocodeZip(zip: string): Promise<GeocodeResult | null> {
  const res = await fetch(`${ZIP_API_URL}/${zip}`, { next: { revalidate: 86400 } });
  if (!res.ok) return null;

  const data = await res.json();
  const place = data?.places?.[0];
  if (!place) return null;

  return {
    lat: parseFloat(place.latitude),
    lng: parseFloat(place.longitude),
    matchedAddress: `${place["place name"]}, ${place["state abbreviation"]} ${data["post code"]}`,
  };
}

interface EcLayerResult {
  hit: boolean;
  details?: string;
}

async function queryArcGISLayer(
  url: string,
  lat: number,
  lng: number,
  labelField: string,
): Promise<EcLayerResult> {
  const params = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: labelField,
    returnGeometry: "false",
    f: "json",
  });

  const res = await fetch(`${url}?${params}`, { next: { revalidate: 86400 } });
  if (!res.ok) return { hit: false };

  const data = await res.json();
  const features = data?.features;
  if (!features || features.length === 0) return { hit: false };

  return {
    hit: true,
    details: features[0]?.attributes?.[labelField] ?? "Qualified",
  };
}

export async function GET(req: NextRequest) {
  const zip = req.nextUrl.searchParams.get("zip")?.trim();

  if (!zip || !/^\d{5}$/.test(zip)) {
    return NextResponse.json({ error: "Provide a valid 5-digit US zip code" }, { status: 400 });
  }

  // Step 1: Geocode zip to lat/lng
  const geo = await geocodeZip(zip);
  if (!geo) {
    return NextResponse.json(
      { error: "Could not geocode zip code. Try a full address or different zip." },
      { status: 404 },
    );
  }

  // Step 2: Query both DOE layers in parallel
  const [coalResult, statResult] = await Promise.all([
    queryArcGISLayer(COAL_CLOSURE_URL, geo.lat, geo.lng, "label"),
    queryArcGISLayer(STATISTICAL_AREA_URL, geo.lat, geo.lng, "label_ec"),
  ]);

  const isEnergyCommunity = coalResult.hit || statResult.hit;

  return NextResponse.json({
    zip,
    matchedAddress: geo.matchedAddress,
    lat: geo.lat,
    lng: geo.lng,
    isEnergyCommunity,
    coalClosure: coalResult,
    statisticalArea: statResult,
  });
}
