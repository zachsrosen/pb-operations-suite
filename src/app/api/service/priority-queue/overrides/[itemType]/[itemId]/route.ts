import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail, prisma } from "@/lib/db";
import { appCache } from "@/lib/cache";
import { QUEUE_CACHE_KEY } from "@/lib/service-priority-cache";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ itemType: string; itemId: string }> }
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

    if (!prisma) {
      return NextResponse.json({ error: "Database not configured" }, { status: 503 });
    }

    const { itemType, itemId } = await params;

    await prisma.servicePriorityOverride.delete({
      where: { itemId_itemType: { itemId, itemType } },
    }).catch(() => {
      // Not found is OK — idempotent delete
    });

    appCache.invalidate(QUEUE_CACHE_KEY);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[PriorityOverride] Error:", error);
    return NextResponse.json({ error: "Failed to remove override" }, { status: 500 });
  }
}
