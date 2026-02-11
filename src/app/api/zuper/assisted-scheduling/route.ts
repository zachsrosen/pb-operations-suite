import { NextRequest, NextResponse } from "next/server";
import { ZuperClient, JOB_CATEGORY_UIDS } from "@/lib/zuper";
import { requireApiAuth } from "@/lib/api-auth";

/**
 * GET /api/zuper/assisted-scheduling
 *
 * Get available time slots for scheduling via Zuper's Assisted Scheduling
 *
 * Query params:
 * - from_date: Start date (YYYY-MM-DD) - required
 * - to_date: End date (YYYY-MM-DD) - required
 * - type: Job type (survey, installation, inspection) - maps to category
 * - team_uid: Filter by team
 * - location: Location name to get team UID
 */
export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const zuper = new ZuperClient();
  const { searchParams } = new URL(request.url);

  const fromDate = searchParams.get("from_date");
  const toDate = searchParams.get("to_date");
  const type = searchParams.get("type");
  const teamUid = searchParams.get("team_uid");
  const location = searchParams.get("location");

  if (!fromDate || !toDate) {
    return NextResponse.json(
      { error: "from_date and to_date are required" },
      { status: 400 }
    );
  }

  // Map type to category UID
  const categoryMap: Record<string, string> = {
    survey: JOB_CATEGORY_UIDS.SITE_SURVEY,
    installation: JOB_CATEGORY_UIDS.CONSTRUCTION,
    inspection: JOB_CATEGORY_UIDS.INSPECTION,
  };

  // Map location to team UID (you may need to fetch these from Zuper or configure them)
  const teamMap: Record<string, string> = {
    "Westminster": "1c23adb9-cefa-44c7-8506-804949afc56f",
    "Centennial": "", // Add actual team UID
    "Colorado Springs": "", // Add actual team UID
    "San Luis Obispo": "699cec60-f9f8-4e57-b41a-bb29b1f3649c",
    "Camarillo": "", // Add actual team UID
  };

  const result = await zuper.getAssistedSchedulingSlots({
    fromDate,
    toDate,
    jobCategory: type ? categoryMap[type] : undefined,
    teamUid: teamUid || (location ? teamMap[location] : undefined),
    duration: type === "survey" ? 120 : 480, // 2 hours for surveys, 8 hours for installs
  });

  if (result.type === "error") {
    return NextResponse.json(
      { error: result.error, slots: [] },
      { status: 500 }
    );
  }

  return NextResponse.json({
    slots: result.data || [],
    fromDate,
    toDate,
    type,
  });
}
