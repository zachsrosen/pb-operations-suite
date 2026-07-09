// ---------------------------------------------------------------------------
// Preferred survey slots — the positive inverse of travel warnings.
//
// When a survey is being scheduled with a known customer address, we surface
// already-booked surveys that are geographically *batchable* into one trip so
// the surveyor's long drive gets reused. This annotates available slots
// (`preferredSlot`) and days (`nearbyAnchors`) and returns the list of days
// that have a batchable "anchor" survey (`nearbyDays`).
//
// Reuses travel-time.ts infrastructure end to end (cached geocoding + Distance
// Matrix drive times). Annotation-only: it never filters or blocks a slot, and
// fails open on any error — matching the travel-time philosophy.
// ---------------------------------------------------------------------------

import { getOfficeByPbLocation } from "@/lib/map-offices";
import {
  getConfig as getTravelConfig,
  getDriveTime,
  normalizeAddress,
  timeToMinutes,
} from "@/lib/travel-time";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PreferredSlotAnchor {
  projectName: string;
  startTime: string;
  endTime: string;
  driveMinutes: number;
  userName: string;
  address: string;
}

export interface PreferredSlotAnnotation {
  /** "adjacent" = time-contiguous with the anchor (strong highlight);
   *  "same_day" = same surveyor's other open slot that day (subtle). */
  tier: "adjacent" | "same_day";
  anchor: PreferredSlotAnchor;
}

export interface NearbyAnchor {
  projectName: string;
  userName: string;
  startTime: string;
  driveMinutes: number;
  address: string;
}

/** A booked survey that passed the pairing test, scoped to one day. */
export interface DayAnchor {
  userKey: string;
  userName: string;
  projectName: string;
  startTime: string;
  endTime: string;
  driveMinutes: number;
  address: string;
}

export interface ClassifiableSlot {
  start_time: string;
  end_time: string;
  user_uid?: string;
  user_name?: string;
  preferredSlot?: PreferredSlotAnnotation;
}

interface BookedForAnchor {
  start_time: string;
  end_time: string;
  user_uid?: string;
  user_name?: string;
  projectName?: string;
  projectId?: string | number;
  address?: string;
  geoCoordinates?: { latitude: number; longitude: number };
}

interface DayAvailabilityLike {
  availableSlots: ClassifiableSlot[];
  bookedSlots?: BookedForAnchor[];
  nearbyAnchors?: NearbyAnchor[];
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface PreferredSlotsConfig {
  enabled: boolean;
  officeTierMinutes: number;
  pairNearMinutes: number;
  pairFarMinutes: number;
  /** Contiguity tolerance for tier-1 "adjacent" (booked jobs aren't grid-aligned). */
  adjacencyMinutes: number;
}

export function getPreferredSlotsConfig(): PreferredSlotsConfig {
  const travel = getTravelConfig();
  const enabledStr = process.env.PREFERRED_SLOTS_ENABLED ?? "true";
  return {
    enabled: !!travel.apiKey && enabledStr !== "false",
    officeTierMinutes:
      parseInt(process.env.PREFERRED_SLOT_OFFICE_TIER_MINUTES ?? "30", 10) || 30,
    pairNearMinutes:
      parseInt(process.env.PREFERRED_SLOT_PAIR_NEAR_MINUTES ?? "15", 10) || 15,
    pairFarMinutes:
      parseInt(process.env.PREFERRED_SLOT_PAIR_FAR_MINUTES ?? "30", 10) || 30,
    adjacencyMinutes: 30,
  };
}

function userKeyOf(s: { user_uid?: string; user_name?: string }): string {
  return s.user_uid || (s.user_name || "").trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Pure tier logic (fully unit-tested)
// ---------------------------------------------------------------------------

/**
 * Annotate a day's available slots with a `preferredSlot` tier, in place.
 *
 * For each slot, among anchors belonging to the *same surveyor*:
 *   - tier "adjacent" when the slot is time-contiguous with the anchor (the gap
 *     on either side is between 0 and `adjacencyMinutes`);
 *   - tier "same_day" otherwise.
 * Ties break toward "adjacent", then the nearest anchor by drive minutes.
 * Slots whose surveyor has no anchor that day are left untouched.
 */
export function classifySlotsForDay(
  slots: ClassifiableSlot[],
  anchors: DayAnchor[],
  adjacencyMinutes = 30,
): void {
  if (!anchors.length) return;

  for (const slot of slots) {
    const key = userKeyOf(slot);
    if (!key) continue;

    const slotStart = timeToMinutes(slot.start_time);
    const slotEnd = timeToMinutes(slot.end_time);

    let best: { tier: "adjacent" | "same_day"; anchor: DayAnchor } | null = null;

    for (const a of anchors) {
      if (a.userKey !== key) continue;

      const aStart = timeToMinutes(a.startTime);
      const aEnd = timeToMinutes(a.endTime);
      // slot immediately before the anchor, or immediately after it
      const gapBefore = aStart - slotEnd;
      const gapAfter = slotStart - aEnd;
      const contiguous =
        (gapBefore >= 0 && gapBefore <= adjacencyMinutes) ||
        (gapAfter >= 0 && gapAfter <= adjacencyMinutes);
      const tier: "adjacent" | "same_day" = contiguous ? "adjacent" : "same_day";

      if (!best) {
        best = { tier, anchor: a };
        continue;
      }
      const betterTier = tier === "adjacent" && best.tier !== "adjacent";
      const sameTierCloser =
        tier === best.tier && a.driveMinutes < best.anchor.driveMinutes;
      if (betterTier || sameTierCloser) best = { tier, anchor: a };
    }

    if (best) {
      slot.preferredSlot = {
        tier: best.tier,
        anchor: {
          projectName: best.anchor.projectName,
          startTime: best.anchor.startTime,
          endTime: best.anchor.endTime,
          driveMinutes: best.anchor.driveMinutes,
          userName: best.anchor.userName,
          address: best.anchor.address,
        },
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Async orchestrator — bounded concurrency + timeouts, fail-open
// ---------------------------------------------------------------------------

const MAX_CONCURRENT = 5;
const PER_CALL_TIMEOUT_MS = 3000;
const BATCH_TIMEOUT_MS = 5000;

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

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

/**
 * Orchestrate preferred-slot classification across the whole visible month.
 * Mutates `availabilityByDate` in place (adds `preferredSlot` to slots and
 * `nearbyAnchors` to days) and returns `{ nearbyDays }`.
 */
export async function classifyPreferredSlots(params: {
  availabilityByDate: Record<string, DayAvailabilityLike>;
  candidateAddress: string;
  candidateProjectId?: string;
  location?: string | null;
}): Promise<{ nearbyDays: string[] }> {
  const config = getPreferredSlotsConfig();
  const result = { nearbyDays: [] as string[] };
  if (!config.enabled || !params.candidateAddress) return result;

  // 1. Office → customer drive time picks the pairing threshold. Fall back to
  //    the strict (near) tier when the office can't be resolved or the drive
  //    time can't be computed, to avoid false positives.
  const office = getOfficeByPbLocation(params.location);
  let pairingThreshold = config.pairNearMinutes;
  if (office) {
    const officeDrive = await withTimeout(
      getDriveTime(`${office.lat},${office.lng}`, params.candidateAddress),
      PER_CALL_TIMEOUT_MS,
    );
    if (officeDrive) {
      pairingThreshold =
        officeDrive.durationMinutes > config.officeTierMinutes
          ? config.pairFarMinutes
          : config.pairNearMinutes;
    }
  }

  // 2. Customer → each unique booked-survey address, computed once and memoized
  //    across the whole month (backed by travel-time's 1h drive-time cache).
  const candidateNorm = normalizeAddress(params.candidateAddress);
  const selfPid = params.candidateProjectId
    ? String(params.candidateProjectId)
    : "";
  const driveCache = new Map<string, Promise<number | null>>();
  const semaphore = createSemaphore(MAX_CONCURRENT);
  const batchStart = Date.now();

  const driveToAnchor = (locKey: string, locStr: string): Promise<number | null> => {
    if (!driveCache.has(locKey)) {
      driveCache.set(
        locKey,
        (async () => {
          if (Date.now() - batchStart > BATCH_TIMEOUT_MS) return null;
          await semaphore.acquire();
          try {
            const est = await withTimeout(
              getDriveTime(params.candidateAddress, locStr),
              PER_CALL_TIMEOUT_MS,
            );
            return est ? est.durationMinutes : null;
          } finally {
            semaphore.release();
          }
        })(),
      );
    }
    return driveCache.get(locKey)!;
  };

  // 3. Per day: resolve anchors (booked surveys within threshold), classify.
  for (const dateStr in params.availabilityByDate) {
    const day = params.availabilityByDate[dateStr];
    const booked = day.bookedSlots || [];

    const anchorPromises = booked.map(async (b): Promise<DayAnchor | null> => {
      // self-anchor exclusion: the candidate's own booking (reschedule) would
      // sit at ~0 drive-minutes and become a guaranteed false anchor.
      if (selfPid && b.projectId != null && String(b.projectId) === selfPid) {
        return null;
      }
      const addr = b.address || "";
      if (!b.geoCoordinates && !addr) return null; // no location → can't pair
      if (addr && normalizeAddress(addr) === candidateNorm) return null; // address fallback

      const userKey = userKeyOf(b);
      if (!userKey) return null;

      const locKey = b.geoCoordinates
        ? `geo:${b.geoCoordinates.latitude},${b.geoCoordinates.longitude}`
        : `addr:${normalizeAddress(addr)}`;
      const locStr = b.geoCoordinates
        ? `${b.geoCoordinates.latitude},${b.geoCoordinates.longitude}`
        : addr;

      const driveMinutes = await driveToAnchor(locKey, locStr);
      if (driveMinutes == null || driveMinutes > pairingThreshold) return null;

      return {
        userKey,
        userName: b.user_name || "",
        projectName: b.projectName || "",
        startTime: b.start_time,
        endTime: b.end_time,
        driveMinutes,
        address: addr,
      };
    });

    const anchors = (await Promise.all(anchorPromises)).filter(
      (a): a is DayAnchor => a !== null,
    );
    if (!anchors.length) continue;

    classifySlotsForDay(day.availableSlots, anchors, config.adjacencyMinutes);

    day.nearbyAnchors = anchors
      .map((a) => ({
        projectName: a.projectName,
        userName: a.userName,
        startTime: a.startTime,
        driveMinutes: a.driveMinutes,
        address: a.address,
      }))
      .sort((x, y) => x.driveMinutes - y.driveMinutes);
    result.nearbyDays.push(dateStr);
  }

  result.nearbyDays.sort();
  return result;
}
