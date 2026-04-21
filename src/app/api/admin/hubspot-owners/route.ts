/**
 * GET /api/admin/hubspot-owners
 *
 * Admin-only. Returns a minimal list of HubSpot owners (id, email, name)
 * for the user-detail drawer's HubSpot link picker.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";
import { hubspotClient } from "@/lib/hubspot";
import { appCache } from "@/lib/cache";

const CACHE_KEY = "hubspot:owners:admin-picker";

interface OwnerItem {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
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

  const cached = appCache.get<OwnerItem[]>(CACHE_KEY);
  if (cached.hit && cached.data) {
    return NextResponse.json({ owners: cached.data });
  }

  const owners: OwnerItem[] = [];
  let after: string | undefined = undefined;
  for (let i = 0; i < 10; i++) {
    const page: { results?: Array<{ id?: string; email?: string; firstName?: string; lastName?: string }>; paging?: { next?: { after?: string } } } =
      await hubspotClient.crm.owners.ownersApi.getPage(undefined, after, 500, false);
    for (const o of page.results ?? []) {
      if (!o.id) continue;
      owners.push({
        id: o.id,
        email: o.email ?? null,
        firstName: o.firstName ?? null,
        lastName: o.lastName ?? null,
      });
    }
    after = page.paging?.next?.after;
    if (!after) break;
  }

  owners.sort((a, b) => {
    const an = `${a.lastName ?? ""} ${a.firstName ?? ""}`.trim().toLowerCase();
    const bn = `${b.lastName ?? ""} ${b.firstName ?? ""}`.trim().toLowerCase();
    return an.localeCompare(bn);
  });

  appCache.set(CACHE_KEY, owners);
  return NextResponse.json({ owners });
}
