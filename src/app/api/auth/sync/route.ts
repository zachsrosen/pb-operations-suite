import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/auth";
import { prisma, getOrCreateUser, getUserByEmail, logActivity } from "@/lib/db";
import { normalizeRole, type UserRole } from "@/lib/role-permissions";

function withEffectiveRoleCookie(response: NextResponse, role: string): NextResponse {
  response.cookies.set("pb_effective_role", role, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 8,
  });
  return response;
}

/**
 * POST /api/auth/sync
 * Sync the current user to the database and return their role
 * Called after login to ensure user exists in DB
 */
export async function POST() {
  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    // Create or update user in database
    const user = await getOrCreateUser({
      email: session.user.email,
      name: session.user.name ?? undefined,
      image: session.user.image ?? undefined,
    }, { touchLastLogin: true });

    if (!user) {
      // Database not configured, return default role
      return withEffectiveRoleCookie(
        NextResponse.json({ role: "VIEWER", synced: false }),
        "VIEWER"
      );
    }

    const normalizedRole = normalizeRole(user.role as UserRole);

    // Log the login activity
    const headersList = await headers();
    const userAgent = headersList.get("user-agent") || undefined;
    const forwarded = headersList.get("x-forwarded-for");
    const ipAddress = forwarded?.split(",")[0]?.trim() || headersList.get("x-real-ip") || undefined;

    await logActivity({
      type: "LOGIN",
      description: `${user.email} logged in`,
      userId: user.id,
      userEmail: user.email,
      ipAddress,
      userAgent,
    });

    return withEffectiveRoleCookie(NextResponse.json({
      role: normalizedRole,
      synced: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: normalizedRole,
      }
    }), normalizedRole);
  } catch (error) {
    console.error("Error syncing user:", error);
    return withEffectiveRoleCookie(
      NextResponse.json({ role: "VIEWER", synced: false, error: "Sync failed" }),
      "VIEWER"
    );
  }
}

/**
 * GET /api/auth/sync
 * Get the current user's role from the database
 * If admin is impersonating, returns impersonated user's role
 */
export async function GET() {
  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const user = await getUserByEmail(session.user.email);

    if (!user) {
      return withEffectiveRoleCookie(
        NextResponse.json({ role: "VIEWER", found: false }),
        "VIEWER"
      );
    }

    // Check if admin is impersonating another user
    if (user.role === "ADMIN" && user.impersonatingUserId && prisma) {
      const impersonatedUser = await prisma.user.findUnique({
        where: { id: user.impersonatingUserId },
      });

      if (impersonatedUser) {
        const normalizedRole = normalizeRole(impersonatedUser.role as UserRole);
        return withEffectiveRoleCookie(NextResponse.json({
          role: normalizedRole,
          found: true,
          isImpersonating: true,
          user: {
            id: impersonatedUser.id,
            email: impersonatedUser.email,
            name: impersonatedUser.name,
            role: normalizedRole,
          },
          impersonatedUser: {
            id: impersonatedUser.id,
            email: impersonatedUser.email,
            name: impersonatedUser.name,
            role: normalizedRole,
          },
          adminUser: {
            id: user.id,
            email: user.email,
            name: user.name,
          },
        }), normalizedRole);
      }
    }

    const normalizedRole = normalizeRole(user.role as UserRole);
    return withEffectiveRoleCookie(NextResponse.json({
      role: normalizedRole,
      found: true,
      isImpersonating: false,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: normalizedRole,
      }
    }), normalizedRole);
  } catch (error) {
    console.error("Error fetching user role:", error);
    return withEffectiveRoleCookie(
      NextResponse.json({ role: "VIEWER", found: false, error: "Fetch failed" }),
      "VIEWER"
    );
  }
}
