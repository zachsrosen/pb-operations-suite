// src/app/api/projects/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { tagSentryRequest } from "@/lib/sentry-request";
import { requireApiAuth } from "@/lib/api-auth";
import { fetchAllProjects, type Project } from "@/lib/hubspot";
import { appCache, CACHE_KEYS } from "@/lib/cache";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  tagSentryRequest(request);

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
  } catch (error) {
    console.error("Error fetching project:", error);
    Sentry.captureException(error);
    return NextResponse.json(
      { error: "Failed to fetch project" },
      { status: 500 }
    );
  }
}
