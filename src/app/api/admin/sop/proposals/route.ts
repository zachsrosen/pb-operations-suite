import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma, getUserByEmail } from "@/lib/db";
import type { UserRole } from "@/generated/prisma/enums";
import { ROLES } from "@/lib/roles";

/**
 * GET /api/admin/sop/proposals
 *
 * List SOP proposals with metadata. Admins can filter by status.
 * Defaults to PENDING.
 *
 * Query params:
 *   ?status=PENDING|APPROVED|REJECTED|all
 *   ?count=true — returns { count: N } for header badge (always pending)
 */
export async function GET(request: NextRequest) {
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

    const countOnly = request.nextUrl.searchParams.get("count") === "true";

    if (countOnly) {
      const count = await prisma.sopProposal.count({ where: { status: "PENDING" } });
      return NextResponse.json({ count });
    }

    const statusParam = request.nextUrl.searchParams.get("status") ?? "PENDING";
    const where: { status?: "PENDING" | "APPROVED" | "REJECTED" } =
      statusParam === "all"
        ? {}
        : statusParam === "APPROVED"
          ? { status: "APPROVED" }
          : statusParam === "REJECTED"
            ? { status: "REJECTED" }
            : { status: "PENDING" };

    // Metadata only — no full content bodies
    const proposals = await prisma.sopProposal.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        suggestedTabId: true,
        suggestedGroup: true,
        reason: true,
        status: true,
        submittedBy: true,
        submittedByName: true,
        reviewedBy: true,
        reviewedAt: true,
        reviewerNotes: true,
        promotedSectionId: true,
        promotedSectionTab: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ proposals });
  } catch (error) {
    console.error("[admin/sop/proposals] List failed:", error);
    return NextResponse.json({ error: "Failed to load proposals" }, { status: 500 });
  }
}
