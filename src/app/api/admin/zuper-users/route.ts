/**
 * GET /api/admin/zuper-users
 *
 * Admin-only. Returns a minimal list of active Zuper users (uid, email, name)
 * for the user-detail drawer's Zuper link picker. Mirrors
 * /api/admin/hubspot-owners (cached 5 min).
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";
import { zuper, type ZuperUser } from "@/lib/zuper";
import { appCache } from "@/lib/cache";

const CACHE_KEY = "zuper:users:admin-picker";

interface ZuperUserItem {
  uid: string;
  email: string | null;
  name: string;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const me = await getUserByEmail(session.user.email);
  if (!me?.roles?.includes("ADMIN")) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const cached = appCache.get<ZuperUserItem[]>(CACHE_KEY);
  if (cached.hit && cached.data) {
    return NextResponse.json({ users: cached.data });
  }

  const result = await zuper.getUsers("admin:zuper-users-picker");
  if (result.type !== "success" || !result.data) {
    return NextResponse.json(
      { error: result.error || result.message || "Failed to fetch Zuper users" },
      { status: 502 },
    );
  }

  const users: ZuperUserItem[] = result.data
    // is_active exists on the wire even though the minimal ZuperUser
    // interface omits it (see sync-zuper/route.ts precedent).
    .filter((u) => (u as ZuperUser & { is_active?: boolean }).is_active !== false)
    .map((u) => ({
      uid: u.user_uid,
      email: u.email ?? null,
      name: `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim(),
    }))
    .filter((u) => !!u.uid);

  users.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  appCache.set(CACHE_KEY, users);
  return NextResponse.json({ users });
}
