import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { tagSentryRequest } from "@/lib/sentry-request";
import {
  fetchAllProjects,
  calculateStats,
  filterProjectsForContext,
  type Project,
} from "@/lib/hubspot";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import { getDealSyncSource, formatStaleness, verifyShadow } from "@/lib/deal-sync";
import { dealToProject } from "@/lib/deal-reader";
import { prisma } from "@/lib/db";

function getHubSpotAuthStatus(error: unknown): number | null {
  const candidate = error as {
    code?: number | string;
    statusCode?: number | string;
    status?: number | string;
    response?: { status?: number | string; statusCode?: number | string };
  };

  const rawStatus =
    candidate?.statusCode ??
    candidate?.code ??
    candidate?.status ??
    candidate?.response?.statusCode ??
    candidate?.response?.status;

  const parsed = Number(rawStatus);
  if (Number.isFinite(parsed)) return parsed;
  return null;
}

function isHubSpotAuthError(error: unknown): boolean {
  const status = getHubSpotAuthStatus(error);
  if (status === 401 || status === 403) return true;

  const message = error instanceof Error ? error.message : String(error ?? "");
  const lowered = message.toLowerCase();
  return (
    lowered.includes("invalid_authentication") ||
    lowered.includes("authentication credentials not found") ||
    lowered.includes("oauth") ||
    lowered.includes("x-hubspot-auth-failure")
  );
}

export async function GET(request: NextRequest) {
  tagSentryRequest(request);
  try {
    // Optional Bearer token gate for external/machine-to-machine access.
    // Browser requests are authenticated by middleware (NextAuth session).
    const authHeader = request.headers.get("authorization");
    const expectedToken = process.env.API_SECRET_TOKEN;

    if (expectedToken && authHeader && authHeader !== `Bearer ${expectedToken}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // -----------------------------------------------------------------------
    // Feature-flag: local-DB path (deal-mirror)
    // -----------------------------------------------------------------------
    const syncSource = await getDealSyncSource("projects");

    if (syncSource === "local" || syncSource === "local-with-verify") {
      if (syncSource === "local-with-verify") {
        // Fire-and-forget background comparison — never blocks the response
        verifyShadow("projects", "PROJECT").catch(() => {});
      }

      const searchParams = request.nextUrl.searchParams;
      const location = searchParams.get("location");
      const locations = searchParams.get("locations");
      const stage = searchParams.get("stage");
      const search = searchParams.get("search");
      const context = searchParams.get("context") as
        | "scheduling" | "equipment" | "pe" | "executive" | "at-risk" | "all" | null;
      const activeOnly = searchParams.get("active") !== "false";
      const includeStats = searchParams.get("stats") === "true";
      const fieldsParam = searchParams.get("fields");
      const page = Math.max(1, parseInt(searchParams.get("page") || "1") || 1);
      const rawLimit = parseInt(searchParams.get("limit") || "0");
      const limit = rawLimit > 0 ? Math.min(200, rawLimit) : 0;
      const sortBy = searchParams.get("sort") || "priorityScore";
      const sortOrder = searchParams.get("order") === "asc" ? "asc" : "desc";

      // Query local Deal table (PROJECT pipeline only for /api/projects)
      const deals = await prisma.deal.findMany({
        where: { pipeline: "PROJECT" },
      });

      let projects: Project[] = deals.map(dealToProject);

      // Apply context filter
      if (context) {
        projects = filterProjectsForContext(projects, context);
      } else if (activeOnly) {
        projects = projects.filter((p) => p.isActive);
      }

      // Location filters
      if (locations) {
        const locSet = new Set(locations.split(",").map((l) => l.trim()));
        projects = projects.filter((p) => locSet.has(p.pbLocation));
      } else if (location) {
        projects = projects.filter((p) => p.pbLocation === location);
      }
      if (stage) {
        projects = projects.filter((p) => p.stage === stage);
      }

      // Text search
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

      // Stats before pagination
      const stats = includeStats ? calculateStats(projects) : undefined;
      const totalCount = projects.length;

      // Pagination
      let paginationMeta = null;
      if (limit > 0) {
        const offset = (page - 1) * limit;
        const totalPages = Math.ceil(totalCount / limit);
        projects = projects.slice(offset, offset + limit);
        paginationMeta = { page, limit, totalCount, totalPages, hasMore: page < totalPages };
      }

      // Field selection
      let outputProjects: unknown[] = projects;
      if (fieldsParam) {
        const fields = fieldsParam.split(",").map((f) => f.trim());
        outputProjects = projects.map((p) => {
          const slim: Record<string, unknown> = {};
          for (const f of fields) {
            if (f in p) slim[f] = p[f as keyof Project];
          }
          return slim;
        });
      }

      // Sync metadata
      const lastSyncLog = await prisma.dealSyncLog.findFirst({
        where: { source: { startsWith: "batch:PROJECT" }, status: "SUCCESS" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });

      const lastSyncedAt = lastSyncLog?.createdAt ?? new Date();

      return NextResponse.json({
        projects: outputProjects,
        count: outputProjects.length,
        totalCount,
        stats,
        pagination: paginationMeta,
        cached: false,
        stale: false,
        lastUpdated: lastSyncedAt.toISOString(),
        sync: {
          source: syncSource,
          lastSyncedAt: lastSyncedAt.toISOString(),
          staleness: formatStaleness(lastSyncedAt),
        },
      });
    }

    // -----------------------------------------------------------------------
    // Default path: HubSpot-sourced
    // -----------------------------------------------------------------------

    // Fail fast for local/dev misconfiguration so we avoid noisy upstream 401s.
    if (!process.env.HUBSPOT_ACCESS_TOKEN?.trim()) {
      return NextResponse.json(
        { error: "HubSpot integration is not configured (missing HUBSPOT_ACCESS_TOKEN)" },
        { status: 503 }
      );
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
    const fieldsParam = searchParams.get("fields"); // comma-separated field list for slim responses

    // Pagination parameters (limit=0 means no pagination - return all results)
    const page = Math.max(1, parseInt(searchParams.get("page") || "1") || 1);
    const rawLimit = parseInt(searchParams.get("limit") || "0");
    const limit = rawLimit > 0 ? Math.min(200, rawLimit) : 0;
    const sortBy = searchParams.get("sort") || "priorityScore";
    const sortOrder = searchParams.get("order") === "asc" ? "asc" : "desc";

    // Use separate cache keys for active vs all projects.
    // Default (active-only) path fetches ~700 deals with server-side stage
    // filtering — much faster than fetching all ~6,500 deals.
    const cacheKey = activeOnly ? CACHE_KEYS.PROJECTS_ACTIVE : CACHE_KEYS.PROJECTS_ALL;

    const { data: cachedProjects, cached, stale, lastUpdated } = await appCache.getOrFetch<Project[]>(
      cacheKey,
      () => fetchAllProjects({ activeOnly }),
      forceRefresh
    );

    let projects = cachedProjects || [];

    // Apply context filter first (if provided)
    if (context) {
      projects = filterProjectsForContext(projects, context);
    } else if (activeOnly) {
      // Safety net: ensure only active projects when activeOnly is true
      // (HubSpot-level filtering already excludes inactive stages, but this
      // guards against edge cases like unexpected stage IDs)
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

    // If specific fields requested, return slim project objects
    let outputProjects: unknown[] = projects;
    if (fieldsParam) {
      const fields = fieldsParam.split(",").map((f) => f.trim());
      outputProjects = projects.map((p) => {
        const slim: Record<string, unknown> = {};
        for (const f of fields) {
          if (f in p) slim[f] = p[f as keyof Project];
        }
        return slim;
      });
    }

    return NextResponse.json({
      projects: outputProjects,
      count: outputProjects.length,
      totalCount,
      stats,
      pagination: paginationMeta,
      cached,
      stale,
      lastUpdated,
    });
  } catch (error) {
    if (isHubSpotAuthError(error)) {
      const status = getHubSpotAuthStatus(error);
      const detail = status ? `HubSpot auth failed (status ${status})` : "HubSpot auth failed";
      console.warn(`[api/projects] ${detail}`);
      Sentry.captureMessage(`[api/projects] ${detail}`, "warning");
      return NextResponse.json(
        { error: "HubSpot authentication failed. Check HUBSPOT_ACCESS_TOKEN." },
        { status: 503 }
      );
    }

    console.error("Error fetching projects:", error);
    Sentry.captureException(error);
    return NextResponse.json(
      { error: "Failed to fetch projects" },
      { status: 500 }
    );
  }
}
