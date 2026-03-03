import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { tagSentryRequest } from "@/lib/sentry-request";
import { requireApiAuth } from "@/lib/api-auth";
import { fetchProjectById, updateDealProperty } from "@/lib/hubspot";

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
    const project = await fetchProjectById(id);
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

// Properties that can be updated via PATCH
const ALLOWED_PATCH_PROPERTIES = new Set([
  "system_performance_review",
]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  tagSentryRequest(request);

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Missing deal id" }, { status: 400 });

  try {
    const body = await request.json();
    const properties: Record<string, string> = body?.properties;
    if (!properties || typeof properties !== "object") {
      return NextResponse.json({ error: "Missing properties object" }, { status: 400 });
    }

    // Filter to only allowed properties
    const filtered: Record<string, string> = {};
    for (const [key, value] of Object.entries(properties)) {
      if (ALLOWED_PATCH_PROPERTIES.has(key)) {
        filtered[key] = String(value);
      }
    }

    if (Object.keys(filtered).length === 0) {
      return NextResponse.json({ error: "No allowed properties provided" }, { status: 400 });
    }

    const success = await updateDealProperty(id, filtered);
    if (!success) {
      return NextResponse.json({ error: "Failed to update deal in HubSpot" }, { status: 502 });
    }

    return NextResponse.json({ success: true, updated: Object.keys(filtered) });
  } catch (error) {
    console.error("Error updating project:", error);
    Sentry.captureException(error);
    return NextResponse.json(
      { error: "Failed to update project" },
      { status: 500 }
    );
  }
}
