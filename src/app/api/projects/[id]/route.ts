import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { tagSentryRequest } from "@/lib/sentry-request";
import { requireApiAuth } from "@/lib/api-auth";
import { fetchProjectById, updateDealProperty } from "@/lib/hubspot";

export const runtime = "nodejs";

// Properties that can be updated from the dashboard UI
const WRITABLE_PROPERTIES = new Set([
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
    const { properties } = body as { properties?: Record<string, string | null> };

    if (!properties || typeof properties !== "object" || Object.keys(properties).length === 0) {
      return NextResponse.json({ error: "Missing or empty properties object" }, { status: 400 });
    }

    // Only allow whitelisted properties
    const disallowed = Object.keys(properties).filter((k) => !WRITABLE_PROPERTIES.has(k));
    if (disallowed.length > 0) {
      return NextResponse.json(
        { error: `Properties not allowed: ${disallowed.join(", ")}` },
        { status: 403 }
      );
    }

    const ok = await updateDealProperty(id, properties);
    if (!ok) {
      return NextResponse.json({ error: "HubSpot update failed" }, { status: 502 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating project:", error);
    Sentry.captureException(error);
    return NextResponse.json(
      { error: "Failed to update project" },
      { status: 500 }
    );
  }
}

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
