import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth-utils";
import { isFlagEnabled } from "../_filter";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isFlagEnabled()) {
    return NextResponse.json({ error: "Aircall dashboard is disabled" }, { status: 404 });
  }
  try {
    await requireRole("ADMIN", "OWNER", "EXECUTIVE");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = await prisma.aircallUserCache.findMany({
    where: { archived: false },
    orderBy: { name: "asc" },
    select: { aircallUserId: true, name: true, email: true, archived: true },
  });

  return NextResponse.json({ users });
}
