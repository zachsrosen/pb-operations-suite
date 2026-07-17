import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";
import { isPiHubAllowedRole, isPiHubEnabled, parseTeam } from "@/lib/pi-hub/access";

export async function GET() {
  if (!isPiHubEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isPiHubAllowedRole(auth.roles)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  // ActivityLog stores deal references as (entityType="deal", entityId=dealId)
  // — there is no `dealId` column. P&I hub writes are type
  // HUBSPOT_DEAL_UPDATED with metadata.team set (see lib/pi-hub/status.ts).
  // The team check runs in JS rather than a Prisma JSON-path filter: today's
  // rows for one user + type are few, and Prisma's DbNull/JsonNull path
  // semantics around missing keys are easy to get subtly wrong.
  const entries = await prisma.activityLog.findMany({
    where: {
      userEmail: auth.email,
      type: "HUBSPOT_DEAL_UPDATED",
      createdAt: { gte: startOfDay },
    },
    select: {
      id: true,
      entityType: true,
      entityId: true,
      createdAt: true,
      metadata: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const piEntries = entries.filter((e) => {
    const meta = e.metadata;
    if (meta === null || typeof meta !== "object" || Array.isArray(meta)) {
      return false;
    }
    // Only count rows whose metadata.team is a real P&I team — a stray
    // HUBSPOT_DEAL_UPDATED row from another writer with an unrelated `team`
    // value must not inflate the count.
    const team = (meta as { team?: unknown }).team;
    return typeof team === "string" && parseTeam(team) !== null;
  });

  return NextResponse.json({
    count: piEntries.length,
    entries: piEntries.map((e) => ({
      id: e.id,
      team: (e.metadata as { team?: string }).team ?? null,
      dealId: e.entityType === "deal" ? e.entityId : null,
      createdAt: e.createdAt,
    })),
  });
}
