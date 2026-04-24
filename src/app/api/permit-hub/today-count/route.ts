import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";
import { isPermitHubAllowedRole, isPermitHubEnabled } from "@/lib/permit-hub";
import type { ActivityType } from "@/generated/prisma/enums";

const PERMIT_HUB_ACTIVITY_TYPES: ActivityType[] = [
  "PERMIT_SUBMITTED",
  "PERMIT_RESUBMITTED",
  "PERMIT_REJECTION_LOGGED",
  "PERMIT_REVISION_ROUTED",
  "PERMIT_REVISION_COMPLETED",
  "PERMIT_FOLLOWUP",
  "PERMIT_AS_BUILT_STARTED",
  "PERMIT_AS_BUILT_COMPLETED",
  "PERMIT_ISSUED",
  "PERMIT_SOLARAPP_SUBMITTED",
];

export async function GET() {
  if (!isPermitHubEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!auth.roles.some((r) => isPermitHubAllowedRole(r))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  // ActivityLog stores deal references as (entityType="deal", entityId=dealId)
  // — there is no `dealId` column (see prisma/schema.prisma:305).
  const entries = await prisma.activityLog.findMany({
    where: {
      userEmail: auth.email,
      type: { in: PERMIT_HUB_ACTIVITY_TYPES },
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
