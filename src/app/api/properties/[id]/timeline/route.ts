import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";
import { isPathAllowedByAccess, resolveUserAccess } from "@/lib/user-access";
import { getPropertyTimeline } from "@/lib/property-timeline";

export const maxDuration = 15;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const user = await getUserByEmail(session.user.email);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 403 });
    }

    if (!isPathAllowedByAccess(resolveUserAccess(user), "/api/service")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const searchParams = req.nextUrl.searchParams;
    const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10) || 0);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "25", 10) || 25));

    const result = await getPropertyTimeline(id, { offset, limit });

    return NextResponse.json(result);
  } catch (error) {
    console.error("[PropertyTimeline] Error:", error);
    return NextResponse.json(
      { error: "Failed to load property timeline" },
      { status: 500 },
    );
  }
}
