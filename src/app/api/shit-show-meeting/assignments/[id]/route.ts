import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json()) as { status?: string };
  const data: { status?: "OPEN" | "COMPLETED" | "CANCELLED" } = {};
  if (body.status === "OPEN" || body.status === "COMPLETED" || body.status === "CANCELLED") {
    data.status = body.status;
  } else {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }

  const assignment = await prisma.shitShowAssignment.update({
    where: { id },
    data,
  });
  return NextResponse.json({ assignment });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;

  await prisma.shitShowAssignment.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
