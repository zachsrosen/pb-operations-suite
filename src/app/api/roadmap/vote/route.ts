import { NextResponse } from "next/server";
import { prisma, logActivity } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";

// Inline validation for vote request
interface VoteRequest {
  itemId?: unknown;
}

function validateVoteRequest(data: unknown): data is { itemId: string } {
  if (!data || typeof data !== "object") return false;
  const req = data as VoteRequest;

  return typeof req.itemId === "string" && req.itemId.length > 0;
}

export async function POST(request: Request) {
  try {
    const authResult = await requireApiAuth();
    if (authResult instanceof NextResponse) return authResult;

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
    }

    // Validate request body
    if (!validateVoteRequest(body)) {
      return NextResponse.json({
        error: "Invalid request: itemId (string) is required",
      }, { status: 400 });
    }

    const { itemId } = body;

    if (!prisma) {
      // No database - return success anyway (vote tracked in localStorage)
      return NextResponse.json({
        success: true,
        item: { id: itemId, votes: 1 },
        note: "Vote tracked locally only",
      });
    }

    // Increment vote count in database
    const updated = await prisma.roadmapItem.update({
      where: { id: itemId },
      data: { votes: { increment: 1 } },
    });

    // Log the vote
    await logActivity({
      type: "FEATURE_USED",
      description: `Voted on roadmap item: ${updated.title || itemId}`,
      userEmail: authResult.email,
      userName: authResult.name,
      entityType: "roadmap_item",
      entityId: itemId,
      entityName: updated.title || undefined,
      ipAddress: authResult.ip,
      userAgent: authResult.userAgent,
    });

    return NextResponse.json({
      success: true,
      item: {
        id: updated.id,
        votes: updated.votes,
      },
    });
  } catch (error) {
    console.error("Failed to vote:", error);
    return NextResponse.json({ error: "Failed to vote" }, { status: 500 });
  }
}
