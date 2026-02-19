/**
 * Tests for src/lib/travel-time.ts
 * All Google API calls are mocked via global.fetch
 */

let travelModule: typeof import("@/lib/travel-time");

const mockFetch = jest.fn();

beforeEach(async () => {
  jest.resetModules();
  // Reset env
  delete process.env.GOOGLE_MAPS_API_KEY;
  delete process.env.TRAVEL_TIME_ENABLED;
  delete process.env.TRAVEL_TIME_BUFFER_MINUTES;
  delete process.env.TRAVEL_TIME_UNKNOWN_THRESHOLD;
  delete process.env.TRAVEL_TIME_TIGHT_THRESHOLD;
  // Set default key for most tests
  process.env.GOOGLE_MAPS_API_KEY = "test-api-key";
  // Mock fetch
  global.fetch = mockFetch as unknown as typeof fetch;
  mockFetch.mockReset();
  // Fresh import
  travelModule = await import("@/lib/travel-time");
  travelModule._clearCaches();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers to build mock responses
// ---------------------------------------------------------------------------

function geocodeResponse(lat: number, lng: number) {
  return {
    ok: true,
    json: async () => ({
      status: "OK",
      results: [{ geometry: { location: { lat, lng } } }],
    }),
  };
}

function distanceMatrixResponse(durationSec: number, distanceMeters: number) {
  return {
    ok: true,
    json: async () => ({
      rows: [
        {
          elements: [
            {
              status: "OK",
              duration: { value: durationSec },
              distance: { value: distanceMeters },
            },
          ],
        },
      ],
    }),
  };
}

// ---------------------------------------------------------------------------
// getConfig
// ---------------------------------------------------------------------------

describe("getConfig", () => {
  it("returns enabled=false when no API key", async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    jest.resetModules();
    const mod = await import("@/lib/travel-time");
    const config = mod.getConfig();
    expect(config.enabled).toBe(false);
    expect(config.apiKey).toBe("");
  });

  it("reads buffer and threshold from env, uses defaults", () => {
    const config = travelModule.getConfig();
    expect(config.enabled).toBe(true);
    expect(config.bufferMinutes).toBe(15);
    expect(config.unknownThresholdMinutes).toBe(90);
    expect(config.tightThresholdMinutes).toBe(10);
    expect(config.apiKey).toBe("test-api-key");
  });

  it("reads custom buffer and threshold", async () => {
    process.env.TRAVEL_TIME_BUFFER_MINUTES = "20";
    process.env.TRAVEL_TIME_UNKNOWN_THRESHOLD = "60";
    process.env.TRAVEL_TIME_TIGHT_THRESHOLD = "7";
    jest.resetModules();
    const mod = await import("@/lib/travel-time");
    const config = mod.getConfig();
    expect(config.bufferMinutes).toBe(20);
    expect(config.unknownThresholdMinutes).toBe(60);
    expect(config.tightThresholdMinutes).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// geocodeAddress
// ---------------------------------------------------------------------------

describe("geocodeAddress", () => {
  it("calls Geocoding API and returns point", async () => {
    mockFetch.mockResolvedValueOnce(geocodeResponse(39.75, -104.99));
    const point = await travelModule.geocodeAddress("123 Main St, Denver, CO");
    expect(point).toEqual({ lat: 39.75, lng: -104.99 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toContain("geocode");
  });

  it("caches results — second call doesn't fetch", async () => {
    mockFetch.mockResolvedValueOnce(geocodeResponse(39.75, -104.99));
    await travelModule.geocodeAddress("123 Main St, Denver, CO");
    const point2 = await travelModule.geocodeAddress("123 Main St, Denver, CO");
    expect(point2).toEqual({ lat: 39.75, lng: -104.99 });
    expect(mockFetch).toHaveBeenCalledTimes(1); // NOT called again
  });

  it("returns null on API error", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false });
    const point = await travelModule.geocodeAddress("bad address");
    expect(point).toBeNull();
  });

  it("returns null on fetch exception", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network error"));
    const point = await travelModule.geocodeAddress("123 Main St");
    expect(point).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveLocation
// ---------------------------------------------------------------------------

describe("resolveLocation", () => {
  it("prefers geo_coordinates over address geocode", async () => {
    const result = await travelModule.resolveLocation({
      geoCoordinates: { latitude: 39.75, longitude: -104.99 },
      address: "123 Main St, Denver, CO",
    });
    expect(result).toBe("39.75,-104.99");
    expect(mockFetch).not.toHaveBeenCalled(); // No geocoding needed
  });

  it("falls back to geocode when no coordinates", async () => {
    mockFetch.mockResolvedValueOnce(geocodeResponse(39.75, -104.99));
    const result = await travelModule.resolveLocation({
      address: "123 Main St, Denver, CO",
    });
    expect(result).toBe("39.75,-104.99");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns null when neither available", async () => {
    const result = await travelModule.resolveLocation({});
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getDriveTime
// ---------------------------------------------------------------------------

describe("getDriveTime", () => {
  it("calls Distance Matrix API and returns estimate", async () => {
    // 1800s = 30min, 32187m = ~20 miles
    mockFetch.mockResolvedValueOnce(distanceMatrixResponse(1800, 32187));
    const est = await travelModule.getDriveTime("39.75,-104.99", "39.85,-105.01");
    expect(est).not.toBeNull();
    expect(est!.durationMinutes).toBe(30);
    expect(est!.distanceMiles).toBe(20);
    expect(est!.cached).toBe(false);
  });

  it("uses directional cache — A→B ≠ B→A", async () => {
    mockFetch
      .mockResolvedValueOnce(distanceMatrixResponse(1800, 32187)) // A→B
      .mockResolvedValueOnce(distanceMatrixResponse(2400, 40000)); // B→A
    await travelModule.getDriveTime("A", "B");
    await travelModule.getDriveTime("B", "A");
    expect(mockFetch).toHaveBeenCalledTimes(2); // Both fetched (not shared cache)
  });

  it("returns cached result on same-direction repeat", async () => {
    mockFetch.mockResolvedValueOnce(distanceMatrixResponse(1800, 32187));
    await travelModule.getDriveTime("A", "B");
    const est2 = await travelModule.getDriveTime("A", "B");
    expect(mockFetch).toHaveBeenCalledTimes(1); // Cached
    expect(est2!.cached).toBe(true);
  });

  it("returns null on API error", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false });
    const est = await travelModule.getDriveTime("A", "B");
    expect(est).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// evaluateSlotTravel
// ---------------------------------------------------------------------------

describe("evaluateSlotTravel", () => {
  // Helper: mock resolveLocation that returns addresses as-is
  const mockResolve = (p: {
    geoCoordinates?: { latitude: number; longitude: number };
    address?: string;
  }) => {
    if (p.geoCoordinates) return Promise.resolve(`${p.geoCoordinates.latitude},${p.geoCoordinates.longitude}`);
    if (p.address) return Promise.resolve(p.address);
    return Promise.resolve(null);
  };

  it("returns null when no adjacent bookings", async () => {
    const warning = await travelModule.evaluateSlotTravel({
      candidateAddress: "123 Main St",
      slotStartTime: "12:00",
      slotEndTime: "13:00",
      bufferMinutes: 15,
      resolveLocationFn: mockResolve,
    });
    expect(warning).toBeNull();
  });

  it("returns type 'tight' when gap < drive + buffer", async () => {
    // 30min drive, 15min buffer = 45min needed, but only 30min gap
    mockFetch.mockResolvedValueOnce(distanceMatrixResponse(1800, 32187)); // 30min
    const warning = await travelModule.evaluateSlotTravel({
      candidateAddress: "123 Main St",
      slotStartTime: "12:00",
      slotEndTime: "13:00",
      prevBooking: {
        address: "456 Oak Ave",
        endTime: "11:30", // 30min gap before slot
        projectName: "Project A",
      },
      bufferMinutes: 15,
      unknownThresholdMinutes: 90,
      resolveLocationFn: mockResolve,
    });
    expect(warning).not.toBeNull();
    expect(warning!.type).toBe("tight");
    expect(warning!.direction).toBe("before");
    expect(warning!.prevJob?.travelMinutes).toBe(30);
    expect(warning!.availableMinutesBefore).toBe(30);
  });

  it("suppresses marginal tight warnings below threshold", async () => {
    // 30min drive + 15 buffer = 45 required; 40min gap => 5min deficit (< default threshold 10)
    mockFetch.mockResolvedValueOnce(distanceMatrixResponse(1800, 32187)); // 30min
    const warning = await travelModule.evaluateSlotTravel({
      candidateAddress: "123 Main St",
      slotStartTime: "12:00",
      slotEndTime: "13:00",
      prevBooking: {
        address: "456 Oak Ave",
        endTime: "11:20", // 40min gap before slot
        projectName: "Project A",
      },
      bufferMinutes: 15,
      unknownThresholdMinutes: 90,
      resolveLocationFn: mockResolve,
    });
    expect(warning).toBeNull();
  });

  it("returns type 'unknown' when address missing and gap < threshold", async () => {
    const warning = await travelModule.evaluateSlotTravel({
      candidateAddress: "123 Main St",
      slotStartTime: "12:00",
      slotEndTime: "13:00",
      prevBooking: {
        // No address, no coordinates
        endTime: "11:30",
        projectName: "Project A",
      },
      bufferMinutes: 15,
      unknownThresholdMinutes: 90,
      resolveLocationFn: mockResolve,
    });
    expect(warning).not.toBeNull();
    expect(warning!.type).toBe("unknown");
  });

  it("returns null when gap is sufficient", async () => {
    // 15min drive, 15min buffer = 30min needed, 60min gap available
    mockFetch.mockResolvedValueOnce(distanceMatrixResponse(900, 16000)); // 15min
    const warning = await travelModule.evaluateSlotTravel({
      candidateAddress: "123 Main St",
      slotStartTime: "12:00",
      slotEndTime: "13:00",
      prevBooking: {
        address: "456 Oak Ave",
        endTime: "11:00", // 60min gap
        projectName: "Project A",
      },
      bufferMinutes: 15,
      unknownThresholdMinutes: 90,
      resolveLocationFn: mockResolve,
    });
    expect(warning).toBeNull();
  });

  it("returns null when address missing but gap ≥ unknown threshold", async () => {
    const warning = await travelModule.evaluateSlotTravel({
      candidateAddress: "123 Main St",
      slotStartTime: "12:00",
      slotEndTime: "13:00",
      prevBooking: {
        // No address
        endTime: "10:00", // 120min gap (≥ 90 threshold)
        projectName: "Project A",
      },
      bufferMinutes: 15,
      unknownThresholdMinutes: 90,
      resolveLocationFn: mockResolve,
    });
    expect(warning).toBeNull();
  });

  it("combines before + after into 'both' direction with worst severity", async () => {
    // Before: tight (30min drive, 30min gap)
    // After: unknown (no address, 45min gap < 90 threshold)
    mockFetch.mockResolvedValueOnce(distanceMatrixResponse(1800, 32187)); // before
    const warning = await travelModule.evaluateSlotTravel({
      candidateAddress: "123 Main St",
      slotStartTime: "12:00",
      slotEndTime: "13:00",
      prevBooking: {
        address: "456 Oak Ave",
        endTime: "11:30",
        projectName: "Project A",
      },
      nextBooking: {
        // No address
        startTime: "13:45",
        projectName: "Project B",
      },
      bufferMinutes: 15,
      unknownThresholdMinutes: 90,
      resolveLocationFn: mockResolve,
    });
    expect(warning).not.toBeNull();
    expect(warning!.type).toBe("tight"); // worst of tight + unknown
    expect(warning!.direction).toBe("both");
    expect(warning!.prevJob).toBeDefined();
    expect(warning!.nextJob).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// evaluateSlotsBatch
// ---------------------------------------------------------------------------

describe("evaluateSlotsBatch", () => {
  it("dedupes same origin/destination pairs across slots", async () => {
    // Two slots for same surveyor, both adjacent to same prev job
    // Should only call getDriveTime once for prevAddr→candidateAddr
    mockFetch
      .mockResolvedValueOnce(geocodeResponse(39.75, -104.99)) // candidate geocode
      .mockResolvedValueOnce(geocodeResponse(39.80, -105.00)) // prev job geocode
      .mockResolvedValueOnce(distanceMatrixResponse(1800, 32187)); // drive time (once!)

    const slots = [
      { start_time: "12:00", end_time: "13:00", user_uid: "u1", user_name: "Drew" },
      { start_time: "13:00", end_time: "14:00", user_uid: "u1", user_name: "Drew" },
    ];
    const booked = {
      u1: [
        {
          start_time: "10:00",
          end_time: "11:30",
          address: "456 Oak Ave",
          projectName: "Prev Job",
        },
      ],
    };

    await travelModule.evaluateSlotsBatch(slots, booked, "123 Main St", 15);

    // geocodeAddress is called for candidate + prev job = 2 geocode calls
    // getDriveTime is called once (same origin/dest pair for both slots via batch memoization)
    const geocodeCalls = mockFetch.mock.calls.filter((c: string[]) =>
      c[0].includes("geocode")
    );
    const distanceCalls = mockFetch.mock.calls.filter((c: string[]) =>
      c[0].includes("distancematrix")
    );
    expect(geocodeCalls.length).toBe(2); // candidate + prev
    expect(distanceCalls.length).toBe(1); // deduped
  });

  it("respects concurrency — does not crash with many slots", async () => {
    // Create 20 slots to test bounded concurrency
    mockFetch.mockResolvedValue(geocodeResponse(39.75, -104.99));

    const slots = Array.from({ length: 20 }, (_, i) => ({
      start_time: `${(8 + i).toString().padStart(2, "0")}:00`,
      end_time: `${(9 + i).toString().padStart(2, "0")}:00`,
      user_uid: "u1",
      user_name: "Drew",
    }));
    const booked = {
      u1: [
        {
          start_time: "07:00",
          end_time: "07:30",
          address: "456 Oak Ave",
          projectName: "Early Job",
        },
      ],
    };

    // Should complete without error (bounded concurrency handles it)
    await travelModule.evaluateSlotsBatch(slots, booked, "123 Main St", 15);
    // Just verify it didn't throw
    expect(true).toBe(true);
  });

  it("times out gracefully — fail-open, no warning on timeout", async () => {
    // Make fetch hang forever
    mockFetch.mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    const slots = [
      { start_time: "12:00", end_time: "13:00", user_uid: "u1", user_name: "Drew" },
    ];
    const booked = {
      u1: [
        {
          start_time: "11:00",
          end_time: "11:30",
          address: "456 Oak Ave",
          projectName: "Prev Job",
        },
      ],
    };

    // Should resolve within timeout budget (not hang forever)
    const start = Date.now();
    await travelModule.evaluateSlotsBatch(slots, booked, "123 Main St", 15);
    const elapsed = Date.now() - start;

    // Should complete within ~PER_CALL_TIMEOUT_MS + some margin
    expect(elapsed).toBeLessThan(10000);
    // No warning set (fail-open)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((slots[0] as any).travelWarning).toBeUndefined();
  }, 15000);
});
