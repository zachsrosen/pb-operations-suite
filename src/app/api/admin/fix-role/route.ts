import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

/**
 * POST /api/admin/fix-role
 * Emergency endpoint to restore admin role for specific user
 * Only works for zach@photonbrothers.com
 */
export async function POST(_request: NextRequest) {
  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  // Only allow this for specific known admin emails
  const adminEmails = ["zach@photonbrothers.com", "zach.rosen@photonbrothers.com"];

  if (!adminEmails.includes(session.user.email)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  try {
    // Use Prisma ORM to update user role safely
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Update user role to ADMIN using Prisma
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _updatedUser = await prisma.user.update({
      where: { email: session.user.email },
      data: { role: "ADMIN" },
    });

    return NextResponse.json({
      success: true,
      message: `Role restored to ADMIN for ${session.user.email}`,
      rowsUpdated: 1,
    });
  } catch (error) {
    console.error("Error fixing role:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to fix role", details: errorMessage }, { status: 500 });
  }
}
