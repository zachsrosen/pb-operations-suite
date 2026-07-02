import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/db";
import { isTeamActivityEnabled } from "@/lib/team-activity/flag";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/team-activity/users?q=<query>
 *
 * Directory typeahead for the "look up anyone" section. ADMIN-only, flag-gated.
 * Searches synced Users by name or email; returns up to 12 matches.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.roles.includes("ADMIN")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await isTeamActivityEnabled())) {
    return NextResponse.json({ error: "Team Activity dashboard is disabled" }, { status: 503 });
  }

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ users: [] });

  const users = await prisma.user.findMany({
    where: {
      OR: [
        { email: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
      ],
    },
    select: { email: true, name: true },
    orderBy: { name: "asc" },
    take: 12,
  });

  return NextResponse.json({ users: users.map((u) => ({ email: u.email, name: u.name ?? u.email })) });
}
