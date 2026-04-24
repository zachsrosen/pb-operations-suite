import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";
import { isIcHubAllowedRole, isIcHubEnabled } from "@/lib/ic-hub";
import type { ActivityType } from "@/generated/prisma/enums";

const IC_HUB_ACTIVITY_TYPES: ActivityType[] = [
  "IC_SUBMITTED",
  "IC_RESUBMITTED",
  "IC_REJECTION_LOGGED",
  "IC_REVISION_ROUTED",
  "IC_REVISION_COMPLETED",
  "IC_INFO_PROVIDED",
  "IC_FOLLOWUP",
  "IC_APPROVED",
];

export async function GET() {
  if (!isIcHubEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!auth.roles.some((r) => isIcHubAllowedRole(r))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const entries = await prisma.activityLog.findMany({
    where: {
      userEmail: auth.email,
      type: { in: IC_HUB_ACTIVITY_TYPES },
      createdAt: { gte: startOfDay },
    },
    select: {
      id: true,
      type: true,
      entityType: true,
      entityId: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    count: entries.length,
    entries: entries.map((e) => ({
      id: e.id,
      type: e.type,
      dealId: e.entityType === "deal" ? e.entityId : null,
      createdAt: e.createdAt,
    })),
  });
}
