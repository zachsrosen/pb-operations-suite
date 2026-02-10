import { NextRequest, NextResponse } from "next/server";
import { ZuperClient, JOB_CATEGORY_UIDS } from "@/lib/zuper";
import { getCrewSchedulesFromDB } from "@/lib/db";

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
  name: string;
  location: string; // "DTC", "Westminster", "Colorado Springs", etc.
  reportLocation: string; // Where they report to
  // Days of week: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  schedule: Array<{
    day: number;
    startTime: string; // "HH:mm" format in the crew's LOCAL timezone
    endTime: string;
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

    // Add scheduled jobs and mark those time slots as booked
    if (jobsResult.type === "success" && jobsResult.data) {
      for (const job of jobsResult.data) {
        if (job.scheduled_start_time) {
          // Parse the scheduled time - Zuper returns UTC times
          const scheduledDate = new Date(job.scheduled_start_time);

          // Default: convert to Mountain Time for date/logging
          const mtLocal = utcToLocalTime(scheduledDate, 'America/Denver');
          const dateStr = mtLocal.dateStr;
          const startTime = `${mtLocal.hour.toString().padStart(2, "0")}:00`;

          if (availabilityByDate[dateStr]) {

            availabilityByDate[dateStr].scheduledJobs.push({
              job_title: job.job_title,
              start_time: job.scheduled_start_time,
              end_time: job.scheduled_end_time,
            });

            // If we have a valid start time, mark that slot as booked from Zuper
            if (startTime) {
              // Get assigned user's info from the job
              // Zuper assigned_to is an array of { user: { first_name, last_name, user_uid } }
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const assignedUserData = (job as any).assigned_to?.[0]?.user;
              const assignedUserName = assignedUserData
                ? `${assignedUserData.first_name || ""} ${assignedUserData.last_name || ""}`.trim()
                : "";
              const assignedUserUid = assignedUserData?.user_uid || "";

              // Log for debugging
              console.log(`[Zuper Availability] Job: ${job.job_title}`);
              console.log(`[Zuper Availability] Scheduled UTC: ${job.scheduled_start_time}`);
              console.log(`[Zuper Availability] MT date: ${dateStr}, MT time: ${startTime}`);
              console.log(`[Zuper Availability] Assigned user from Zuper: "${assignedUserName}" (uid: ${assignedUserUid})`);

              // Try to match this scheduled job to an availability slot and mark it booked
              // Note: slotStartTime is in MT, but slots may be in different timezones (e.g. PT for CA)
              // We match by converting UTC to each slot's timezone
              const slotStartTime = startTime; // MT time for default matching

              // Find matching crew member - ONLY if we know who it's assigned to
              // Don't auto-match unassigned jobs to random slots
              let matchingSlot = null;
              if (assignedUserUid || assignedUserName) {
                // Primary: match by user UID with timezone-aware time comparison
                if (assignedUserUid) {
                  matchingSlot = availabilityByDate[dateStr].availableSlots.find(slot => {
                    if (slot.user_uid !== assignedUserUid) return false;
                    // Convert UTC to the slot's timezone for time comparison
                    const slotTz = slot.timezone || 'America/Denver';
                    const localTime = utcToLocalTime(scheduledDate, slotTz);
                    const localStartTime = `${localTime.hour.toString().padStart(2, "0")}:${localTime.minute.toString().padStart(2, "0")}`;
                    // Match if the hour aligns (slots are hourly)
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
                // Job is not assigned to anyone - don't auto-match to a random slot
                // This prevents showing "Drew" when Joe was selected but assignment failed
                console.log(`[Zuper Availability] Job "${job.job_title}" has no assigned user - not auto-matching to slots`);
              }

              if (matchingSlot) {
                console.log(`[Zuper Availability] Matched slot: ${matchingSlot.user_name} @ ${matchingSlot.start_time}`);
                const key = getSlotKey(dateStr, matchingSlot.user_name || "", slotStartTime);
                if (!bookedSlots.has(key)) {
                  // Auto-book this slot based on Zuper scheduled job
                  const startHour = parseInt(slotStartTime.split(":")[0]);
                  bookedSlots.set(key, {
                    date: dateStr,
                    startTime: slotStartTime,
                    endTime: `${(startHour + 1).toString().padStart(2, "0")}:00`,
                    userName: matchingSlot.user_name || "",
                    location: matchingSlot.location || "",
                    projectId: job.job_uid || "",
                    projectName: job.job_title,
                    bookedAt: new Date().toISOString(),
                  });
                  console.log(`[Zuper Availability] Booked slot: ${key}`);
                }
              } else if (assignedUserUid || assignedUserName) {
                // No matching availability slot found, but the job IS assigned and scheduled in Zuper.
                // This happens when the job is on a day/time outside the crew's configured schedule
                // (e.g. job at a different location, or an ad-hoc booking).
                // We still need to block this slot so it shows on the calendar.
                const displayName = (assignedUserUid && uidToDisplayName[assignedUserUid]) || assignedUserName;
                const startHour = parseInt(slotStartTime.split(":")[0]);
                const endTime = `${(startHour + 1).toString().padStart(2, "0")}:00`;
                const key = getSlotKey(dateStr, displayName, slotStartTime);
                if (!bookedSlots.has(key)) {
                  bookedSlots.set(key, {
                    date: dateStr,
                    startTime: slotStartTime,
                    endTime,
                    userName: displayName,
                    location: "",
                    projectId: job.job_uid || "",
                    projectName: job.job_title,
                    bookedAt: new Date().toISOString(),
                  });
                  // Also inject this as a booked slot in the day's data so the frontend sees it
                  // even if there was no pre-existing availability slot for this user/time
                  console.log(`[Zuper Availability] Injected booked slot for ${displayName} @ ${slotStartTime} (no configured schedule slot): ${key}`);
                }
              } else {
                console.log(`[Zuper Availability] No matching slot found for ${dateStr} at ${slotStartTime}`);
              }
            }
          }
        }
      }
    }
  }

  // Clean up stale in-memory bookings that Zuper now manages.
  // Keep recent bookings (< 5 min) for optimistic UI, but let Zuper
  // be the source of truth for older entries it owns.
  const STALE_THRESHOLD_MS = 5 * 60 * 1000;
  const now = Date.now();
  for (const [key, slot] of bookedSlots.entries()) {
    if (slot.date >= fromDate && slot.date <= toDate) {
      const age = now - new Date(slot.bookedAt).getTime();
      if (slot.zuperJobUid && age > STALE_THRESHOLD_MS) {
        bookedSlots.delete(key);
      }
    }
  }

  // Filter out locally booked slots and add them to bookedSlots array for display
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
    }> = [];

    // Track which bookings were matched against an availability slot
    const matchedBookingKeys = new Set<string>();

    day.availableSlots = day.availableSlots.filter((slot) => {
      const key = getSlotKey(dateStr, slot.user_name || "", slot.start_time);
      const booking = bookedSlots.get(key);
      if (booking) {
        matchedBookingKeys.add(key);
        // Add to booked list for display
        booked.push({
          start_time: slot.start_time,
          end_time: slot.end_time,
          display_time: slot.display_time,
          user_name: slot.user_name,
          location: slot.location,
          projectId: booking.projectId,
          projectName: booking.projectName,
        });
        return false; // Filter out from available
      }
      return true;
    });

    // Also add injected Zuper bookings that had no matching availability slot
    // (e.g. jobs on days/times outside the configured crew schedule, or at different locations)
    for (const [key, booking] of bookedSlots.entries()) {
      if (booking.date === dateStr && !matchedBookingKeys.has(key)) {
        booked.push({
          start_time: booking.startTime,
          end_time: booking.endTime,
          display_time: `${formatTimeForDisplay(booking.startTime)}-${formatTimeForDisplay(booking.endTime)}`,
          user_name: booking.userName,
          location: booking.location,
          projectId: booking.projectId,
          projectName: booking.projectName,
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
