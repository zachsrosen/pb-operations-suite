import { NextRequest, NextResponse } from "next/server";
import { ZuperClient, JOB_CATEGORY_UIDS } from "@/lib/zuper";

/**
 * GET /api/zuper/availability
 *
 * Get availability information for scheduling including:
 * - Available time slots from Zuper Assisted Scheduling
 * - Time-off requests (unavailable periods)
 * - Already scheduled jobs
 *
 * Query params:
 * - from_date: Start date (YYYY-MM-DD) - required
 * - to_date: End date (YYYY-MM-DD) - required
 * - type: Job type (survey, installation, inspection) - maps to category
 * - team_uid: Filter by team
 * - location: Location name to get team UID
 */
export async function GET(request: NextRequest) {
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

  if (!zuper.isConfigured()) {
    return NextResponse.json({
      configured: false,
      availableSlots: [],
      timeOffs: [],
      scheduledJobs: [],
      message: "Zuper not configured",
    });
  }

  // Map type to category UID
  const categoryMap: Record<string, string> = {
    survey: JOB_CATEGORY_UIDS.SITE_SURVEY,
    installation: JOB_CATEGORY_UIDS.CONSTRUCTION,
    inspection: JOB_CATEGORY_UIDS.INSPECTION,
  };

  // Map location to team UID
  const teamMap: Record<string, string> = {
    Westminster: "1c23adb9-cefa-44c7-8506-804949afc56f",
    Centennial: "",
    "Colorado Springs": "",
    "San Luis Obispo": "699cec60-f9f8-4e57-b41a-bb29b1f3649c",
    Camarillo: "",
  };

  const resolvedTeamUid = teamUid || (location ? teamMap[location] : undefined);

  // Fetch all data in parallel
  const [slotsResult, timeOffResult, jobsResult] = await Promise.all([
    zuper.getAssistedSchedulingSlots({
      fromDate,
      toDate,
      jobCategory: type ? categoryMap[type] : undefined,
      teamUid: resolvedTeamUid,
      duration: type === "survey" ? 120 : 480,
    }),
    zuper.getTimeOffRequests({
      fromDate,
      toDate,
    }),
    zuper.getScheduledJobsForDateRange({
      fromDate,
      toDate,
      teamUid: resolvedTeamUid,
    }),
  ]);

  // Process availability by date
  const availabilityByDate: Record<
    string,
    {
      date: string;
      availableSlots: Array<{
        start_time: string;
        end_time: string;
        user_uid?: string;
        user_name?: string;
      }>;
      timeOffs: Array<{
        user_name?: string;
        all_day?: boolean;
        start_time?: string;
        end_time?: string;
      }>;
      scheduledJobs: Array<{
        job_title: string;
        start_time?: string;
        end_time?: string;
      }>;
      hasAvailability: boolean;
      isFullyBooked: boolean;
    }
  > = {};

  // Initialize dates in range
  const start = new Date(fromDate);
  const end = new Date(toDate);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split("T")[0];
    availabilityByDate[dateStr] = {
      date: dateStr,
      availableSlots: [],
      timeOffs: [],
      scheduledJobs: [],
      hasAvailability: false,
      isFullyBooked: false,
    };
  }

  // Add available slots
  if (slotsResult.type === "success" && slotsResult.data) {
    for (const slot of slotsResult.data) {
      if (availabilityByDate[slot.date]) {
        availabilityByDate[slot.date].availableSlots.push({
          start_time: slot.start_time,
          end_time: slot.end_time,
          user_uid: slot.user_uid,
          user_name: slot.user_name,
        });
        if (slot.available) {
          availabilityByDate[slot.date].hasAvailability = true;
        }
      }
    }
  }

  // Add time-offs
  if (timeOffResult.type === "success" && timeOffResult.data) {
    for (const to of timeOffResult.data) {
      if (to.status !== "APPROVED") continue;

      // Time-off can span multiple days
      const toStart = new Date(to.start_date);
      const toEnd = new Date(to.end_date);
      for (let d = new Date(toStart); d <= toEnd; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split("T")[0];
        if (availabilityByDate[dateStr]) {
          availabilityByDate[dateStr].timeOffs.push({
            user_name: to.user_name,
            all_day: to.all_day,
            start_time: to.start_time,
            end_time: to.end_time,
          });
        }
      }
    }
  }

  // Add scheduled jobs
  if (jobsResult.type === "success" && jobsResult.data) {
    for (const job of jobsResult.data) {
      if (job.scheduled_start_time) {
        const dateStr = job.scheduled_start_time.split("T")[0];
        if (availabilityByDate[dateStr]) {
          availabilityByDate[dateStr].scheduledJobs.push({
            job_title: job.job_title,
            start_time: job.scheduled_start_time,
            end_time: job.scheduled_end_time,
          });
        }
      }
    }
  }

  // Determine if dates are fully booked
  for (const dateStr in availabilityByDate) {
    const day = availabilityByDate[dateStr];
    // A day is fully booked if there are no available slots OR if there are time-offs covering the whole day
    day.isFullyBooked =
      day.availableSlots.length === 0 ||
      day.timeOffs.some((to) => to.all_day);
  }

  return NextResponse.json({
    configured: true,
    fromDate,
    toDate,
    type,
    location,
    availabilityByDate,
    // Also return raw data for advanced use
    rawSlots: slotsResult.data || [],
    rawTimeOffs: timeOffResult.data || [],
    rawJobs: jobsResult.data || [],
  });
}
