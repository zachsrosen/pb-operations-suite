import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";
import { isPathAllowedByAccess, resolveUserAccess } from "@/lib/user-access";
import {
  getPropertyHub,
  getPropertyHubCounts,
  type HubTab,
} from "@/lib/property-hub";

export const maxDuration = 30;

const VALID_TABS: HubTab[] = [
  "activity",
  "deals",
  "tickets",
  "jobs",
  "schedule",
  "equipment",
  "photos",
  "monitoring",
];

/**
 * GET /api/properties/[id]/hub?tab=activity&offset=0&limit=25
 *
 * Single route, `tab` parameter determines payload shape.
 * `tab=counts` returns badge counts for all tabs (used by drawer).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const user = await getUserByEmail(session.user.email);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 403 });
    }

    if (!isPathAllowedByAccess(resolveUserAccess(user), "/api/properties")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const url = new URL(req.url);
    const tabParam = url.searchParams.get("tab") ?? "activity";

    // Special case: counts for drawer badges
    if (tabParam === "counts") {
      const counts = await getPropertyHubCounts(id);
      return NextResponse.json(counts);
    }

    if (!VALID_TABS.includes(tabParam as HubTab)) {
      return NextResponse.json(
        { error: `Invalid tab: ${tabParam}` },
        { status: 400 },
      );
    }

    const tab = tabParam as HubTab;
    const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);
    const limit = parseInt(url.searchParams.get("limit") ?? "25", 10);

    const result = await getPropertyHub(id, tab, { offset, limit });
    return NextResponse.json(result.data);
  } catch (error) {
    console.error("[PropertyHub API] Error:", error);
    return NextResponse.json(
      { error: "Failed to load property hub data" },
      { status: 500 },
    );
  }
}
