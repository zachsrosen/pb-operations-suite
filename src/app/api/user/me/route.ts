import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma, getUserByEmail } from "@/lib/db";

/**
 * GET /api/user/me
 * Get the current user's info including role
 * If admin is impersonating, returns impersonated user's info
 */
export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.email) {
      return NextResponse.json({ user: null }, { status: 200 });
    }

    const user = await getUserByEmail(session.user.email);

    if (!user) {
      return NextResponse.json({ user: null }, { status: 200 });
    }

    // Check if admin is impersonating another user
    if (user.role === "ADMIN" && user.impersonatingUserId && prisma) {
      const impersonatedUser = await prisma.user.findUnique({
        where: { id: user.impersonatingUserId },
      });

      if (impersonatedUser) {
        return NextResponse.json({
          user: {
            id: impersonatedUser.id,
            email: impersonatedUser.email,
            name: impersonatedUser.name,
            role: impersonatedUser.role,
            canScheduleSurveys: impersonatedUser.canScheduleSurveys,
            canScheduleInstalls: impersonatedUser.canScheduleInstalls,
            canSyncToZuper: impersonatedUser.canSyncToZuper,
            canManageUsers: impersonatedUser.canManageUsers,
            allowedLocations: impersonatedUser.allowedLocations,
          },
          isImpersonating: true,
          adminUser: {
            id: user.id,
            email: user.email,
            name: user.name,
          },
        });
      }
    }

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        canScheduleSurveys: user.canScheduleSurveys,
        canScheduleInstalls: user.canScheduleInstalls,
        canSyncToZuper: user.canSyncToZuper,
        canManageUsers: user.canManageUsers,
        allowedLocations: user.allowedLocations,
      },
      isImpersonating: false,
    });
  } catch (error) {
    console.error("Error fetching current user:", error);
    return NextResponse.json({ error: "Failed to fetch user" }, { status: 500 });
  }
}
