import { NextRequest, NextResponse } from "next/server";
import { fetchAllProjects, calculateStats, type Project } from "@/lib/hubspot";
import { appCache, CACHE_KEYS } from "@/lib/cache";

export async function GET(request: NextRequest) {
  try {
    // Optional Bearer token gate for external/machine-to-machine access.
    // Browser requests are authenticated by middleware (NextAuth session).
    const authHeader = request.headers.get("authorization");
    const expectedToken = process.env.API_SECRET_TOKEN;

    if (expectedToken && authHeader && authHeader !== `Bearer ${expectedToken}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const forceRefresh = request.nextUrl.searchParams.get("refresh") === "true";

    // Reuse the shared projects cache - avoids duplicate HubSpot calls
    const { data: projects, cached, stale, lastUpdated } = await appCache.getOrFetch<Project[]>(
      CACHE_KEYS.PROJECTS_ALL,
      () => fetchAllProjects({ activeOnly: false }),
      forceRefresh
    );

    const stats = calculateStats(projects || []);

    return NextResponse.json({
      ...stats,
      cached,
      stale,
      lastUpdated,
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch stats" },
      { status: 500 }
    );
  }
}
