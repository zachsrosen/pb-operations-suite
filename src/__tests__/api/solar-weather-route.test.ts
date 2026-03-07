/**
 * Route-level tests for GET /api/solar/weather
 *
 * Tests cache hit/miss/TTL behavior — the route layer that was missing
 * from the parser-only solar-weather.test.ts (PBO-003a P2).
 *
 * Tests:
 *  1. Cache miss → fetches from NREL, parses, caches, returns source=nrel
 *  2. Cache hit (fresh) → returns cached data with source=cache, no NREL fetch
 *  3. Cache expired (>90 days) → re-fetches from NREL, updates cache
 *  4. Missing lat/lng → 400
 *  5. NREL fetch failure → 502
 *  6. NREL returns invalid CSV → 502
 *  7. Row count mismatch (not 8760) → 502
 *  8. Cache upsert failure is non-fatal
 *  9. latE3/lngE3 rounding
 */

// ── Set env BEFORE module imports (NREL_API_KEY is captured at module level) ──
process.env.NREL_API_KEY = "test-api-key-123";

// ── Auth mock ──────────────────────────────────────────────
jest.mock("@/lib/solar-auth", () => ({
  requireSolarAuth: jest.fn().mockResolvedValue([
    { id: "user1", email: "test@photonbrothers.com", role: "ADMIN" },
    null,
  ]),
}));

// ── Prisma mock ────────────────────────────────────────────
const mockFindUnique = jest.fn();
const mockUpsert = jest.fn();

jest.mock("@/lib/db", () => ({
  prisma: {
    solarWeatherCache: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      upsert: (...args: unknown[]) => mockUpsert(...args),
    },
  },
}));

// ── Global fetch mock ──────────────────────────────────────
const originalFetch = global.fetch;
const mockFetch = jest.fn();

beforeAll(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = originalFetch;
  delete process.env.NREL_API_KEY;
});

// ── Route under test ───────────────────────────────────────
import { NextRequest } from "next/server";
import { GET } from "@/app/api/solar/weather/route";

// ── Helpers ────────────────────────────────────────────────

/** Standard NSRDB header */
const HEADER = "Year,Month,Day,Hour,Minute,GHI,DNI,DHI,Temperature,Pressure,Wind Speed";

/** Generate a valid 8760-row CSV with metadata row + header + data */
function makeValidCsv(): string {
  const metaRow = "Source,Location ID,Latitude,Longitude,Timezone";
  const rows = [metaRow, HEADER];
  for (let i = 0; i < 8760; i++) {
    const hour = i % 24;
    const ghi = hour >= 6 && hour <= 18
      ? Math.round(Math.sin(((hour - 6) / 12) * Math.PI) * 800)
      : 0;
    const temp = (15 + 5 * Math.sin(((hour - 6) / 24) * Math.PI * 2)).toFixed(1);
    rows.push(`2021,1,${Math.floor(i / 24) + 1},${hour},0,${ghi},100,50,${temp},1013,5`);
  }
  return rows.join("\n");
}

/** Cached TMY data shape (what prisma would return) */
function makeCachedTmyData() {
  const ghi: number[] = [];
  const temperature: number[] = [];
  for (let i = 0; i < 8760; i++) {
    const hour = i % 24;
    ghi.push(hour >= 6 && hour <= 18 ? Math.round(Math.sin(((hour - 6) / 12) * Math.PI) * 800) : 0);
    temperature.push(15 + 5 * Math.sin(((hour - 6) / 24) * Math.PI * 2));
  }
  return { ghi, temperature };
}

function makeRequest(lat?: number | string, lng?: number | string): NextRequest {
  const params = new URLSearchParams();
  if (lat !== undefined) params.set("lat", String(lat));
  if (lng !== undefined) params.set("lng", String(lng));
  return new NextRequest(`http://localhost/api/solar/weather?${params}`);
}

// ── Tests ──────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GET /api/solar/weather", () => {
  // ── Validation ───────────────────────────────────────────

  it("returns 400 for invalid lat/lng (non-numeric strings)", async () => {
    const res = await GET(makeRequest("abc", "xyz"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid coordinates");
  });

  it("returns 400 for out-of-range coordinates", async () => {
    const res = await GET(makeRequest(91, -104));
    expect(res.status).toBe(400);
  });

  // ── Cache miss → NREL fetch ──────────────────────────────

  it("fetches from NREL on cache miss, caches result, returns source=nrel", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockUpsert.mockResolvedValue({});

    const csvText = makeValidCsv();
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(csvText),
    });

    const res = await GET(makeRequest(39.739, -104.985));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.source).toBe("nrel");
    expect(body.data.ghi).toHaveLength(8760);
    expect(body.data.temperature).toHaveLength(8760);
    expect(body.latE3).toBe(39739);
    expect(body.lngE3).toBe(-104985);

    // Should have called NREL API
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toContain("developer.nrel.gov");

    // Should have upserted to cache
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const upsertArgs = mockUpsert.mock.calls[0][0];
    expect(upsertArgs.where.latE3_lngE3).toEqual({ latE3: 39739, lngE3: -104985 });
  });

  // ── Cache hit (fresh) ────────────────────────────────────

  it("returns cached data without NREL fetch when cache is fresh", async () => {
    const tmyData = makeCachedTmyData();
    mockFindUnique.mockResolvedValue({
      latE3: 39739,
      lngE3: -104985,
      tmyData,
      fetchedAt: new Date(), // just now → fresh
    });

    const res = await GET(makeRequest(39.739, -104.985));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.source).toBe("cache");
    expect(body.data.ghi).toHaveLength(8760);
    expect(body.data.temperature).toHaveLength(8760);

    // Should NOT have called NREL
    expect(mockFetch).not.toHaveBeenCalled();
    // Should NOT have upserted
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  // ── Cache expired (TTL rollover) ─────────────────────────

  it("re-fetches from NREL when cache is older than 90 days", async () => {
    const tmyData = makeCachedTmyData();
    const expired = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000); // 91 days ago
    mockFindUnique.mockResolvedValue({
      latE3: 39739,
      lngE3: -104985,
      tmyData,
      fetchedAt: expired,
    });
    mockUpsert.mockResolvedValue({});

    const csvText = makeValidCsv();
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(csvText),
    });

    const res = await GET(makeRequest(39.739, -104.985));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.source).toBe("nrel"); // re-fetched, not cache
    expect(body.data.ghi).toHaveLength(8760);

    // Should have called NREL
    expect(mockFetch).toHaveBeenCalledTimes(1);
    // Should have upserted refreshed data
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  it("treats exactly 90-day-old cache as expired (boundary)", async () => {
    const tmyData = makeCachedTmyData();
    const exactlyExpired = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    mockFindUnique.mockResolvedValue({
      latE3: 39739,
      lngE3: -104985,
      tmyData,
      fetchedAt: exactlyExpired,
    });
    mockUpsert.mockResolvedValue({});

    const csvText = makeValidCsv();
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(csvText),
    });

    const res = await GET(makeRequest(39.739, -104.985));
    expect(res.status).toBe(200);

    const body = await res.json();
    // age === TTL_MS → strict less-than fails → treated as expired
    expect(body.source).toBe("nrel");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns cached data at 89 days (within TTL)", async () => {
    const tmyData = makeCachedTmyData();
    const almostExpired = new Date(Date.now() - 89 * 24 * 60 * 60 * 1000);
    mockFindUnique.mockResolvedValue({
      latE3: 39739,
      lngE3: -104985,
      tmyData,
      fetchedAt: almostExpired,
    });

    const res = await GET(makeRequest(39.739, -104.985));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.source).toBe("cache");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ── NREL failure paths ───────────────────────────────────

  it("returns 502 when NREL API returns non-OK status", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      text: () => Promise.resolve("Rate limit exceeded"),
    });

    const res = await GET(makeRequest(39.739, -104.985));
    expect(res.status).toBe(502);

    const body = await res.json();
    expect(body.error).toBe("NREL API request failed");
    expect(body.nrelStatus).toBe(429);
  });

  it("returns 502 when NREL fetch throws (network error)", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockFetch.mockRejectedValue(new Error("Network timeout"));

    const res = await GET(makeRequest(39.739, -104.985));
    expect(res.status).toBe(502);

    const body = await res.json();
    expect(body.error).toBe("Failed to reach NREL API");
  });

  it("returns 502 when NREL CSV is unparseable", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("this,is,not,a,valid,csv\nfoo,bar,baz"),
    });

    const res = await GET(makeRequest(39.739, -104.985));
    expect(res.status).toBe(502);

    const body = await res.json();
    expect(body.error).toContain("Failed to parse");
  });

  it("returns 502 when CSV has fewer than 8760 data rows", async () => {
    mockFindUnique.mockResolvedValue(null);

    const meta = "Source,Location";
    const rows = [meta, HEADER];
    for (let i = 0; i < 100; i++) {
      rows.push(`2021,1,1,${i % 24},0,500,100,50,20,1013,5`);
    }
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(rows.join("\n")),
    });

    const res = await GET(makeRequest(39.739, -104.985));
    expect(res.status).toBe(502);

    const body = await res.json();
    expect(body.error).toContain("Expected 8760");
  });

  // ── latE3/lngE3 rounding ────────────────────────────────

  it("rounds coordinates correctly for cache key", async () => {
    const tmyData = makeCachedTmyData();
    mockFindUnique.mockResolvedValue({
      latE3: 39739,
      lngE3: -104985,
      tmyData,
      fetchedAt: new Date(),
    });

    // 39.7394 should round to 39739, -104.9851 should round to -104985
    const res = await GET(makeRequest(39.7394, -104.9851));
    expect(res.status).toBe(200);

    // Verify the findUnique was called with correctly rounded keys
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { latE3_lngE3: { latE3: 39739, lngE3: -104985 } },
    });
  });

  // ── Cache write failure is non-fatal ─────────────────────

  it("returns data even when cache upsert fails", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockUpsert.mockRejectedValue(new Error("DB write failed"));

    const csvText = makeValidCsv();
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(csvText),
    });

    const res = await GET(makeRequest(39.739, -104.985));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.source).toBe("nrel");
    expect(body.data.ghi).toHaveLength(8760);
  });
});
