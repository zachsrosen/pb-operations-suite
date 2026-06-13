/**
 * GET /api/admin/crew-options
 *
 * Admin-only. Returns active CrewMembers (id, name, email, linkedUserId)
 * for the user-detail drawer's crew link picker. No cache — cheap DB read.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma, getUserByEmail } from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const me = await getUserByEmail(session.user.email);
  if (!me?.roles?.includes("ADMIN")) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const crewMembers = await prisma.crewMember.findMany({
    where: { isActive: true },
    select: { id: true, name: true, email: true, userId: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({
    crew: crewMembers.map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      linkedUserId: c.userId,
    })),
  });
}
