import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma, getUserByEmail } from "@/lib/db";

const ALLOWED_ROLES = new Set(["ADMIN", "OWNER"]);

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Role check — enforced in handler, not middleware
  const user = await getUserByEmail(session.user.email);
  if (!user?.roles?.some((r) => ALLOWED_ROLES.has(r))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const residents = await prisma.shovelsResident.findMany({
    where: { propertyId: id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ residents });
}
