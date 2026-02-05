import { NextRequest, NextResponse } from "next/server";
import { ZuperClient, JOB_CATEGORY_UIDS } from "@/lib/zuper";

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
  location: string;
  projectId: string;
  projectName: string;
  bookedAt: string;
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
    startTime: string; // "HH:mm" format
    endTime: string;
  }>;
  jobTypes: string[]; // "survey", "construction", "inspection"
  userUid?: string; // Zuper user UID - populated dynamically
}

// Cache for Zuper user UID lookups (name -> userUid)
let userUidCache: Map<string, string> | null = null;
let userUidCacheTime = 0;
const USER_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * Fetch and cache Zuper user UIDs
 * Maps user names to their Zuper user_uid
 */
async function getZuperUserUidMap(zuper: ZuperClient): Promise<Map<string, string>> {
  const now = Date.now();

  // Return cached data if still valid
  if (userUidCache && (now - userUidCacheTime) < USER_CACHE_TTL) {
    return userUidCache;
  }

  // Fetch users from Zuper
  const usersResult = await zuper.getUsers();

  const userMap = new Map<string, string>();

  if (usersResult.type === "success" && usersResult.data) {
    // Zuper API returns { type, data: [users] } or sometimes just the array
    // Handle both cases
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const responseData = usersResult.data as any;
    const users = Array.isArray(responseData)
      ? responseData
      : (Array.isArray(responseData.data) ? responseData.data : []);

    console.log(`[Zuper Users] Got ${users.length} users from API`);

    for (const user of users) {
      if (user.user_uid && user.first_name) {
        // Create multiple lookup keys for flexible matching
        const fullName = `${user.first_name} ${user.last_name || ""}`.trim().toLowerCase();
        const firstName = user.first_name.toLowerCase();
        const lastName = (user.last_name || "").toLowerCase();

        // Store with full name
        userMap.set(fullName, user.user_uid);

        // Store with first name only (for cases like "Rich" or "Rolando")
        if (!userMap.has(firstName)) {
          userMap.set(firstName, user.user_uid);
        }

        // Store with "FirstName LastName" format
        if (lastName) {
          userMap.set(`${firstName} ${lastName}`, user.user_uid);
        }

        console.log(`[Zuper Users] Cached: "${fullName}" -> ${user.user_uid}`);
      }
    }
  } else {
    console.error(`[Zuper Users] Failed to fetch users:`, usersResult.error);
  }

  // Cache the results
  userUidCache = userMap;
  userUidCacheTime = now;

  console.log(`[Zuper Users] Cached ${userMap.size} user mappings`);
  return userMap;
}

/**
 * Look up a Zuper user UID by name
 */
function findUserUid(userMap: Map<string, string>, name: string): string | undefined {
  const normalizedName = name.toLowerCase().trim();

  // Try exact match first
  if (userMap.has(normalizedName)) {
    return userMap.get(normalizedName);
  }

  // Try first name only (e.g., "Rich" matches "Rich SomeLastName")
  const firstName = normalizedName.split(" ")[0];
  if (userMap.has(firstName)) {
    return userMap.get(firstName);
  }

  // Try partial match (for cases where Zuper has different name format)
  for (const [key, uid] of userMap.entries()) {
    if (key.includes(firstName) || firstName.includes(key.split(" ")[0])) {
      return uid;
    }
  }

  return undefined;
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

  // Helper to generate 1-hour time slots from a time range
  const generateHourlySlots = (startTime: string, endTime: string): Array<{ start: string; end: string }> => {
    const slots: Array<{ start: string; end: string }> = [];
    const [startHour, startMin] = startTime.split(":").map(Number);
    const [endHour, endMin] = endTime.split(":").map(Number);

    let currentHour = startHour;
    let currentMin = startMin;

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

  // Look up Zuper user UIDs for crew members
  let userUidMap: Map<string, string> = new Map();
  if (zuper.isConfigured()) {
    try {
      userUidMap = await getZuperUserUidMap(zuper);
    } catch (err) {
      console.error("[Zuper Availability] Failed to fetch user UIDs:", err);
    }
  }

  for (const crew of CREW_SCHEDULES) {
    // Filter by job type
    if (!crew.jobTypes.includes(jobType)) continue;

    // Filter by location if specified
    if (locationMatches && !locationMatches.includes(crew.location)) continue;

    // Look up the user's Zuper UID
    const crewUserUid = findUserUid(userUidMap, crew.name);
    if (crewUserUid) {
      console.log(`[Zuper Availability] Matched crew "${crew.name}" to UID: ${crewUserUid}`);
    } else {
      console.log(`[Zuper Availability] No UID found for crew "${crew.name}"`);
    }

    // Check each date in range
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dayOfWeek = d.getDay();
      const dateStr = d.toISOString().split("T")[0];

      // Check if crew works on this day
      const shifts = crew.schedule.filter((s) => s.day === dayOfWeek);
      for (const shift of shifts) {
        if (availabilityByDate[dateStr]) {
          // Generate 1-hour slots for this shift
          const hourlySlots = generateHourlySlots(shift.startTime, shift.endTime);

          for (const slot of hourlySlots) {
            const displayTime = `${formatTimeForDisplay(slot.start)}-${formatTimeForDisplay(slot.end)}`;
            availabilityByDate[dateStr].availableSlots.push({
              start_time: slot.start,
              end_time: slot.end,
              display_time: displayTime,
              user_uid: crewUserUid, // Include Zuper user UID for assignment
              user_name: crew.name,
              location: crew.location,
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

    // Add scheduled jobs and mark those time slots as booked
    if (jobsResult.type === "success" && jobsResult.data) {
      for (const job of jobsResult.data) {
        if (job.scheduled_start_time) {
          // Parse the scheduled time - Zuper returns UTC times
          // We need to convert to local time (Mountain Time) for matching
          const scheduledDate = new Date(job.scheduled_start_time);

          // Get local date and time in Mountain Time
          // Use the scheduled date's local representation
          const localDateStr = scheduledDate.toLocaleDateString('en-CA', { timeZone: 'America/Denver' }); // YYYY-MM-DD format
          const localHour = parseInt(scheduledDate.toLocaleTimeString('en-US', {
            timeZone: 'America/Denver',
            hour: '2-digit',
            hour12: false
          }));
          const startTime = `${localHour.toString().padStart(2, "0")}:00`;

          const dateStr = localDateStr;
          if (availabilityByDate[dateStr]) {

            availabilityByDate[dateStr].scheduledJobs.push({
              job_title: job.job_title,
              start_time: job.scheduled_start_time,
              end_time: job.scheduled_end_time,
            });

            // If we have a valid start time, mark that slot as booked from Zuper
            if (startTime) {
              // Get assigned user's name from the job
              // Zuper assigned_to is an array of { user: { first_name, last_name } }
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const assignedUserData = (job as any).assigned_to?.[0]?.user;
              const assignedUserName = assignedUserData
                ? `${assignedUserData.first_name || ""} ${assignedUserData.last_name || ""}`.trim()
                : "";

              // Log for debugging
              console.log(`[Zuper Availability] Job: ${job.job_title}`);
              console.log(`[Zuper Availability] Scheduled UTC: ${job.scheduled_start_time}`);
              console.log(`[Zuper Availability] Local date: ${dateStr}, Local time: ${startTime}`);
              console.log(`[Zuper Availability] Assigned user from Zuper: "${assignedUserName}"`);

              // Try to match this scheduled job to an availability slot and mark it booked
              const slotStartTime = startTime; // Already in HH:00 format

              // Find matching crew member - first try to match by assigned user name
              let matchingSlot = null;
              if (assignedUserName) {
                // Try to find a slot for this specific user at this time
                // Match by first name (case insensitive)
                const firstName = assignedUserName.split(" ")[0].toLowerCase();
                matchingSlot = availabilityByDate[dateStr].availableSlots.find(
                  slot => slot.start_time === slotStartTime &&
                    slot.user_name?.toLowerCase().includes(firstName)
                );
                console.log(`[Zuper Availability] Looking for slot at ${slotStartTime} for user containing "${firstName}"`);
                console.log(`[Zuper Availability] Available slots for this date:`, availabilityByDate[dateStr].availableSlots.map(s => `${s.user_name} @ ${s.start_time}`));
              }

              // If no match by user, fall back to finding any slot at this time
              if (!matchingSlot) {
                console.log(`[Zuper Availability] No user match, falling back to time-only match at ${slotStartTime}`);
                matchingSlot = availabilityByDate[dateStr].availableSlots.find(
                  slot => slot.start_time === slotStartTime
                );
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
              } else {
                console.log(`[Zuper Availability] No matching slot found for ${dateStr} at ${slotStartTime}`);
              }
            }
          }
        }
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

    day.availableSlots = day.availableSlots.filter((slot) => {
      const key = getSlotKey(dateStr, slot.user_name || "", slot.start_time);
      const booking = bookedSlots.get(key);
      if (booking) {
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
    const { date, startTime, endTime, userName, location, projectId, projectName } = body;

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

    // Book the slot
    const booking: BookedSlot = {
      date,
      startTime,
      endTime: endTime || `${(parseInt(startTime.split(":")[0]) + 1).toString().padStart(2, "0")}:00`,
      userName,
      location: location || "",
      projectId,
      projectName: projectName || "",
      bookedAt: new Date().toISOString(),
    };

    bookedSlots.set(key, booking);

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
