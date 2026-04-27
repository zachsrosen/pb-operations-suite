import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;

  const sessions = await prisma.shitShowSession.findMany({
    orderBy: { date: "desc" },
    take: 50,
  });
  return NextResponse.json({ sessions });
}

export async function POST() {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;

  // Only one ACTIVE session at a time
  const existing = await prisma.shitShowSession.findFirst({
    where: { status: "ACTIVE" },
  });
  if (existing) {
    return NextResponse.json(
      { error: "active_session_exists", sessionId: existing.id },
      { status: 409 },
    );
  }

  const session = await prisma.shitShowSession.create({
    data: {
      date: new Date(),
      createdBy: auth.email,
      status: "DRAFT",
    },
  });
  return NextResponse.json({ session });
}
