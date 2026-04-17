import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail, prisma } from "@/lib/db";
import { appCache } from "@/lib/cache";
import { QUEUE_CACHE_KEY } from "@/lib/service-priority-cache";

const VALID_PRIORITIES = ["critical", "high", "medium", "low"];
const VALID_TYPES = ["deal", "ticket"];
const ALLOWED_ROLES = ["ADMIN", "OWNER", "MANAGER", "OPERATIONS", "OPERATIONS_MANAGER", "PROJECT_MANAGER"];

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const user = await getUserByEmail(session.user.email);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 403 });
    }

    const userRoles = user.roles && user.roles.length > 0 ? user.roles : [user.role];
    if (!userRoles.some((r) => ALLOWED_ROLES.includes(r))) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    if (!prisma) {
      return NextResponse.json({ error: "Database not configured" }, { status: 503 });
    }

    const body = await request.json();
    const { itemId, itemType, priority, reason, expiresAt } = body;

    if (!itemId || !itemType || !priority) {
      return NextResponse.json({ error: "itemId, itemType, and priority are required" }, { status: 400 });
    }

    if (!VALID_TYPES.includes(itemType)) {
      return NextResponse.json({ error: `itemType must be: ${VALID_TYPES.join(", ")}` }, { status: 400 });
    }

    if (!VALID_PRIORITIES.includes(priority)) {
      return NextResponse.json({ error: `priority must be: ${VALID_PRIORITIES.join(", ")}` }, { status: 400 });
    }

    const override = await prisma.servicePriorityOverride.upsert({
      where: { itemId_itemType: { itemId, itemType } },
      update: {
        overridePriority: priority,
        setBy: session.user.email,
        reason: reason || null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
      create: {
        itemId,
        itemType,
        overridePriority: priority,
        setBy: session.user.email,
        reason: reason || null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
    });

    // Invalidate priority queue cache (bypasses debounce — user action)
    appCache.invalidate(QUEUE_CACHE_KEY);

    return NextResponse.json({ success: true, override });
  } catch (error) {
    console.error("[PriorityOverride] Error:", error);
    return NextResponse.json({ error: "Failed to set override" }, { status: 500 });
  }
}
