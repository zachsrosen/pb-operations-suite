import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma, getUserByEmail } from "@/lib/db";
import { ROLES } from "@/lib/roles";
import type { UserRole } from "@/generated/prisma/enums";

const TAKE_PER_CATEGORY = 5;
const ACTIVITY_WINDOW_DAYS = 30;

interface SearchUser {
  id: string;
  email: string;
  name: string | null;
}
interface SearchRole {
  role: UserRole;
  label: string;
}
interface SearchActivity {
  id: string;
  type: string;
  description: string;
  userEmail: string | null;
  createdAt: string;
}
interface SearchTicket {
  id: string;
  title: string;
  status: string;
  createdAt: string;
}
interface SearchResponse {
  users: SearchUser[];
  roles: SearchRole[];
  activity: SearchActivity[];
  tickets: SearchTicket[];
}

/**
 * GET /api/admin/search?q=<query>
 *
 * Admin-only. Returns up to TAKE_PER_CATEGORY matches across four entity
 * types for a single query string. Partial failures in any one category
 * degrade to an empty array for that category so the dropdown stays useful
 * if e.g. the activity log query times out.
 *
 * Route is already admin-gated via the `/api/admin` prefix in
 * `ADMIN_ONLY_ROUTES`. The handler re-checks from a fresh DB read because
 * the JWT role can be stale (matches the pattern in `/api/admin/users`).
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const currentUser = await getUserByEmail(session.user.email);
  if (!currentUser || !currentUser.roles?.includes("ADMIN")) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const empty: SearchResponse = { users: [], roles: [], activity: [], tickets: [] };

  if (!q) {
    return NextResponse.json(empty);
  }
  if (!prisma) {
    return NextResponse.json(empty);
  }

  const db = prisma;
  const since = new Date(Date.now() - ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const insensitive = { contains: q, mode: "insensitive" as const };

  const [users, activity, tickets] = await Promise.all([
    db.user
      .findMany({
        where: {
          OR: [{ email: insensitive }, { name: insensitive }],
        },
        select: { id: true, email: true, name: true },
        take: TAKE_PER_CATEGORY,
      })
      .catch((e: unknown) => {
        console.error("[admin-search] user query failed:", e);
        return [] as SearchUser[];
      }),
    db.activityLog
      .findMany({
        where: {
          createdAt: { gte: since },
          OR: [{ description: insensitive }, { userEmail: insensitive }],
        },
        select: { id: true, type: true, description: true, userEmail: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: TAKE_PER_CATEGORY,
      })
      .catch((e: unknown) => {
        console.error("[admin-search] activity query failed:", e);
        return [];
      }),
    db.bugReport
      .findMany({
        where: { OR: [{ title: insensitive }, { description: insensitive }] },
        select: { id: true, title: true, status: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: TAKE_PER_CATEGORY,
      })
      .catch((e: unknown) => {
        console.error("[admin-search] ticket query failed:", e);
        return [];
      }),
  ]);

  const qLower = q.toLowerCase();
  const roles: SearchRole[] = (Object.entries(ROLES) as Array<[UserRole, (typeof ROLES)[UserRole]]>)
    .filter(([role, def]) =>
      role.toLowerCase().includes(qLower) ||
      def.label.toLowerCase().includes(qLower),
    )
    .slice(0, TAKE_PER_CATEGORY)
    .map(([role, def]) => ({ role, label: def.label }));

  const response: SearchResponse = {
    users: users.map((u) => ({ id: u.id, email: u.email, name: u.name })),
    roles,
    activity: activity.map((a) => ({
      id: a.id,
      type: String(a.type),
      description: a.description,
      userEmail: a.userEmail,
      createdAt: a.createdAt instanceof Date ? a.createdAt.toISOString() : String(a.createdAt),
    })),
    tickets: tickets.map((t) => ({
      id: t.id,
      title: t.title,
      status: String(t.status),
      createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : String(t.createdAt),
    })),
  };

  return NextResponse.json(response);
}
