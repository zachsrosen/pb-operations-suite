import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;

  const session = await prisma.shitShowSession.findUnique({
    where: { id },
    include: {
      items: {
        include: { assignments: true },
        orderBy: [{ region: "asc" }, { flaggedSince: "asc" }],
      },
    },
  });
  if (!session) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ session });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  const body = (await req.json()) as { status?: string };

  // Reject session-start via PATCH — must use the snapshot endpoint
  if (body.status === "ACTIVE") {
    const current = await prisma.shitShowSession.findUnique({
      where: { id },
      select: { status: true },
    });
    if (current && current.status !== "ACTIVE") {
      return NextResponse.json(
        {
          error: "use_snapshot_endpoint_to_start",
          endpoint: `/api/shit-show-meeting/sessions/${id}/snapshot`,
        },
        { status: 409 },
      );
    }
  }

  const data: { status?: "DRAFT" | "ACTIVE" | "COMPLETED" } = {};
  if (body.status === "DRAFT" || body.status === "ACTIVE" || body.status === "COMPLETED") {
    data.status = body.status;
  }
  const session = await prisma.shitShowSession.update({ where: { id }, data });
  return NextResponse.json({ session });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;

  await prisma.shitShowSession.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
