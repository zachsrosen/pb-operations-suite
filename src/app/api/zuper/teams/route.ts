import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { zuper } from "@/lib/zuper";

/**
 * GET /api/zuper/teams
 *
 * Get all teams from Zuper
 * Useful for finding team UIDs for user assignment
 */
export async function GET() {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  if (!zuper.isConfigured()) {
    return NextResponse.json(
      { error: "Zuper integration not configured", configured: false },
      { status: 503 }
    );
  }

  try {
    const result = await zuper.getTeams();

    if (result.type === "error") {
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      teams: result.data,
    });
  } catch (error) {
    console.error("Error fetching teams:", error);
    return NextResponse.json(
      { error: "Failed to fetch teams", details: String(error) },
      { status: 500 }
    );
  }
}
