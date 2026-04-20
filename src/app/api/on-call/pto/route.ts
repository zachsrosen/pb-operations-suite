import { NextResponse } from "next/server";
import { assertOnCallEnabled } from "@/lib/on-call-guard";
import { canAdminOnCall } from "@/lib/on-call-auth";
import { getCurrentUser } from "@/lib/auth-utils";
import { resolveElectricianByEmail } from "@/lib/on-call-db";
import { prisma, logActivity } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const gate = assertOnCallEnabled();
  if (gate) return gate;
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const poolId = url.searchParams.get("poolId");
  const requests = await prisma.onCallPtoRequest.findMany({
    where: { ...(status ? { status } : {}), ...(poolId ? { poolId } : {}) },
    include: { crewMember: true, pool: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ requests });
}

type CreateBody = {
  poolId: string;
  crewMemberId: string;
  startDate: string;
  endDate: string;
  reason?: string;
};

export async function POST(req: Request) {
  const gate = assertOnCallEnabled();
  if (gate) return gate;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json()) as CreateBody;
  if (!body.poolId || !body.crewMemberId || !body.startDate || !body.endDate) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  if (body.startDate > body.endDate) {
    return NextResponse.json({ error: "startDate after endDate" }, { status: 400 });
  }

  // Non-admin callers can only request PTO for themselves.
  if (!canAdminOnCall(user)) {
    const callerCrew = user.email ? await resolveElectricianByEmail(user.email) : null;
    if (!callerCrew || callerCrew.id !== body.crewMemberId) {
      return NextResponse.json({ error: "Forbidden: can only request PTO for yourself" }, { status: 403 });
    }
  }

  // Overlap with existing approved PTO?
  const overlap = await prisma.onCallPtoRequest.findFirst({
    where: {
      poolId: body.poolId,
      crewMemberId: body.crewMemberId,
      status: "approved",
      AND: [
        { startDate: { lte: body.endDate } },
        { endDate: { gte: body.startDate } },
      ],
    },
  });
  if (overlap) {
    return NextResponse.json({ error: "Overlaps with existing approved PTO" }, { status: 409 });
  }

  const created = await prisma.onCallPtoRequest.create({
    data: {
      poolId: body.poolId,
      crewMemberId: body.crewMemberId,
      startDate: body.startDate,
      endDate: body.endDate,
      reason: body.reason,
      status: "awaiting-admin",
    },
  });
  await logActivity({
    type: "ON_CALL_PTO_REQUESTED",
    description: `PTO requested ${body.startDate} – ${body.endDate}`,
    userId: user?.id,
    userEmail: user?.email,
    entityType: "OnCallPtoRequest",
    entityId: created.id,
  });
  return NextResponse.json({ request: created });
}
