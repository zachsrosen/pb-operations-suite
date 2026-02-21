// src/app/api/projects/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { fetchAllProjects, type Project } from "@/lib/hubspot";
import { appCache, CACHE_KEYS } from "@/lib/cache";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Missing deal id" }, { status: 400 });

  try {
    // Use cached project list — same as the main projects route (active-only default)
    const { data: projects } = await appCache.getOrFetch<Project[]>(
      CACHE_KEYS.PROJECTS_ACTIVE,
      () => fetchAllProjects({ activeOnly: true })
    );

    const project = (projects ?? []).find((p) => String(p.id) === id);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    return NextResponse.json({ project });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to fetch project" },
      { status: 500 }
    );
  }
}
