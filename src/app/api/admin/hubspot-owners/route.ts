/**
 * GET /api/admin/hubspot-owners
 *
 * Admin-only. Returns a minimal list of HubSpot owners (id, email, name)
 * for the user-detail drawer's HubSpot link picker.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";
import { fetchAllOwnersMinimal, type MinimalHubSpotOwner } from "@/lib/hubspot";
import { appCache } from "@/lib/cache";

const CACHE_KEY = "hubspot:owners:admin-picker";

type OwnerItem = MinimalHubSpotOwner;

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

  const owners: OwnerItem[] = await fetchAllOwnersMinimal();

  owners.sort((a, b) => {
    const an = `${a.lastName ?? ""} ${a.firstName ?? ""}`.trim().toLowerCase();
    const bn = `${b.lastName ?? ""} ${b.firstName ?? ""}`.trim().toLowerCase();
    return an.localeCompare(bn);
  });

  appCache.set(CACHE_KEY, owners);
  return NextResponse.json({ owners });
}
