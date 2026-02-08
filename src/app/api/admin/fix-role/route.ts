import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

/**
 * POST /api/admin/fix-role
 * Emergency endpoint to restore admin role for specific user
 * Only works for zach@photonbrothers.com
 */
export async function POST(request: NextRequest) {
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
    // Use raw SQL to avoid Prisma client schema mismatch issues
    // This bypasses Prisma's generated client and talks directly to the database
    const result = await prisma.$executeRaw`
      UPDATE "User"
      SET "role" = 'ADMIN'::"UserRole"
      WHERE "email" = ${session.user.email}
    `;

    if (result === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: `Role restored to ADMIN for ${session.user.email}`,
      rowsUpdated: result,
    });
  } catch (error) {
    console.error("Error fixing role:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to fix role", details: errorMessage }, { status: 500 });
  }
}
