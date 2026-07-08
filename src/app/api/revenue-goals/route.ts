import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { getRevenueGoalSnapshot } from "@/lib/revenue-goals";

const ALLOWED_ROLES = ["ADMIN", "OWNER", "OPERATIONS_MANAGER", "PROJECT_MANAGER"];

export async function GET(request: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!ALLOWED_ROLES.includes(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get("year") || String(new Date().getFullYear()), 10);
  const forceRefresh = searchParams.get("refresh") === "true";

  if (isNaN(year) || year < 2020 || year > 2100) {
    return NextResponse.json({ error: "Invalid year" }, { status: 400 });
  }

  try {
    const { data, lastUpdated } = await getRevenueGoalSnapshot(year, forceRefresh);
    return NextResponse.json({ ...data, lastUpdated });
  } catch (error) {
    console.error("[RevenueGoals] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch revenue goals" },
      { status: 500 }
    );
  }
}
