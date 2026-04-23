/**
 * GET /api/admin/workflows/hubspot-pipelines?objectType=deal|ticket
 *
 * Fetches HubSpot pipelines + stages for deals or tickets. Returns a
 * flattened option list suitable for a multiselect dropdown:
 *   { options: [{ value: stageId, label: "Pipeline: Stage", group: "Pipeline" }] }
 *
 * ADMIN only. Cached for 5 minutes via Vercel's fetch cache.
 */

import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";
import { isAdminWorkflowsEnabled } from "@/lib/inngest-client";

interface HubSpotPipeline {
  id: string;
  label: string;
  stages?: Array<{
    id: string;
    label: string;
    displayOrder?: number;
  }>;
}

interface HubSpotPipelinesResponse {
  results?: HubSpotPipeline[];
}

export async function GET(request: NextRequest) {
  if (!isAdminWorkflowsEnabled()) {
    return NextResponse.json({ error: "Feature disabled" }, { status: 503 });
  }
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const user = await getUserByEmail(session.user.email);
  if (!user?.roles.includes("ADMIN")) {
    return NextResponse.json({ error: "Admin required" }, { status: 403 });
  }

  const url = new URL(request.url);
  const objectType = url.searchParams.get("objectType") ?? "deal";
  if (!["deal", "ticket"].includes(objectType)) {
    return NextResponse.json(
      { error: "objectType must be 'deal' or 'ticket'" },
      { status: 400 },
    );
  }

  const accessToken = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!accessToken) {
    return NextResponse.json({ error: "HubSpot not configured" }, { status: 503 });
  }

  const res = await fetch(`https://api.hubapi.com/crm/v3/pipelines/${objectType}s`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    next: { revalidate: 300 }, // cache 5m
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return NextResponse.json(
      { error: `HubSpot pipelines fetch failed: ${res.status}`, detail: body.slice(0, 200) },
      { status: 502 },
    );
  }

  const data = (await res.json()) as HubSpotPipelinesResponse;
  const pipelines = data.results ?? [];

  const options: Array<{ value: string; label: string; group: string }> = [];
  for (const pipeline of pipelines) {
    const stages = pipeline.stages ?? [];
    // Sort by displayOrder where available
    stages.sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
    for (const stage of stages) {
      options.push({
        value: stage.id,
        label: stage.label,
        group: pipeline.label,
      });
    }
  }

  return NextResponse.json({ options });
}
