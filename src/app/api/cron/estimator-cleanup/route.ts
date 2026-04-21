import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";

function checkCronAuth(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!checkCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const now = new Date();
  const deleted = await prisma.estimatorRun.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  return NextResponse.json({ deleted: deleted.count });
}
