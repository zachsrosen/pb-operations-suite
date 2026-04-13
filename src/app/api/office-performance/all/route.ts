import { NextRequest, NextResponse } from "next/server";
import { CANONICAL_LOCATIONS, CANONICAL_TO_LOCATION_SLUG } from "@/lib/locations";
import { getOfficePerformanceData } from "@/lib/office-performance";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import type {
  AllLocationsResponse,
  LocationOverview,
  OfficePerformanceData,
} from "@/lib/office-performance-types";

function stripToOverview(data: OfficePerformanceData): LocationOverview {
  const surveyCompliance = data.surveys.compliance;
  const installCompliance = data.installs.compliance;
  const inspectionCompliance = data.inspections.compliance;

  return {
    location: data.location,
    surveys: {
      completedMtd: data.surveys.completedMtd,
      avgDays: data.surveys.avgTurnaroundDays,
      scheduledThisWeek: data.surveys.scheduledThisWeek,
      onTimePercent: surveyCompliance?.onTimePercent ?? -1,
      grade: surveyCompliance?.aggregateGrade ?? "—",
      stuckCount: surveyCompliance?.stuckJobs.length ?? 0,
    },
    installs: {
      completedMtd: data.installs.completedMtd,
      avgDays: data.installs.avgDaysPerInstall,
      scheduledThisWeek: data.installs.scheduledThisWeek,
      onTimePercent: installCompliance?.onTimePercent ?? -1,
      grade: installCompliance?.aggregateGrade ?? "—",
      stuckCount: installCompliance?.stuckJobs.length ?? 0,
      kwInstalledMtd: data.installs.kwInstalledMtd,
    },
    inspections: {
      completedMtd: data.inspections.completedMtd,
      avgDays: data.inspections.avgCcToPtoDays,
      scheduledThisWeek: data.inspections.scheduledThisWeek,
      onTimePercent: inspectionCompliance?.onTimePercent ?? -1,
      grade: inspectionCompliance?.aggregateGrade ?? "—",
      stuckCount: inspectionCompliance?.stuckJobs.length ?? 0,
      firstPassRate: data.inspections.firstPassRate,
    },
  };
}

/**
 * Try to read per-location data from the existing appCache.
 * Each per-location TV page populates this cache via /api/office-performance/[location].
 * Returns null if the cache is empty (location page hasn't been loaded yet).
 */
function getFromPerLocationCache(canonicalLocation: string): OfficePerformanceData | null {
  const slug = CANONICAL_TO_LOCATION_SLUG[canonicalLocation as keyof typeof CANONICAL_TO_LOCATION_SLUG];
  if (!slug) return null;
  const cacheKey = CACHE_KEYS.OFFICE_PERFORMANCE(slug);
  const cached = appCache.get<OfficePerformanceData>(cacheKey);
  // Skip stale entries so the aggregate route honours the 2-minute TV polling cadence
  return (cached.hit && !cached.stale) ? cached.data : null;
}

export async function GET(request: NextRequest) {
  try {
    const forceRefresh = request.nextUrl.searchParams.get("refresh") === "true";
    const cacheKey = CACHE_KEYS.OFFICE_PERFORMANCE("all");

    const { data, cached, stale, lastUpdated } =
      await appCache.getOrFetch<AllLocationsResponse>(
        cacheKey,
        async () => {
          const locations: LocationOverview[] = [];

          // Try per-location caches first (instant — no API calls)
          const uncachedLocations: string[] = [];
          for (const loc of CANONICAL_LOCATIONS) {
            const cachedData = getFromPerLocationCache(loc);
            if (cachedData) {
              locations.push(stripToOverview(cachedData));
            } else {
              uncachedLocations.push(loc);
            }
          }

          // Fetch uncached locations sequentially to avoid rate-limit storms.
          // Parallel fetches for 5 locations = 5x HubSpot + 15x Zuper concurrent
          // API calls, which triggers 429s and causes multi-minute hangs.
          for (const loc of uncachedLocations) {
            try {
              const data = await getOfficePerformanceData(loc);
              locations.push(stripToOverview(data));
            } catch (err) {
              console.error(`[office-perf/all] Failed to fetch ${loc}:`, err);
            }
          }

          // Sort to match CANONICAL_LOCATIONS order
          const orderMap = new Map(
            (CANONICAL_LOCATIONS as readonly string[]).map((loc, i) => [loc, i])
          );
          locations.sort((a, b) => (orderMap.get(a.location) ?? 99) - (orderMap.get(b.location) ?? 99));

          return {
            locations,
            lastUpdated: new Date().toISOString(),
          };
        },
        forceRefresh
      );

    return NextResponse.json({ ...data, cached, stale, lastUpdated });
  } catch (error) {
    console.error("[office-perf/all] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch all-locations data" },
      { status: 500 }
    );
  }
}
