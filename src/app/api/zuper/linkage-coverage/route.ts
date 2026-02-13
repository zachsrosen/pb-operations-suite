import { NextResponse } from "next/server";
import { ZuperClient } from "@/lib/zuper";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { fetchAllProjects, type Project } from "@/lib/hubspot";
import { appCache, CACHE_KEYS } from "@/lib/cache";

/**
 * GET /api/zuper/linkage-coverage
 *
 * Reports on Zuper linkage coverage for active HubSpot projects.
 * Shows which projects have cached Zuper jobs and which don't,
 * broken down by job category.
 */
export async function GET() {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const zuper = new ZuperClient();

  if (!zuper.isConfigured()) {
    return NextResponse.json({
      configured: false,
      message: "Zuper is not configured",
    });
  }

  try {
    // 1. Get all active projects from HubSpot (uses cache if available)
    const cacheResult = appCache.get<Project[]>(CACHE_KEYS.PROJECTS_ACTIVE);
    const allProjects = cacheResult.hit && cacheResult.data ? cacheResult.data : await fetchAllProjects({ activeOnly: true });

    const projects = allProjects.map((p) => ({
      id: String(p.id),
      name: p.name,
      stage: p.stage,
      pbLocation: p.pbLocation || "Unknown",
      amount: p.amount,
    }));

    if (projects.length === 0) {
      return NextResponse.json({
        configured: true,
        totalProjects: 0,
        message: "No projects found",
      });
    }

    // 2. Check DB cache for all project IDs
    const projectIds = projects.map((p) => p.id);
    let cachedEntries: { hubspotDealId: string | null; jobUid: string; jobCategory: string }[] = [];

    if (prisma) {
      cachedEntries = await prisma.zuperJobCache.findMany({
        where: { hubspotDealId: { in: projectIds } },
        select: {
          hubspotDealId: true,
          jobUid: true,
          jobCategory: true,
        },
      });
    }

    // 3. Build coverage map
    const cachedByDealId = new Map<string, typeof cachedEntries[0][]>();
    for (const entry of cachedEntries) {
      if (!entry.hubspotDealId) continue;
      const existing = cachedByDealId.get(entry.hubspotDealId) || [];
      existing.push(entry);
      cachedByDealId.set(entry.hubspotDealId, existing);
    }

    // 4. Categorize projects
    const linked: typeof projects = [];
    const unlinked: typeof projects = [];
    const categoryCounts: Record<string, number> = {};

    for (const project of projects) {
      const entries = cachedByDealId.get(project.id);
      if (entries && entries.length > 0) {
        linked.push(project);
        for (const entry of entries) {
          if (entry.jobCategory) {
            categoryCounts[entry.jobCategory] = (categoryCounts[entry.jobCategory] || 0) + 1;
          }
        }
      } else {
        unlinked.push(project);
      }
    }

    // 5. Break down unlinked by stage and location
    const unlinkedByStage: Record<string, number> = {};
    const unlinkedByLocation: Record<string, number> = {};
    let unlinkedValue = 0;

    for (const p of unlinked) {
      unlinkedByStage[p.stage] = (unlinkedByStage[p.stage] || 0) + 1;
      unlinkedByLocation[p.pbLocation] = (unlinkedByLocation[p.pbLocation] || 0) + 1;
      unlinkedValue += p.amount;
    }

    // 6. Break down linked by stage
    const linkedByStage: Record<string, number> = {};
    let linkedValue = 0;

    for (const p of linked) {
      linkedByStage[p.stage] = (linkedByStage[p.stage] || 0) + 1;
      linkedValue += p.amount;
    }

    return NextResponse.json({
      configured: true,
      totalProjects: projects.length,
      linkedCount: linked.length,
      unlinkedCount: unlinked.length,
      coveragePercent: projects.length > 0 ? Math.round((linked.length / projects.length) * 100) : 0,
      linkedValue,
      unlinkedValue,
      categoryBreakdown: categoryCounts,
      linkedByStage,
      unlinkedByStage,
      unlinkedByLocation,
      unlinkedProjects: unlinked.slice(0, 50).map((p) => ({
        id: p.id,
        name: p.name,
        stage: p.stage,
        location: p.pbLocation,
        amount: p.amount,
      })),
    });
  } catch (error) {
    console.error("Zuper linkage coverage error:", error);
    return NextResponse.json(
      { error: "Failed to calculate linkage coverage", configured: true },
      { status: 500 }
    );
  }
}
