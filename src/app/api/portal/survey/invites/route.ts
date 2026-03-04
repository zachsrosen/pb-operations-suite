/**
 * GET /api/portal/survey/invites
 *
 * Internal endpoint (requires auth). Lists survey invites,
 * optionally filtered by dealId. Used by the site survey scheduler
 * to show invite status per project.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma, getUserPermissions } from "@/lib/db";

export async function GET(request: NextRequest) {
  if (!prisma) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Permission check — only users who can schedule surveys can view invite data
  const permissions = await getUserPermissions(session.user.email);
  if (!permissions?.canScheduleSurveys) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const dealId = searchParams.get("dealId");
  const dealIds = searchParams.get("dealIds"); // comma-separated for bulk lookup

  const where: Record<string, unknown> = {};
  if (dealId) {
    where.dealId = dealId;
  } else if (dealIds) {
    where.dealId = { in: dealIds.split(",").map((s) => s.trim()) };
  }

  const invites = await prisma.surveyInvite.findMany({
    where,
    select: {
      id: true,
      dealId: true,
      customerEmail: true,
      customerName: true,
      pbLocation: true,
      status: true,
      expiresAt: true,
      scheduledDate: true,
      scheduledTime: true,
      sentAt: true,
      sentBy: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json({ invites });
}

export async function DELETE(request: NextRequest) {
  if (!prisma) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const permissions = await getUserPermissions(session.user.email);
  if (!permissions?.canScheduleSurveys) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  await prisma.surveyInvite.delete({ where: { id } });
  return NextResponse.json({ deleted: true });
}
