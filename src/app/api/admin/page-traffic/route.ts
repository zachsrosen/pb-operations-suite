import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getPageTraffic, type TrafficWindow } from "@/lib/page-traffic";

const WINDOWS: TrafficWindow[] = ["7d", "30d", "90d", "all"];

/** GET /api/admin/page-traffic?window=30d&roles=ADMIN,SALES&locations=Westminster */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const sp = request.nextUrl.searchParams;
  const windowParam = (sp.get("window") || "30d") as TrafficWindow;
  const window: TrafficWindow = WINDOWS.includes(windowParam) ? windowParam : "30d";
  const roles = sp.get("roles")?.split(",").map((s) => s.trim()).filter(Boolean);
  const locations = sp.get("locations")?.split(",").map((s) => s.trim()).filter(Boolean);

  try {
    const data = await getPageTraffic({ window, roles, locations });
    return NextResponse.json({ ...data, window, generatedAt: new Date().toISOString() });
  } catch (e) {
    console.error("page-traffic aggregation failed:", e);
    return NextResponse.json({ error: "Failed to compute page traffic" }, { status: 500 });
  }
}
