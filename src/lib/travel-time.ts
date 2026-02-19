/**
 * Travel Time Utility — Google Maps Distance Matrix + Geocoding
 *
 * Provides travel-time warnings for survey scheduling.
 * All Google API calls are fail-open: on any error, returns null (no warning).
 * Booking is NEVER blocked by travel logic.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface TravelEstimate {
  durationMinutes: number;
  distanceMiles: number;
  cached: boolean;
}

export interface TravelWarning {
  type: "tight" | "unknown";
  direction: "before" | "after" | "both";
  prevJob?: { projectName: string; endTime: string; travelMinutes?: number };
  nextJob?: { projectName: string; startTime: string; travelMinutes?: number };
  availableMinutesBefore?: number;
  availableMinutesAfter?: number;
}

export interface TravelTimeConfig {
  enabled: boolean;
  bufferMinutes: number;
  unknownThresholdMinutes: number;
  apiKey: string;
}

interface SlotLike {
  start_time: string;
  end_time: string;
  user_uid?: string;
  user_name?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  travelWarning?: any;
}

interface BookedEntry {
  start_time: string;
  end_time: string;
  address?: string;
  geoCoordinates?: { latitude: number; longitude: number };
  projectName?: string;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export function getConfig(): TravelTimeConfig {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || "";
  const enabledStr = process.env.TRAVEL_TIME_ENABLED ?? "true";
  const bufferStr = process.env.TRAVEL_TIME_BUFFER_MINUTES ?? "15";
  const thresholdStr = process.env.TRAVEL_TIME_UNKNOWN_THRESHOLD ?? "90";

  return {
    enabled: !!apiKey && enabledStr !== "false",
    bufferMinutes: parseInt(bufferStr, 10) || 15,
    unknownThresholdMinutes: parseInt(thresholdStr, 10) || 90,
    apiKey,
  };
}

// ---------------------------------------------------------------------------
// Caches (static, survive across requests within same server process)
// ---------------------------------------------------------------------------

const GEOCODE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const DRIVE_TIME_TTL_MS = 60 * 60 * 1000; // 1h

const geocodeCache = new Map<string, { point: GeoPoint | null; ts: number }>();
const driveTimeCache = new Map<
  string,
  { estimate: TravelEstimate; ts: number }
>();

function normalizeAddress(addr: string): string {
  return addr.trim().toLowerCase().replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------
// Geocoding
// ---------------------------------------------------------------------------

export async function geocodeAddress(
  address: string
): Promise<GeoPoint | null> {
  const config = getConfig();
  if (!config.apiKey) return null;

  const key = normalizeAddress(address);
  const cached = geocodeCache.get(key);
  if (cached && Date.now() - cached.ts < GEOCODE_TTL_MS) {
    return cached.point;
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${config.apiKey}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      geocodeCache.set(key, { point: null, ts: Date.now() });
      return null;
    }
    const data = await resp.json();
    if (data.status !== "OK" || !data.results?.[0]?.geometry?.location) {
      geocodeCache.set(key, { point: null, ts: Date.now() });
      return null;
    }
    const loc = data.results[0].geometry.location;
    const point: GeoPoint = { lat: loc.lat, lng: loc.lng };
    geocodeCache.set(key, { point, ts: Date.now() });
    return point;
  } catch {
    geocodeCache.set(key, { point: null, ts: Date.now() });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Location resolution (geo_coordinates preferred, address geocode fallback)
// ---------------------------------------------------------------------------

export async function resolveLocation(params: {
  geoCoordinates?: { latitude: number; longitude: number };
  address?: string;
}): Promise<string | null> {
  if (params.geoCoordinates?.latitude && params.geoCoordinates?.longitude) {
    return `${params.geoCoordinates.latitude},${params.geoCoordinates.longitude}`;
  }
  if (params.address) {
    const point = await geocodeAddress(params.address);
    if (point) return `${point.lat},${point.lng}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Distance Matrix (drive time)
// ---------------------------------------------------------------------------

export async function getDriveTime(
  origin: string,
  destination: string
): Promise<TravelEstimate | null> {
  const config = getConfig();
  if (!config.apiKey) return null;

  // Directional cache (A→B ≠ B→A)
  const cacheKey = `${origin}|${destination}`;
  const cached = driveTimeCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < DRIVE_TIME_TTL_MS) {
    return { ...cached.estimate, cached: true };
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(origin)}&destinations=${encodeURIComponent(destination)}&key=${config.apiKey}`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = await resp.json();
    const element = data.rows?.[0]?.elements?.[0];
    if (!element || element.status !== "OK") return null;

    const estimate: TravelEstimate = {
      durationMinutes: Math.ceil(element.duration.value / 60),
      distanceMiles: Math.round((element.distance.value / 1609.34) * 10) / 10,
      cached: false,
    };
    driveTimeCache.set(cacheKey, { estimate, ts: Date.now() });
    return estimate;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0);
}

// ---------------------------------------------------------------------------
// Single slot evaluation
// ---------------------------------------------------------------------------

export async function evaluateSlotTravel(params: {
  candidateAddress: string;
  slotStartTime: string;
  slotEndTime: string;
  prevBooking?: {
    address?: string;
    geoCoordinates?: { latitude: number; longitude: number };
    endTime: string;
    projectName: string;
  };
  nextBooking?: {
    address?: string;
    geoCoordinates?: { latitude: number; longitude: number };
    startTime: string;
    projectName: string;
  };
  bufferMinutes: number;
  unknownThresholdMinutes?: number;
  // Allow passing a memoized resolver for batch efficiency
  resolveLocationFn?: (p: {
    geoCoordinates?: { latitude: number; longitude: number };
    address?: string;
  }) => Promise<string | null>;
}): Promise<TravelWarning | null> {
  const {
    candidateAddress,
    slotStartTime,
    slotEndTime,
    prevBooking,
    nextBooking,
    bufferMinutes,
    unknownThresholdMinutes = getConfig().unknownThresholdMinutes,
    resolveLocationFn = resolveLocation,
  } = params;

  if (!prevBooking && !nextBooking) return null;

  const slotStart = timeToMinutes(slotStartTime);
  const slotEnd = timeToMinutes(slotEndTime);

  let beforeResult: {
    type: "tight" | "unknown";
    travelMinutes?: number;
    gapMinutes: number;
  } | null = null;
  let afterResult: {
    type: "tight" | "unknown";
    travelMinutes?: number;
    gapMinutes: number;
  } | null = null;

  // Evaluate BEFORE (prev job → this slot)
  if (prevBooking) {
    const prevEnd = timeToMinutes(prevBooking.endTime);
    const gapBefore = slotStart - prevEnd;

    // Skip if gap is large enough that travel is irrelevant
    if (gapBefore < unknownThresholdMinutes) {
      const candidateLoc = await resolveLocationFn({ address: candidateAddress });
      const prevLoc = await resolveLocationFn({
        geoCoordinates: prevBooking.geoCoordinates,
        address: prevBooking.address,
      });

      if (candidateLoc && prevLoc) {
        const estimate = await getDriveTime(prevLoc, candidateLoc);
        if (estimate && gapBefore < estimate.durationMinutes + bufferMinutes) {
          beforeResult = {
            type: "tight",
            travelMinutes: estimate.durationMinutes,
            gapMinutes: gapBefore,
          };
        }
        // If estimate exists and gap is sufficient, no warning needed
      } else {
        // Can't resolve one or both locations
        beforeResult = { type: "unknown", gapMinutes: gapBefore };
      }
    }
  }

  // Evaluate AFTER (this slot → next job)
  if (nextBooking) {
    const nextStart = timeToMinutes(nextBooking.startTime);
    const gapAfter = nextStart - slotEnd;

    if (gapAfter < unknownThresholdMinutes) {
      const candidateLoc = await resolveLocationFn({ address: candidateAddress });
      const nextLoc = await resolveLocationFn({
        geoCoordinates: nextBooking.geoCoordinates,
        address: nextBooking.address,
      });

      if (candidateLoc && nextLoc) {
        const estimate = await getDriveTime(candidateLoc, nextLoc);
        if (estimate && gapAfter < estimate.durationMinutes + bufferMinutes) {
          afterResult = {
            type: "tight",
            travelMinutes: estimate.durationMinutes,
            gapMinutes: gapAfter,
          };
        }
      } else {
        afterResult = { type: "unknown", gapMinutes: gapAfter };
      }
    }
  }

  if (!beforeResult && !afterResult) return null;

  // Determine combined direction
  let direction: "before" | "after" | "both";
  if (beforeResult && afterResult) direction = "both";
  else if (beforeResult) direction = "before";
  else direction = "after";

  // Worst severity: tight > unknown
  const worstType =
    beforeResult?.type === "tight" || afterResult?.type === "tight"
      ? "tight"
      : "unknown";

  const warning: TravelWarning = {
    type: worstType,
    direction,
  };

  if (prevBooking && beforeResult) {
    warning.prevJob = {
      projectName: prevBooking.projectName,
      endTime: prevBooking.endTime,
      travelMinutes: beforeResult.travelMinutes,
    };
    warning.availableMinutesBefore = beforeResult.gapMinutes;
  }
  if (nextBooking && afterResult) {
    warning.nextJob = {
      projectName: nextBooking.projectName,
      startTime: nextBooking.startTime,
      travelMinutes: afterResult.travelMinutes,
    };
    warning.availableMinutesAfter = afterResult.gapMinutes;
  }

  return warning;
}

// ---------------------------------------------------------------------------
// Batch evaluation with memoization, dedup, concurrency control
// ---------------------------------------------------------------------------

const BATCH_TIMEOUT_MS = 5000;
const PER_CALL_TIMEOUT_MS = 3000;
const MAX_CONCURRENT = 5;

/** Simple semaphore for bounded concurrency */
function createSemaphore(limit: number) {
  let current = 0;
  const queue: Array<() => void> = [];

  return {
    async acquire(): Promise<void> {
      if (current < limit) {
        current++;
        return;
      }
      await new Promise<void>((resolve) => queue.push(resolve));
    },
    release(): void {
      current--;
      const next = queue.shift();
      if (next) {
        current++;
        next();
      }
    },
  };
}

/** Wrap a promise with a timeout — resolves to null on timeout (fail-open) */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number
): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

/**
 * Evaluate travel warnings for all available slots in a day.
 * Memoizes resolveLocation, dedupes drive-time calls, bounded concurrency.
 */
export async function evaluateSlotsBatch(
  availableSlots: SlotLike[],
  bookedByUser: Record<string, BookedEntry[]>,
  candidateAddress: string,
  bufferMinutes: number
): Promise<void> {
  const config = getConfig();
  if (!config.enabled || !candidateAddress) return;

  // Memoize resolveLocation within this batch
  const resolveCache = new Map<string, Promise<string | null>>();
  const memoizedResolve = (p: {
    geoCoordinates?: { latitude: number; longitude: number };
    address?: string;
  }): Promise<string | null> => {
    // Build a stable key
    const key = p.geoCoordinates
      ? `geo:${p.geoCoordinates.latitude},${p.geoCoordinates.longitude}`
      : p.address
        ? `addr:${normalizeAddress(p.address)}`
        : "none";
    if (key === "none") return Promise.resolve(null);

    if (!resolveCache.has(key)) {
      resolveCache.set(key, resolveLocation(p));
    }
    return resolveCache.get(key)!;
  };

  const semaphore = createSemaphore(MAX_CONCURRENT);
  const batchStart = Date.now();

  const tasks = availableSlots.map(async (slot) => {
    // Check batch timeout budget
    if (Date.now() - batchStart > BATCH_TIMEOUT_MS) return;

    const userKey =
      slot.user_uid || (slot.user_name || "").trim().toLowerCase();
    if (!userKey) return;

    const userBooked = bookedByUser[userKey];
    if (!userBooked || userBooked.length === 0) return;

    // Find prev (last booked ending ≤ slot start) and next (first booked starting ≥ slot end)
    let prev: BookedEntry | null = null;
    let next: BookedEntry | null = null;
    for (const b of userBooked) {
      if (b.end_time <= slot.start_time) prev = b;
      if (!next && b.start_time >= slot.end_time) next = b;
    }
    if (!prev && !next) return;

    await semaphore.acquire();
    try {
      const warning = await withTimeout(
        evaluateSlotTravel({
          candidateAddress,
          slotStartTime: slot.start_time,
          slotEndTime: slot.end_time,
          prevBooking: prev
            ? {
                address: prev.address,
                geoCoordinates: prev.geoCoordinates,
                endTime: prev.end_time,
                projectName: prev.projectName || "",
              }
            : undefined,
          nextBooking: next
            ? {
                address: next.address,
                geoCoordinates: next.geoCoordinates,
                startTime: next.start_time,
                projectName: next.projectName || "",
              }
            : undefined,
          bufferMinutes,
          unknownThresholdMinutes: config.unknownThresholdMinutes,
          resolveLocationFn: memoizedResolve,
        }),
        PER_CALL_TIMEOUT_MS
      );
      if (warning) {
        slot.travelWarning = warning;
      }
    } finally {
      semaphore.release();
    }
  });

  await Promise.all(tasks);
}

// ---------------------------------------------------------------------------
// Test helpers — allow clearing caches in tests
// ---------------------------------------------------------------------------

export function _clearCaches(): void {
  geocodeCache.clear();
  driveTimeCache.clear();
}
