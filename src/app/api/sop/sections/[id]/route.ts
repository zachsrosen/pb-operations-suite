import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth-utils";
import { canAccessSection } from "@/lib/sop-access";

/**
 * GET /api/sop/sections/[id]
 *
 * Returns a single SOP section with its full HTML content.
 * Access is checked against the caller's role and the section's parent tab.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    if (!prisma) {
      return NextResponse.json({ error: "Database not configured" }, { status: 503 });
    }

    const { id } = await params;

    const section = await prisma.sopSection.findUnique({
      where: { id },
      select: {
        id: true,
        tabId: true,
        sidebarGroup: true,
        title: true,
        dotColor: true,
        sortOrder: true,
        content: true,
        version: true,
        updatedAt: true,
        updatedBy: true,
      },
    });

    if (!section) {
      return NextResponse.json({ error: "Section not found" }, { status: 404 });
    }

    // Check access against parent tab and section-level restrictions.
    // Pass the full role array so multi-role users get the union of permissions.
    const firstName = (user.name || "").split(" ")[0].toLowerCase();
    const userRoles = user.roles ?? ["VIEWER"];
    if (!canAccessSection(section.id, section.tabId, userRoles, firstName)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    return NextResponse.json({ section });
  } catch (error) {
    console.error("[sop/sections] Failed to load section:", error);
    return NextResponse.json({ error: "Failed to load section" }, { status: 500 });
  }
}
