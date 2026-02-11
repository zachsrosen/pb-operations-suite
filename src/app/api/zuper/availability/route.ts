import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { ZuperClient, JOB_CATEGORY_UIDS } from "@/lib/zuper";
import { getCrewSchedulesFromDB, getAvailabilityOverrides } from "@/lib/db";

/**
 * GET /api/zuper/availability
 *
 * Get availability information for scheduling including:
 * - Local crew availability schedules (configured in this file)
 * - Time-off requests from Zuper (unavailable periods)
 * - Already scheduled jobs from Zuper
 * - Locally booked 1-hour slots
 *
 * Query params:
 * - from_date: Start date (YYYY-MM-DD) - required
 * - to_date: End date (YYYY-MM-DD) - required
 * - type: Job type (survey, construction, inspection) - maps to category
 * - team_uid: Filter by team
 * - location: Location name to filter by
 *
 * POST /api/zuper/availability
 *
 * Book a 1-hour time slot
 * Body: { date, startTime, endTime, userName, location, projectId, projectName }
 *
 * DELETE /api/zuper/availability
 *
 * Remove a booked slot
 * Body: { date, startTime, userName }
 */

// In-memory store for booked slots
// In production, this should be stored in a database
// Format: { "2025-02-05|Drew Perry|12:00": { projectId, projectName, ... } }
interface BookedSlot {
  date: string;
  startTime: string;
  endTime: string;
  userName: string;
  userUid?: string; // Zuper user UID for assignment tracking
  location: string;
  projectId: string;
  projectName: string;
  bookedAt: string;
  // Track the Zuper job UID if we created/scheduled this
  zuperJobUid?: string;
}

// This will persist across requests within the same server instance
// but will reset on redeploy - for production, use a database
const bookedSlots: Map<string, BookedSlot> = new Map();

function getSlotKey(date: string, userName: string, startTime: string): string {
  return `${date}|${userName}|${startTime}`;
}

// Local crew availability configuration
// Based on surveyor shift schedules
interface CrewSchedule {
  crewMemberId?: string; // DB crew member ID (undefined for hardcoded fallback)
  name: string;
  location: string; // "DTC", "Westminster", "Colorado Springs", etc.
  reportLocation: string; // Where they report to
  // Days of week: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  schedule: Array<{
    day: number;
    startTime: string; // "HH:mm" format in the crew's LOCAL timezone
    endTime: string;
    availabilityId?: string; // DB availability record ID (for linking overrides)
  }>;
  jobTypes: string[]; // "survey", "construction", "inspection"
  userUid?: string; // Zuper user UID for assignments
  teamUid?: string; // Zuper team UID (required for assignment API)
  timezone?: string; // IANA timezone (defaults to "America/Denver" for CO locations)
}

// Location → timezone mapping
const LOCATION_TIMEZONE: Record<string, string> = {
  Westminster: "America/Denver",
  Centennial: "America/Denver",
  DTC: "America/Denver",
  "Colorado Springs": "America/Denver",
  "San Luis Obispo": "America/Los_Angeles",
  Camarillo: "America/Los_Angeles",
};

// Team and user UIDs are now resolved dynamically from Zuper API (cached in ZuperClient).
// Location names used for team resolution:
const TEAM_LOCATION_NAMES: Record<string, string> = {
  Westminster: "Westminster",
  Centennial: "Centennial",
  DTC: "Centennial", // DTC is part of Centennial team
  "Colorado Springs": "Colorado Springs",
  "San Luis Obispo": "San Luis Obispo",
  Camarillo: "Camarillo",
};

const CREW_SCHEDULES: CrewSchedule[] = [
  // Site Surveyors — userUid and teamUid are resolved dynamically from Zuper API
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
    name: "Ryszard Szymanski",
    location: "Westminster",
    reportLocation: "Westminster",
    schedule: [
      { day: 2, startTime: "11:00", endTime: "14:00" }, // Tue 11am-2pm
      { day: 3, startTime: "09:00", endTime: "12:00" }, // Wed 9am-12pm
      { day: 4, startTime: "11:00", endTime: "14:00" }, // Thu 11am-2pm
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

  // Nick Scarpellino — California locations (times in Pacific Time)
  {
    name: "Nick Scarpellino",
    location: "San Luis Obispo",
    reportLocation: "San Luis Obispo",
    timezone: "America/Los_Angeles",
    schedule: [
      { day: 1, startTime: "08:00", endTime: "10:00" }, // Mon 8-10am PT
      { day: 2, startTime: "08:00", endTime: "10:00" }, // Tue 8-10am PT
      { day: 4, startTime: "08:00", endTime: "10:00" }, // Thu 8-10am PT
    ],
    jobTypes: ["survey"],
  },
  {
    name: "Nick Scarpellino",
    location: "Camarillo",
    reportLocation: "Camarillo",
    timezone: "America/Los_Angeles",
    schedule: [
      { day: 3, startTime: "09:30", endTime: "11:30" }, // Wed 9:30-11:30am PT
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
  // INSPECTION CREWS
  // ============================================
  {
    name: "Daniel Kelly",
    location: "DTC",
    reportLocation: "DTC",
    schedule: [
      { day: 2, startTime: "08:00", endTime: "15:00" }, // Tue 8am-3pm
      { day: 3, startTime: "08:00", endTime: "15:00" }, // Wed 8am-3pm
      { day: 4, startTime: "08:00", endTime: "15:00" }, // Thu 8am-3pm
      { day: 5, startTime: "08:00", endTime: "15:00" }, // Fri 8am-3pm
    ],
    jobTypes: ["inspection"],
  },
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

  // Map type to category UID for Zuper queries
  const categoryMap: Record<string, string> = {
    survey: JOB_CATEGORY_UIDS.SITE_SURVEY,
    installation: JOB_CATEGORY_UIDS.CONSTRUCTION,
    construction: JOB_CATEGORY_UIDS.CONSTRUCTION,
    inspection: JOB_CATEGORY_UIDS.INSPECTION,
  };

  // Resolve team UIDs dynamically from Zuper API
  const teamMap: Record<string, string> = {};
  for (const [loc, teamName] of Object.entries(TEAM_LOCATION_NAMES)) {
    const resolved = await zuper.resolveTeamUid(teamName);
    if (resolved) teamMap[loc] = resolved;
  }

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
        start_time: string; // HH:mm in the crew's local timezone
        end_time: string;
        display_time?: string; // Formatted time range for display (local tz)
        user_uid?: string;
        team_uid?: string; // Zuper team UID (required for assignment API)
        user_name?: string;
        location?: string; // Crew member's location
        timezone?: string; // IANA timezone for this slot (e.g. "America/Los_Angeles")
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

  // Helper to generate 1-hour time slots from a time range
  const generateHourlySlots = (startTime: string, endTime: string): Array<{ start: string; end: string }> => {
    const slots: Array<{ start: string; end: string }> = [];
    const [startHour, startMin] = startTime.split(":").map(Number);
    const [endHour, endMin] = endTime.split(":").map(Number);

    let currentHour = startHour;
    const currentMin = startMin;

    while (currentHour < endHour || (currentHour === endHour && currentMin < endMin)) {
      const slotStart = `${currentHour.toString().padStart(2, "0")}:${currentMin.toString().padStart(2, "0")}`;

      // Move to next hour
      currentHour += 1;
      if (currentHour > endHour || (currentHour === endHour && currentMin >= endMin)) {
        // Last slot ends at the shift end time
        slots.push({ start: slotStart, end: endTime });
        break;
      }

      const slotEnd = `${currentHour.toString().padStart(2, "0")}:${currentMin.toString().padStart(2, "0")}`;
      slots.push({ start: slotStart, end: slotEnd });
    }

    return slots;
  };

  // Generate availability from local crew schedules
  const locationMatches = location ? getLocationMatches(location) : null;
  const jobType = type || "survey";

  // Try loading crew schedules from DB first, fall back to hardcoded
  let activeSchedules = CREW_SCHEDULES;
  try {
    const dbSchedules = await getCrewSchedulesFromDB();
    if (dbSchedules.length > 0) {
      activeSchedules = dbSchedules.map(s => ({
        crewMemberId: s.crewMemberId,
        name: s.name,
        location: s.location,
        reportLocation: s.reportLocation,
        schedule: s.schedule,
        jobTypes: s.jobTypes,
        userUid: s.userUid,
        teamUid: s.teamUid,
        timezone: s.timezone,
      }));
      console.log(`[Zuper Availability] Using ${dbSchedules.length} crew schedules from DB`);
    } else {
      console.log("[Zuper Availability] No DB schedules found, using hardcoded fallback");
    }
  } catch (dbErr) {
    console.warn("[Zuper Availability] Failed to load DB schedules, using hardcoded fallback:", dbErr);
  }

  // Load date-specific overrides (blocked dates, custom slots)
  const overridesMap = new Map<string, Array<{ availabilityId: string | null; type: string }>>();
  try {
    const overrides = await getAvailabilityOverrides({ dateFrom: fromDate!, dateTo: toDate! });
    for (const ov of overrides) {
      const key = `${ov.crewMemberId}|${ov.date}`;
      if (!overridesMap.has(key)) overridesMap.set(key, []);
      overridesMap.get(key)!.push({
        availabilityId: ov.availabilityId,
        type: ov.type,
      });
    }
    if (overrides.length > 0) {
      console.log(`[Zuper Availability] Loaded ${overrides.length} date overrides`);
    }
  } catch (ovErr) {
    console.warn("[Zuper Availability] Failed to load overrides:", ovErr);
  }

  // Resolve all unique crew member names to Zuper UIDs (one API call, cached)
  const crewNames = [...new Set(activeSchedules.map(c => c.name))];
  const resolvedCrewUids: Record<string, { userUid: string; teamUid?: string }> = {};
  const uidToDisplayName: Record<string, string> = {};
  for (const name of crewNames) {
    const resolved = await zuper.resolveUserUid(name);
    if (resolved) {
      resolvedCrewUids[name] = resolved;
      uidToDisplayName[resolved.userUid] = name;
    }
  }

  for (const crew of activeSchedules) {
    // Filter by job type
    if (!crew.jobTypes.includes(jobType)) continue;

    // Filter by location if specified
    if (locationMatches && !locationMatches.includes(crew.location)) continue;

    // Resolve userUid and teamUid dynamically from Zuper API
    const resolved = resolvedCrewUids[crew.name];
    const crewUserUid = crew.userUid || resolved?.userUid;
    // Prefer team from user's Zuper profile, fall back to location-based team map
    const crewTeamUid = crew.teamUid || resolved?.teamUid || teamMap[crew.location];
    if (crewUserUid) {
      console.log(`[Zuper Availability] Crew "${crew.name}" resolved UID: ${crewUserUid}, Team: ${crewTeamUid || "none"}`);
    } else {
      console.log(`[Zuper Availability] Could not resolve UID for crew "${crew.name}"`);
    }

    // Determine crew timezone
    const crewTimezone = crew.timezone || LOCATION_TIMEZONE[crew.location] || "America/Denver";
    const isPacific = crewTimezone === "America/Los_Angeles";
    const tzSuffix = isPacific ? " PT" : "";

    // Check each date in range
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dayOfWeek = d.getDay();
      const dateStr = d.toISOString().split("T")[0];

      // Check if crew works on this day
      const shifts = crew.schedule.filter((s) => s.day === dayOfWeek);
      for (const shift of shifts) {
        if (availabilityByDate[dateStr]) {
          // Check for date-specific overrides (blocked dates)
          if (crew.crewMemberId) {
            const dateOverrides = overridesMap.get(`${crew.crewMemberId}|${dateStr}`) || [];
            const isBlocked = dateOverrides.some(ov =>
              ov.type === "blocked" &&
              (!ov.availabilityId || ov.availabilityId === shift.availabilityId)
            );
            if (isBlocked) continue; // Skip this shift for this specific date
          }

          // Generate 1-hour slots for this shift (times are in crew's local timezone)
          const hourlySlots = generateHourlySlots(shift.startTime, shift.endTime);

          for (const slot of hourlySlots) {
            const displayTime = `${formatTimeForDisplay(slot.start)}-${formatTimeForDisplay(slot.end)}${tzSuffix}`;
            availabilityByDate[dateStr].availableSlots.push({
              start_time: slot.start,
              end_time: slot.end,
              display_time: displayTime,
              user_uid: crewUserUid, // Include Zuper user UID for assignment
              team_uid: crewTeamUid, // Include Zuper team UID (required for assignment API)
              user_name: crew.name,
              location: crew.location,
              timezone: isPacific ? crewTimezone : undefined, // Only include if non-default
            });
          }
          availabilityByDate[dateStr].hasAvailability = true;
        }
      }
    }
  }

  // Temporary map for Zuper-sourced bookings (rebuilt fresh each request).
  // Zuper is the source of truth for its own data — these are NOT stored persistently.
  const zuperBookings: Map<string, BookedSlot> = new Map();
  // Track Zuper job UIDs we see so we can clean up stale app-booked entries
  const zuperJobUids = new Set<string>();

  // Fetch time-offs and scheduled jobs from Zuper if configured
  if (zuper.isConfigured()) {
    // Get the category UID for filtering jobs
    const categoryUid = type ? categoryMap[type] : undefined;

    const [timeOffResult, jobsResult] = await Promise.all([
      zuper.getTimeOffRequests({
        fromDate,
        toDate,
      }),
      zuper.getScheduledJobsForDateRange({
        fromDate,
        toDate,
        teamUid: resolvedTeamUid,
        categoryUid, // Filter by job category (survey, construction, inspection)
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

    // Helper: convert UTC date to local time in a given timezone
    const utcToLocalTime = (utcDate: Date, tz: string): { dateStr: string; hour: number; minute: number } => {
      const localDateStr = utcDate.toLocaleDateString('en-CA', { timeZone: tz });
      const localHour = parseInt(utcDate.toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', hour12: false }));
      const localMinute = parseInt(utcDate.toLocaleTimeString('en-US', { timeZone: tz, minute: '2-digit', hour12: false }).split(':')[1] || '0');
      return { dateStr: localDateStr, hour: localHour, minute: localMinute };
    };

    // Helper: extract HubSpot Deal ID from Zuper job custom fields
    // Zuper jobs may have "HubSpot Deal ID" (numeric) or "Hubspot Deal Link" (URL) fields
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const getHubSpotDealId = (job: any): string | null => {
      const fields = job.custom_fields;
      if (!fields || !Array.isArray(fields)) return null;
      // Try direct numeric ID field first
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dealIdField = fields.find((f: any) => f.label?.toLowerCase() === "hubspot deal id");
      if (dealIdField?.value) return dealIdField.value;
      // Fall back to extracting ID from the deal link URL
      // Format: "https://app.hubspot.com/contacts/PORTAL_ID/record/0-3/DEAL_ID"
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dealLinkField = fields.find((f: any) => f.label?.toLowerCase().includes("hubspot") && f.label?.toLowerCase().includes("link"));
      if (dealLinkField?.value) {
        const urlMatch = dealLinkField.value.match(/\/record\/0-3\/(\d+)/);
        if (urlMatch) return urlMatch[1];
      }
      return null;
    };

    // Add scheduled jobs and mark those time slots as booked
    if (jobsResult.type === "success" && jobsResult.data) {
      for (const job of jobsResult.data) {
        if (job.scheduled_start_time) {
          // Parse the scheduled time - Zuper returns UTC times
          const scheduledDate = new Date(job.scheduled_start_time);

          // Default: convert to Mountain Time for date/logging
          const mtLocal = utcToLocalTime(scheduledDate, 'America/Denver');
          const dateStr = mtLocal.dateStr;

          if (job.job_uid) zuperJobUids.add(job.job_uid);

          if (availabilityByDate[dateStr]) {

            availabilityByDate[dateStr].scheduledJobs.push({
              job_title: job.job_title,
              start_time: job.scheduled_start_time,
              end_time: job.scheduled_end_time,
            });

            // Get assigned user's info from the job
            // Zuper assigned_to is an array of { user: { first_name, last_name, user_uid } }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const assignedUserData = (job as any).assigned_to?.[0]?.user;
            const assignedUserName = assignedUserData
              ? `${assignedUserData.first_name || ""} ${assignedUserData.last_name || ""}`.trim()
              : "";
            const assignedUserUid = assignedUserData?.user_uid || "";

            // Extract HubSpot deal ID so frontend can match by project ID directly
            const hubspotDealId = getHubSpotDealId(job);
            // Use HubSpot deal ID as projectId when available, fall back to job_uid
            const slotProjectId = hubspotDealId || job.job_uid || "";

            // Log for debugging
            console.log(`[Zuper Availability] Job: ${job.job_title}`);
            console.log(`[Zuper Availability] Scheduled UTC: ${job.scheduled_start_time}`);
            console.log(`[Zuper Availability] MT date: ${dateStr}`);
            console.log(`[Zuper Availability] Assigned user from Zuper: "${assignedUserName}" (uid: ${assignedUserUid})`);

            // Find matching crew member - ONLY if we know who it's assigned to
            let matchingSlot = null;
            if (assignedUserUid || assignedUserName) {
              // Primary: match by user UID with timezone-aware time comparison
              if (assignedUserUid) {
                matchingSlot = availabilityByDate[dateStr].availableSlots.find(slot => {
                  if (slot.user_uid !== assignedUserUid) return false;
                  const slotTz = slot.timezone || 'America/Denver';
                  const localTime = utcToLocalTime(scheduledDate, slotTz);
                  const localStartTime = `${localTime.hour.toString().padStart(2, "0")}:${localTime.minute.toString().padStart(2, "0")}`;
                  return slot.start_time === localStartTime || slot.start_time === `${localTime.hour.toString().padStart(2, "0")}:00`;
                });
                console.log(`[Zuper Availability] UID match for ${assignedUserUid}: ${matchingSlot ? `${matchingSlot.user_name} @ ${matchingSlot.start_time}` : "none"}`);
              }

              // Fallback: match by first name (case insensitive) with timezone-aware time
              if (!matchingSlot && assignedUserName) {
                const firstName = assignedUserName.split(" ")[0].toLowerCase();
                matchingSlot = availabilityByDate[dateStr].availableSlots.find(slot => {
                  if (!slot.user_name?.toLowerCase().includes(firstName)) return false;
                  const slotTz = slot.timezone || 'America/Denver';
                  const localTime = utcToLocalTime(scheduledDate, slotTz);
                  const localStartTime = `${localTime.hour.toString().padStart(2, "0")}:${localTime.minute.toString().padStart(2, "0")}`;
                  return slot.start_time === localStartTime || slot.start_time === `${localTime.hour.toString().padStart(2, "0")}:00`;
                });
                console.log(`[Zuper Availability] Name match for "${firstName}": ${matchingSlot ? `${matchingSlot.user_name} @ ${matchingSlot.start_time}` : "none"}`);
              }

              console.log(`[Zuper Availability] Available slots for this date:`, availabilityByDate[dateStr].availableSlots.map(s => `${s.user_name} (${s.user_uid}) @ ${s.start_time}`));
            } else {
              console.log(`[Zuper Availability] Job "${job.job_title}" has no assigned user - not auto-matching to slots`);
            }

            if (matchingSlot) {
              // Use the MATCHED SLOT's start_time for the key — this is in the crew member's
              // local timezone and matches the available slot key used in the merge phase.
              // Previously we used MT-converted time here, which caused key mismatches for
              // non-Mountain-Time crew (e.g., California/Pacific Time).
              const slotLocalStart = matchingSlot.start_time;
              console.log(`[Zuper Availability] Matched slot: ${matchingSlot.user_name} @ ${slotLocalStart}`);
              const key = getSlotKey(dateStr, matchingSlot.user_name || "", slotLocalStart);
              const slotLocalHour = parseInt(slotLocalStart.split(":")[0]);
              // Store in temporary zuperBookings (NOT persistent bookedSlots)
              zuperBookings.set(key, {
                date: dateStr,
                startTime: slotLocalStart,
                endTime: `${(slotLocalHour + 1).toString().padStart(2, "0")}:00`,
                userName: matchingSlot.user_name || "",
                location: matchingSlot.location || "",
                projectId: slotProjectId,
                projectName: job.job_title,
                bookedAt: new Date().toISOString(),
                zuperJobUid: job.job_uid,
              });
              console.log(`[Zuper Availability] Zuper-sourced booking: ${key}`);
            } else if (assignedUserUid || assignedUserName) {
              // No matching availability slot found, but the job IS assigned and scheduled in Zuper.
              // Determine the user's timezone from their crew schedule or default to MT.
              const displayName = (assignedUserUid && uidToDisplayName[assignedUserUid]) || assignedUserName;
              const crewEntry = activeSchedules.find(c => c.name === displayName);
              const userTz = crewEntry?.timezone || LOCATION_TIMEZONE[crewEntry?.location || ""] || 'America/Denver';
              const localTime = utcToLocalTime(scheduledDate, userTz);
              const localStartTime = `${localTime.hour.toString().padStart(2, "0")}:00`;
              const localHour = localTime.hour;
              const endTime = `${(localHour + 1).toString().padStart(2, "0")}:00`;
              // Also check if the date differs in the user's local timezone
              const localDateStr = localTime.dateStr;
              const effectiveDateStr = availabilityByDate[localDateStr] ? localDateStr : dateStr;
              const key = getSlotKey(effectiveDateStr, displayName, localStartTime);
              // Store in temporary zuperBookings (NOT persistent bookedSlots)
              zuperBookings.set(key, {
                date: effectiveDateStr,
                startTime: localStartTime,
                endTime,
                userName: displayName,
                location: crewEntry?.location || "",
                projectId: slotProjectId,
                projectName: job.job_title,
                bookedAt: new Date().toISOString(),
                zuperJobUid: job.job_uid,
              });
              console.log(`[Zuper Availability] Injected Zuper booking for ${displayName} @ ${localStartTime} ${userTz} (no configured schedule slot): ${key}`);
            } else {
              // Job has no assigned user — still create a booking so the frontend
              // can match by zuperJobUid and show the job is scheduled
              const mtStartTime = `${mtLocal.hour.toString().padStart(2, "0")}:00`;
              const startHour = mtLocal.hour;
              const endTime = `${(startHour + 1).toString().padStart(2, "0")}:00`;
              const key = getSlotKey(dateStr, "Unassigned", mtStartTime);
              zuperBookings.set(key, {
                date: dateStr,
                startTime: mtStartTime,
                endTime,
                userName: "Unassigned",
                location: "",
                projectId: slotProjectId,
                projectName: job.job_title,
                bookedAt: new Date().toISOString(),
                zuperJobUid: job.job_uid,
              });
              console.log(`[Zuper Availability] Unassigned Zuper job booking: ${key} (${job.job_title})`);
            }
          }
        }
      }
    }
  }

  // Clean up stale app-booked entries from the persistent Map.
  // If Zuper now has a live job for the same slot key, or if the app-booked
  // entry is older than 5 minutes and has a zuperJobUid (meaning Zuper owns it),
  // remove it so the fresh Zuper data takes precedence.
  const STALE_THRESHOLD_MS = 5 * 60 * 1000;
  const now = Date.now();
  for (const [key, slot] of bookedSlots.entries()) {
    if (slot.date >= fromDate && slot.date <= toDate) {
      // If Zuper now has a booking for this exact slot key, remove the app-booked one
      if (zuperBookings.has(key)) {
        bookedSlots.delete(key);
        continue;
      }
      // If this app-booked entry references a Zuper job that's still active,
      // remove it so the fresh Zuper data (which may have different time/user) takes over
      if (slot.zuperJobUid && zuperJobUids.has(slot.zuperJobUid)) {
        bookedSlots.delete(key);
        continue;
      }
      // If this app-booked entry has a zuperJobUid and is stale, clean it up
      const age = now - new Date(slot.bookedAt).getTime();
      if (slot.zuperJobUid && age > STALE_THRESHOLD_MS) {
        bookedSlots.delete(key);
      }
    }
  }

  // Merge: Zuper bookings take priority, then app-booked entries fill in the rest
  // Build combined bookings per date for display
  for (const dateStr in availabilityByDate) {
    const day = availabilityByDate[dateStr];
    const booked: Array<{
      start_time: string;
      end_time: string;
      display_time?: string;
      user_name?: string;
      location?: string;
      projectId?: string;
      projectName?: string;
      zuperJobUid?: string;
    }> = [];

    // Track which slot keys have been accounted for
    const matchedKeys = new Set<string>();

    // First pass: check Zuper bookings against available slots
    day.availableSlots = day.availableSlots.filter((slot) => {
      const key = getSlotKey(dateStr, slot.user_name || "", slot.start_time);
      // Check Zuper bookings first (source of truth)
      const zuperBooking = zuperBookings.get(key);
      if (zuperBooking) {
        matchedKeys.add(key);
        booked.push({
          start_time: slot.start_time,
          end_time: slot.end_time,
          display_time: slot.display_time,
          user_name: slot.user_name,
          location: slot.location,
          projectId: zuperBooking.projectId,
          projectName: zuperBooking.projectName,
          zuperJobUid: zuperBooking.zuperJobUid,
        });
        return false; // Remove from available
      }
      // Then check app-booked entries (optimistic bookings)
      const appBooking = bookedSlots.get(key);
      if (appBooking) {
        matchedKeys.add(key);
        booked.push({
          start_time: slot.start_time,
          end_time: slot.end_time,
          display_time: slot.display_time,
          user_name: slot.user_name,
          location: slot.location,
          projectId: appBooking.projectId,
          projectName: appBooking.projectName,
          zuperJobUid: appBooking.zuperJobUid,
        });
        return false; // Remove from available
      }
      return true;
    });

    // Add Zuper bookings that had no matching availability slot (ad-hoc bookings)
    for (const [key, booking] of zuperBookings.entries()) {
      if (booking.date === dateStr && !matchedKeys.has(key)) {
        matchedKeys.add(key);
        booked.push({
          start_time: booking.startTime,
          end_time: booking.endTime,
          display_time: `${formatTimeForDisplay(booking.startTime)}-${formatTimeForDisplay(booking.endTime)}`,
          user_name: booking.userName,
          location: booking.location,
          projectId: booking.projectId,
          projectName: booking.projectName,
          zuperJobUid: booking.zuperJobUid,
        });
      }
    }

    // Add app-booked entries that had no matching availability slot
    for (const [key, booking] of bookedSlots.entries()) {
      if (booking.date === dateStr && !matchedKeys.has(key)) {
        booked.push({
          start_time: booking.startTime,
          end_time: booking.endTime,
          display_time: `${formatTimeForDisplay(booking.startTime)}-${formatTimeForDisplay(booking.endTime)}`,
          user_name: booking.userName,
          location: booking.location,
          projectId: booking.projectId,
          projectName: booking.projectName,
          zuperJobUid: booking.zuperJobUid,
        });
      }
    }

    // Add booked slots to the day data
    // @ts-expect-error - adding bookedSlots to response
    day.bookedSlots = booked;

    // Recheck availability after filtering
    day.hasAvailability = day.availableSlots.length > 0;
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

/**
 * POST /api/zuper/availability
 * Book a 1-hour time slot for a surveyor
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireApiAuth();
    if (authResult instanceof NextResponse) return authResult;

    const body = await request.json();
    const { date, startTime, endTime, userName, userUid, location, projectId, projectName, zuperJobUid } = body;

    if (!date || !startTime || !userName || !projectId) {
      return NextResponse.json(
        { error: "Missing required fields: date, startTime, userName, projectId" },
        { status: 400 }
      );
    }

    const key = getSlotKey(date, userName, startTime);

    // Check if slot is already booked
    if (bookedSlots.has(key)) {
      return NextResponse.json(
        { error: "This time slot is already booked" },
        { status: 409 }
      );
    }

    // Book the slot - this tracks the assignment locally since Zuper API
    // doesn't support updating assignments after job creation
    const booking: BookedSlot = {
      date,
      startTime,
      endTime: endTime || `${(parseInt(startTime.split(":")[0]) + 1).toString().padStart(2, "0")}:00`,
      userName,
      userUid, // Track the Zuper user UID for this booking
      location: location || "",
      projectId,
      projectName: projectName || "",
      bookedAt: new Date().toISOString(),
      zuperJobUid, // Track which Zuper job this booking is for
    };

    bookedSlots.set(key, booking);

    console.log(`[Availability] Booked slot for ${userName} (${userUid}) on ${date} at ${startTime} - Job: ${zuperJobUid}`);

    return NextResponse.json({
      success: true,
      booking,
      message: `Slot booked: ${userName} on ${date} at ${startTime}`,
    });
  } catch (error) {
    console.error("Error booking slot:", error);
    return NextResponse.json(
      { error: "Failed to book slot", details: String(error) },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/zuper/availability
 * Remove a booked time slot
 */
export async function DELETE(request: NextRequest) {
  try {
    const authResult = await requireApiAuth();
    if (authResult instanceof NextResponse) return authResult;

    const body = await request.json();
    const { date, startTime, userName } = body;

    if (!date || !startTime || !userName) {
      return NextResponse.json(
        { error: "Missing required fields: date, startTime, userName" },
        { status: 400 }
      );
    }

    const key = getSlotKey(date, userName, startTime);

    if (!bookedSlots.has(key)) {
      return NextResponse.json(
        { error: "Slot not found" },
        { status: 404 }
      );
    }

    const booking = bookedSlots.get(key);
    bookedSlots.delete(key);

    return NextResponse.json({
      success: true,
      removed: booking,
      message: `Slot freed: ${userName} on ${date} at ${startTime}`,
    });
  } catch (error) {
    console.error("Error removing slot:", error);
    return NextResponse.json(
      { error: "Failed to remove slot", details: String(error) },
      { status: 500 }
    );
  }
}
