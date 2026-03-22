import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth-utils";
import { canAccessTab, ADMIN_ONLY_SECTIONS } from "@/lib/sop-access";
import { normalizeRole, type UserRole } from "@/lib/role-permissions";

/**
 * GET /api/sop/tabs
 *
 * Returns SOP tabs with their section metadata (no content bodies).
 * Tabs and admin-only sections are filtered by the caller's role.
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    if (!prisma) {
      return NextResponse.json({ error: "Database not configured" }, { status: 503 });
    }

    const firstName = (user.name || "").split(" ")[0].toLowerCase();
    const role = normalizeRole(user.role as UserRole);
    const isAdmin = role === "ADMIN" || role === "EXECUTIVE";

    const allTabs = await prisma.sopTab.findMany({
      orderBy: { sortOrder: "asc" },
      include: {
        sections: {
          orderBy: { sortOrder: "asc" },
          select: {
            id: true,
            tabId: true,
            sidebarGroup: true,
            title: true,
            dotColor: true,
            sortOrder: true,
            updatedAt: true,
            updatedBy: true,
          },
        },
      },
    });

    // Filter tabs the user can access
    const tabs = allTabs
      .filter((tab) => canAccessTab(tab.id, role, firstName))
      .map((tab) => ({
        ...tab,
        // Strip admin-only sections for non-admins
        sections: isAdmin
          ? tab.sections
          : tab.sections.filter((s) => !ADMIN_ONLY_SECTIONS.includes(s.id)),
      }));

    return NextResponse.json({ tabs });
  } catch (error) {
    console.error("[sop/tabs] Failed to load tabs:", error);
    return NextResponse.json({ error: "Failed to load tabs" }, { status: 500 });
  }
}
