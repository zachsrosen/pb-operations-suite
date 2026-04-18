import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/auth";
import { prisma, getUserByEmail, updateUserExtraRoutes } from "@/lib/db";
import { logAdminActivity, extractRequestContext } from "@/lib/audit/admin-activity";

/**
 * PUT /api/admin/users/[userId]/extra-routes
 *
 * Option D: per-user extra/denied routes. Replaces both lists wholesale —
 * caller sends the complete desired state. Denied wins over allowed within
 * the same user, and denied even overrides the ADMIN wildcard (see
 * `isPathAllowedByAccess`).
 *
 * Body: { extraAllowedRoutes: string[], extraDeniedRoutes: string[] }
 *
 * Validation:
 *  - Each array must contain strings only, each starting with "/".
 *  - Arrays capped at 50 entries each (prevents runaway state).
 *  - No further canonical route validation — admins can paste any route
 *    including paths that may not exist today; misspellings simply have
 *    no effect. A future enhancement can autocomplete from the Next.js
 *    file-system route map.
 *
 * Audit: one USER_EXTRA_ROUTES_CHANGED activity row (risk=HIGH) with
 * before/after diff in metadata.
 */

const MAX_ENTRIES_PER_LIST = 50;

interface ParsedBody {
  extraAllowedRoutes: string[];
  extraDeniedRoutes: string[];
}

function parseBody(data: unknown): ParsedBody | { error: string } {
  if (!data || typeof data !== "object") {
    return { error: "Body must be a JSON object with extraAllowedRoutes and extraDeniedRoutes arrays" };
  }
  const body = data as { extraAllowedRoutes?: unknown; extraDeniedRoutes?: unknown };

  const validate = (val: unknown, label: string): string[] | { error: string } => {
    if (!Array.isArray(val)) {
      return { error: `${label} must be an array of path strings` };
    }
    if (val.length > MAX_ENTRIES_PER_LIST) {
      return { error: `${label} exceeds max of ${MAX_ENTRIES_PER_LIST} entries` };
    }
    const out: string[] = [];
    for (const raw of val) {
      if (typeof raw !== "string") {
        return { error: `${label} must contain only strings` };
      }
      const trimmed = raw.trim();
      if (!trimmed) continue; // skip blanks silently
      if (!trimmed.startsWith("/")) {
        return { error: `${label} entry "${trimmed}" must start with "/"` };
      }
      out.push(trimmed);
    }
    return out;
  };

  const allowed = validate(body.extraAllowedRoutes, "extraAllowedRoutes");
  if (!Array.isArray(allowed)) return allowed;
  const denied = validate(body.extraDeniedRoutes, "extraDeniedRoutes");
  if (!Array.isArray(denied)) return denied;

  return { extraAllowedRoutes: allowed, extraDeniedRoutes: denied };
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ userId: string }> },
) {
  const { userId } = await context.params;
  if (!userId || typeof userId !== "string") {
    return NextResponse.json({ error: "userId required in path" }, { status: 400 });
  }

  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const currentUser = await getUserByEmail(session.user.email);
  if (!currentUser || !currentUser.roles?.includes("ADMIN")) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }

  const parsed = parseBody(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      extraAllowedRoutes: true,
      extraDeniedRoutes: true,
    },
  });
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const updated = await updateUserExtraRoutes(userId, parsed);

  const headersList = await headers();
  const reqCtx = extractRequestContext(headersList);
  await logAdminActivity({
    type: "USER_EXTRA_ROUTES_CHANGED",
    description: `Updated extra routes for ${target.email}`,
    userId: currentUser.id,
    userEmail: currentUser.email,
    userName: currentUser.name || undefined,
    entityType: "user",
    entityId: target.id,
    entityName: target.email,
    metadata: {
      targetUserId: target.id,
      targetUserEmail: target.email,
      previous: {
        extraAllowedRoutes: target.extraAllowedRoutes,
        extraDeniedRoutes: target.extraDeniedRoutes,
      },
      next: {
        extraAllowedRoutes: parsed.extraAllowedRoutes,
        extraDeniedRoutes: parsed.extraDeniedRoutes,
      },
    },
    ...reqCtx,
  });

  return NextResponse.json({
    success: true,
    user: updated,
  });
}
