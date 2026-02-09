import { NextRequest, NextResponse } from "next/server";
import {
  fetchAllProjects,
  calculateStats,
  filterProjectsForContext,
  type Project,
} from "@/lib/hubspot";
import { appCache, CACHE_KEYS } from "@/lib/cache";

export async function GET(request: NextRequest) {
  try {
    // Check authentication
    const authHeader = request.headers.get("authorization");
    const expectedToken = process.env.API_SECRET_TOKEN;

    if (expectedToken && authHeader !== `Bearer ${expectedToken}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const location = searchParams.get("location");
    const locations = searchParams.get("locations"); // comma-separated multi-location filter
    const stage = searchParams.get("stage");
    const search = searchParams.get("search");
    const context = searchParams.get("context") as
      | "scheduling"
      | "equipment"
      | "pe"
      | "executive"
      | "at-risk"
      | "all"
      | null;
    const activeOnly = searchParams.get("active") !== "false";
    const includeStats = searchParams.get("stats") === "true";
    const forceRefresh = searchParams.get("refresh") === "true";

    // Pagination parameters (limit=0 means no pagination - return all results)
    const page = Math.max(1, parseInt(searchParams.get("page") || "1") || 1);
    const rawLimit = parseInt(searchParams.get("limit") || "0");
    const limit = rawLimit > 0 ? Math.min(200, rawLimit) : 0;
    const sortBy = searchParams.get("sort") || "priorityScore";
    const sortOrder = searchParams.get("order") === "asc" ? "asc" : "desc";

    // Use shared cache with stale-while-revalidate + request coalescing
    const { data: allProjects, cached, stale, lastUpdated } = await appCache.getOrFetch<Project[]>(
      CACHE_KEYS.PROJECTS_ALL,
      () => fetchAllProjects({ activeOnly: false }),
      forceRefresh
    );

    let projects = allProjects || [];

    // Apply context filter first (if provided)
    if (context) {
      projects = filterProjectsForContext(projects, context);
    } else if (activeOnly) {
      projects = projects.filter((p) => p.isActive);
    }

    // Apply additional filters
    if (locations) {
      const locSet = new Set(locations.split(",").map((l) => l.trim()));
      projects = projects.filter((p) => locSet.has(p.pbLocation));
    } else if (location) {
      projects = projects.filter((p) => p.pbLocation === location);
    }
    if (stage) {
      projects = projects.filter((p) => p.stage === stage);
    }

    // Text search across key fields
    if (search) {
      const q = search.toLowerCase();
      projects = projects.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.projectNumber.toLowerCase().includes(q) ||
          p.address.toLowerCase().includes(q) ||
          p.city.toLowerCase().includes(q) ||
          p.ahj.toLowerCase().includes(q) ||
          p.installCrew.toLowerCase().includes(q) ||
          p.projectManager.toLowerCase().includes(q)
      );
    }

    // Sort
    const sortKey = sortBy as keyof Project;
    projects = projects.sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortOrder === "desc" ? bVal - aVal : aVal - bVal;
      }
      const aStr = String(aVal ?? "");
      const bStr = String(bVal ?? "");
      return sortOrder === "desc" ? bStr.localeCompare(aStr) : aStr.localeCompare(bStr);
    });

    // Calculate stats BEFORE pagination (on full filtered set)
    const stats = includeStats ? calculateStats(projects) : undefined;
    const totalCount = projects.length;

    // Apply pagination (limit=0 means no pagination - return all for backwards compat)
    let paginationMeta = null;
    if (limit > 0) {
      const offset = (page - 1) * limit;
      const totalPages = Math.ceil(totalCount / limit);
      projects = projects.slice(offset, offset + limit);
      paginationMeta = {
        page,
        limit,
        totalCount,
        totalPages,
        hasMore: page < totalPages,
      };
    }

    return NextResponse.json({
      projects,
      count: projects.length,
      totalCount,
      stats,
      pagination: paginationMeta,
      cached,
      stale,
      lastUpdated,
    });
  } catch (error) {
    console.error("Error fetching projects:", error);
    return NextResponse.json(
      { error: "Failed to fetch projects", details: String(error) },
      { status: 500 }
    );
  }
}
