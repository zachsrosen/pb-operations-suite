import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma, getUserByEmail } from "@/lib/db";
import { sanitizeSopContent } from "@/lib/sop-sanitize";

const MAX_CONTENT_LENGTH = 500_000;

/**
 * POST /api/sop/sections/[id]/suggest
 *
 * Submit a suggested change to an SOP section.
 * Available to any authenticated user except VIEWER.
 * Content is sanitized on submit (defense in depth).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    if (!prisma) {
      return NextResponse.json(
        { error: "Database not configured" },
        { status: 503 }
      );
    }

    const currentUser = await getUserByEmail(session.user.email);
    if (!currentUser) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 403 }
      );
    }
    if (currentUser.role === "VIEWER") {
      return NextResponse.json(
        { error: "Viewers cannot submit suggestions" },
        { status: 403 }
      );
    }

    const { id: sectionId } = await params;
    const body = await request.json();
    const { content, summary } = body;

    // Validate
    if (!content || typeof content !== "string") {
      return NextResponse.json(
        { error: "Content is required" },
        { status: 400 }
      );
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      return NextResponse.json(
        { error: `Content exceeds ${MAX_CONTENT_LENGTH} character limit` },
        { status: 400 }
      );
    }
    if (!summary || typeof summary !== "string" || summary.trim().length === 0) {
      return NextResponse.json(
        { error: "Summary is required" },
        { status: 400 }
      );
    }

    // Read section to get current version for basedOnVersion
    const section = await prisma.sopSection.findUnique({
      where: { id: sectionId },
      select: { id: true, version: true },
    });

    if (!section) {
      return NextResponse.json(
        { error: "Section not found" },
        { status: 404 }
      );
    }

    // Sanitize content on submit (defense in depth)
    const sanitized = sanitizeSopContent(content);

    const suggestion = await prisma.sopSuggestion.create({
      data: {
        sectionId,
        content: sanitized,
        summary: summary.trim(),
        basedOnVersion: section.version,
        submittedBy: currentUser.email,
      },
    });

    return NextResponse.json(
      { success: true, suggestionId: suggestion.id },
      {
        status: 201,
        headers: { "Cache-Control": "no-store" },
      }
    );
  } catch (error) {
    console.error("[sop/suggest] Submit failed:", error);
    return NextResponse.json(
      { error: "Failed to submit suggestion" },
      { status: 500 }
    );
  }
}
