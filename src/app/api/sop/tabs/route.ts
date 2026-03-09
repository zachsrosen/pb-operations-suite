import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

/**
 * GET /api/sop/tabs
 *
 * Returns all SOP tabs with their section metadata (no content bodies).
 * Available to all authenticated users.
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

    const tabs = await prisma.sopTab.findMany({
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

    return NextResponse.json({ tabs });
  } catch (error) {
    console.error("[sop/tabs] Failed to load tabs:", error);
    return NextResponse.json({ error: "Failed to load tabs" }, { status: 500 });
  }
}
