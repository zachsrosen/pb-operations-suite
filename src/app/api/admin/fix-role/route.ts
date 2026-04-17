import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma, updateUserRoles, type UserRole } from "@/lib/db";

/**
 * POST /api/admin/fix-role
 * Emergency endpoint to restore admin role for specific user
 * Only works for zach@photonbrothers.com
 */
export async function POST(request: Request) {
  // Explicit kill-switch: this recovery endpoint should remain disabled unless needed.
  if (process.env.ENABLE_ADMIN_ROLE_RECOVERY !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Require a recovery code as a second factor
  const recoveryCode = process.env.ADMIN_RECOVERY_CODE;
  if (!recoveryCode) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

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

  const body = await request.json().catch(() => ({}));
  if (body.recoveryCode !== recoveryCode) {
    return NextResponse.json({ error: "Invalid recovery code" }, { status: 403 });
  }

  try {
    // Use Prisma ORM to update user role safely
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Accept either `{ roles: string[] }` or legacy `{ role: string }`. Default
    // to ["ADMIN"] when neither is provided (preserves original recovery behavior).
    let newRoles: UserRole[];
    if (Array.isArray(body?.roles) && body.roles.every((r: unknown) => typeof r === "string") && body.roles.length > 0) {
      newRoles = body.roles as UserRole[];
    } else if (typeof body?.role === "string" && body.role.length > 0) {
      newRoles = [body.role as UserRole];
    } else {
      newRoles = ["ADMIN" as UserRole];
    }

    await updateUserRoles(user.id, newRoles);

    return NextResponse.json({
      success: true,
      message: `Roles restored to [${newRoles.join(", ")}] for ${session.user.email}`,
      rowsUpdated: 1,
    });
  } catch (error) {
    console.error("Error fixing role:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to fix role", details: errorMessage }, { status: 500 });
  }
}
