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

const MAX_CONTENT_LENGTH = 500_000;

/**
 * PUT /api/admin/sop/sections/[id]
 *
 * Direct save for ADMIN/OWNER. Uses atomic optimistic locking via
 * conditional updateMany to prevent TOCTOU races.
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

    // Defense-in-depth: verify ADMIN or OWNER (route already gated by ADMIN_ONLY_ROUTES)
    const currentUser = await getUserByEmail(session.user.email);
    const rawRoles: UserRole[] = currentUser?.roles && currentUser.roles.length > 0
      ? currentUser.roles
      : currentUser?.role ? [currentUser.role as UserRole] : [];
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
    const { content, version, editSummary } = body;

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
    if (!Number.isInteger(version) || version < 1) {
      return NextResponse.json(
        { error: "Valid version number is required" },
        { status: 400 }
      );
    }

    // Sanitize content before any DB write
    const sanitized = sanitizeSopContent(content);

    // Atomic transaction: read → conditional write → revision
    const result = await prisma.$transaction(async (tx) => {
      // Step 1: Read current section + capture old content for revision
      const section = await tx.sopSection.findUnique({
        where: { id },
        select: { id: true, title: true, content: true, version: true },
      });

      if (!section) {
        return { status: "not_found" as const };
      }

      // Step 2: Conditional write — combines version check + update in one query
      const updated = await tx.sopSection.updateMany({
        where: { id, version },
        data: {
          content: sanitized,
          version: { increment: 1 },
          updatedBy: adminUser.email,
        },
      });

      if (updated.count === 0) {
        // Re-read to get the actual current version (another write may have
        // landed between our initial read and the conditional update).
        const fresh = await tx.sopSection.findUnique({
          where: { id },
          select: { version: true },
        });
        return {
          status: "conflict" as const,
          currentVersion: fresh?.version ?? section.version,
        };
      }

      // Step 3: Create revision from old content snapshot
      await tx.sopRevision.create({
        data: {
          sectionId: id,
          content: section.content,
          editedBy: adminUser.email,
          editSummary: editSummary || null,
        },
      });

      return {
        status: "success" as const,
        title: section.title,
        newVersion: section.version + 1,
      };
    });

    if (result.status === "not_found") {
      return NextResponse.json(
        { error: "Section not found" },
        { status: 404 }
      );
    }

    if (result.status === "conflict") {
      return NextResponse.json(
        {
          error: "Version conflict — section was edited by someone else",
          currentVersion: result.currentVersion,
        },
        { status: 409 }
      );
    }

    // Audit log (outside transaction — best-effort)
    try {
      const headersList = await headers();
      const reqCtx = extractRequestContext(headersList);
      await logAdminActivity({
        type: "SETTINGS_CHANGED",
        description: `Edited SOP section: ${result.title}`,
        userId: adminUser.id,
        userEmail: adminUser.email,
        userName: adminUser.name || undefined,
        entityType: "sop_section",
        entityId: id,
        entityName: result.title,
        metadata: {
          action: "sop_edit",
          sectionId: id,
          title: result.title,
          newVersion: result.newVersion,
          editSummary: editSummary || null,
        },
        ...reqCtx,
      });
    } catch (auditErr) {
      console.error("[admin/sop/sections] Audit log failed:", auditErr);
    }

    return NextResponse.json(
      { success: true, version: result.newVersion },
      {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      }
    );
  } catch (error) {
    console.error("[admin/sop/sections] Save failed:", error);
    return NextResponse.json(
      { error: "Failed to save section" },
      { status: 500 }
    );
  }
}
