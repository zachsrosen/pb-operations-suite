/**
 * Portal Availability Computation
 *
 * Computes available survey time slots for the customer portal.
 * Reuses the same data sources (CrewAvailability, BookedSlot, AvailabilityOverride)
 * as the internal scheduler but exposes only opaque, customer-safe data.
 *
 * All internal details (crew names, IDs, Zuper UIDs) are hidden from the customer.
 * Slot identity is encoded as an HMAC so the server can decode it on booking.
 */

import { createHmac } from "crypto";
import { prisma } from "@/lib/db";
import { getTimezoneForLocation } from "@/lib/constants";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** How many calendar days ahead to show slots (from tomorrow) */
const LOOKAHEAD_DAYS = 14;

/** Minimum hours of lead time before the first available slot */
const MIN_LEAD_HOURS = 48;

/** Secret used to HMAC slot identifiers. Falls back to NEXTAUTH_SECRET. */
const SLOT_HMAC_SECRET =
  process.env.PORTAL_SLOT_HMAC_SECRET || process.env.NEXTAUTH_SECRET || "portal-dev-secret";

/**
 * Location aliases — same mapping the internal scheduler uses.
 * e.g. "Centennial" crew availability is stored as "DTC".
 */
const LOCATION_ALIASES: Record<string, string[]> = {
  Westminster: ["Westminster"],
  Centennial: ["Centennial", "DTC"],
  DTC: ["DTC", "Centennial"],
  "Colorado Springs": ["Colorado Springs"],
  "San Luis Obispo": ["San Luis Obispo", "SLO"],
  Camarillo: ["Camarillo", "San Luis Obispo", "SLO"],
};

function getLocationMatches(location: string): string[] {
  return LOCATION_ALIASES[location] || [location];
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single available slot as returned to the customer */
export interface PortalSlot {
  slotId: string;       // opaque HMAC — encodes date + time + crewMemberId
  time: string;         // "HH:MM" in location-local timezone
  displayTime: string;  // "9:00 AM – 10:00 AM MT"
}

/** A day's worth of available slots */
export interface PortalDay {
  date: string;         // "YYYY-MM-DD" in location-local timezone
  dayLabel: string;     // "Mon, Mar 10"
  slots: PortalSlot[];
}

/** Full availability response for the portal */
export interface PortalAvailability {
  days: PortalDay[];
  timezone: string;     // IANA timezone string for the location
  tzAbbrev: string;     // "MT" or "PT"
}

/** Decoded slot — server-side only, used during booking */
export interface DecodedSlot {
  date: string;
  time: string;
  crewMemberId: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get available survey slots for a location over the next LOOKAHEAD_DAYS.
 * Returns only customer-safe data (no crew names or internal IDs).
 */
export async function getPortalAvailability(
  pbLocation: string,
): Promise<PortalAvailability> {
  const timezone = getTimezoneForLocation(pbLocation);
  const tzAbbrev = timezone === "America/Los_Angeles" ? "PT" : "MT";

  if (!prisma) {
    return { days: [], timezone, tzAbbrev };
  }

  // Compute the date window in the location's timezone
  const now = new Date();
  const localNow = toLocalDate(now, timezone);

  // Start from tomorrow (no same-day booking)
  const startDate = addCalendarDays(localNow, 1);
  const endDate = addCalendarDays(localNow, LOOKAHEAD_DAYS);

  // Lead-time cutoff: slots before this UTC instant are unavailable
  const leadCutoff = new Date(now.getTime() + MIN_LEAD_HOURS * 60 * 60 * 1000);

  // Resolve location aliases (e.g. "Centennial" → ["Centennial", "DTC"])
  const locations = getLocationMatches(pbLocation);

  // ----- Load data in parallel -----
  const [crewAvailabilities, bookedSlots, scheduleRecords, overrides] = await Promise.all([
    // Active survey availabilities at this location (including aliases)
    prisma.crewAvailability.findMany({
      where: {
        isActive: true,
        jobType: "survey",
        location: { in: locations },
        crewMember: { isActive: true },
      },
      include: {
        crewMember: { select: { id: true, name: true, maxDailyJobs: true, zuperUserUid: true } },
      },
    }),
    // Booked slots in the date range (including aliases)
    prisma.bookedSlot.findMany({
      where: {
        date: { gte: startDate, lte: endDate },
        location: { in: locations },
      },
    }),
    // Active survey schedule records (covers scheduler-created bookings that do
    // not always materialize as BookedSlot rows)
    prisma.scheduleRecord.findMany({
      where: {
        scheduleType: "survey",
        status: { in: ["scheduled", "tentative"] },
        scheduledDate: { gte: startDate, lte: endDate },
        assignedUser: { not: null },
        scheduledStart: { not: null },
      },
      select: {
        projectId: true,
        scheduledDate: true,
        scheduledStart: true,
        assignedUser: true,
        assignedUserUid: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    // Availability overrides in the date range
    prisma.availabilityOverride.findMany({
      where: {
        date: { gte: startDate, lte: endDate },
        crewMember: { isActive: true },
      },
    }),
  ]);

  // ----- Index booked slots for O(1) lookup -----
  // Key: "date|crewMemberId|startTime"
  const bookedSet = new Set<string>();
  // Count booked slots per crew per day for maxDailyJobs enforcement
  const dailyBookedCount = new Map<string, number>(); // "date|crewMemberId" → count
  const addBookedKey = (date: string, crewMemberId: string, startTime: string) => {
    const key = `${date}|${crewMemberId}|${startTime}`;
    if (bookedSet.has(key)) return;
    bookedSet.add(key);
    const dayKey = `${date}|${crewMemberId}`;
    dailyBookedCount.set(dayKey, (dailyBookedCount.get(dayKey) || 0) + 1);
  };
  for (const slot of bookedSlots) {
    // We key by userName in BookedSlot, but we need crewMemberId
    // Look up crew by name from our loaded availabilities
    const crew = crewAvailabilities.find((a) => a.crewMember.name === slot.userName);
    if (crew) {
      addBookedKey(slot.date, crew.crewMemberId, slot.startTime);
    }
  }

  // Also block with the latest active survey ScheduleRecord per project.
  // This prevents portal double-booking when scheduler-created records have not
  // been mirrored into BookedSlot yet.
  const latestSurveyByProject = new Map<string, (typeof scheduleRecords)[number]>();
  for (const record of scheduleRecords) {
    if (!latestSurveyByProject.has(record.projectId)) {
      latestSurveyByProject.set(record.projectId, record);
    }
  }
  for (const record of latestSurveyByProject.values()) {
    const start = normalizeTime(record.scheduledStart);
    if (!start) continue;
    const crew = crewAvailabilities.find((a) => {
      if (record.assignedUserUid && a.crewMember.zuperUserUid === record.assignedUserUid) {
        return true;
      }
      return !!record.assignedUser && a.crewMember.name === record.assignedUser;
    });
    if (!crew) continue;
    addBookedKey(record.scheduledDate, crew.crewMemberId, start);
  }

  // ----- Index overrides for O(1) lookup -----
  // Key: "crewMemberId|date"
  const overridesByCrewDate = new Map<
    string,
    Array<{
      availabilityId: string | null;
      type: string;
      startTime: string | null;
      endTime: string | null;
    }>
  >();
  for (const ov of overrides) {
    const key = `${ov.crewMemberId}|${ov.date}`;
    if (!overridesByCrewDate.has(key)) {
      overridesByCrewDate.set(key, []);
    }
    overridesByCrewDate.get(key)!.push({
      availabilityId: ov.availabilityId,
      type: ov.type,
      startTime: ov.startTime,
      endTime: ov.endTime,
    });
  }

  // ----- Generate slots day by day -----
  const days: PortalDay[] = [];

  for (let dayOffset = 0; dayOffset <= LOOKAHEAD_DAYS; dayOffset++) {
    const dateStr = addCalendarDays(startDate, dayOffset);
    if (dateStr > endDate) break;

    const dayOfWeek = getDayOfWeek(dateStr, timezone);
    const daySlots: PortalSlot[] = [];

    for (const avail of crewAvailabilities) {
      if (avail.dayOfWeek !== dayOfWeek) continue;

      const crewId = avail.crewMemberId;
      const overridesForDay = overridesByCrewDate.get(`${crewId}|${dateStr}`) || [];

      // Check if the entire shift is blocked
      const isShiftBlocked = overridesForDay.some(
        (ov) =>
          ov.type === "blocked" &&
          (!ov.availabilityId || ov.availabilityId === avail.id),
      );
      if (isShiftBlocked) continue;

      // Check maxDailyJobs
      const dayBookedKey = `${dateStr}|${crewId}`;
      const bookedCount = dailyBookedCount.get(dayBookedKey) || 0;
      if (bookedCount >= avail.crewMember.maxDailyJobs) continue;

      // Generate 1-hour slots within the shift
      const hourlySlots = generateHourlySlots(avail.startTime, avail.endTime);

      for (const slot of hourlySlots) {
        // Check custom time-range blocks
        const isCustomBlocked = overridesForDay.some((ov) => {
          if (ov.type !== "custom" || !ov.startTime || !ov.endTime) return false;
          if (ov.availabilityId && ov.availabilityId !== avail.id) return false;
          return rangesOverlap(slot.start, slot.end, ov.startTime, ov.endTime);
        });
        if (isCustomBlocked) continue;

        // Check if already booked
        if (bookedSet.has(`${dateStr}|${crewId}|${slot.start}`)) continue;

        // Check lead-time cutoff
        const slotUtc = localTimeToUtc(dateStr, slot.start, timezone);
        if (slotUtc <= leadCutoff) continue;

        // Slot is available — create opaque ID
        const slotId = encodeSlotId(dateStr, slot.start, crewId);
        daySlots.push({
          slotId,
          time: slot.start,
          displayTime: formatTimeRange(slot.start, slot.end, tzAbbrev),
        });
      }
    }

    if (daySlots.length > 0) {
      // De-duplicate by time (multiple crew = same time slot shown once to customer)
      // Keep the first one per time (arbitrary crew assignment)
      const seenTimes = new Set<string>();
      const uniqueSlots: PortalSlot[] = [];
      // Sort by time first so the customer sees a natural order
      daySlots.sort((a, b) => a.time.localeCompare(b.time));
      for (const slot of daySlots) {
        if (!seenTimes.has(slot.time)) {
          seenTimes.add(slot.time);
          uniqueSlots.push(slot);
        }
      }

      days.push({
        date: dateStr,
        dayLabel: formatDayLabel(dateStr),
        slots: uniqueSlots,
      });
    }
  }

  return { days, timezone, tzAbbrev };
}

// ---------------------------------------------------------------------------
// Slot ID encoding / decoding (HMAC-based opaque tokens)
// ---------------------------------------------------------------------------

/**
 * Encode a slot into an opaque ID.
 * Format: base64url(date|time|crewMemberId|hmac)
 * Uses "|" as delimiter since time values contain ":"
 */
export function encodeSlotId(date: string, time: string, crewMemberId: string): string {
  const payload = `${date}|${time}|${crewMemberId}`;
  const mac = createHmac("sha256", SLOT_HMAC_SECRET).update(payload).digest("base64url");
  return Buffer.from(`${payload}|${mac}`).toString("base64url");
}

/**
 * Decode and verify a slot ID. Returns null if tampered.
 */
export function decodeSlotId(slotId: string): DecodedSlot | null {
  try {
    const decoded = Buffer.from(slotId, "base64url").toString("utf8");
    const parts = decoded.split("|");
    if (parts.length !== 4) return null;

    const [date, time, crewMemberId, mac] = parts;
    const payload = `${date}|${time}|${crewMemberId}`;
    const expectedMac = createHmac("sha256", SLOT_HMAC_SECRET).update(payload).digest("base64url");

    if (mac !== expectedMac) return null;

    return { date, time, crewMemberId };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

/** Generate 1-hour slots from startTime to endTime. "08:00"-"11:00" → 3 slots */
function generateHourlySlots(
  startTime: string,
  endTime: string,
): Array<{ start: string; end: string }> {
  const slots: Array<{ start: string; end: string }> = [];
  const startMin = timeToMinutes(startTime);
  const endMin = timeToMinutes(endTime);

  for (let min = startMin; min + 60 <= endMin; min += 60) {
    slots.push({
      start: minutesToTime(min),
      end: minutesToTime(min + 60),
    });
  }
  return slots;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

function rangesOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string,
): boolean {
  const aS = timeToMinutes(startA);
  const aE = timeToMinutes(endA);
  const bS = timeToMinutes(startB);
  const bE = timeToMinutes(endB);
  return aS < bE && bS < aE;
}

function normalizeTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(":");
  if (parts.length < 2) return null;

  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;

  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Date helpers (timezone-aware, no external deps)
// ---------------------------------------------------------------------------

/** Get YYYY-MM-DD in a given timezone */
function toLocalDate(date: Date, timezone: string): string {
  return date.toLocaleDateString("en-CA", { timeZone: timezone });
}

/** Add N calendar days to a YYYY-MM-DD string */
function addCalendarDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00Z"); // noon UTC to avoid DST edge
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

/** Get day of week (0=Sun) for a date string in a timezone */
export function getDayOfWeekForTz(dateStr: string, timezone: string): number {
  return getDayOfWeek(dateStr, timezone);
}

function getDayOfWeek(dateStr: string, timezone: string): number {
  const d = new Date(dateStr + "T12:00:00Z");
  // Get the local day in the target timezone
  const localDay = new Date(
    d.toLocaleString("en-US", { timeZone: timezone }),
  ).getDay();
  return localDay;
}

/** Convert a local date + time to a UTC Date object */
function localTimeToUtc(dateStr: string, timeStr: string, timezone: string): Date {
  // Build an ISO-ish string and use the timezone to find the UTC offset
  // We use a two-pass approach: format in the target TZ, then compute offset

  // Create a reference date at noon UTC to get the timezone offset for that date
  const ref = new Date(dateStr + "T12:00:00Z");
  const localStr = ref.toLocaleString("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const localRef = new Date(localStr);
  const offsetMs = ref.getTime() - localRef.getTime();

  // Target local datetime
  const localTarget = new Date(`${dateStr}T${timeStr}:00`);
  return new Date(localTarget.getTime() + offsetMs);
}

/** Format "09:00","10:00" → "9:00 AM – 10:00 AM MT" */
function formatTimeRange(start: string, end: string, tzAbbrev: string): string {
  return `${formatTime12(start)} – ${formatTime12(end)} ${tzAbbrev}`;
}

/** "09:00" → "9:00 AM", "13:00" → "1:00 PM" */
function formatTime12(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${m.toString().padStart(2, "0")} ${period}`;
}

/** "2026-03-10" → "Mon, Mar 10" */
function formatDayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
