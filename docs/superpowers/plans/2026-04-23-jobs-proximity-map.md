# Jobs Proximity Map Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 1 of `/dashboards/map` — a standalone dashboard showing scheduled + unscheduled installs and service work on a Google map, with proximity-aware detail panels and deep-links to the existing schedulers.

**Architecture:** Standalone Next.js page backed by a single aggregation endpoint. Pulls from HubSpot (installs + tickets) and Zuper (service jobs), normalizes to a `JobMarker[]` + `CrewPin[]` contract, caches 60s server-side and 30s client-side with SSE invalidation. Proximity computed client-side (Haversine, no extra round-trips). Rendered via `@vis.gl/react-google-maps` with supercluster. Ships behind `NEXT_PUBLIC_UI_MAP_VIEW_ENABLED=false`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, `@vis.gl/react-google-maps`, `supercluster`, React Query v5, Jest + Testing Library, Prisma (read-only — no schema changes), `DashboardShell`, existing theme tokens (`bg-surface`, `text-foreground`), existing `HubSpotPropertyCache` + `lib/travel-time.ts` geocoding cache.

**Spec:** `docs/superpowers/specs/2026-04-23-jobs-proximity-map-design.md`

---

## Chunk 1: Foundation (types, colors, proximity, aggregator, API)

### Task 1: Shared types

**Files:**
- Create: `src/lib/map-types.ts`

- [ ] **Step 1: Create the types file**

```ts
// src/lib/map-types.ts

export type JobMarkerKind =
  | "install"
  | "service"
  | "inspection"
  | "survey"
  | "dnr"
  | "roofing";

export type MapMode = "today" | "week" | "backlog";

export type CrewShopId = "dtc" | "westy" | "cosp" | "ca" | "camarillo";

export interface JobMarkerAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
}

export interface JobMarker {
  id: string; // stable: "install:PROJ-8241", "ticket:3114", "zuperjob:<uid>"
  kind: JobMarkerKind;
  scheduled: boolean;
  lat: number;
  lng: number;
  address: JobMarkerAddress;
  title: string;
  subtitle?: string;
  status?: string;
  priorityScore?: number;
  scheduledAt?: string;
  crewId?: string;
  dealId?: string;
  ticketId?: string;
  zuperJobUid?: string;
  rawStage?: string;
}

export interface CrewRouteStop {
  lat: number;
  lng: number;
  time: string;
  title: string;
  kind: JobMarkerKind;
}

export interface CrewPin {
  id: string;
  name: string;
  shopId: CrewShopId;
  currentLat?: number;
  currentLng?: number;
  routeStops: CrewRouteStop[];
  working: boolean;
}

export interface UnplacedMarker {
  id: string;
  kind: JobMarkerKind;
  title: string;
  address: JobMarkerAddress;
  reason: "no-cache" | "geocode-failed" | "missing-address";
}

export interface MapMarkersResponse {
  markers: JobMarker[];
  crews: CrewPin[];
  lastUpdated: string;
  droppedCount: number;
  partialFailures?: string[];
  unplaced?: UnplacedMarker[];
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/map-types.ts
git commit -m "feat(map): add JobMarker/CrewPin/MapMarkersResponse types"
```

---

### Task 2: Color palette constant

**Files:**
- Create: `src/lib/map-colors.ts`

- [ ] **Step 1: Create the file**

Per spec, Google Maps markers cannot use CSS variables — concrete hex strings required. Centralize them here so the palette is greppable.

```ts
// src/lib/map-colors.ts
import type { JobMarkerKind, CrewShopId } from "./map-types";

/**
 * Color palette for map markers. Google Maps JS API requires concrete color
 * strings — CSS variable tokens are not usable at the marker level. This file
 * is the single source of truth for the map color palette; do NOT inline these
 * hex values anywhere else.
 */
export const MARKER_COLORS: Record<JobMarkerKind, string> = {
  install: "#f97316",      // orange
  service: "#22c55e",      // green
  inspection: "#3b82f6",   // blue
  survey: "#a855f7",       // purple
  dnr: "#eab308",          // yellow
  roofing: "#ef4444",      // red
};

export const CREW_COLOR_WORKING = "#38bdf8";  // cyan
export const CREW_COLOR_IDLE = "#64748b";     // grey

export const CLUSTER_COLORS = {
  small: "rgba(249, 115, 22, 0.85)",   // 2–9
  medium: "rgba(249, 115, 22, 0.92)",  // 10–49
  large: "rgba(239, 68, 68, 0.92)",    // 50+
};

export const CLUSTER_THRESHOLDS = { medium: 10, large: 50 } as const;

export function markerFillStyle(
  kind: JobMarkerKind,
  scheduled: boolean
): { fillColor: string; strokeColor: string; fillOpacity: number; strokeWeight: number; strokeDashArray?: string } {
  const color = MARKER_COLORS[kind];
  if (scheduled) {
    return { fillColor: color, strokeColor: "#0b1220", fillOpacity: 1, strokeWeight: 2 };
  }
  return { fillColor: "transparent", strokeColor: color, fillOpacity: 0, strokeWeight: 2, strokeDashArray: "4 2" };
}

// Shop → hex for the idle home-shop pin hover label
export const SHOP_LABELS: Record<CrewShopId, string> = {
  dtc: "DTC",
  westy: "Westy",
  cosp: "COSP",
  ca: "CA (SLO/Camarillo)",
  camarillo: "Camarillo",
};
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/map-colors.ts
git commit -m "feat(map): add centralized marker color palette"
```

---

### Task 3: Proximity helpers (TDD)

**Files:**
- Create: `src/lib/map-proximity.ts`
- Test: `src/__tests__/map-proximity.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/map-proximity.test.ts
import { haversineMiles, nearbyMarkers, closestCrews } from "@/lib/map-proximity";
import type { JobMarker, CrewPin } from "@/lib/map-types";

const denver = { lat: 39.7392, lng: -104.9903 };
const boulder = { lat: 40.0150, lng: -105.2705 };
const coloradoSprings = { lat: 38.8339, lng: -104.8214 };

function makeMarker(id: string, lat: number, lng: number): JobMarker {
  return {
    id,
    kind: "install",
    scheduled: false,
    lat,
    lng,
    address: { street: "", city: "", state: "CO", zip: "" },
    title: id,
  };
}

function makeCrew(id: string, lat: number, lng: number): CrewPin {
  return {
    id,
    name: id,
    shopId: "dtc",
    currentLat: lat,
    currentLng: lng,
    routeStops: [],
    working: true,
  };
}

describe("haversineMiles", () => {
  it("is 0 for the same point", () => {
    expect(haversineMiles(denver, denver)).toBeCloseTo(0, 2);
  });

  it("denver → boulder is ~24–27 miles", () => {
    const d = haversineMiles(denver, boulder);
    expect(d).toBeGreaterThan(24);
    expect(d).toBeLessThan(28);
  });

  it("denver → CO springs is ~62–66 miles", () => {
    const d = haversineMiles(denver, coloradoSprings);
    expect(d).toBeGreaterThan(62);
    expect(d).toBeLessThan(66);
  });
});

describe("nearbyMarkers", () => {
  const origin = denver;
  const markers = [
    makeMarker("near-1", 39.7400, -104.9900),   // ~0.1 mi
    makeMarker("boulder", boulder.lat, boulder.lng), // ~26 mi
    makeMarker("cos", coloradoSprings.lat, coloradoSprings.lng), // ~64 mi
    makeMarker("also-near", 39.7450, -104.9800), // <1 mi
  ];

  it("respects maxMiles", () => {
    const result = nearbyMarkers(origin, markers, { maxMiles: 10 });
    expect(result.map(r => r.id).sort()).toEqual(["also-near", "near-1"]);
  });

  it("respects limit", () => {
    const result = nearbyMarkers(origin, markers, { maxMiles: 100, limit: 2 });
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("near-1");
    expect(result[1].id).toBe("also-near");
  });

  it("excludes excludeId", () => {
    const result = nearbyMarkers(origin, markers, {
      maxMiles: 100,
      excludeId: "near-1",
    });
    expect(result.map(r => r.id)).not.toContain("near-1");
  });

  it("returns markers with distanceMiles attached", () => {
    const result = nearbyMarkers(origin, markers, { maxMiles: 5 });
    expect(result[0]).toHaveProperty("distanceMiles");
    expect(typeof result[0].distanceMiles).toBe("number");
  });
});

describe("closestCrews", () => {
  it("sorts by distance ascending", () => {
    const origin = denver;
    const crews = [
      makeCrew("far", coloradoSprings.lat, coloradoSprings.lng),
      makeCrew("close", 39.7400, -104.9900),
      makeCrew("mid", boulder.lat, boulder.lng),
    ];
    const result = closestCrews(origin, crews, { maxMiles: 100 });
    expect(result.map(r => r.id)).toEqual(["close", "mid", "far"]);
  });

  it("skips crews without currentLat/currentLng", () => {
    const origin = denver;
    const crews: CrewPin[] = [
      makeCrew("has-loc", 39.7400, -104.9900),
      {
        id: "no-loc",
        name: "No Loc",
        shopId: "dtc",
        routeStops: [],
        working: false,
      },
    ];
    const result = closestCrews(origin, crews, { maxMiles: 100 });
    expect(result.map(r => r.id)).toEqual(["has-loc"]);
  });
});
```

- [ ] **Step 2: Run test — expect fail**

```bash
npx jest src/__tests__/map-proximity.test.ts
```

Expected: Test suite fails to compile (module not found).

- [ ] **Step 3: Implement**

```ts
// src/lib/map-proximity.ts
import type { JobMarker, CrewPin } from "./map-types";

const EARTH_RADIUS_MI = 3958.8;

export interface LatLng {
  lat: number;
  lng: number;
}

export function haversineMiles(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(h));
}

export interface NearbyOptions {
  maxMiles?: number;
  limit?: number;
  excludeId?: string;
}

export interface MarkerWithDistance extends JobMarker {
  distanceMiles: number;
}

export function nearbyMarkers(
  origin: LatLng,
  markers: JobMarker[],
  options: NearbyOptions = {}
): MarkerWithDistance[] {
  const { maxMiles = 10, limit = 5, excludeId } = options;
  const result: MarkerWithDistance[] = [];

  for (const m of markers) {
    if (m.id === excludeId) continue;
    const distanceMiles = haversineMiles(origin, m);
    if (distanceMiles <= maxMiles) {
      result.push({ ...m, distanceMiles });
    }
  }

  result.sort((a, b) => a.distanceMiles - b.distanceMiles);
  return result.slice(0, limit);
}

export interface CrewWithDistance extends CrewPin {
  distanceMiles: number;
}

export interface ClosestCrewsOptions {
  maxMiles?: number;
  limit?: number;
}

export function closestCrews(
  origin: LatLng,
  crews: CrewPin[],
  options: ClosestCrewsOptions = {}
): CrewWithDistance[] {
  const { maxMiles = 10, limit = 3 } = options;
  const result: CrewWithDistance[] = [];

  for (const c of crews) {
    if (c.currentLat == null || c.currentLng == null) continue;
    const distanceMiles = haversineMiles(origin, {
      lat: c.currentLat,
      lng: c.currentLng,
    });
    if (distanceMiles <= maxMiles) {
      result.push({ ...c, distanceMiles });
    }
  }

  result.sort((a, b) => a.distanceMiles - b.distanceMiles);
  return result.slice(0, limit);
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npx jest src/__tests__/map-proximity.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/map-proximity.ts src/__tests__/map-proximity.test.ts
git commit -m "feat(map): haversine distance + nearby/closest proximity helpers"
```

---

### Task 4: Aggregator — geocoding resolver helper (TDD)

**Files:**
- Create: `src/lib/map-aggregator.ts` (initial — just the resolver)
- Test: `src/__tests__/map-aggregator.test.ts`

The full aggregator is large; we build it in pieces. First the address resolver (priority cascade).

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/map-aggregator.test.ts
import { resolveAddressCoords } from "@/lib/map-aggregator";

// Mock modules
jest.mock("@/lib/db", () => ({
  prisma: {
    hubSpotPropertyCache: {
      findFirst: jest.fn(),
    },
  },
}));

jest.mock("@/lib/travel-time", () => ({
  geocodeAddress: jest.fn(),
}));

import { prisma } from "@/lib/db";
import { geocodeAddress as liveGeocode } from "@/lib/travel-time";

const mockFindFirst = prisma.hubSpotPropertyCache.findFirst as jest.Mock;
const mockLiveGeocode = liveGeocode as jest.Mock;

describe("resolveAddressCoords", () => {
  beforeEach(() => {
    mockFindFirst.mockReset();
    mockLiveGeocode.mockReset();
  });

  const addr = {
    street: "123 Main St",
    city: "Denver",
    state: "CO",
    zip: "80202",
  };

  it("returns cache hit without calling live geocode", async () => {
    mockFindFirst.mockResolvedValue({ latitude: 39.74, longitude: -104.99 });
    const result = await resolveAddressCoords(addr);
    expect(result).toEqual({ lat: 39.74, lng: -104.99, source: "cache" });
    expect(mockLiveGeocode).not.toHaveBeenCalled();
  });

  it("falls back to live geocode on cache miss", async () => {
    mockFindFirst.mockResolvedValue(null);
    mockLiveGeocode.mockResolvedValue({ lat: 39.74, lng: -104.99 });
    const result = await resolveAddressCoords(addr);
    expect(result).toEqual({ lat: 39.74, lng: -104.99, source: "live" });
    expect(mockLiveGeocode).toHaveBeenCalledTimes(1);
  });

  it("returns null when cache miss + live geocode fails", async () => {
    mockFindFirst.mockResolvedValue(null);
    mockLiveGeocode.mockResolvedValue(null);
    const result = await resolveAddressCoords(addr);
    expect(result).toBeNull();
  });

  it("returns null with missing-fields when address is incomplete", async () => {
    const result = await resolveAddressCoords({
      street: "",
      city: "",
      state: "",
      zip: "",
    });
    expect(result).toBeNull();
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockLiveGeocode).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test — expect fail**

```bash
npx jest src/__tests__/map-aggregator.test.ts
```

Expected: Module not found.

- [ ] **Step 3: Implement resolver**

```ts
// src/lib/map-aggregator.ts
import { prisma } from "@/lib/db";
import { geocodeAddress as liveGeocode } from "@/lib/travel-time";
import type { JobMarkerAddress } from "./map-types";

export interface ResolvedCoords {
  lat: number;
  lng: number;
  source: "cache" | "live";
}

/**
 * Resolve an address to lat/lng via cascade:
 *   1. HubSpotPropertyCache exact-address match
 *   2. Live Google geocode (cached in travel-time.ts for 24h)
 *
 * Returns null when the address is incomplete or geocoding fails.
 */
export async function resolveAddressCoords(
  addr: JobMarkerAddress
): Promise<ResolvedCoords | null> {
  if (!addr.street || !addr.city || !addr.state || !addr.zip) {
    return null;
  }

  // 1. Property cache
  try {
    const cached = await prisma.hubSpotPropertyCache.findFirst({
      where: {
        street: addr.street,
        city: addr.city,
        state: addr.state,
        zip: addr.zip,
      },
      select: { latitude: true, longitude: true },
    });
    if (cached?.latitude != null && cached?.longitude != null) {
      return { lat: cached.latitude, lng: cached.longitude, source: "cache" };
    }
  } catch {
    // Fall through to live
  }

  // 2. Live geocode
  const full = `${addr.street}, ${addr.city}, ${addr.state} ${addr.zip}`;
  const point = await liveGeocode(full);
  if (point) return { lat: point.lat, lng: point.lng, source: "live" };

  return null;
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npx jest src/__tests__/map-aggregator.test.ts -t resolveAddressCoords
```

Expected: All 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/map-aggregator.ts src/__tests__/map-aggregator.test.ts
git commit -m "feat(map): address → coords resolver (cache → live cascade)"
```

---

### Task 5: Aggregator — install markers (TDD)

**Files:**
- Modify: `src/lib/map-aggregator.ts`
- Modify: `src/__tests__/map-aggregator.test.ts`

- [ ] **Step 1: Add failing test for `buildInstallMarkers`**

Append to `src/__tests__/map-aggregator.test.ts`:

```ts
import { buildInstallMarkers } from "@/lib/map-aggregator";
import type { TransformedProject } from "@/lib/types";

describe("buildInstallMarkers", () => {
  beforeEach(() => {
    mockFindFirst.mockReset();
    mockLiveGeocode.mockReset();
  });

  const sampleProject: Partial<TransformedProject> = {
    id: "PROJ-8241",
    project_name: "Jenkins Residence",
    street_address: "4820 Gunbarrel Ave",
    city: "Boulder",
    state: "CO",
    zip: "80301",
    pipeline_stage: "Construction Scheduled",
    construction_schedule_date: "2026-04-23T16:00:00.000Z",
    system_size_kw_dc: 9.6,
  };

  it("normalizes a scheduled project into a JobMarker", async () => {
    mockFindFirst.mockResolvedValue({ latitude: 40.01, longitude: -105.25 });
    const { markers, unplaced } = await buildInstallMarkers(
      [sampleProject as TransformedProject],
      { today: new Date("2026-04-23") }
    );
    expect(unplaced).toHaveLength(0);
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({
      id: "install:PROJ-8241",
      kind: "install",
      scheduled: true,
      lat: 40.01,
      lng: -105.25,
      title: "Jenkins Residence",
      dealId: "PROJ-8241",
    });
    expect(markers[0].scheduledAt).toBeDefined();
  });

  it("marks RTB projects as unscheduled", async () => {
    mockFindFirst.mockResolvedValue({ latitude: 40.01, longitude: -105.25 });
    const rtb = {
      ...sampleProject,
      pipeline_stage: "Ready to Build",
      construction_schedule_date: undefined,
    };
    const { markers } = await buildInstallMarkers(
      [rtb as TransformedProject],
      { today: new Date("2026-04-23") }
    );
    expect(markers[0].scheduled).toBe(false);
    expect(markers[0].scheduledAt).toBeUndefined();
  });

  it("adds to unplaced[] when geocoding fails", async () => {
    mockFindFirst.mockResolvedValue(null);
    mockLiveGeocode.mockResolvedValue(null);
    const { markers, unplaced } = await buildInstallMarkers(
      [sampleProject as TransformedProject],
      { today: new Date("2026-04-23") }
    );
    expect(markers).toHaveLength(0);
    expect(unplaced).toHaveLength(1);
    expect(unplaced[0].reason).toBe("geocode-failed");
  });

  it("adds missing-address unplaced entry when fields are empty", async () => {
    const bad = { ...sampleProject, street_address: "" };
    const { markers, unplaced } = await buildInstallMarkers(
      [bad as TransformedProject],
      { today: new Date("2026-04-23") }
    );
    expect(markers).toHaveLength(0);
    expect(unplaced[0].reason).toBe("missing-address");
  });
});
```

- [ ] **Step 2: Run — expect fail** (`buildInstallMarkers` undefined)

- [ ] **Step 3: Implement**

Append to `src/lib/map-aggregator.ts`:

```ts
import type { TransformedProject } from "@/lib/types";
import type { JobMarker, UnplacedMarker } from "./map-types";

export interface BuildResult {
  markers: JobMarker[];
  unplaced: UnplacedMarker[];
}

function isInstallScheduled(project: TransformedProject): boolean {
  return !!project.construction_schedule_date;
}

function projectAddress(p: TransformedProject) {
  return {
    street: p.street_address ?? "",
    city: p.city ?? "",
    state: p.state ?? "",
    zip: p.zip ?? "",
  };
}

export async function buildInstallMarkers(
  projects: TransformedProject[],
  _opts: { today: Date }
): Promise<BuildResult> {
  const markers: JobMarker[] = [];
  const unplaced: UnplacedMarker[] = [];

  for (const p of projects) {
    const address = projectAddress(p);
    const id = `install:${p.id}`;
    const title = p.project_name || `Project ${p.id}`;

    if (!address.street || !address.city || !address.state || !address.zip) {
      unplaced.push({
        id, kind: "install", title, address, reason: "missing-address",
      });
      continue;
    }

    const coords = await resolveAddressCoords(address);
    if (!coords) {
      unplaced.push({
        id, kind: "install", title, address, reason: "geocode-failed",
      });
      continue;
    }

    const scheduled = isInstallScheduled(p);
    markers.push({
      id,
      kind: "install",
      scheduled,
      lat: coords.lat,
      lng: coords.lng,
      address,
      title,
      subtitle: scheduled ? formatInstallSubtitle(p) : "Ready to schedule",
      status: p.pipeline_stage ?? undefined,
      scheduledAt: scheduled ? p.construction_schedule_date ?? undefined : undefined,
      dealId: String(p.id),
      rawStage: p.pipeline_stage ?? undefined,
    });
  }

  return { markers, unplaced };
}

function formatInstallSubtitle(p: TransformedProject): string {
  const when = p.construction_schedule_date
    ? new Date(p.construction_schedule_date).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
  const size = p.system_size_kw_dc ? `${p.system_size_kw_dc} kW` : "";
  return [when, size].filter(Boolean).join(" · ");
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npx jest src/__tests__/map-aggregator.test.ts -t buildInstallMarkers
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/map-aggregator.ts src/__tests__/map-aggregator.test.ts
git commit -m "feat(map): normalize HubSpot install projects into JobMarker"
```

---

### Task 6: Aggregator — service ticket + Zuper job markers (TDD)

**Files:**
- Modify: `src/lib/map-aggregator.ts`
- Modify: `src/__tests__/map-aggregator.test.ts`

- [ ] **Step 1: Write failing tests**

Append:

```ts
import { buildServiceMarkers } from "@/lib/map-aggregator";

describe("buildServiceMarkers", () => {
  beforeEach(() => {
    mockFindFirst.mockReset();
    mockLiveGeocode.mockReset();
  });

  const sampleTicket = {
    id: "3114",
    subject: "Monitoring offline — Patel system",
    address_line_1: "1127 Elder Pl",
    city: "Boulder",
    state: "CO",
    zip: "80304",
    stage_label: "Needs Dispatch",
    priorityScore: 68,
    hs_pipeline_stage: "stage-xyz",
  };

  const sampleZuperJob = {
    job_uid: "zuper-abc",
    job_title: "Inverter replacement",
    scheduled_start_date_time: "2026-04-23T15:00:00.000Z",
    customer: {
      customer_address: {
        street: "4820 Gunbarrel Ave",
        city: "Boulder",
        state: "CO",
        zip_code: "80301",
      },
    },
    current_job_status: { status_name: "In Progress" },
    assigned_to: [{ user_uid: "user-1" }],
  };

  it("normalizes open ticket as unscheduled service marker", async () => {
    mockFindFirst.mockResolvedValue({ latitude: 40.02, longitude: -105.27 });
    const { markers } = await buildServiceMarkers(
      [sampleTicket as any],
      [],
      { today: new Date("2026-04-23") }
    );
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({
      id: "ticket:3114",
      kind: "service",
      scheduled: false,
      title: "Monitoring offline — Patel system",
      priorityScore: 68,
      ticketId: "3114",
    });
  });

  it("normalizes scheduled Zuper job as scheduled service marker", async () => {
    mockFindFirst.mockResolvedValue({ latitude: 40.01, longitude: -105.25 });
    const { markers } = await buildServiceMarkers(
      [],
      [sampleZuperJob as any],
      { today: new Date("2026-04-23") }
    );
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({
      id: "zuperjob:zuper-abc",
      kind: "service",
      scheduled: true,
      zuperJobUid: "zuper-abc",
      crewId: "user-1",
    });
  });

  it("deduplicates ticket whose Zuper job is already listed", async () => {
    mockFindFirst.mockResolvedValue({ latitude: 40.01, longitude: -105.25 });
    const ticketWithJob = { ...sampleTicket, linkedZuperJobUid: "zuper-abc" };
    const { markers } = await buildServiceMarkers(
      [ticketWithJob as any],
      [sampleZuperJob as any],
      { today: new Date("2026-04-23") }
    );
    // Only the Zuper job shows — the ticket is suppressed (already scheduled)
    expect(markers).toHaveLength(1);
    expect(markers[0].id).toBe("zuperjob:zuper-abc");
  });
});
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement**

Append to `src/lib/map-aggregator.ts`:

```ts
// Types kept loose — aggregator receives already-fetched records from callers
// that typed them against HubSpot/Zuper shapes. We only read a narrow slice.
export interface ServiceTicketInput {
  id: string;
  subject?: string;
  address_line_1?: string;
  city?: string;
  state?: string;
  zip?: string;
  stage_label?: string;
  priorityScore?: number;
  linkedZuperJobUid?: string;
}

export interface ZuperJobInput {
  job_uid: string;
  job_title?: string;
  scheduled_start_date_time?: string;
  customer?: {
    customer_address?: {
      street?: string;
      city?: string;
      state?: string;
      zip_code?: string;
    };
  };
  current_job_status?: { status_name?: string };
  assigned_to?: Array<{ user_uid?: string }>;
}

export async function buildServiceMarkers(
  tickets: ServiceTicketInput[],
  jobs: ZuperJobInput[],
  _opts: { today: Date }
): Promise<BuildResult> {
  const markers: JobMarker[] = [];
  const unplaced: UnplacedMarker[] = [];
  const scheduledJobUids = new Set(jobs.map((j) => j.job_uid));

  // Zuper jobs = scheduled service markers
  for (const job of jobs) {
    const ca = job.customer?.customer_address;
    const address = {
      street: ca?.street ?? "",
      city: ca?.city ?? "",
      state: ca?.state ?? "",
      zip: ca?.zip_code ?? "",
    };
    const id = `zuperjob:${job.job_uid}`;
    const title = job.job_title || `Service job ${job.job_uid}`;

    if (!address.street || !address.city || !address.state || !address.zip) {
      unplaced.push({ id, kind: "service", title, address, reason: "missing-address" });
      continue;
    }
    const coords = await resolveAddressCoords(address);
    if (!coords) {
      unplaced.push({ id, kind: "service", title, address, reason: "geocode-failed" });
      continue;
    }
    markers.push({
      id,
      kind: "service",
      scheduled: true,
      lat: coords.lat,
      lng: coords.lng,
      address,
      title,
      subtitle: job.scheduled_start_date_time
        ? new Date(job.scheduled_start_date_time).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          })
        : undefined,
      status: job.current_job_status?.status_name,
      scheduledAt: job.scheduled_start_date_time,
      crewId: job.assigned_to?.[0]?.user_uid,
      zuperJobUid: job.job_uid,
    });
  }

  // Tickets without linked Zuper job = unscheduled service markers
  for (const ticket of tickets) {
    if (ticket.linkedZuperJobUid && scheduledJobUids.has(ticket.linkedZuperJobUid)) {
      continue; // suppress — the Zuper job marker is already in the list
    }
    const address = {
      street: ticket.address_line_1 ?? "",
      city: ticket.city ?? "",
      state: ticket.state ?? "",
      zip: ticket.zip ?? "",
    };
    const id = `ticket:${ticket.id}`;
    const title = ticket.subject || `Ticket ${ticket.id}`;

    if (!address.street || !address.city || !address.state || !address.zip) {
      unplaced.push({ id, kind: "service", title, address, reason: "missing-address" });
      continue;
    }
    const coords = await resolveAddressCoords(address);
    if (!coords) {
      unplaced.push({ id, kind: "service", title, address, reason: "geocode-failed" });
      continue;
    }
    markers.push({
      id,
      kind: "service",
      scheduled: false,
      lat: coords.lat,
      lng: coords.lng,
      address,
      title,
      subtitle: ticket.stage_label,
      status: ticket.stage_label,
      priorityScore: ticket.priorityScore,
      ticketId: ticket.id,
    });
  }

  return { markers, unplaced };
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npx jest src/__tests__/map-aggregator.test.ts -t buildServiceMarkers
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/map-aggregator.ts src/__tests__/map-aggregator.test.ts
git commit -m "feat(map): normalize service tickets + Zuper jobs into JobMarker"
```

---

### Task 7: Aggregator — crew pins (TDD)

**Files:**
- Modify: `src/lib/map-aggregator.ts`
- Modify: `src/__tests__/map-aggregator.test.ts`

- [ ] **Step 1: Write failing test**

Append:

```ts
import { buildCrewPins } from "@/lib/map-aggregator";
import type { JobMarker } from "@/lib/map-types";

describe("buildCrewPins", () => {
  const crewMembers = [
    {
      id: "crew-1",
      name: "Alex P.",
      location: "dtc",
      active: true,
    },
    {
      id: "crew-2",
      name: "Marco R.",
      location: "westy",
      active: true,
    },
  ];

  it("assigns current position from earliest today's stop", () => {
    const markers: JobMarker[] = [
      {
        id: "install:A",
        kind: "install",
        scheduled: true,
        scheduledAt: "2026-04-23T09:00:00Z",
        lat: 39.75,
        lng: -104.99,
        crewId: "crew-1",
        address: { street: "x", city: "x", state: "CO", zip: "0" },
        title: "Stop 1",
      },
      {
        id: "install:B",
        kind: "install",
        scheduled: true,
        scheduledAt: "2026-04-23T15:00:00Z",
        lat: 39.80,
        lng: -104.95,
        crewId: "crew-1",
        address: { street: "x", city: "x", state: "CO", zip: "0" },
        title: "Stop 2",
      },
    ];
    const pins = buildCrewPins(crewMembers as any, markers);
    const alex = pins.find(p => p.id === "crew-1")!;
    expect(alex.working).toBe(true);
    expect(alex.currentLat).toBe(39.75);
    expect(alex.routeStops).toHaveLength(2);
  });

  it("marks crew without today's stops as not working", () => {
    const pins = buildCrewPins(crewMembers as any, []);
    expect(pins.find(p => p.id === "crew-1")?.working).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement**

Append:

```ts
export interface CrewMemberInput {
  id: string;
  name: string;
  location: string | null;
  active: boolean;
}

import type { CrewPin, CrewShopId } from "./map-types";

const SHOP_MAP: Record<string, CrewShopId> = {
  dtc: "dtc",
  westy: "westy",
  cosp: "cosp",
  ca: "ca",
  camarillo: "camarillo",
  slo: "ca", // SLO shares California bucket
};

export function buildCrewPins(
  crews: CrewMemberInput[],
  markers: JobMarker[]
): CrewPin[] {
  return crews
    .filter((c) => c.active)
    .map((c) => {
      const stops = markers
        .filter((m) => m.crewId === c.id && m.scheduled && m.scheduledAt)
        .sort((a, b) => (a.scheduledAt! < b.scheduledAt! ? -1 : 1));
      const first = stops[0];
      return {
        id: c.id,
        name: c.name,
        shopId: SHOP_MAP[c.location?.toLowerCase() ?? ""] ?? "dtc",
        currentLat: first?.lat,
        currentLng: first?.lng,
        routeStops: stops.map((s) => ({
          lat: s.lat,
          lng: s.lng,
          time: s.scheduledAt!,
          title: s.title,
          kind: s.kind,
        })),
        working: stops.length > 0,
      };
    });
}
```

- [ ] **Step 4: Run tests — expect pass**

- [ ] **Step 5: Commit**

```bash
git add src/lib/map-aggregator.ts src/__tests__/map-aggregator.test.ts
git commit -m "feat(map): build CrewPin[] from CrewMember + today's scheduled markers"
```

---

### Task 8: Aggregator — top-level orchestrator (TDD)

**Files:**
- Modify: `src/lib/map-aggregator.ts`
- Modify: `src/__tests__/map-aggregator.test.ts`

- [ ] **Step 1: Write failing test for `aggregateMapMarkers`**

Append:

```ts
import { aggregateMapMarkers } from "@/lib/map-aggregator";

jest.mock("@/lib/hubspot", () => ({
  fetchTransformedProjects: jest.fn(),
}));

jest.mock("@/lib/hubspot-tickets", () => ({
  fetchServiceTickets: jest.fn(),
}));

jest.mock("@/lib/zuper", () => ({
  fetchTodaysServiceJobs: jest.fn(),
}));

jest.mock("@/lib/db", () => ({
  prisma: {
    hubSpotPropertyCache: { findFirst: jest.fn() },
    crewMember: { findMany: jest.fn() },
  },
}));

import { fetchTransformedProjects } from "@/lib/hubspot";
import { fetchServiceTickets } from "@/lib/hubspot-tickets";
import { fetchTodaysServiceJobs } from "@/lib/zuper";

describe("aggregateMapMarkers", () => {
  beforeEach(() => {
    (fetchTransformedProjects as jest.Mock).mockReset();
    (fetchServiceTickets as jest.Mock).mockReset();
    (fetchTodaysServiceJobs as jest.Mock).mockReset();
    (prisma.crewMember.findMany as jest.Mock).mockResolvedValue([]);
    mockFindFirst.mockResolvedValue({ latitude: 40, longitude: -105 });
  });

  it("assembles response with all sources succeeding", async () => {
    (fetchTransformedProjects as jest.Mock).mockResolvedValue([]);
    (fetchServiceTickets as jest.Mock).mockResolvedValue([]);
    (fetchTodaysServiceJobs as jest.Mock).mockResolvedValue([]);
    const res = await aggregateMapMarkers({ mode: "today", types: ["install", "service"] });
    expect(res.markers).toEqual([]);
    expect(res.crews).toEqual([]);
    expect(res.partialFailures ?? []).toEqual([]);
    expect(res.droppedCount).toBe(0);
  });

  it("surfaces partialFailures when one source throws", async () => {
    (fetchTransformedProjects as jest.Mock).mockRejectedValue(new Error("hubspot down"));
    (fetchServiceTickets as jest.Mock).mockResolvedValue([]);
    (fetchTodaysServiceJobs as jest.Mock).mockResolvedValue([]);
    const res = await aggregateMapMarkers({ mode: "today", types: ["install", "service"] });
    expect(res.partialFailures).toEqual(expect.arrayContaining([expect.stringContaining("hubspot")]));
  });

  it("excludes service sources when types filter omits service", async () => {
    (fetchTransformedProjects as jest.Mock).mockResolvedValue([]);
    const res = await aggregateMapMarkers({ mode: "today", types: ["install"] });
    expect(fetchServiceTickets).not.toHaveBeenCalled();
    expect(fetchTodaysServiceJobs).not.toHaveBeenCalled();
    expect(res).toBeDefined();
  });
});
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement orchestrator**

Append to `src/lib/map-aggregator.ts`:

```ts
import { fetchTransformedProjects } from "@/lib/hubspot";
import { fetchServiceTickets } from "@/lib/hubspot-tickets";
import { fetchTodaysServiceJobs } from "@/lib/zuper";
import type { MapMarkersResponse, MapMode, JobMarkerKind } from "./map-types";

export interface AggregateOptions {
  mode: MapMode;
  types: JobMarkerKind[];
  date?: Date;
  includeUnplaced?: boolean;
}

export async function aggregateMapMarkers(
  opts: AggregateOptions
): Promise<MapMarkersResponse> {
  const today = opts.date ?? new Date();
  const partialFailures: string[] = [];
  const allMarkers: JobMarker[] = [];
  const allUnplaced: UnplacedMarker[] = [];

  const wantInstalls = opts.types.includes("install");
  const wantService = opts.types.includes("service");

  const [projectsResult, ticketsResult, jobsResult] = await Promise.allSettled([
    wantInstalls ? fetchTransformedProjects() : Promise.resolve([]),
    wantService ? fetchServiceTickets() : Promise.resolve([]),
    wantService ? fetchTodaysServiceJobs() : Promise.resolve([]),
  ]);

  const projects =
    projectsResult.status === "fulfilled" ? projectsResult.value : (partialFailures.push(`hubspot-projects: ${projectsResult.reason?.message ?? "unknown"}`), []);
  const tickets =
    ticketsResult.status === "fulfilled" ? ticketsResult.value : (partialFailures.push(`hubspot-tickets: ${ticketsResult.reason?.message ?? "unknown"}`), []);
  const jobs =
    jobsResult.status === "fulfilled" ? jobsResult.value : (partialFailures.push(`zuper: ${jobsResult.reason?.message ?? "unknown"}`), []);

  if (wantInstalls) {
    const scopedProjects = filterProjectsByMode(projects as TransformedProject[], opts.mode, today);
    const { markers, unplaced } = await buildInstallMarkers(scopedProjects, { today });
    allMarkers.push(...markers);
    allUnplaced.push(...unplaced);
  }

  if (wantService) {
    const { markers, unplaced } = await buildServiceMarkers(
      (tickets as ServiceTicketInput[]) ?? [],
      (jobs as ZuperJobInput[]) ?? [],
      { today }
    );
    allMarkers.push(...markers);
    allUnplaced.push(...unplaced);
  }

  // Crews
  let crews: CrewPin[] = [];
  try {
    const crewMembers = await prisma.crewMember.findMany({
      where: { active: true },
      select: { id: true, name: true, location: true, active: true },
    });
    crews = buildCrewPins(crewMembers, allMarkers);
  } catch (e) {
    partialFailures.push(`crews: ${(e as Error).message}`);
  }

  const response: MapMarkersResponse = {
    markers: allMarkers,
    crews,
    lastUpdated: new Date().toISOString(),
    droppedCount: allUnplaced.length,
  };
  if (partialFailures.length > 0) response.partialFailures = partialFailures;
  if (opts.includeUnplaced) response.unplaced = allUnplaced;
  return response;
}

function filterProjectsByMode(
  projects: TransformedProject[],
  mode: MapMode,
  today: Date
): TransformedProject[] {
  const dayStart = new Date(today);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  if (mode === "today") {
    // Scheduled today OR RTB (ready-to-schedule)
    return projects.filter((p) => {
      if (p.construction_schedule_date) {
        const d = new Date(p.construction_schedule_date);
        if (d >= dayStart && d < dayEnd) return true;
      }
      const stage = (p.pipeline_stage ?? "").toLowerCase();
      return stage.includes("ready to build") || stage === "rtb";
    });
  }
  // Phase 1 only implements today mode; week/backlog fall through to today.
  return projects.filter((p) => !!p.construction_schedule_date);
}
```

**Note:** `fetchTodaysServiceJobs` may not exist yet in `src/lib/zuper.ts`. If it doesn't, add a thin wrapper in this task (before implementing the aggregator test):

- [ ] **Step 3a (if needed): Add `fetchTodaysServiceJobs` helper to `src/lib/zuper.ts`**

Check first:

```bash
grep -n "fetchTodaysServiceJobs\|export.*ServiceJobs" src/lib/zuper.ts
```

If not present, add near the bottom of `src/lib/zuper.ts`:

```ts
/**
 * Fetch service Zuper jobs scheduled for today.
 * Thin wrapper used by the map aggregator; tests mock this directly.
 */
export async function fetchTodaysServiceJobs(): Promise<unknown[]> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);

  const res = await zuper.listJobs({
    from: todayStart.toISOString(),
    to: tomorrowStart.toISOString(),
    category_uid: JOB_CATEGORY_UIDS.service,
  });
  return res.data ?? [];
}
```

Verify `zuper.listJobs` signature first — if the actual method is different, adapt to it. If no such listing exists yet, return `[]` and add a `TODO: implement today-job-fetch` — non-blocking for Phase 1 since empty list still renders.

- [ ] **Step 4: Run tests — expect pass**

```bash
npx jest src/__tests__/map-aggregator.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/map-aggregator.ts src/lib/zuper.ts src/__tests__/map-aggregator.test.ts
git commit -m "feat(map): top-level aggregator with partial-failure tolerance"
```

---

### Task 9: API route

**Files:**
- Create: `src/app/api/map/markers/route.ts`

- [ ] **Step 1: Write the route**

```ts
// src/app/api/map/markers/route.ts
import { NextRequest, NextResponse } from "next/server";
import { aggregateMapMarkers } from "@/lib/map-aggregator";
import { getCached, setCached } from "@/lib/cache";
import type { MapMode, JobMarkerKind } from "@/lib/map-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_MODES: MapMode[] = ["today", "week", "backlog"];
const VALID_KINDS: JobMarkerKind[] = [
  "install", "service", "inspection", "survey", "dnr", "roofing",
];

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const mode = (url.searchParams.get("mode") ?? "today") as MapMode;
  const typesParam = url.searchParams.get("types") ?? "install,service";
  const includeUnplaced = url.searchParams.get("include") === "unplaced";

  if (!VALID_MODES.includes(mode)) {
    return NextResponse.json({ error: "invalid mode" }, { status: 400 });
  }

  const types = typesParam
    .split(",")
    .map((s) => s.trim())
    .filter((t): t is JobMarkerKind => VALID_KINDS.includes(t as JobMarkerKind));

  if (types.length === 0) {
    return NextResponse.json({ error: "at least one type required" }, { status: 400 });
  }

  const dateStr = url.searchParams.get("date");
  const date = dateStr ? new Date(dateStr) : new Date();

  const cacheKey = `map:markers:${mode}:${date.toISOString().slice(0, 10)}:${types.sort().join(",")}`;

  // Don't cache the debug variant
  if (!includeUnplaced) {
    const cached = getCached(cacheKey);
    if (cached) {
      return NextResponse.json(cached, {
        headers: { "x-cache": "hit" },
      });
    }
  }

  const result = await aggregateMapMarkers({ mode, types, date, includeUnplaced });

  if (!includeUnplaced) {
    setCached(cacheKey, result, 60_000);
  }

  return NextResponse.json(result, { headers: { "x-cache": "miss" } });
}
```

- [ ] **Step 2: Verify `lib/cache.ts` exports `getCached` / `setCached`**

```bash
grep -n "export " src/lib/cache.ts | head -20
```

If the names are different (e.g. `get` / `set`), adjust imports and usage.

- [ ] **Step 3: Smoke test the route locally**

```bash
npm run dev &
sleep 5
curl -s "http://localhost:3000/api/map/markers?mode=today&types=install,service" | head -c 300
```

Expected: JSON response with `markers`, `crews`, `lastUpdated`, `droppedCount`. May include `partialFailures` if HubSpot/Zuper creds aren't configured — that's acceptable for the smoke test.

- [ ] **Step 4: Add route to role allowlists**

Modify `src/lib/roles.ts` — for each of `ADMIN`, `OWNER`, `PROJECT_MANAGER`, `OPERATIONS_MANAGER`, `OPERATIONS`, `SERVICE`, add to `allowedRoutes`:
- `/dashboards/map`
- `/api/map`

ADMIN already has `["*"]` so skip it. For all others, add both entries preserving the existing array pattern. Grep for each role block, add the two strings.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/map/markers/route.ts src/lib/roles.ts
git commit -m "feat(map): GET /api/map/markers endpoint + role allowlist"
```

---

### Task 10: Query keys + SSE cascade wiring

**Files:**
- Modify: `src/lib/query-keys.ts`

- [ ] **Step 1: Add map keys**

Read current `src/lib/query-keys.ts` to find the pattern. Add a new root block:

```ts
map: {
  root: ["map"] as const,
  markers: (mode: string, types: string[]) =>
    [...queryKeys.map.root, "markers", mode, types.sort().join(",")] as const,
},
```

And update `cacheKeyToQueryKeys` (search for it in the same file) to map the SSE cache key `map:markers` to the root, plus add the upstream cascade: existing `deals:*`, `serviceTickets:*`, `zuper:*` cache-update events should also invalidate `map:markers`. Pattern mirror from `lib/service-priority-cache.ts`.

If `cacheKeyToQueryKeys` uses a switch/lookup table, add an entry:

```ts
"map:markers": [queryKeys.map.root],
```

And in whatever existing keys cascade into service priority, also cascade into `map:markers`.

- [ ] **Step 2: Commit**

```bash
git add src/lib/query-keys.ts
git commit -m "feat(map): register map query keys + SSE cascade from deals/service/zuper"
```

## Chunk 2: UI components

### Task 11: FilterBar component (TDD)

**Files:**
- Create: `src/app/dashboards/map/FilterBar.tsx`
- Test: `src/__tests__/FilterBar.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// src/__tests__/FilterBar.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { FilterBar } from "@/app/dashboards/map/FilterBar";

describe("FilterBar", () => {
  const defaultProps = {
    mode: "today" as const,
    types: ["install", "service"] as const,
    enabledTypes: ["install", "service"] as const,
    onModeChange: jest.fn(),
    onTypeToggle: jest.fn(),
  };

  it("renders all three mode toggles with Today active", () => {
    render(<FilterBar {...defaultProps} />);
    const todayBtn = screen.getByRole("button", { name: /today/i });
    expect(todayBtn).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /week/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("calls onModeChange when a mode is clicked", () => {
    const onModeChange = jest.fn();
    render(<FilterBar {...defaultProps} onModeChange={onModeChange} />);
    fireEvent.click(screen.getByRole("button", { name: /week/i }));
    expect(onModeChange).toHaveBeenCalledWith("week");
  });

  it("renders type chips and toggles via onTypeToggle", () => {
    const onTypeToggle = jest.fn();
    render(<FilterBar {...defaultProps} onTypeToggle={onTypeToggle} />);
    fireEvent.click(screen.getByRole("button", { name: /^install$/i }));
    expect(onTypeToggle).toHaveBeenCalledWith("install");
  });
});
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement**

```tsx
"use client";

import { MapMode, JobMarkerKind } from "@/lib/map-types";
import { MARKER_COLORS } from "@/lib/map-colors";

interface FilterBarProps {
  mode: MapMode;
  types: readonly JobMarkerKind[];        // all available types
  enabledTypes: readonly JobMarkerKind[]; // currently selected
  onModeChange: (mode: MapMode) => void;
  onTypeToggle: (kind: JobMarkerKind) => void;
}

const MODES: Array<{ id: MapMode; label: string }> = [
  { id: "today", label: "Today" },
  { id: "week", label: "Week" },
  { id: "backlog", label: "Backlog" },
];

export function FilterBar({
  mode,
  types,
  enabledTypes,
  onModeChange,
  onTypeToggle,
}: FilterBarProps) {
  const enabledSet = new Set(enabledTypes);
  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-surface border-b border-t-border">
      <div role="tablist" className="inline-flex rounded-md bg-surface-2 p-0.5">
        {MODES.map((m) => {
          const active = m.id === mode;
          return (
            <button
              key={m.id}
              role="tab"
              aria-pressed={active}
              onClick={() => onModeChange(m.id)}
              className={`px-3 py-1 text-sm rounded ${
                active ? "bg-orange-500 text-white" : "text-foreground"
              }`}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {types.map((t) => {
          const on = enabledSet.has(t);
          return (
            <button
              key={t}
              aria-pressed={on}
              onClick={() => onTypeToggle(t)}
              className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                on
                  ? "text-white"
                  : "bg-surface-2 text-muted border-t-border"
              }`}
              style={on ? {
                background: MARKER_COLORS[t],
                borderColor: MARKER_COLORS[t],
              } : undefined}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests — expect pass**

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboards/map/FilterBar.tsx src/__tests__/FilterBar.test.tsx
git commit -m "feat(map): FilterBar with mode toggle + type chips"
```

---

### Task 12: DetailPanel component (TDD)

**Files:**
- Create: `src/app/dashboards/map/DetailPanel.tsx`
- Test: `src/__tests__/DetailPanel.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// src/__tests__/DetailPanel.test.tsx
import { render, screen } from "@testing-library/react";
import { DetailPanel } from "@/app/dashboards/map/DetailPanel";
import type { JobMarker, CrewPin } from "@/lib/map-types";

const scheduledInstall: JobMarker = {
  id: "install:PROJ-8241",
  kind: "install",
  scheduled: true,
  lat: 40.01,
  lng: -105.25,
  address: { street: "4820 Gunbarrel Ave", city: "Boulder", state: "CO", zip: "80301" },
  title: "Jenkins Residence",
  subtitle: "9:00 AM · Alex P.",
  status: "On Site",
  scheduledAt: "2026-04-23T16:00:00Z",
  dealId: "PROJ-8241",
};

const unscheduledTicket: JobMarker = {
  id: "ticket:3114",
  kind: "service",
  scheduled: false,
  lat: 40.02,
  lng: -105.27,
  address: { street: "1127 Elder Pl", city: "Boulder", state: "CO", zip: "80304" },
  title: "Monitoring offline",
  status: "Needs Dispatch",
  priorityScore: 68,
  ticketId: "3114",
};

describe("DetailPanel", () => {
  it("renders scheduled install sections", () => {
    render(<DetailPanel marker={scheduledInstall} markers={[]} crews={[]} onClose={jest.fn()} />);
    expect(screen.getByText("Jenkins Residence")).toBeInTheDocument();
    expect(screen.getByText(/Schedule/i)).toBeInTheDocument();
    expect(screen.getByText(/4820 Gunbarrel Ave/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open in hubspot/i })).toBeInTheDocument();
  });

  it("shows priority score for unscheduled ticket", () => {
    render(<DetailPanel marker={unscheduledTicket} markers={[]} crews={[]} onClose={jest.fn()} />);
    expect(screen.getByText(/68/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /schedule this/i })).toBeInTheDocument();
  });

  it("renders closest crew list when crews provided", () => {
    const crews: CrewPin[] = [
      {
        id: "crew-1", name: "Alex P.", shopId: "dtc",
        currentLat: 40.02, currentLng: -105.28,
        routeStops: [], working: true,
      },
    ];
    render(<DetailPanel marker={unscheduledTicket} markers={[]} crews={crews} onClose={jest.fn()} />);
    expect(screen.getByText(/Alex P\./)).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = jest.fn();
    render(<DetailPanel marker={scheduledInstall} markers={[]} crews={[]} onClose={onClose} />);
    screen.getByRole("button", { name: /close/i }).click();
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement**

```tsx
"use client";

import type { JobMarker, CrewPin } from "@/lib/map-types";
import { MARKER_COLORS } from "@/lib/map-colors";
import { nearbyMarkers, closestCrews } from "@/lib/map-proximity";
import Link from "next/link";

interface DetailPanelProps {
  marker: JobMarker;
  markers: JobMarker[];   // full set, for proximity
  crews: CrewPin[];
  onClose: () => void;
}

export function DetailPanel({ marker, markers, crews, onClose }: DetailPanelProps) {
  const isTicket = marker.kind === "service" && !marker.scheduled;
  const nearby = nearbyMarkers(
    { lat: marker.lat, lng: marker.lng },
    markers,
    { maxMiles: 10, limit: 5, excludeId: marker.id }
  );
  const nearestCrews = isTicket
    ? closestCrews({ lat: marker.lat, lng: marker.lng }, crews, { maxMiles: 15, limit: 3 })
    : [];

  return (
    <aside
      className="fixed right-0 top-0 bottom-0 w-[380px] bg-surface border-l border-t-border overflow-y-auto z-20"
      aria-label="Job detail panel"
    >
      <header className="flex items-start gap-2 p-4 border-b border-t-border">
        <span
          className="inline-block w-3.5 h-3.5 rounded-full mt-1 flex-shrink-0"
          style={{
            background: marker.scheduled ? MARKER_COLORS[marker.kind] : "transparent",
            border: `2px ${marker.scheduled ? "solid" : "dashed"} ${MARKER_COLORS[marker.kind]}`,
          }}
        />
        <div className="flex-1">
          <h2 className="text-foreground font-semibold">{marker.title}</h2>
          <div className="text-xs text-muted">
            {marker.dealId ? `PROJ-${marker.dealId}` : marker.ticketId ? `TICKET-${marker.ticketId}` : ""} · {capitalize(marker.kind)} · {marker.scheduled ? "Scheduled" : "Unscheduled"}
          </div>
        </div>
        <button onClick={onClose} aria-label="Close" className="text-muted hover:text-foreground">×</button>
      </header>

      {marker.scheduled && (
        <Section label="Schedule">
          <KV k="When" v={marker.scheduledAt ? new Date(marker.scheduledAt).toLocaleString() : "—"} />
          {marker.status && <KV k="Status" v={marker.status} />}
        </Section>
      )}

      {isTicket && marker.priorityScore != null && (
        <Section label="Priority">
          <KV k="Score" v={<strong className="text-red-400">{marker.priorityScore}</strong>} />
          {marker.status && <KV k="Stage" v={marker.status} />}
        </Section>
      )}

      <Section label="Location">
        <div className="text-foreground text-sm">{marker.address.street}</div>
        <div className="text-xs text-muted">
          {marker.address.city}, {marker.address.state} {marker.address.zip}
        </div>
      </Section>

      {nearestCrews.length > 0 && (
        <Section label="Closest crew today">
          {nearestCrews.map((c) => (
            <div key={c.id} className="flex items-center gap-2 py-1 text-xs">
              <span className="text-foreground flex-1">{c.name}</span>
              <span className="text-blue-400 font-semibold">{c.distanceMiles.toFixed(1)} mi</span>
            </div>
          ))}
        </Section>
      )}

      {nearby.length > 0 && (
        <Section label="Nearby open work">
          {nearby.map((m) => (
            <div key={m.id} className="flex items-center gap-2 py-1 text-xs">
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{
                  background: m.scheduled ? MARKER_COLORS[m.kind] : "transparent",
                  border: `2px ${m.scheduled ? "solid" : "dashed"} ${MARKER_COLORS[m.kind]}`,
                }}
              />
              <span className="text-foreground flex-1 truncate">{m.title}</span>
              <span className="text-blue-400 font-semibold">{m.distanceMiles.toFixed(1)} mi</span>
            </div>
          ))}
        </Section>
      )}

      <Section label="">
        <div className="flex flex-wrap gap-2">
          {isTicket && (
            <Link
              href={`/dashboards/service-scheduler?ticketId=${marker.ticketId}`}
              className="px-3 py-2 rounded text-xs font-semibold bg-orange-500 text-white"
            >
              Schedule this
            </Link>
          )}
          {!isTicket && marker.kind === "install" && !marker.scheduled && (
            <Link
              href={`/dashboards/construction-scheduler?dealId=${marker.dealId}`}
              className="px-3 py-2 rounded text-xs font-semibold bg-orange-500 text-white"
            >
              Schedule this
            </Link>
          )}
          {marker.dealId && (
            <a
              href={`https://app.hubspot.com/contacts/${process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID ?? ""}/record/0-3/${marker.dealId}`}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-2 rounded text-xs font-semibold bg-surface-2 text-foreground border border-t-border"
            >
              Open in HubSpot
            </a>
          )}
          {marker.ticketId && (
            <a
              href={`https://app.hubspot.com/contacts/${process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID ?? ""}/record/0-5/${marker.ticketId}`}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-2 rounded text-xs font-semibold bg-surface-2 text-foreground border border-t-border"
            >
              Open ticket
            </a>
          )}
        </div>
      </Section>
    </aside>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="px-4 py-3 border-b border-t-border">
      {label && (
        <div className="text-[10px] uppercase tracking-wider text-muted mb-1.5 font-semibold">
          {label}
        </div>
      )}
      {children}
    </section>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[80px_1fr] gap-x-2 text-xs py-0.5">
      <span className="text-muted">{k}</span>
      <span className="text-foreground">{v}</span>
    </div>
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
```

- [ ] **Step 4: Run tests — expect pass**

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboards/map/DetailPanel.tsx src/__tests__/DetailPanel.test.tsx
git commit -m "feat(map): DetailPanel with nearby work + closest crew"
```

---

### Task 13: Map canvas (Google Maps + supercluster)

**Files:**
- Create: `src/app/dashboards/map/JobMapCanvas.tsx`

Clustering uses `supercluster`. Check if it's installed:

- [ ] **Step 1: Install supercluster if missing**

```bash
cd "/Users/zach/Downloads/Dev Projects/PB-Operations-Suite/.claude/worktrees/bold-raman-717d52"
node -e "require('supercluster')" 2>&1 | head -1
# If "Cannot find module", install:
npm install supercluster
npm install --save-dev @types/supercluster
```

- [ ] **Step 2: Implement canvas**

```tsx
"use client";

import { useMemo, useState, useCallback } from "react";
import {
  APIProvider,
  Map,
  useMap,
  AdvancedMarker,
} from "@vis.gl/react-google-maps";
import Supercluster from "supercluster";
import type { JobMarker, CrewPin } from "@/lib/map-types";
import { MARKER_COLORS, CREW_COLOR_WORKING, CREW_COLOR_IDLE, CLUSTER_COLORS, CLUSTER_THRESHOLDS } from "@/lib/map-colors";

interface JobMapCanvasProps {
  markers: JobMarker[];
  crews: CrewPin[];
  apiKey: string;
  onMarkerClick: (marker: JobMarker) => void;
  defaultCenter?: { lat: number; lng: number };
  defaultZoom?: number;
}

const DEFAULT_CENTER = { lat: 39.6, lng: -105.3 }; // Rough Colorado center
const DEFAULT_ZOOM = 7;

export function JobMapCanvas({
  markers,
  crews,
  apiKey,
  onMarkerClick,
  defaultCenter = DEFAULT_CENTER,
  defaultZoom = DEFAULT_ZOOM,
}: JobMapCanvasProps) {
  return (
    <APIProvider apiKey={apiKey}>
      <Map
        mapId="pb-jobs-map"
        defaultCenter={defaultCenter}
        defaultZoom={defaultZoom}
        gestureHandling="greedy"
        disableDefaultUI={false}
        className="w-full h-full"
      >
        <ClusteredMarkers markers={markers} onMarkerClick={onMarkerClick} />
        <CrewMarkers crews={crews} />
      </Map>
    </APIProvider>
  );
}

function ClusteredMarkers({
  markers,
  onMarkerClick,
}: {
  markers: JobMarker[];
  onMarkerClick: (m: JobMarker) => void;
}) {
  const map = useMap();
  const [, setVersion] = useState(0);

  const supercluster = useMemo(() => {
    const sc = new Supercluster({ radius: 60, maxZoom: 13 });
    sc.load(
      markers.map((m) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [m.lng, m.lat] },
        properties: { marker: m },
      }))
    );
    return sc;
  }, [markers]);

  // Re-render on zoom/move
  const onChange = useCallback(() => setVersion((v) => v + 1), []);
  useMapEvent(map, "idle", onChange);

  if (!map) return null;

  const bounds = map.getBounds();
  if (!bounds) return null;
  const ne = bounds.getNorthEast();
  const sw = bounds.getSouthWest();
  const zoom = Math.round(map.getZoom() ?? DEFAULT_ZOOM);

  const clusters = supercluster.getClusters(
    [sw.lng(), sw.lat(), ne.lng(), ne.lat()],
    zoom
  );

  return (
    <>
      {clusters.map((c) => {
        const [lng, lat] = c.geometry.coordinates;
        if (c.properties && "cluster" in c.properties && c.properties.cluster) {
          const count = c.properties.point_count as number;
          const color =
            count >= CLUSTER_THRESHOLDS.large
              ? CLUSTER_COLORS.large
              : count >= CLUSTER_THRESHOLDS.medium
              ? CLUSTER_COLORS.medium
              : CLUSTER_COLORS.small;
          const size = count >= CLUSTER_THRESHOLDS.large ? 60 : count >= CLUSTER_THRESHOLDS.medium ? 52 : 44;
          return (
            <AdvancedMarker
              key={`cluster-${c.id}`}
              position={{ lat, lng }}
              onClick={() => {
                const expZoom = supercluster.getClusterExpansionZoom(c.id as number);
                map.setZoom(expZoom);
                map.panTo({ lat, lng });
              }}
            >
              <div style={{
                width: size, height: size, borderRadius: "50%",
                background: color, color: "white",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 700, border: "3px solid #0b1220",
              }}>
                {count}
              </div>
            </AdvancedMarker>
          );
        }
        const marker = (c.properties as { marker: JobMarker }).marker;
        const color = MARKER_COLORS[marker.kind];
        return (
          <AdvancedMarker
            key={marker.id}
            position={{ lat, lng }}
            onClick={() => onMarkerClick(marker)}
          >
            <div style={{
              width: 18, height: 18, borderRadius: "50%",
              background: marker.scheduled ? color : "transparent",
              border: `2px ${marker.scheduled ? "solid" : "dashed"} ${marker.scheduled ? "#0b1220" : color}`,
            }} />
          </AdvancedMarker>
        );
      })}
    </>
  );
}

function CrewMarkers({ crews }: { crews: CrewPin[] }) {
  return (
    <>
      {crews.map((c) => {
        if (c.currentLat == null || c.currentLng == null) return null;
        return (
          <AdvancedMarker
            key={`crew:${c.id}`}
            position={{ lat: c.currentLat, lng: c.currentLng }}
            title={c.name}
          >
            <div style={{
              width: 22, height: 22, borderRadius: 5,
              background: c.working ? CREW_COLOR_WORKING : CREW_COLOR_IDLE,
              border: "2px solid #0b1220",
            }} />
          </AdvancedMarker>
        );
      })}
    </>
  );
}

// Helper to subscribe to a google.maps.Map event
function useMapEvent(map: google.maps.Map | null, event: string, handler: () => void) {
  useMemo(() => {
    if (!map) return;
    const l = map.addListener(event, handler);
    return () => l.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, event]);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/map/JobMapCanvas.tsx package.json package-lock.json
git commit -m "feat(map): JobMapCanvas with supercluster + crew pins"
```

---

### Task 14: Table fallback for when Maps JS fails

**Files:**
- Create: `src/app/dashboards/map/JobMarkerTable.tsx`

- [ ] **Step 1: Implement**

```tsx
"use client";

import type { JobMarker } from "@/lib/map-types";
import { MARKER_COLORS } from "@/lib/map-colors";

export function JobMarkerTable({
  markers,
  onMarkerClick,
}: {
  markers: JobMarker[];
  onMarkerClick: (m: JobMarker) => void;
}) {
  return (
    <div className="p-4 bg-surface-2 min-h-full">
      <div className="mb-3 text-sm text-muted">
        Google Maps unavailable — showing list view. {markers.length} job{markers.length === 1 ? "" : "s"}.
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted text-xs uppercase">
            <th className="px-2 py-1">Type</th>
            <th className="px-2 py-1">Title</th>
            <th className="px-2 py-1">Address</th>
            <th className="px-2 py-1">Status</th>
          </tr>
        </thead>
        <tbody>
          {markers.map((m) => (
            <tr
              key={m.id}
              className="border-t border-t-border cursor-pointer hover:bg-surface-elevated"
              onClick={() => onMarkerClick(m)}
            >
              <td className="px-2 py-2">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full mr-2"
                  style={{
                    background: m.scheduled ? MARKER_COLORS[m.kind] : "transparent",
                    border: `2px ${m.scheduled ? "solid" : "dashed"} ${MARKER_COLORS[m.kind]}`,
                  }}
                />
                {m.kind}
              </td>
              <td className="px-2 py-2 text-foreground">{m.title}</td>
              <td className="px-2 py-2 text-muted text-xs">
                {m.address.street}, {m.address.city}, {m.address.state} {m.address.zip}
              </td>
              <td className="px-2 py-2 text-muted">{m.status ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboards/map/JobMarkerTable.tsx
git commit -m "feat(map): JobMarkerTable fallback for when Google Maps fails to load"
```

---

### Task 15: MapClient container

**Files:**
- Create: `src/app/dashboards/map/MapClient.tsx`

- [ ] **Step 1: Implement**

```tsx
"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useSSE } from "@/hooks/useSSE";
import type { MapMode, JobMarkerKind, MapMarkersResponse, JobMarker } from "@/lib/map-types";
import { FilterBar } from "./FilterBar";
import { DetailPanel } from "./DetailPanel";
import { JobMapCanvas } from "./JobMapCanvas";
import { JobMarkerTable } from "./JobMarkerTable";

const ALL_TYPES: JobMarkerKind[] = ["install", "service", "inspection", "survey", "dnr", "roofing"];
const PHASE_1_TYPES: JobMarkerKind[] = ["install", "service"];

interface MapClientProps {
  googleMapsApiKey: string | null;
}

export function MapClient({ googleMapsApiKey }: MapClientProps) {
  const [mode, setMode] = useState<MapMode>("today");
  const [enabledTypes, setEnabledTypes] = useState<JobMarkerKind[]>([...PHASE_1_TYPES]);
  const [selectedMarker, setSelectedMarker] = useState<JobMarker | null>(null);

  const typesKey = useMemo(() => enabledTypes.slice().sort().join(","), [enabledTypes]);

  const query = useQuery<MapMarkersResponse>({
    queryKey: queryKeys.map.markers(mode, enabledTypes),
    queryFn: async () => {
      const params = new URLSearchParams({ mode, types: typesKey });
      const res = await fetch(`/api/map/markers?${params}`);
      if (!res.ok) throw new Error("Failed to load markers");
      return res.json();
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  useSSE(() => query.refetch(), { cacheKeyFilter: "map" });

  const markers = query.data?.markers ?? [];
  const crews = query.data?.crews ?? [];

  const onTypeToggle = (k: JobMarkerKind) => {
    setEnabledTypes((prev) =>
      prev.includes(k) ? prev.filter((t) => t !== k) : [...prev, k]
    );
  };

  const onMarkerClick = (m: JobMarker) => setSelectedMarker(m);
  const onClose = () => setSelectedMarker(null);

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      <FilterBar
        mode={mode}
        types={ALL_TYPES}
        enabledTypes={enabledTypes}
        onModeChange={setMode}
        onTypeToggle={onTypeToggle}
      />

      <div className="flex-1 relative">
        {googleMapsApiKey ? (
          <JobMapCanvas
            markers={markers}
            crews={crews}
            apiKey={googleMapsApiKey}
            onMarkerClick={onMarkerClick}
          />
        ) : (
          <JobMarkerTable markers={markers} onMarkerClick={onMarkerClick} />
        )}

        {query.data?.droppedCount ? (
          <div className="absolute bottom-2 left-2 text-xs bg-surface-2 text-muted px-3 py-1.5 rounded border border-t-border">
            {query.data.droppedCount} job{query.data.droppedCount === 1 ? "" : "s"} could not be placed
          </div>
        ) : null}

        {query.data?.partialFailures?.length ? (
          <div className="absolute top-2 right-2 text-xs bg-surface-2 text-yellow-400 px-3 py-1.5 rounded border border-yellow-600">
            Partial data: {query.data.partialFailures.join("; ")}
          </div>
        ) : null}
      </div>

      {selectedMarker && (
        <DetailPanel
          marker={selectedMarker}
          markers={markers}
          crews={crews}
          onClose={onClose}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboards/map/MapClient.tsx
git commit -m "feat(map): MapClient container wiring FilterBar + Canvas + DetailPanel"
```

---

### Task 16: Page entry (server component) + feature flag

**Files:**
- Create: `src/app/dashboards/map/page.tsx`

- [ ] **Step 1: Implement**

```tsx
import { redirect } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";
import { getCurrentUser } from "@/lib/auth-utils";
import { MapClient } from "./MapClient";

export const dynamic = "force-dynamic";

export default async function JobsMapPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const enabled = process.env.NEXT_PUBLIC_UI_MAP_VIEW_ENABLED !== "false";
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? null;

  if (!enabled) {
    return (
      <DashboardShell title="Jobs Map" accentColor="blue">
        <div className="p-8 text-muted">
          The Jobs Map is coming soon. Enable <code>NEXT_PUBLIC_UI_MAP_VIEW_ENABLED</code> to preview.
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell title="Jobs Map" accentColor="blue" fullWidth>
      <MapClient googleMapsApiKey={apiKey} />
    </DashboardShell>
  );
}
```

- [ ] **Step 2: Verify `getCurrentUser` and `DashboardShell` import paths are correct** (check existing dashboard pages for the pattern).

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/map/page.tsx
git commit -m "feat(map): dashboard page entry with feature flag + auth redirect"
```

## Chunk 3: Wiring, env, suite cards, verification

### Task 17: Suite cards

**Files:**
- Modify: `src/app/suites/operations/page.tsx`
- Modify: `src/app/suites/service/page.tsx`

- [ ] **Step 1: Add Operations card**

Read the existing `LINKS` array, add a new entry in the "Scheduling & Planning" section:

```tsx
{
  href: "/dashboards/map",
  title: "Jobs Map",
  description: "Map of scheduled and unscheduled work with crew positions and proximity insights.",
  tag: "MAP",
  icon: "🗺️",
  section: "Scheduling & Planning",
},
```

- [ ] **Step 2: Add Service Suite card**

Read `src/app/suites/service/page.tsx`, add the same entry with `href: "/dashboards/map?types=service"` and appropriate section.

- [ ] **Step 3: Verify the `NEXT_PUBLIC_UI_MAP_VIEW_ENABLED` flag hides the card when off**

Easiest approach: filter the `LINKS` array inline:

```tsx
const LINKS = BASE_LINKS.filter(
  (l) => l.href !== "/dashboards/map" || process.env.NEXT_PUBLIC_UI_MAP_VIEW_ENABLED !== "false"
);
```

(Or gate with a simple flag check.)

- [ ] **Step 4: Commit**

```bash
git add src/app/suites/operations/page.tsx src/app/suites/service/page.tsx
git commit -m "feat(map): add Jobs Map suite cards (Operations + Service), flag-gated"
```

---

### Task 18: Env example + flag docs

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Append entries**

```
# Jobs Map (Phase 1)
# Client-exposed Google Maps JS API key. Restrict by HTTP referrer in Google
# Cloud Console. Separate from the server GOOGLE_MAPS_API_KEY used for
# Geocoding and Distance Matrix.
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=

# Set to "false" to hide the Jobs Map page and its suite cards.
NEXT_PUBLIC_UI_MAP_VIEW_ENABLED=true
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: add NEXT_PUBLIC_GOOGLE_MAPS_API_KEY + UI_MAP_VIEW_ENABLED to .env.example"
```

---

### Task 19: Verify build + lint + tests

- [ ] **Step 1: Prisma generate**

```bash
cd "/Users/zach/Downloads/Dev Projects/PB-Operations-Suite/.claude/worktrees/bold-raman-717d52"
npx prisma generate
```

Expected: completes without error (no schema changes should mean no-op).

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: No errors. If any surface, fix before proceeding.

- [ ] **Step 3: Run full test suite**

```bash
npm run test
```

Expected: All tests pass, including 4 new suites (map-proximity, map-aggregator, FilterBar, DetailPanel).

- [ ] **Step 4: Lint**

```bash
npm run lint
```

Expected: No errors; address warnings if introduced by new files.

- [ ] **Step 5: Production build**

```bash
npm run build
```

Expected: Build succeeds. Watch for Next 16 warnings on dynamic routes.

- [ ] **Step 6: Preflight**

```bash
npm run preflight
```

Expected: Passes.

- [ ] **Step 7: Commit any fixes**

```bash
git add -A
git commit -m "chore(map): fixes from build/lint/test verification" || true
```

---

### Task 20: Final PR-ready commit summary

- [ ] **Step 1: Review the full branch**

```bash
git log --oneline main..HEAD
git diff main...HEAD --stat
```

- [ ] **Step 2: Open PR**

Use the commit-commands:commit-push-pr flow (or `gh pr create` directly). PR body should reference:
- Spec: `docs/superpowers/specs/2026-04-23-jobs-proximity-map-design.md`
- Plan: `docs/superpowers/plans/2026-04-23-jobs-proximity-map.md`
- Phase 1 scope note (installs + service, today mode, behind `NEXT_PUBLIC_UI_MAP_VIEW_ENABLED=false`)

PR title: `feat(map): jobs proximity map Phase 1 (installs + service + crews)`

---

## Risks and gotchas during implementation

- **Prisma `select` shape for HubSpotPropertyCache** — the resolver uses `street/city/state/zip` as exact-match where clause. If the Prisma field names differ (e.g. `addressStreet`), correct in Task 4. Verify with `grep -n "model HubSpotPropertyCache" prisma/schema.prisma` and inspect columns.

- **`fetchTransformedProjects` vs the actual export name** — Task 8 imports this from `@/lib/hubspot`. If it doesn't exist with that exact name, grep for the project-fetch helper used by existing dashboards (e.g. `/dashboards/deals/page.tsx`) and mirror. The aggregator test mocks it so implementation detail is local.

- **Zuper today-jobs fetch** — Task 8 step 3a is a sentinel. If `fetchTodaysServiceJobs` has to be a new helper, keep it minimal; don't spec out full Zuper filtering here.

- **`getCurrentUser` import path** — check an existing dashboard page (e.g. `/dashboards/scheduler/page.tsx`) for the current pattern before copying into `page.tsx`.

- **DashboardShell `fullWidth` prop** — verify it exists on the Shell component. If not, the shell already uses max-w; we may need to pass a className override or add a `fullWidth` prop to the Shell. Minor scope creep acceptable.

- **`APIProvider` duplicate load** — `@vis.gl/react-google-maps` may error if multiple `APIProvider` instances mount. Phase 1 is fine because there's only one; future maps on other pages should hoist the provider.

- **Google Maps referrer restriction** — when enabling in prod, set HTTP referrer allowlist in Google Cloud Console to only the app's domain. Do NOT ship an unrestricted key.

- **Vercel env var sync** — per memory `feedback_vercel_env_sync.md`, add `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` + `NEXT_PUBLIC_UI_MAP_VIEW_ENABLED` to Vercel prod BEFORE flipping the feature flag on.

---

## Phase 2+ out of scope

These are explicitly deferred:

- Week and Backlog modes (endpoint accepts `mode` param; aggregator falls through to today for now)
- Inspection / survey / D&R / roofing markers
- Crew route polylines (data populated in CrewPin; rendering deferred)
- Drag-to-reassign
- Live GPS tracking

Any work on these belongs in separate specs and plans.
