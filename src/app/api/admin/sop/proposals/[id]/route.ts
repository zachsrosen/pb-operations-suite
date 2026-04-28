import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/auth";
import { prisma, getUserByEmail } from "@/lib/db";
import {
  logAdminActivity,
  extractRequestContext,
} from "@/lib/audit/admin-activity";
import { sanitizeSopContent } from "@/lib/sop-sanitize";
import type { UserRole } from "@/generated/prisma/enums";
import { ROLES } from "@/lib/roles";

/**
 * Build a stable, URL-safe section id from a title.
 * Mirrors the slug convention used elsewhere in the SOP guide
 * (kebab-case, lowercase, no special chars).
 */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Generate a unique section id by appending a numeric suffix if the
 * slug already collides with an existing section.
 */
async function pickUniqueSectionId(baseSlug: string, prismaClient: NonNullable<typeof prisma>): Promise<string> {
  let candidate = baseSlug;
  let attempt = 0;
  // Cap at 50 attempts as a sanity guard
  while (attempt < 50) {
    const existing = await prismaClient.sopSection.findUnique({
      where: { id: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
    attempt += 1;
    candidate = `${baseSlug}-${attempt + 1}`;
  }
  // Fallback — shouldn't happen
  return `${baseSlug}-${Date.now()}`;
}

/**
 * GET /api/admin/sop/proposals/[id]
 *
 * Full proposal detail including the proposed content body.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!prisma) {
      return NextResponse.json({ error: "Database not configured" }, { status: 503 });
    }

    const currentUser = await getUserByEmail(session.user.email);
    const rawRoles: UserRole[] =
      currentUser?.roles && currentUser.roles.length > 0 ? currentUser.roles : [];
    const normalizedRoles = rawRoles.map((r) => ROLES[r]?.normalizesTo ?? r);
    if (!normalizedRoles.some((r) => r === "ADMIN" || r === "EXECUTIVE")) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { id } = await params;

    const proposal = await prisma.sopProposal.findUnique({ where: { id } });
    if (!proposal) {
      return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
    }

    return NextResponse.json({ proposal });
  } catch (error) {
    console.error("[admin/sop/proposals/[id]] Get failed:", error);
    return NextResponse.json({ error: "Failed to load proposal" }, { status: 500 });
  }
}

/**
 * PUT /api/admin/sop/proposals/[id]
 *
 * Review action. Body shape:
 *
 *   { action: "approve", targetTabId?: string, targetGroup?: string, reviewerNotes?: string }
 *     - Promotes the proposal to a real SopSection.
 *     - targetTabId/targetGroup let the admin override what the submitter
 *       suggested (e.g. submitter said "ops" but admin wants it in "ref").
 *
 *   { action: "reject", reviewerNotes: string }
 *     - Marks rejected with reviewer notes (reason required).
 *
 *   { action: "update", title?, content?, reason?, suggestedTabId?, suggestedGroup? }
 *     - Lets an admin edit a PENDING proposal before approving (typo
 *       fixes, formatting cleanup, group reassignment, etc.).
 *
 * Atomic guards via conditional updateMany to prevent double-review races.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!prisma) {
      return NextResponse.json({ error: "Database not configured" }, { status: 503 });
    }

    const currentUser = await getUserByEmail(session.user.email);
    const rawRoles: UserRole[] =
      currentUser?.roles && currentUser.roles.length > 0 ? currentUser.roles : [];
    const normalizedRoles = rawRoles.map((r) => ROLES[r]?.normalizesTo ?? r);
    if (!normalizedRoles.some((r) => r === "ADMIN" || r === "EXECUTIVE")) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    const adminUser = currentUser!;

    const { id } = await params;
    const body = await request.json();
    const { action } = body ?? {};

    if (action !== "approve" && action !== "reject" && action !== "update") {
      return NextResponse.json(
        { error: 'Action must be "approve", "reject", or "update"' },
        { status: 400 },
      );
    }

    const proposal = await prisma.sopProposal.findUnique({ where: { id } });
    if (!proposal) {
      return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
    }

    // -------------------------------------------------------------------
    // UPDATE — admin edits a pending proposal before approving
    // -------------------------------------------------------------------
    if (action === "update") {
      if (proposal.status !== "PENDING") {
        return NextResponse.json(
          { error: "Only pending proposals can be edited" },
          { status: 409 },
        );
      }

      const data: {
        title?: string;
        content?: string;
        reason?: string;
        suggestedTabId?: string;
        suggestedGroup?: string | null;
      } = {};
      if (typeof body.title === "string" && body.title.trim().length > 0) {
        data.title = body.title.trim();
      }
      if (typeof body.content === "string" && body.content.trim().length > 0) {
        data.content = sanitizeSopContent(body.content);
      }
      if (typeof body.reason === "string" && body.reason.trim().length > 0) {
        data.reason = body.reason.trim();
      }
      if (typeof body.suggestedTabId === "string" && body.suggestedTabId.length > 0) {
        const tab = await prisma.sopTab.findUnique({
          where: { id: body.suggestedTabId },
          select: { id: true },
        });
        if (!tab) {
          return NextResponse.json(
            { error: `Unknown tab: ${body.suggestedTabId}` },
            { status: 400 },
          );
        }
        data.suggestedTabId = body.suggestedTabId;
      }
      if (typeof body.suggestedGroup === "string") {
        data.suggestedGroup = body.suggestedGroup.trim() || null;
      }

      if (Object.keys(data).length === 0) {
        return NextResponse.json({ error: "No fields to update" }, { status: 400 });
      }

      const updated = await prisma.sopProposal.update({ where: { id }, data });
      return NextResponse.json(
        { success: true, proposal: updated },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    // -------------------------------------------------------------------
    // REJECT — claim and stamp
    // -------------------------------------------------------------------
    if (action === "reject") {
      const reviewerNotes = typeof body.reviewerNotes === "string" ? body.reviewerNotes.trim() : "";
      if (reviewerNotes.length === 0) {
        return NextResponse.json(
          { error: "Reviewer notes are required when rejecting" },
          { status: 400 },
        );
      }

      try {
        await prisma.$transaction(async (tx) => {
          const claimed = await tx.sopProposal.updateMany({
            where: { id, status: "PENDING" },
            data: {
              status: "REJECTED",
              reviewedBy: adminUser.email,
              reviewedAt: new Date(),
              reviewerNotes,
            },
          });
          if (claimed.count === 0) throw new Error("ALREADY_REVIEWED");
        });
      } catch (err) {
        if (err instanceof Error && err.message === "ALREADY_REVIEWED") {
          return NextResponse.json(
            { error: "Proposal was already reviewed" },
            { status: 409 },
          );
        }
        throw err;
      }

      try {
        const headersList = await headers();
        const reqCtx = extractRequestContext(headersList);
        await logAdminActivity({
          type: "SETTINGS_CHANGED",
          description: `Rejected SOP proposal: ${proposal.title}`,
          userId: adminUser.id,
          userEmail: adminUser.email,
          userName: adminUser.name || undefined,
          entityType: "sop_proposal",
          entityId: id,
          entityName: proposal.title,
          metadata: {
            action: "sop_proposal_rejected",
            proposalId: id,
            submittedBy: proposal.submittedBy,
            reviewerNotes,
          },
          ...reqCtx,
        });
      } catch (auditErr) {
        console.error("[admin/sop/proposals] Audit log failed:", auditErr);
      }

      return NextResponse.json(
        { success: true, action: "rejected" },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    // -------------------------------------------------------------------
    // APPROVE — promote to a real SopSection in the chosen tab/group
    // -------------------------------------------------------------------
    const targetTabId =
      typeof body.targetTabId === "string" && body.targetTabId.length > 0
        ? body.targetTabId
        : proposal.suggestedTabId;
    const targetGroup =
      typeof body.targetGroup === "string" && body.targetGroup.trim().length > 0
        ? body.targetGroup.trim()
        : proposal.suggestedGroup ?? "Submitted by team";
    const reviewerNotes =
      typeof body.reviewerNotes === "string" && body.reviewerNotes.trim().length > 0
        ? body.reviewerNotes.trim()
        : null;

    // Validate the target tab exists
    const tab = await prisma.sopTab.findUnique({
      where: { id: targetTabId },
      select: { id: true },
    });
    if (!tab) {
      return NextResponse.json(
        { error: `Unknown target tab: ${targetTabId}` },
        { status: 400 },
      );
    }

    // Pick a unique section id from the title slug
    const baseSlug = slugify(proposal.title) || `proposal-${id.slice(0, 8)}`;
    const newSectionId = await pickUniqueSectionId(baseSlug, prisma);

    // Compute a sort order — last in the target tab + 10
    const lastSection = await prisma.sopSection.findFirst({
      where: { tabId: targetTabId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    const newSortOrder = (lastSection?.sortOrder ?? 0) + 10;

    // Re-sanitize defense in depth
    const sanitized = sanitizeSopContent(proposal.content);

    let createdSectionId: string | undefined;

    try {
      await prisma.$transaction(async (tx) => {
        // 1. Claim the proposal — must still be PENDING
        const claimed = await tx.sopProposal.updateMany({
          where: { id, status: "PENDING" },
          data: {
            status: "APPROVED",
            reviewedBy: adminUser.email,
            reviewedAt: new Date(),
            reviewerNotes,
            promotedSectionId: newSectionId,
            promotedSectionTab: targetTabId,
          },
        });
        if (claimed.count === 0) throw new Error("ALREADY_REVIEWED");

        // 2. Create the new SopSection
        await tx.sopSection.create({
          data: {
            id: newSectionId,
            tabId: targetTabId,
            sidebarGroup: targetGroup,
            title: proposal.title,
            dotColor: "blue",
            sortOrder: newSortOrder,
            content: sanitized,
            version: 1,
            updatedBy: adminUser.email,
          },
        });

        createdSectionId = newSectionId;
      });
    } catch (err) {
      if (err instanceof Error && err.message === "ALREADY_REVIEWED") {
        return NextResponse.json(
          { error: "Proposal was already reviewed" },
          { status: 409 },
        );
      }
      throw err;
    }

    try {
      const headersList = await headers();
      const reqCtx = extractRequestContext(headersList);
      await logAdminActivity({
        type: "SETTINGS_CHANGED",
        description: `Approved SOP proposal "${proposal.title}" → published as section ${createdSectionId} in tab ${targetTabId}`,
        userId: adminUser.id,
        userEmail: adminUser.email,
        userName: adminUser.name || undefined,
        entityType: "sop_proposal",
        entityId: id,
        entityName: proposal.title,
        metadata: {
          action: "sop_proposal_approved",
          proposalId: id,
          createdSectionId,
          targetTabId,
          targetGroup,
          submittedBy: proposal.submittedBy,
        },
        ...reqCtx,
      });
    } catch (auditErr) {
      console.error("[admin/sop/proposals] Audit log failed:", auditErr);
    }

    return NextResponse.json(
      {
        success: true,
        action: "approved",
        sectionId: createdSectionId,
        tabId: targetTabId,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[admin/sop/proposals/[id]] Review failed:", error);
    return NextResponse.json({ error: "Failed to review proposal" }, { status: 500 });
  }
}
