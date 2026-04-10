import { NextRequest, NextResponse } from "next/server";
import { CANONICAL_LOCATIONS } from "@/lib/locations";
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

export async function GET(request: NextRequest) {
  try {
    const forceRefresh = request.nextUrl.searchParams.get("refresh") === "true";

    // Use CACHE_KEYS.OFFICE_PERFORMANCE("all") — same pattern as per-location routes
    const cacheKey = CACHE_KEYS.OFFICE_PERFORMANCE("all");

    const { data, cached, stale, lastUpdated } =
      await appCache.getOrFetch<AllLocationsResponse>(
        cacheKey,
        async () => {
          // Fetch all locations in parallel
          const locationData = await Promise.all(
            CANONICAL_LOCATIONS.map((loc) =>
              getOfficePerformanceData(loc).catch((err) => {
                console.error(`[office-perf/all] Failed to fetch ${loc}:`, err);
                return null;
              })
            )
          );

          const locations: LocationOverview[] = locationData
            .filter((d): d is OfficePerformanceData => d !== null)
            .map(stripToOverview);

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
