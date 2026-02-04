import { NextRequest, NextResponse } from "next/server";
import { ZuperClient, JOB_CATEGORY_UIDS } from "@/lib/zuper";

/**
 * GET /api/zuper/availability
 *
 * Get availability information for scheduling including:
 * - Local crew availability schedules (configured in this file)
 * - Time-off requests from Zuper (unavailable periods)
 * - Already scheduled jobs from Zuper
 *
 * Query params:
 * - from_date: Start date (YYYY-MM-DD) - required
 * - to_date: End date (YYYY-MM-DD) - required
 * - type: Job type (survey, construction, inspection) - maps to category
 * - team_uid: Filter by team
 * - location: Location name to filter by
 */

// Local crew availability configuration
// Based on surveyor shift schedules
interface CrewSchedule {
  name: string;
  location: string; // "DTC", "Westminster", "Colorado Springs", etc.
  reportLocation: string; // Where they report to
  // Days of week: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  schedule: Array<{
    day: number;
    startTime: string; // "HH:mm" format
    endTime: string;
  }>;
  jobTypes: string[]; // "survey", "construction", "inspection"
}

const CREW_SCHEDULES: CrewSchedule[] = [
  // Site Surveyors
  {
    name: "Drew Perry",
    location: "DTC",
    reportLocation: "DTC",
    schedule: [
      { day: 2, startTime: "12:00", endTime: "15:00" }, // Tue
      { day: 4, startTime: "12:00", endTime: "15:00" }, // Thu
    ],
    jobTypes: ["survey"],
  },
  {
    name: "Joe Lynch",
    location: "Westminster",
    reportLocation: "Westminster",
    schedule: [
      { day: 2, startTime: "11:00", endTime: "14:00" }, // Tue
      { day: 4, startTime: "11:00", endTime: "14:00" }, // Thu
    ],
    jobTypes: ["survey"],
  },
  {
    name: "Derek Pomar",
    location: "DTC",
    reportLocation: "DTC",
    schedule: [
      { day: 2, startTime: "12:00", endTime: "16:00" }, // Tue
    ],
    jobTypes: ["survey"],
  },
  {
    name: "Derek Pomar",
    location: "Westminster",
    reportLocation: "Westminster",
    schedule: [
      { day: 3, startTime: "12:00", endTime: "16:00" }, // Wed
    ],
    jobTypes: ["survey"],
  },
  {
    name: "Derek Pomar",
    location: "DTC",
    reportLocation: "DTC",
    schedule: [
      { day: 4, startTime: "12:00", endTime: "16:00" }, // Thu
    ],
    jobTypes: ["survey"],
  },
  {
    name: "Rich",
    location: "Westminster",
    reportLocation: "Westminster",
    schedule: [
      { day: 4, startTime: "11:00", endTime: "14:00" }, // Thu
    ],
    jobTypes: ["survey"],
  },
  {
    name: "Rolando",
    location: "Colorado Springs",
    reportLocation: "Colorado Springs",
    schedule: [
      { day: 1, startTime: "08:00", endTime: "12:00" }, // Mon
      { day: 2, startTime: "08:00", endTime: "12:00" }, // Tue
      { day: 3, startTime: "08:00", endTime: "12:00" }, // Wed
      { day: 4, startTime: "08:00", endTime: "12:00" }, // Thu
      { day: 5, startTime: "08:00", endTime: "12:00" }, // Fri
    ],
    jobTypes: ["survey"],
  },

  // ============================================
  // CONSTRUCTION CREWS - PENDING CONFIGURATION
  // Add construction crew schedules here
  // ============================================
  // Example:
  // {
  //   name: "Construction Crew 1",
  //   location: "DTC",
  //   reportLocation: "DTC",
  //   schedule: [
  //     { day: 1, startTime: "07:00", endTime: "16:00" }, // Mon
  //     { day: 2, startTime: "07:00", endTime: "16:00" }, // Tue
  //     { day: 3, startTime: "07:00", endTime: "16:00" }, // Wed
  //     { day: 4, startTime: "07:00", endTime: "16:00" }, // Thu
  //     { day: 5, startTime: "07:00", endTime: "16:00" }, // Fri
  //   ],
  //   jobTypes: ["construction"],
  // },

  // ============================================
  // INSPECTION CREWS - PENDING CONFIGURATION
  // Add inspection crew schedules here
  // ============================================
  // Example:
  // {
  //   name: "Inspector 1",
  //   location: "DTC",
  //   reportLocation: "DTC",
  //   schedule: [
  //     { day: 1, startTime: "08:00", endTime: "17:00" }, // Mon
  //     { day: 2, startTime: "08:00", endTime: "17:00" }, // Tue
  //     { day: 3, startTime: "08:00", endTime: "17:00" }, // Wed
  //     { day: 4, startTime: "08:00", endTime: "17:00" }, // Thu
  //     { day: 5, startTime: "08:00", endTime: "17:00" }, // Fri
  //   ],
  //   jobTypes: ["inspection"],
  // },
];

// Map location names to normalized versions
const LOCATION_ALIASES: Record<string, string[]> = {
  Westminster: ["Westminster"],
  Centennial: ["Centennial", "DTC"],
  DTC: ["DTC", "Centennial"],
  "Colorado Springs": ["Colorado Springs"],
  "San Luis Obispo": ["San Luis Obispo", "SLO"],
  Camarillo: ["Camarillo"],
};

function getLocationMatches(location: string): string[] {
  return LOCATION_ALIASES[location] || [location];
}

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

  // Map type to category UID for Zuper queries
  const categoryMap: Record<string, string> = {
    survey: JOB_CATEGORY_UIDS.SITE_SURVEY,
    installation: JOB_CATEGORY_UIDS.CONSTRUCTION,
    construction: JOB_CATEGORY_UIDS.CONSTRUCTION,
    inspection: JOB_CATEGORY_UIDS.INSPECTION,
  };

  // Map location to team UID
  const teamMap: Record<string, string> = {
    Westminster: "1c23adb9-cefa-44c7-8506-804949afc56f",
    Centennial: "",
    DTC: "",
    "Colorado Springs": "",
    "San Luis Obispo": "699cec60-f9f8-4e57-b41a-bb29b1f3649c",
    Camarillo: "",
  };

  const resolvedTeamUid = teamUid || (location ? teamMap[location] : undefined);

  // Helper to format time for display (e.g., "12:00" -> "12pm", "08:00" -> "8am")
  const formatTimeForDisplay = (time: string): string => {
    const [hours, minutes] = time.split(":").map(Number);
    const suffix = hours >= 12 ? "pm" : "am";
    const displayHour = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
    return minutes === 0 ? `${displayHour}${suffix}` : `${displayHour}:${minutes.toString().padStart(2, "0")}${suffix}`;
  };

  // Initialize availability by date
  const availabilityByDate: Record<
    string,
    {
      date: string;
      availableSlots: Array<{
        start_time: string;
        end_time: string;
        display_time?: string; // Formatted time range for display
        user_uid?: string;
        user_name?: string;
        location?: string; // Crew member's location
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

  // Generate availability from local crew schedules
  const locationMatches = location ? getLocationMatches(location) : null;
  const jobType = type || "survey";

  for (const crew of CREW_SCHEDULES) {
    // Filter by job type
    if (!crew.jobTypes.includes(jobType)) continue;

    // Filter by location if specified
    if (locationMatches && !locationMatches.includes(crew.location)) continue;

    // Check each date in range
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dayOfWeek = d.getDay();
      const dateStr = d.toISOString().split("T")[0];

      // Check if crew works on this day
      const shifts = crew.schedule.filter((s) => s.day === dayOfWeek);
      for (const shift of shifts) {
        if (availabilityByDate[dateStr]) {
          const displayTime = `${formatTimeForDisplay(shift.startTime)}-${formatTimeForDisplay(shift.endTime)}`;
          availabilityByDate[dateStr].availableSlots.push({
            start_time: shift.startTime,
            end_time: shift.endTime,
            display_time: displayTime,
            user_name: crew.name,
            location: crew.location,
          });
          availabilityByDate[dateStr].hasAvailability = true;
        }
      }
    }
  }

  // Fetch time-offs and scheduled jobs from Zuper if configured
  if (zuper.isConfigured()) {
    const [timeOffResult, jobsResult] = await Promise.all([
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

    // Add time-offs
    if (timeOffResult.type === "success" && timeOffResult.data) {
      for (const to of timeOffResult.data) {
        if (to.status !== "APPROVED") continue;

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

            // Remove this user's availability if they have time off
            if (to.user_name) {
              availabilityByDate[dateStr].availableSlots = availabilityByDate[
                dateStr
              ].availableSlots.filter(
                (slot) =>
                  slot.user_name?.toLowerCase() !== to.user_name?.toLowerCase()
              );
              // Recheck if there's still availability
              availabilityByDate[dateStr].hasAvailability =
                availabilityByDate[dateStr].availableSlots.length > 0;
            }
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
  }

  // Determine if dates are fully booked
  for (const dateStr in availabilityByDate) {
    const day = availabilityByDate[dateStr];
    // A day is fully booked if there are no available slots OR if all slots are covered by time-offs
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
  });
}
