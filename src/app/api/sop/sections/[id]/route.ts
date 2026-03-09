import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

/**
 * GET /api/sop/sections/[id]
 *
 * Returns a single SOP section with its full HTML content.
 * Available to all authenticated users.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
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

    return NextResponse.json({ section });
  } catch (error) {
    console.error("[sop/sections] Failed to load section:", error);
    return NextResponse.json({ error: "Failed to load section" }, { status: 500 });
  }
}
