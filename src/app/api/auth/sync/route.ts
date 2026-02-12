import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/auth";
import { prisma, getOrCreateUser, getUserByEmail, logActivity } from "@/lib/db";

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
      return NextResponse.json({ role: "VIEWER", synced: false });
    }

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

    return NextResponse.json({
      role: user.role,
      synced: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      }
    });
  } catch (error) {
    console.error("Error syncing user:", error);
    return NextResponse.json({ role: "VIEWER", synced: false, error: "Sync failed" });
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
      return NextResponse.json({ role: "VIEWER", found: false });
    }

    // Check if admin is impersonating another user
    if (user.role === "ADMIN" && user.impersonatingUserId && prisma) {
      const impersonatedUser = await prisma.user.findUnique({
        where: { id: user.impersonatingUserId },
      });

      if (impersonatedUser) {
        return NextResponse.json({
          role: impersonatedUser.role,
          found: true,
          isImpersonating: true,
          user: {
            id: impersonatedUser.id,
            email: impersonatedUser.email,
            name: impersonatedUser.name,
            role: impersonatedUser.role,
          },
          impersonatedUser: {
            id: impersonatedUser.id,
            email: impersonatedUser.email,
            name: impersonatedUser.name,
            role: impersonatedUser.role,
          },
          adminUser: {
            id: user.id,
            email: user.email,
            name: user.name,
          },
        });
      }
    }

    return NextResponse.json({
      role: user.role,
      found: true,
      isImpersonating: false,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      }
    });
  } catch (error) {
    console.error("Error fetching user role:", error);
    return NextResponse.json({ role: "VIEWER", found: false, error: "Fetch failed" });
  }
}
