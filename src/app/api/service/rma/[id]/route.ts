import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (process.env.RMA_ENABLED !== "true") {
    return NextResponse.json({ error: "RMA disabled" }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { id } = await params;
  const order = await prisma.rmaOrder.findUnique({ where: { id } });
  if (!order) {
    return NextResponse.json({ error: "RMA order not found" }, { status: 404 });
  }

  return NextResponse.json(order);
}
