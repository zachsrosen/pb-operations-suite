import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

/**
 * Read-only proxy for the assignee picker in AssignmentsPanel. Returns users
 * who have any role assigned (the project's effective active-user filter).
 */
export async function GET() {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;

  const users = await prisma.user.findMany({
    where: { roles: { isEmpty: false } },
    select: { id: true, email: true, name: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ users });
}
