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

  // Only allow this for specific known admin email
  const adminEmails = ["zach@photonbrothers.com"];

  if (!adminEmails.includes(session.user.email)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  try {
    // Update the user's role to ADMIN
    // Note: Only updating role - impersonatingUserId may not exist yet if migration not run
    const updatedUser = await prisma.user.update({
      where: { email: session.user.email },
      data: {
        role: "ADMIN",
      },
    });

    return NextResponse.json({
      success: true,
      message: `Role restored to ADMIN for ${session.user.email}`,
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        role: updatedUser.role,
      },
    });
  } catch (error) {
    console.error("Error fixing role:", error);
    return NextResponse.json({ error: "Failed to fix role" }, { status: 500 });
  }
}
