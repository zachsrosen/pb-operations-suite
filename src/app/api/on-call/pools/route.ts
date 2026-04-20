import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { assertOnCallEnabled } from "@/lib/on-call-guard";
import { canAdminOnCall } from "@/lib/on-call-auth";
import { getCurrentUser } from "@/lib/auth-utils";
import { listPools } from "@/lib/on-call-db";
import { prisma, logActivity } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = assertOnCallEnabled();
  if (gate) return gate;
  const pools = await listPools();
  return NextResponse.json({ pools });
}

type CreateBody = {
  name?: string;
  region?: string;
  shiftStart?: string;
  shiftEnd?: string;
  timezone?: string;
  startDate?: string;
  horizonMonths?: number;
};

export async function POST(req: Request) {
  const gate = assertOnCallEnabled();
  if (gate) return gate;
  const user = await getCurrentUser();
  if (!canAdminOnCall(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json()) as CreateBody;
  const { name, region, shiftStart, shiftEnd, timezone, startDate, horizonMonths } = body;
  if (!name || !region || !shiftStart || !shiftEnd || !timezone || !startDate) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const pool = await prisma.onCallPool.create({
    data: {
      name,
      region,
      shiftStart,
      shiftEnd,
      timezone,
      startDate,
      horizonMonths: horizonMonths ?? 3,
      icalToken: randomBytes(24).toString("hex"),
    },
  });
  await logActivity({
    type: "ON_CALL_POOL_CREATED",
    description: `Created on-call pool ${pool.name}`,
    userId: user?.id,
    userEmail: user?.email,
    entityType: "OnCallPool",
    entityId: pool.id,
  });
  return NextResponse.json({ pool });
}
