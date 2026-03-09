import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma, getUserByEmail } from "@/lib/db";

/**
 * GET /api/admin/sop/suggestions
 *
 * List pending suggestions (metadata only) or return count.
 * ADMIN/OWNER only (enforced by ADMIN_ONLY_ROUTES).
 *
 * Query params:
 *   ?count=true — returns { count: N } for header badge
 */
export async function GET(request: NextRequest) {
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

    // Defense-in-depth role check
    const currentUser = await getUserByEmail(session.user.email);
    if (
      !currentUser ||
      (currentUser.role !== "ADMIN" && currentUser.role !== "OWNER")
    ) {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    }

    const countOnly = request.nextUrl.searchParams.get("count") === "true";

    if (countOnly) {
      const count = await prisma.sopSuggestion.count({
        where: { status: "PENDING" },
      });
      return NextResponse.json({ count });
    }

    // Return metadata only — no full content bodies
    const suggestions = await prisma.sopSuggestion.findMany({
      where: { status: "PENDING" },
      select: {
        id: true,
        sectionId: true,
        summary: true,
        submittedBy: true,
        createdAt: true,
        status: true,
        basedOnVersion: true,
        section: {
          select: { title: true, tabId: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error("[admin/sop/suggestions] List failed:", error);
    return NextResponse.json(
      { error: "Failed to load suggestions" },
      { status: 500 }
    );
  }
}
