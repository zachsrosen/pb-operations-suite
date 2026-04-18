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
 * GET /api/admin/sop/suggestions/[id]
 *
 * Return full suggestion detail with content.
 * ADMIN/OWNER only.
 */
export async function GET(
  _request: NextRequest,
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
    const rawRoles: UserRole[] = currentUser?.roles && currentUser.roles.length > 0
      ? currentUser.roles
      : [];
    const normalizedRoles = rawRoles.map((r) => ROLES[r]?.normalizesTo ?? r);
    if (!normalizedRoles.some((r) => r === "ADMIN" || r === "EXECUTIVE")) {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    }
    const { id } = await params;

    const suggestion = await prisma.sopSuggestion.findUnique({
      where: { id },
      include: {
        section: {
          select: {
            id: true,
            title: true,
            tabId: true,
            content: true,
            version: true,
          },
        },
      },
    });

    if (!suggestion) {
      return NextResponse.json(
        { error: "Suggestion not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ suggestion });
  } catch (error) {
    console.error("[admin/sop/suggestions] Get failed:", error);
    return NextResponse.json(
      { error: "Failed to load suggestion" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/sop/suggestions/[id]
 *
 * Approve or reject a suggestion. Uses atomic guards:
 * - Step 0: findUnique to distinguish 404 from 409
 * - Approve: tx with conditional suggestion claim + conditional section version update
 * - Reject: tx with conditional status claim
 * Throws inside tx callback to force Prisma rollback on conflict.
 */
export async function PUT(
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
    const rawRoles: UserRole[] = currentUser?.roles && currentUser.roles.length > 0
      ? currentUser.roles
      : [];
    const normalizedRoles = rawRoles.map((r) => ROLES[r]?.normalizesTo ?? r);
    if (!normalizedRoles.some((r) => r === "ADMIN" || r === "EXECUTIVE")) {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    }
    const adminUser = currentUser!;

    const { id } = await params;
    const body = await request.json();
    const { action, reviewNote } = body;

    if (action !== "approve" && action !== "reject") {
      return NextResponse.json(
        { error: 'Action must be "approve" or "reject"' },
        { status: 400 }
      );
    }

    // Step 0: Read suggestion to separate 404 from 409
    const suggestion = await prisma.sopSuggestion.findUnique({
      where: { id },
      select: {
        id: true,
        sectionId: true,
        content: true,
        basedOnVersion: true,
        status: true,
        summary: true,
      },
    });

    if (!suggestion) {
      return NextResponse.json(
        { error: "Suggestion not found" },
        { status: 404 }
      );
    }

    if (action === "reject") {
      // Reject flow — single conditional update in tx
      try {
        await prisma.$transaction(async (tx) => {
          const claimed = await tx.sopSuggestion.updateMany({
            where: { id, status: "PENDING" },
            data: {
              status: "REJECTED",
              reviewedBy: adminUser.email,
              reviewNote: reviewNote || null,
              reviewedAt: new Date(),
            },
          });

          if (claimed.count === 0) {
            throw new Error("ALREADY_REVIEWED");
          }
        });
      } catch (err) {
        if (err instanceof Error && err.message === "ALREADY_REVIEWED") {
          return NextResponse.json(
            { error: "Suggestion was already reviewed" },
            { status: 409 }
          );
        }
        throw err;
      }

      // Audit log
      try {
        const headersList = await headers();
        const reqCtx = extractRequestContext(headersList);
        await logAdminActivity({
          type: "SETTINGS_CHANGED",
          description: `Rejected SOP suggestion: ${suggestion.summary}`,
          userId: adminUser.id,
          userEmail: adminUser.email,
          userName: adminUser.name || undefined,
          entityType: "sop_suggestion",
          entityId: id,
          entityName: suggestion.summary,
          metadata: {
            action: "sop_suggestion_rejected",
            suggestionId: id,
            sectionId: suggestion.sectionId,
            reviewNote: reviewNote || null,
          },
          ...reqCtx,
        });
      } catch (auditErr) {
        console.error("[admin/sop/suggestions] Audit log failed:", auditErr);
      }

      return NextResponse.json(
        { success: true, action: "rejected" },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // Approve flow — all-in-one tx with throws for rollback
    let newVersion: number | undefined;
    let sectionTitle: string | undefined;

    try {
      await prisma.$transaction(async (tx) => {
        // 1. Read section (capture old content for revision)
        const section = await tx.sopSection.findUnique({
          where: { id: suggestion.sectionId },
          select: { id: true, title: true, content: true, version: true },
        });

        if (!section) {
          throw new Error("SECTION_NOT_FOUND");
        }

        sectionTitle = section.title;

        // 2. Re-sanitize suggestion content (defense in depth)
        const sanitized = sanitizeSopContent(suggestion.content);

        // 3. Claim the suggestion (conditional on PENDING)
        const claimed = await tx.sopSuggestion.updateMany({
          where: { id, status: "PENDING" },
          data: {
            status: "APPROVED",
            reviewedBy: adminUser.email,
            reviewedAt: new Date(),
          },
        });

        if (claimed.count === 0) {
          throw new Error("ALREADY_REVIEWED");
        }

        // 4. Conditional section update (version check)
        const updated = await tx.sopSection.updateMany({
          where: { id: suggestion.sectionId, version: suggestion.basedOnVersion },
          data: {
            content: sanitized,
            version: { increment: 1 },
            updatedBy: adminUser.email,
          },
        });

        if (updated.count === 0) {
          throw new Error("VERSION_CONFLICT");
        }

        newVersion = suggestion.basedOnVersion + 1;

        // 5. Create revision from old content snapshot
        await tx.sopRevision.create({
          data: {
            sectionId: suggestion.sectionId,
            content: section.content,
            editedBy: adminUser.email,
            editSummary: `Approved suggestion: ${suggestion.summary}`,
          },
        });
      });
    } catch (err) {
      if (err instanceof Error) {
        if (err.message === "SECTION_NOT_FOUND") {
          return NextResponse.json(
            { error: "Section not found" },
            { status: 404 }
          );
        }
        if (err.message === "ALREADY_REVIEWED") {
          return NextResponse.json(
            { error: "Suggestion was already reviewed" },
            { status: 409 }
          );
        }
        if (err.message === "VERSION_CONFLICT") {
          return NextResponse.json(
            {
              error:
                "Section was edited since this suggestion was created. The suggestion cannot be applied automatically.",
              basedOnVersion: suggestion.basedOnVersion,
            },
            { status: 409 }
          );
        }
      }
      throw err;
    }

    // Audit log (outside tx)
    try {
      const headersList = await headers();
      const reqCtx = extractRequestContext(headersList);
      await logAdminActivity({
        type: "SETTINGS_CHANGED",
        description: `Approved SOP suggestion: ${suggestion.summary} → ${sectionTitle}`,
        userId: adminUser.id,
        userEmail: adminUser.email,
        userName: adminUser.name || undefined,
        entityType: "sop_suggestion",
        entityId: id,
        entityName: suggestion.summary,
        metadata: {
          action: "sop_suggestion_approved",
          suggestionId: id,
          sectionId: suggestion.sectionId,
          sectionTitle,
          newVersion,
        },
        ...reqCtx,
      });
    } catch (auditErr) {
      console.error("[admin/sop/suggestions] Audit log failed:", auditErr);
    }

    return NextResponse.json(
      { success: true, action: "approved", version: newVersion },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[admin/sop/suggestions] Review failed:", error);
    return NextResponse.json(
      { error: "Failed to review suggestion" },
      { status: 500 }
    );
  }
}
