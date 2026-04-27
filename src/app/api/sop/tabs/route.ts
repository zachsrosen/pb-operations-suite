import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth-utils";
import { canAccessTab, canAccessSection } from "@/lib/sop-access";
import type { UserRole } from "@/generated/prisma/enums";
import { ROLES } from "@/lib/roles";

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
    // Multi-role union — normalize each role to its canonical form, then check
    // tab + section access against the full set.
    const userRoles = (user.roles ?? ["VIEWER"]).map((r) => {
      const normalized = ROLES[r as UserRole]?.normalizesTo;
      return (normalized ?? r) as string;
    });

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

    // Filter tabs the user can access, then filter sections by per-section gates.
    const tabs = allTabs
      .filter((tab) => canAccessTab(tab.id, userRoles, firstName))
      .map((tab) => ({
        ...tab,
        sections: tab.sections.filter((s) =>
          canAccessSection(s.id, tab.id, userRoles, firstName),
        ),
      }));

    return NextResponse.json({ tabs });
  } catch (error) {
    console.error("[sop/tabs] Failed to load tabs:", error);
    return NextResponse.json({ error: "Failed to load tabs" }, { status: 500 });
  }
}
