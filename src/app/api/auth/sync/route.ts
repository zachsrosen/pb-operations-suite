import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/auth";
import { prisma, getOrCreateUser, getUserByEmail, logActivity } from "@/lib/db";
import type { UserRole } from "@/generated/prisma/enums";
import { ROLES } from "@/lib/roles";
import { resolveUserAccess, type UserLike, type EffectiveUserAccess } from "@/lib/user-access";

/**
 * Compute the serializable access payload for a user. `EffectiveUserAccess`
 * carries `suites` and `allowedRoutes` as Sets, which don't survive JSON.stringify —
 * we convert them to arrays here.
 */
function serializeAccess(user: UserLike): {
  roles: EffectiveUserAccess["roles"];
  access: {
    roles: EffectiveUserAccess["roles"];
    suites: string[];
    allowedRoutes: string[];
    landingCards: EffectiveUserAccess["landingCards"];
    scope: EffectiveUserAccess["scope"];
    capabilities: EffectiveUserAccess["capabilities"];
  };
} {
  const access = resolveUserAccess(user);
  return {
    roles: access.roles,
    access: {
      roles: access.roles,
      suites: Array.from(access.suites),
      allowedRoutes: Array.from(access.allowedRoutes),
      landingCards: access.landingCards,
      scope: access.scope,
      capabilities: access.capabilities,
    },
  };
}

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

function withImpersonationStateCookie(response: NextResponse, isImpersonating: boolean): NextResponse {
  response.cookies.set("pb_is_impersonating", isImpersonating ? "1" : "0", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 8,
  });
  return response;
}

function withRoleAndImpersonationCookies(
  response: NextResponse,
  role: string,
  isImpersonating: boolean
): NextResponse {
  return withImpersonationStateCookie(withEffectiveRoleCookie(response, role), isImpersonating);
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
      return withRoleAndImpersonationCookies(
        NextResponse.json({ role: "VIEWER", synced: false }),
        "VIEWER",
        false
      );
    }

    const normalizedRole = (ROLES[(user.roles?.[0] ?? "VIEWER") as UserRole]?.normalizesTo ?? ((user.roles?.[0] ?? "VIEWER") as UserRole));

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

    const { roles, access } = serializeAccess(user);

    return withRoleAndImpersonationCookies(NextResponse.json({
      role: normalizedRole,
      roles,
      access,
      synced: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: normalizedRole,
        roles,
      }
    }), normalizedRole, false);
  } catch (error) {
    console.error("Error syncing user:", error);
    return withRoleAndImpersonationCookies(
      NextResponse.json({ role: "VIEWER", synced: false, error: "Sync failed" }),
      "VIEWER",
      false
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
      return withRoleAndImpersonationCookies(
        NextResponse.json({ role: "VIEWER", found: false }),
        "VIEWER",
        false
      );
    }

    // Check if admin is impersonating another user
    if (user.roles?.includes("ADMIN") && user.impersonatingUserId && prisma) {
      const impersonatedUser = await prisma.user.findUnique({
        where: { id: user.impersonatingUserId },
      });

      if (impersonatedUser) {
        const normalizedRole = (ROLES[(impersonatedUser.roles?.[0] ?? "VIEWER") as UserRole]?.normalizesTo ?? ((impersonatedUser.roles?.[0] ?? "VIEWER") as UserRole));
        const { roles, access } = serializeAccess(impersonatedUser);
        return withRoleAndImpersonationCookies(NextResponse.json({
          role: normalizedRole,
          roles,
          access,
          found: true,
          isImpersonating: true,
          user: {
            id: impersonatedUser.id,
            email: impersonatedUser.email,
            name: impersonatedUser.name,
            role: normalizedRole,
            roles,
          },
          impersonatedUser: {
            id: impersonatedUser.id,
            email: impersonatedUser.email,
            name: impersonatedUser.name,
            role: normalizedRole,
            roles,
          },
          adminUser: {
            id: user.id,
            email: user.email,
            name: user.name,
          },
        }), normalizedRole, true);
      }
    }

    const normalizedRole = (ROLES[(user.roles?.[0] ?? "VIEWER") as UserRole]?.normalizesTo ?? ((user.roles?.[0] ?? "VIEWER") as UserRole));
    const { roles, access } = serializeAccess(user);
    return withRoleAndImpersonationCookies(NextResponse.json({
      role: normalizedRole,
      roles,
      access,
      found: true,
      isImpersonating: false,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: normalizedRole,
        roles,
      }
    }), normalizedRole, false);
  } catch (error) {
    console.error("Error fetching user role:", error);
    return withRoleAndImpersonationCookies(
      NextResponse.json({ role: "VIEWER", found: false, error: "Fetch failed" }),
      "VIEWER",
      false
    );
  }
}
