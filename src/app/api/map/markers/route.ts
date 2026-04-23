// src/app/api/map/markers/route.ts
import { NextRequest, NextResponse } from "next/server";
import { aggregateMapMarkers } from "@/lib/map-aggregator";
import { CacheStore } from "@/lib/cache";
import type { MapMode, JobMarkerKind, MapMarkersResponse } from "@/lib/map-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_MODES: MapMode[] = ["today", "week", "backlog"];
const VALID_KINDS: JobMarkerKind[] = [
  "install", "service", "inspection", "survey", "dnr", "roofing",
];

// Dedicated 60s cache for map markers (separate from appCache's 5min default)
const MAP_TTL_MS = 60 * 1000;
const MAP_STALE_TTL_MS = 5 * 60 * 1000;
const mapCache = new CacheStore(MAP_TTL_MS, MAP_STALE_TTL_MS);

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const mode = (url.searchParams.get("mode") ?? "today") as MapMode;
  const typesParam = url.searchParams.get("types") ?? "install,service";
  const includeUnplaced = url.searchParams.get("include") === "unplaced";

  if (!VALID_MODES.includes(mode)) {
    return NextResponse.json({ error: "invalid mode" }, { status: 400 });
  }

  const types = typesParam
    .split(",")
    .map((s) => s.trim())
    .filter((t): t is JobMarkerKind => VALID_KINDS.includes(t as JobMarkerKind));

  if (types.length === 0) {
    return NextResponse.json({ error: "at least one type required" }, { status: 400 });
  }

  const dateStr = url.searchParams.get("date");
  const date = dateStr ? new Date(dateStr) : new Date();

  // Debug variant bypasses cache
  if (includeUnplaced) {
    const result = await aggregateMapMarkers({ mode, types, date, includeUnplaced: true });
    return NextResponse.json(result, { headers: { "x-cache": "bypass" } });
  }

  const cacheKey = `map:markers:${mode}:${date.toISOString().slice(0, 10)}:${types.sort().join(",")}`;

  const { data, cached, stale } = await mapCache.getOrFetch<MapMarkersResponse>(
    cacheKey,
    () => aggregateMapMarkers({ mode, types, date })
  );

  return NextResponse.json(data, {
    headers: {
      "x-cache": cached ? (stale ? "stale" : "hit") : "miss",
    },
  });
}
