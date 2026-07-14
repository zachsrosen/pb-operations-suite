/**
 * Tests for preferred-survey-slots batching logic.
 *
 * `classifySlotsForDay` is pure and gets the bulk of the coverage (tiering,
 * contiguity tolerance, same-surveyor matching, nearest-wins). The async
 * `classifyPreferredSlots` is covered with mocked drive times for threshold
 * selection, self-anchor exclusion, multi-day, and fail-open behavior.
 */
import {
  classifySlotsForDay,
  classifyPreferredSlots,
  getPreferredSlotsConfig,
  type ClassifiableSlot,
  type DayAnchor,
} from "@/lib/preferred-slots";
import * as travel from "@/lib/travel-time";
import * as offices from "@/lib/map-offices";

// Keep the pure helpers (timeToMinutes, normalizeAddress) real; mock the I/O.
jest.mock("@/lib/travel-time", () => ({
  ...jest.requireActual("@/lib/travel-time"),
  getConfig: jest.fn(),
  getDriveTime: jest.fn(),
}));
jest.mock("@/lib/map-offices", () => ({
  ...jest.requireActual("@/lib/map-offices"),
  getOfficeByPbLocation: jest.fn(),
}));

const mockGetDriveTime = travel.getDriveTime as jest.Mock;
const mockGetConfig = travel.getConfig as jest.Mock;
const mockGetOffice = offices.getOfficeByPbLocation as jest.Mock;

const anchor = (over: Partial<DayAnchor> = {}): DayAnchor => ({
  userKey: "jake",
  userName: "Jake",
  projectName: "Evergreen survey",
  startTime: "10:00",
  endTime: "11:00",
  driveMinutes: 12,
  address: "200 Anchor Ave, Evergreen",
  ...over,
});

const slot = (over: Partial<ClassifiableSlot> = {}): ClassifiableSlot => ({
  start_time: "09:00",
  end_time: "10:00",
  user_uid: "jake",
  user_name: "Jake",
  ...over,
});

// ---------------------------------------------------------------------------
// Pure tier logic
// ---------------------------------------------------------------------------

describe("classifySlotsForDay", () => {
  it("tier-1 adjacent when the slot ends right before the anchor", () => {
    const s = slot({ start_time: "09:00", end_time: "10:00" }); // anchor 10-11
    classifySlotsForDay([s], [anchor()]);
    expect(s.preferredSlot?.tier).toBe("adjacent");
    expect(s.preferredSlot?.anchor.projectName).toBe("Evergreen survey");
  });

  it("tier-1 adjacent when the slot starts right after the anchor", () => {
    const s = slot({ start_time: "11:00", end_time: "12:00" }); // anchor 10-11
    classifySlotsForDay([s], [anchor()]);
    expect(s.preferredSlot?.tier).toBe("adjacent");
  });

  it("honors the adjacency tolerance boundary (30 min in, 31 min out)", () => {
    const anchor1030 = anchor({ startTime: "10:30", endTime: "11:30" });
    const justIn = slot({ start_time: "09:00", end_time: "10:00" }); // gap 30
    classifySlotsForDay([justIn], [anchor1030]);
    expect(justIn.preferredSlot?.tier).toBe("adjacent");

    const anchor1031 = anchor({ startTime: "10:31", endTime: "11:31" });
    const justOut = slot({ start_time: "09:00", end_time: "10:00" }); // gap 31
    classifySlotsForDay([justOut], [anchor1031]);
    expect(justOut.preferredSlot?.tier).toBe("same_day");
  });

  it("tier-2 same_day for a non-contiguous same-surveyor slot", () => {
    const s = slot({ start_time: "14:00", end_time: "15:00" }); // anchor 10-11, 3h gap
    classifySlotsForDay([s], [anchor()]);
    expect(s.preferredSlot?.tier).toBe("same_day");
  });

  it("matches same surveyor by user_uid", () => {
    const s = slot({ user_uid: "jake", user_name: "Someone Else" });
    classifySlotsForDay([s], [anchor({ userKey: "jake" })]);
    expect(s.preferredSlot).toBeDefined();
  });

  it("matches same surveyor by normalized-name fallback when uid absent", () => {
    const s = slot({ user_uid: undefined, user_name: "  JAKE " });
    classifySlotsForDay([s], [anchor({ userKey: "jake" })]);
    expect(s.preferredSlot).toBeDefined();
  });

  it("leaves a different surveyor's slot untouched", () => {
    const s = slot({ user_uid: "maria", user_name: "Maria" });
    classifySlotsForDay([s], [anchor({ userKey: "jake" })]);
    expect(s.preferredSlot).toBeUndefined();
  });

  it("prefers adjacent over same_day, then the nearest anchor by driveMinutes", () => {
    const s = slot({ start_time: "09:00", end_time: "10:00" });
    const adjacentFar = anchor({ startTime: "10:00", endTime: "11:00", driveMinutes: 25, projectName: "adjacent-far" });
    const sameDayNear = anchor({ startTime: "15:00", endTime: "16:00", driveMinutes: 5, projectName: "sameday-near" });
    classifySlotsForDay([s], [sameDayNear, adjacentFar]);
    expect(s.preferredSlot?.tier).toBe("adjacent");
    expect(s.preferredSlot?.anchor.projectName).toBe("adjacent-far");

    const s2 = slot({ start_time: "09:00", end_time: "10:00" });
    const adjNear = anchor({ startTime: "10:00", endTime: "11:00", driveMinutes: 8, projectName: "adj-near" });
    const adjFar = anchor({ startTime: "10:15", endTime: "11:15", driveMinutes: 20, projectName: "adj-far" });
    classifySlotsForDay([s2], [adjFar, adjNear]);
    expect(s2.preferredSlot?.anchor.projectName).toBe("adj-near");
  });

  it("does nothing when there are no anchors", () => {
    const s = slot();
    classifySlotsForDay([s], []);
    expect(s.preferredSlot).toBeUndefined();
  });

  it("annotates preferredSlot even when a travelWarning is present (precedence is UI-side)", () => {
    const s = slot({ start_time: "09:00", end_time: "10:00" }) as ClassifiableSlot & { travelWarning?: unknown };
    s.travelWarning = { type: "tight" };
    classifySlotsForDay([s], [anchor()]);
    expect(s.preferredSlot?.tier).toBe("adjacent");
    expect(s.travelWarning).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

describe("getPreferredSlotsConfig", () => {
  const OLD = process.env;
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD };
    mockGetConfig.mockReturnValue({ apiKey: "key", enabled: true });
  });
  afterEach(() => {
    process.env = OLD;
  });

  it("is disabled without a Google API key", () => {
    mockGetConfig.mockReturnValue({ apiKey: "", enabled: false });
    expect(getPreferredSlotsConfig().enabled).toBe(false);
  });

  it("is disabled when PREFERRED_SLOTS_ENABLED=false", () => {
    process.env.PREFERRED_SLOTS_ENABLED = "false";
    expect(getPreferredSlotsConfig().enabled).toBe(false);
  });

  it("reads tunable thresholds with sane defaults", () => {
    const c = getPreferredSlotsConfig();
    expect(c.officeTierMinutes).toBe(30);
    expect(c.pairNearMinutes).toBe(15);
    expect(c.pairFarMinutes).toBe(30);
    process.env.PREFERRED_SLOT_PAIR_FAR_MINUTES = "45";
    expect(getPreferredSlotsConfig().pairFarMinutes).toBe(45);
  });
});

// ---------------------------------------------------------------------------
// Async orchestrator
// ---------------------------------------------------------------------------

const CUSTOMER = "100 Customer Rd, Evergreen, CO";
const OFFICE = { id: "dtc", label: "DTC", pbLocation: "Centennial", lat: 39.6, lng: -104.85, address: "" };
const OFFICE_ORIGIN = "39.6,-104.85";

/** Route the mocked drive times: office->customer keyed by origin, customer->anchor keyed by destination. */
function wireDriveTimes(officeToCustomer: number | null, anchorMinutes: Record<string, number | null>) {
  mockGetDriveTime.mockImplementation(async (origin: string, dest: string) => {
    if (origin === OFFICE_ORIGIN) {
      return officeToCustomer == null ? null : { durationMinutes: officeToCustomer, distanceMiles: 1, cached: false };
    }
    const m = anchorMinutes[dest];
    return m == null ? null : { durationMinutes: m, distanceMiles: 1, cached: false };
  });
}

function bookedDay(bookings: Array<Record<string, unknown>>, slots: ClassifiableSlot[] = []) {
  return { availableSlots: slots, bookedSlots: bookings };
}

describe("classifyPreferredSlots", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetConfig.mockReturnValue({ apiKey: "key", enabled: true });
    mockGetOffice.mockReturnValue(OFFICE);
    delete process.env.PREFERRED_SLOTS_ENABLED;
  });

  it("returns empty and annotates nothing when the feature is disabled", async () => {
    mockGetConfig.mockReturnValue({ apiKey: "", enabled: false });
    const avail = { "2026-07-17": bookedDay([{ start_time: "10:00", end_time: "11:00", address: "x", user_uid: "jake", projectName: "P" }], [slot()]) };
    const res = await classifyPreferredSlots({ availabilityByDate: avail, candidateAddress: CUSTOMER, location: "Centennial" });
    expect(res.nearbyDays).toEqual([]);
    expect(mockGetDriveTime).not.toHaveBeenCalled();
  });

  it("returns empty when no candidate address is provided", async () => {
    const res = await classifyPreferredSlots({ availabilityByDate: {}, candidateAddress: "", location: "Centennial" });
    expect(res.nearbyDays).toEqual([]);
  });

  it("uses the NEAR threshold when the customer is close to the office (batches ≤15, rejects >15)", async () => {
    wireDriveTimes(20 /* office->customer, near tier */, {
      "200 Anchor Ave, Evergreen": 12, // ≤15 → anchor
      "900 Far St, Denver": 25, // >15 → not an anchor
    });
    const avail = {
      "2026-07-17": bookedDay(
        [
          { start_time: "10:00", end_time: "11:00", address: "200 Anchor Ave, Evergreen", user_uid: "jake", user_name: "Jake", projectName: "near" },
          { start_time: "13:00", end_time: "14:00", address: "900 Far St, Denver", user_uid: "maria", user_name: "Maria", projectName: "far" },
        ],
        [slot({ start_time: "09:00", end_time: "10:00", user_uid: "jake" }), slot({ start_time: "14:00", end_time: "15:00", user_uid: "maria" })],
      ),
    };
    const res = await classifyPreferredSlots({ availabilityByDate: avail, candidateAddress: CUSTOMER, location: "Centennial" });
    expect(res.nearbyDays).toEqual(["2026-07-17"]);
    expect(avail["2026-07-17"].availableSlots[0].preferredSlot?.tier).toBe("adjacent");
    expect(avail["2026-07-17"].availableSlots[1].preferredSlot).toBeUndefined(); // maria's far job isn't an anchor
    expect(avail["2026-07-17"].nearbyAnchors?.[0].projectName).toBe("near");
  });

  it("uses the FAR threshold once the customer is a long drive from the office (batches ≤30)", async () => {
    wireDriveTimes(45 /* office->customer, far tier */, { "900 Far St, Denver": 25 });
    const avail = {
      "2026-07-18": bookedDay(
        [{ start_time: "10:00", end_time: "11:00", address: "900 Far St, Denver", user_uid: "jake", user_name: "Jake", projectName: "far-anchor" }],
        [slot({ start_time: "11:00", end_time: "12:00", user_uid: "jake" })],
      ),
    };
    const res = await classifyPreferredSlots({ availabilityByDate: avail, candidateAddress: CUSTOMER, location: "Centennial" });
    expect(res.nearbyDays).toEqual(["2026-07-18"]); // 25 ≤ 30 far threshold
  });

  it("falls back to the strict tier when the office cannot be resolved", async () => {
    mockGetOffice.mockReturnValue(null);
    wireDriveTimes(null, { "900 Far St, Denver": 25 }); // 25 > 15 strict → not an anchor
    const avail = { "2026-07-18": bookedDay([{ start_time: "10:00", end_time: "11:00", address: "900 Far St, Denver", user_uid: "jake", projectName: "x" }], [slot({ user_uid: "jake" })]) };
    const res = await classifyPreferredSlots({ availabilityByDate: avail, candidateAddress: CUSTOMER, location: "Nowhere" });
    expect(res.nearbyDays).toEqual([]);
  });

  it("excludes the candidate's own booking as an anchor (by candidate_project_id)", async () => {
    wireDriveTimes(20, { "200 Anchor Ave, Evergreen": 0 });
    const avail = { "2026-07-17": bookedDay([{ start_time: "10:00", end_time: "11:00", address: "200 Anchor Ave, Evergreen", user_uid: "jake", projectId: "555", projectName: "self" }], [slot({ user_uid: "jake" })]) };
    const res = await classifyPreferredSlots({ availabilityByDate: avail, candidateAddress: CUSTOMER, candidateProjectId: "555", location: "Centennial" });
    expect(res.nearbyDays).toEqual([]);
  });

  it("excludes the candidate's own booking via normalized-address fallback", async () => {
    wireDriveTimes(20, {});
    const avail = { "2026-07-17": bookedDay([{ start_time: "10:00", end_time: "11:00", address: "  100 Customer RD, Evergreen, CO ", user_uid: "jake", projectName: "self-addr" }], [slot({ user_uid: "jake" })]) };
    const res = await classifyPreferredSlots({ availabilityByDate: avail, candidateAddress: CUSTOMER, location: "Centennial" });
    expect(res.nearbyDays).toEqual([]);
  });

  it("ignores bookings with no address or geo (fail-open)", async () => {
    wireDriveTimes(20, {});
    const avail = { "2026-07-17": bookedDay([{ start_time: "10:00", end_time: "11:00", user_uid: "jake", projectName: "no-loc" }], [slot({ user_uid: "jake" })]) };
    const res = await classifyPreferredSlots({ availabilityByDate: avail, candidateAddress: CUSTOMER, location: "Centennial" });
    expect(res.nearbyDays).toEqual([]);
  });

  it("collects anchors across multiple days, sorted", async () => {
    wireDriveTimes(20, { "200 Anchor Ave, Evergreen": 12 });
    const mk = () => bookedDay([{ start_time: "10:00", end_time: "11:00", address: "200 Anchor Ave, Evergreen", user_uid: "jake", user_name: "Jake", projectName: "a" }], [slot({ user_uid: "jake" })]);
    const avail = { "2026-07-20": mk(), "2026-07-17": mk() };
    const res = await classifyPreferredSlots({ availabilityByDate: avail, candidateAddress: CUSTOMER, location: "Centennial" });
    expect(res.nearbyDays).toEqual(["2026-07-17", "2026-07-20"]);
  });
});
