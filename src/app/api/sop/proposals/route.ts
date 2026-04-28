import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma, getUserByEmail } from "@/lib/db";
import { sanitizeSopContent } from "@/lib/sop-sanitize";

const MAX_CONTENT_LENGTH = 500_000;
const MAX_TITLE_LENGTH = 200;
const MAX_REASON_LENGTH = 2_000;

/**
 * POST /api/sop/proposals
 *
 * Submit a proposal for a brand-new SOP section to be added to the guide.
 * Available to any authenticated user except VIEWER.
 *
 * Body: {
 *   title: string,
 *   suggestedTabId: string,
 *   suggestedGroup?: string,
 *   content: string (HTML, sanitized on submit),
 *   reason: string (why this matters)
 * }
 *
 * Distinct from /api/sop/sections/[id]/suggest, which proposes EDITS to
 * existing sections. This endpoint proposes the ADDITION of a new section.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    if (!prisma) {
      return NextResponse.json({ error: "Database not configured" }, { status: 503 });
    }

    const currentUser = await getUserByEmail(session.user.email);
    if (!currentUser) {
      return NextResponse.json({ error: "User not found" }, { status: 403 });
    }
    const primaryRole = currentUser.roles?.[0] ?? "VIEWER";
    if (primaryRole === "VIEWER") {
      return NextResponse.json(
        { error: "Viewers cannot submit SOP proposals" },
        { status: 403 },
      );
    }

    const body = await request.json();
    const { title, suggestedTabId, suggestedGroup, content, reason } = body;

    // ---- Validation -----------------------------------------------------
    if (!title || typeof title !== "string" || title.trim().length === 0) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }
    if (title.length > MAX_TITLE_LENGTH) {
      return NextResponse.json(
        { error: `Title exceeds ${MAX_TITLE_LENGTH} character limit` },
        { status: 400 },
      );
    }
    if (!suggestedTabId || typeof suggestedTabId !== "string") {
      return NextResponse.json(
        { error: "Suggested tab is required" },
        { status: 400 },
      );
    }
    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return NextResponse.json({ error: "Content is required" }, { status: 400 });
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      return NextResponse.json(
        { error: `Content exceeds ${MAX_CONTENT_LENGTH} character limit` },
        { status: 400 },
      );
    }
    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      return NextResponse.json(
        { error: "A reason ('why this matters') is required" },
        { status: 400 },
      );
    }
    if (reason.length > MAX_REASON_LENGTH) {
      return NextResponse.json(
        { error: `Reason exceeds ${MAX_REASON_LENGTH} character limit` },
        { status: 400 },
      );
    }

    // Validate the suggested tab actually exists in the guide.
    const tab = await prisma.sopTab.findUnique({
      where: { id: suggestedTabId },
      select: { id: true },
    });
    if (!tab) {
      return NextResponse.json(
        { error: `Unknown tab: ${suggestedTabId}` },
        { status: 400 },
      );
    }

    // ---- Sanitize content (defense-in-depth) ---------------------------
    const sanitized = sanitizeSopContent(content);

    // ---- Persist --------------------------------------------------------
    const proposal = await prisma.sopProposal.create({
      data: {
        submittedBy: currentUser.email,
        submittedByName: currentUser.name || null,
        title: title.trim(),
        suggestedTabId,
        suggestedGroup:
          typeof suggestedGroup === "string" && suggestedGroup.trim().length > 0
            ? suggestedGroup.trim()
            : null,
        content: sanitized,
        reason: reason.trim(),
      },
    });

    // TODO: send email notification to admins. Wired in a follow-up step.

    return NextResponse.json(
      { success: true, proposalId: proposal.id },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[sop/proposals] Submit failed:", error);
    return NextResponse.json(
      { error: "Failed to submit proposal" },
      { status: 500 },
    );
  }
}

/**
 * GET /api/sop/proposals
 *
 * Returns the current user's own proposals (so they can see status).
 * For admin review, see /api/admin/sop/proposals.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!prisma) {
      return NextResponse.json({ error: "Database not configured" }, { status: 503 });
    }

    const proposals = await prisma.sopProposal.findMany({
      where: { submittedBy: session.user.email },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        suggestedTabId: true,
        status: true,
        reviewerNotes: true,
        promotedSectionId: true,
        promotedSectionTab: true,
        createdAt: true,
        reviewedAt: true,
      },
    });

    return NextResponse.json(
      { proposals },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[sop/proposals] List own failed:", error);
    return NextResponse.json(
      { error: "Failed to fetch proposals" },
      { status: 500 },
    );
  }
}
