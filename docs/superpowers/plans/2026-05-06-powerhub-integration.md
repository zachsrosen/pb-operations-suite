# Tesla PowerHub Integration — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate Tesla PowerHub fleet monitoring (solar production, battery SOC, alerts) into the PB Operations Suite for Service and Design teams.

**Architecture:** Cron-driven sync from Tesla PowerHub API (via mTLS proxy) → Postgres cache tables → React Query + SSE real-time UI. Three-tier site-to-deal linkage (Property → address match → manual). Feature-flagged behind `POWERHUB_ENABLED`.

**Tech Stack:** Next.js 16, Prisma 7, React Query v5, SSE, Tesla PowerHub API (mTLS + JWT), Vercel Cron

**Spec:** `docs/superpowers/specs/2026-05-06-powerhub-integration-design.md`

---

## File Structure

### New Files (17)

| File | Responsibility |
|------|---------------|
| `prisma/migrations/YYYYMMDD_powerhub_models/migration.sql` | Schema migration for 4 new models + 3 enums |
| `src/lib/tesla-powerhub.ts` | API client: JWT auth, rate limiting, endpoint wrappers |
| `src/lib/powerhub-linkage.ts` | Three-tier site-to-deal linkage logic |
| `src/lib/powerhub-sync.ts` | Sync orchestration: asset, telemetry, alert poll logic |
| `src/app/api/powerhub/sites/route.ts` | GET: list all PowerHub sites |
| `src/app/api/powerhub/sites/[siteId]/route.ts` | GET: site detail + snapshot + alerts |
| `src/app/api/powerhub/sites/[siteId]/history/route.ts` | GET: telemetry history |
| `src/app/api/powerhub/sites/[siteId]/alerts/route.ts` | GET: alert history |
| `src/app/api/powerhub/fleet/route.ts` | GET: aggregated fleet metrics |
| `src/app/api/powerhub/link/route.ts` | POST: manual site-to-deal link (admin) |
| `src/app/api/powerhub/unlink/route.ts` | POST: remove link (admin) |
| `src/app/api/powerhub/sync/route.ts` | POST: trigger manual sync (admin) |
| `src/app/api/cron/powerhub-assets/route.ts` | Cron: asset sync every 6h |
| `src/app/api/cron/powerhub-telemetry/route.ts` | Cron: telemetry poll every 15m |
| `src/app/api/cron/powerhub-alerts/route.ts` | Cron: alert poll every 5m |
| `src/app/dashboards/powerhub/page.tsx` | Fleet monitoring dashboard |
| `src/app/dashboards/admin/powerhub/page.tsx` | Admin site linkage manager |
| `src/components/powerhub/FleetTable.tsx` | Expandable site table |
| `src/components/powerhub/SiteDetail.tsx` | Expanded row detail panel |
| `src/components/powerhub/SystemHealth.tsx` | Customer 360 embed |
| `src/components/powerhub/LinkDialog.tsx` | Deal search + link modal |
| `src/components/powerhub/SyncStatus.tsx` | Sync timestamps panel |
| `src/__tests__/powerhub-client.test.ts` | API client unit tests |
| `src/__tests__/powerhub-linkage.test.ts` | Linkage logic unit tests |
| `src/__tests__/powerhub-priority.test.ts` | Priority scoring unit tests |

### Modified Files (8)

| File | Change |
|------|--------|
| `prisma/schema.prisma` | 4 new models, 3 enums, back-relation on HubSpotPropertyCache |
| `src/lib/query-keys.ts` | Add `powerhub` key factory + `cacheKeyToQueryKeys` branches |
| `src/lib/service-priority.ts` | Add PowerHub alert scoring factor |
| `src/lib/roles.ts` | Add `/api/powerhub` + `/dashboards/powerhub` to role allowlists |
| `src/middleware.ts` | Add 3 cron paths to PUBLIC_API_ROUTES |
| `src/app/suites/service/page.tsx` | Add PowerHub dashboard card |
| `src/app/suites/design-engineering/page.tsx` | Add PowerHub dashboard card |
| `vercel.json` | Add 3 cron entries + maxDuration overrides |

---

## Chunk 1: Database Schema & Plumbing

### Task 1: Prisma Schema — New Enums

**Files:**
- Modify: `prisma/schema.prisma` (append after last enum block, ~line 3927)

- [ ] **Step 1: Add PowerHub enums to schema**

Append at end of `prisma/schema.prisma`:

```prisma
// ===========================================
// POWERHUB (Tesla Fleet Monitoring)
// ===========================================

enum PowerhubLinkMethod {
  PROPERTY       // Matched via HubSpotPropertyCache.addressHash
  ADDRESS_MATCH  // Matched via normalized address against HubSpot deals
  MANUAL         // Admin manually linked
  UNLINKED       // No link established yet
}

enum PowerhubLinkConfidence {
  HIGH    // Property match or exact address+city+state+zip
  MEDIUM  // Street + city only (no zip match)
  LOW     // Partial or uncertain match
}

enum PowerhubSiteStatus {
  ACTIVE
  OFFLINE
  ERROR
}

enum PowerhubAlertSeverity {
  INFORMATIONAL
  PERFORMANCE
  CRITICAL
}

enum PowerhubTelemetrySource {
  POLL  // Phase 1: cron-polled data
  BULK  // Phase 2: CSV bulk import
}
```

- [ ] **Step 2: Run `npx prisma format` to verify no syntax errors**

Run: `npx prisma format`
Expected: "Formatted prisma/schema.prisma"

- [ ] **Step 3: Commit enums**

```bash
git add prisma/schema.prisma
git commit -m "feat(powerhub): add PowerHub enums to Prisma schema"
```

---

### Task 2: Prisma Schema — PowerhubSite Model

**Files:**
- Modify: `prisma/schema.prisma` (append after enums)

- [ ] **Step 1: Add PowerhubSite model**

Append after the enums:

```prisma
model PowerhubSite {
  id         String @id @default(cuid())
  siteId     String @unique // Tesla site UUID
  siteName   String
  instanceId String

  // Address
  address     String
  city        String
  state       String
  zip         String?
  addressHash String? // SHA-256 of normalized address (for Property matching)

  // Linkage
  propertyId     String?
  property       HubSpotPropertyCache? @relation(fields: [propertyId], references: [id])
  dealId         String? // Bare HubSpot deal ID string — no Prisma FK (deal lives in HubSpot)
  linkMethod     PowerhubLinkMethod     @default(UNLINKED)
  linkConfidence PowerhubLinkConfidence @default(LOW)

  // Device summary (full tree stored in JSON)
  devices            Json   @default("[]") // Full device tree: gateways, batteries, inverters, meters
  totalBatteryEnergy Int?   // Nameplate battery energy (Wh)
  totalBatteryPower  Int?   // Nameplate battery power (W)
  totalGateways      Int    @default(0)
  totalBatteries     Int    @default(0)
  totalInverters     Int    @default(0)

  // Status
  status PowerhubSiteStatus @default(ACTIVE)

  // Sync metadata
  lastAssetSyncAt  DateTime
  lastTelemetryAt  DateTime?
  lastAlertCheckAt DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // Back-relations
  telemetrySnapshot PowerhubTelemetrySnapshot?
  telemetryHistory   PowerhubTelemetryHistory[]
  alerts             PowerhubAlert[]

  @@index([addressHash])
  @@index([propertyId])
  @@index([dealId])
  @@index([status])
}
```

- [ ] **Step 2: Add back-relation to HubSpotPropertyCache**

In the existing `HubSpotPropertyCache` model (line ~826, after `companyLinks`), add:

```prisma
  powerhubSites PowerhubSite[]
```

- [ ] **Step 3: Run `npx prisma format`**

Run: `npx prisma format`
Expected: "Formatted prisma/schema.prisma"

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(powerhub): add PowerhubSite model with Property back-relation"
```

---

### Task 3: Prisma Schema — Telemetry & Alert Models

**Files:**
- Modify: `prisma/schema.prisma` (append after PowerhubSite)

- [ ] **Step 1: Add PowerhubTelemetrySnapshot model**

```prisma
model PowerhubTelemetrySnapshot {
  id     String @id @default(cuid())
  siteId String @unique // One snapshot per site
  site   PowerhubSite @relation(fields: [siteId], references: [siteId])

  timestamp DateTime // Measurement time from Tesla

  // Core signals
  solarPowerW              Float? // Solar real power (W)
  solarEnergyTodayWh       Float? // Solar energy produced today (Wh)
  batteryPowerW            Float? // Battery real power (W, +discharge/-charge)
  batterySocPercent        Float? // Battery state of energy (%)
  batteryEnergyRemainingWh Float? // Energy remaining (Wh)
  gridPowerW               Float? // Grid real power (W, +import/-export)
  gridEnergyImportedWh     Float? // Grid energy imported (Wh)
  gridEnergyExportedWh     Float? // Grid energy exported (Wh)
  loadPowerW               Float? // Load real power (W)
  gridConnectedStatus      String? // "Grid Connected" or "Grid Disconnected"
  batteryMode              String? // "Self-Powered", "Time Based Control", etc.

  raw Json? // Full signal dump for future use

  updatedAt DateTime @updatedAt
}
```

- [ ] **Step 2: Add PowerhubTelemetryHistory model**

```prisma
model PowerhubTelemetryHistory {
  id     String @id @default(cuid())
  siteId String
  site   PowerhubSite @relation(fields: [siteId], references: [siteId])

  timestamp   DateTime
  signalName  String // Tesla signal name (e.g., "solar_instant_power")
  value       Float? // Numeric value
  valueString String? // String value (for status signals)
  source      PowerhubTelemetrySource @default(POLL)

  @@index([siteId, signalName, timestamp])
  @@index([siteId, timestamp])
}
```

- [ ] **Step 3: Add PowerhubAlert model**

```prisma
model PowerhubAlert {
  id     String @id @default(cuid())
  siteId String
  site   PowerhubSite @relation(fields: [siteId], references: [siteId])

  deviceId    String // Tesla device UUID; use "site" sentinel for site-level alerts
  din         String? // Device Identification Number
  alertName   String
  description String @db.Text
  severity    PowerhubAlertSeverity
  isActive    Boolean @default(true)
  origin      String // "device" or "server_inferred"
  reportedAt  DateTime
  resolvedAt  DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([siteId, deviceId, alertName, reportedAt])
  @@index([siteId, isActive])
  @@index([severity, isActive])
}
```

- [ ] **Step 4: Run `npx prisma format`**

Run: `npx prisma format`
Expected: "Formatted prisma/schema.prisma"

- [ ] **Step 5: Generate migration**

Run: `npx prisma migrate dev --name powerhub_models --create-only`
Expected: Creates migration file in `prisma/migrations/` without applying (we review first).

- [ ] **Step 6: Review generated SQL, then apply**

Run: `npx prisma migrate dev`
Expected: Migration applied, `prisma generate` runs, client types updated.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(powerhub): add Telemetry + Alert models, generate migration"
```

---

### Task 4: Middleware & Role Plumbing

**Files:**
- Modify: `src/middleware.ts` (~line 51, in PUBLIC_API_ROUTES)
- Modify: `src/lib/roles.ts` (multiple role blocks)

- [ ] **Step 1: Add cron paths to PUBLIC_API_ROUTES**

In `src/middleware.ts`, add to the `PUBLIC_API_ROUTES` array (after the last `/api/cron/` entry):

```typescript
  "/api/cron/powerhub-assets",     // PowerHub asset sync — CRON_SECRET validated in route
  "/api/cron/powerhub-telemetry",  // PowerHub telemetry poll — CRON_SECRET validated in route
  "/api/cron/powerhub-alerts",     // PowerHub alert poll — CRON_SECRET validated in route
```

- [ ] **Step 2: Add routes to role allowlists in roles.ts**

For each of these roles, add to their `allowedRoutes` array:

**PROJECT_MANAGER**: add `"/api/powerhub"`, `"/dashboards/powerhub"`
**OPERATIONS_MANAGER**: add `"/api/powerhub"`, `"/dashboards/powerhub"`
**OPERATIONS**: add `"/api/powerhub"` (API only — for Customer 360 embed)
**SERVICE**: add `"/api/powerhub"`, `"/dashboards/powerhub"`
**TECH_OPS**: add `"/api/powerhub"`, `"/dashboards/powerhub"`
**DESIGN**: add `"/api/powerhub"`, `"/dashboards/powerhub"`

- [ ] **Step 3: Add query key factory to query-keys.ts**

In `src/lib/query-keys.ts`, add to the `queryKeys` object (after `servicePriority`):

```typescript
  powerhub: {
    root: ["powerhub"] as const,
    sites: (params?: Record<string, unknown>) =>
      [...queryKeys.powerhub.root, "sites", params] as const,
    site: (siteId: string) =>
      [...queryKeys.powerhub.root, "site", siteId] as const,
    fleet: () => [...queryKeys.powerhub.root, "fleet"] as const,
  },
```

- [ ] **Step 4: Add cacheKeyToQueryKeys branches**

In `src/lib/query-keys.ts`, in the `cacheKeyToQueryKeys` function, add BEFORE the final `return []` line:

```typescript
  // PowerHub — alerts cascade to service priority queue for scoring boost
  if (serverKey.startsWith("powerhub:alerts"))
    return [queryKeys.powerhub.root, queryKeys.servicePriority.root];
  if (serverKey.startsWith("powerhub"))
    return [queryKeys.powerhub.root];
```

**IMPORTANT**: `powerhub:alerts` must appear BEFORE the generic `powerhub` branch (more-specific first).

- [ ] **Step 5: Add vercel.json cron entries**

In `vercel.json`, add to the `crons` array:

```json
{ "path": "/api/cron/powerhub-assets", "schedule": "0 0,6,12,18 * * *" },
{ "path": "/api/cron/powerhub-telemetry", "schedule": "2,17,32,47 * * * *" },
{ "path": "/api/cron/powerhub-alerts", "schedule": "4,9,14,19,24,29,34,39,44,49,54,59 * * * *" }
```

And in the `functions` block:

```json
"src/app/api/cron/powerhub-assets/route.ts": { "maxDuration": 300 },
"src/app/api/cron/powerhub-telemetry/route.ts": { "maxDuration": 120 },
"src/app/api/cron/powerhub-alerts/route.ts": { "maxDuration": 120 }
```

- [ ] **Step 6: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 7: Commit**

```bash
git add src/middleware.ts src/lib/roles.ts src/lib/query-keys.ts vercel.json
git commit -m "feat(powerhub): add middleware, roles, query keys, and vercel cron plumbing"
```

---

## Chunk 2: Tesla PowerHub API Client

### Task 5: Write Failing Tests for API Client

**Files:**
- Create: `src/__tests__/powerhub-client.test.ts`

- [ ] **Step 1: Write test file with core test cases**

```typescript
/**
 * Tesla PowerHub API client tests.
 * Tests JWT auth flow, rate limiting, endpoint wrappers, and error handling.
 */
import {
  createPowerHubClient,
  type PowerHubClient,
} from "@/lib/tesla-powerhub";

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Env setup
const TEST_ENV = {
  POWERHUB_ENABLED: "true",
  TESLA_POWERHUB_INSTANCE_ID: "test-instance-id",
  TESLA_POWERHUB_USER_ID: "test@photonbrothers.com",
  TESLA_POWERHUB_PROXY_URL: "https://proxy.test.com",
};

beforeEach(() => {
  jest.resetAllMocks();
  Object.entries(TEST_ENV).forEach(([k, v]) => {
    process.env[k] = v;
  });
});

afterEach(() => {
  Object.keys(TEST_ENV).forEach((k) => delete process.env[k]);
});

describe("PowerHub Client — Authentication", () => {
  it("should request a JWT token on first API call", async () => {
    // Token endpoint returns JWT
    mockFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "jwt-token-123", expires_in: 600 }), {
          status: 200,
        })
      )
      // Actual API call
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ groups: [] }), { status: 200 })
      );

    const client = createPowerHubClient();
    await client.getGroups();

    // First call should be token request
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toBe(
      "https://proxy.test.com/asset/tokens"
    );
    expect(mockFetch.mock.calls[0][1].method).toBe("POST");
  });

  it("should reuse cached token on subsequent calls", async () => {
    mockFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "jwt-token-123", expires_in: 600 }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ groups: [] }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sites: [] }), { status: 200 })
      );

    const client = createPowerHubClient();
    await client.getGroups();
    await client.getSites();

    // Only 1 token request, then 2 API calls = 3 total
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("should re-authenticate on 401 response", async () => {
    mockFetch
      // Initial token
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "old-token", expires_in: 600 }), {
          status: 200,
        })
      )
      // API returns 401
      .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
      // Re-auth token
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "new-token", expires_in: 600 }), {
          status: 200,
        })
      )
      // Retry succeeds
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ groups: [] }), { status: 200 })
      );

    const client = createPowerHubClient();
    const result = await client.getGroups();

    expect(result).toEqual({ groups: [] });
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });
});

describe("PowerHub Client — Rate Limiting", () => {
  it("should respect 4 req/sec rate limit", async () => {
    // Return token once
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ token: "jwt", expires_in: 600 }), {
        status: 200,
      })
    );
    // Then 5 API responses
    for (let i = 0; i < 5; i++) {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ data: i }), { status: 200 })
      );
    }

    const client = createPowerHubClient();
    const start = Date.now();
    await Promise.all([
      client.getGroups(),
      client.getGroups(),
      client.getGroups(),
      client.getGroups(),
      client.getGroups(),
    ]);
    const elapsed = Date.now() - start;

    // 5 requests at 4/sec means at least 1 must wait ~250ms
    expect(elapsed).toBeGreaterThanOrEqual(200);
  });
});

describe("PowerHub Client — Error Handling", () => {
  it("should retry on 429 with exponential backoff", async () => {
    mockFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "jwt", expires_in: 600 }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(new Response("Rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response("Rate limited", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ groups: [] }), { status: 200 })
      );

    const client = createPowerHubClient();
    const result = await client.getGroups();

    expect(result).toEqual({ groups: [] });
    // token + 2 retries + success = 4
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("should throw immediately on 403", async () => {
    mockFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "jwt", expires_in: 600 }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));

    const client = createPowerHubClient();
    await expect(client.getGroups()).rejects.toThrow(/403|Forbidden/);
  });

  it("should throw when POWERHUB_ENABLED is false", () => {
    process.env.POWERHUB_ENABLED = "false";
    expect(() => createPowerHubClient()).toThrow(/PowerHub.*disabled/i);
  });
});

describe("PowerHub Client — Endpoint Wrappers", () => {
  let client: PowerHubClient;

  beforeEach(() => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ token: "jwt", expires_in: 600 }), {
        status: 200,
      })
    );
    client = createPowerHubClient();
  });

  it("getSiteDetail should call /asset/sites/{siteId}", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ site_id: "abc", site_name: "Test" }), {
        status: 200,
      })
    );

    await client.getSiteDetail("abc");

    const url = mockFetch.mock.calls[1][0];
    expect(url).toContain("/asset/sites/abc");
  });

  it("getLastTelemetry should include signal list in params", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ signals: [] }), { status: 200 })
    );

    await client.getLastTelemetry("site-1", ["solar_instant_power", "battery_state_of_energy"]);

    const url = mockFetch.mock.calls[1][0];
    expect(url).toContain("target_id=site-1");
    expect(url).toContain("solar_instant_power");
  });

  it("getActiveAlerts should call /alerts/last with active_only", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ alerts: [] }), { status: 200 })
    );

    await client.getActiveAlerts("site-1");

    const url = mockFetch.mock.calls[1][0];
    expect(url).toContain("/alerts/last");
    expect(url).toContain("active_only=true");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/powerhub-client.test.ts --no-coverage`
Expected: FAIL — "Cannot find module '@/lib/tesla-powerhub'"

- [ ] **Step 3: Commit test file**

```bash
git add src/__tests__/powerhub-client.test.ts
git commit -m "test(powerhub): add failing tests for PowerHub API client"
```

---

### Task 6: Implement PowerHub API Client

**Files:**
- Create: `src/lib/tesla-powerhub.ts`

- [ ] **Step 1: Implement the client**

```typescript
/**
 * Tesla PowerHub API Client
 *
 * Handles mTLS proxy communication, JWT authentication, rate limiting,
 * and typed endpoint wrappers for the PowerHub API.
 *
 * Architecture:
 * - Our Vercel functions call the mTLS proxy (plain HTTPS)
 * - The proxy adds client cert and forwards to Tesla's API
 * - JWT tokens (10-min expiry) are cached in module-level state
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PowerHubTokenResponse {
  token: string;
  expires_in: number; // seconds
}

export interface PowerHubGroup {
  group_id: string;
  group_name: string;
  subgroups?: PowerHubGroup[];
  sites?: { site_id: string; site_name: string }[];
}

export interface PowerHubSiteDetail {
  site_id: string;
  site_name: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  equipment?: PowerHubDevice[];
}

export interface PowerHubDevice {
  device_id: string;
  din?: string;
  device_type: string; // "gateway", "battery", "inverter", "meter"
  manufacturer?: string;
  model?: string;
  serial_number?: string;
  nameplate_energy_wh?: number;
  nameplate_power_w?: number;
}

export interface PowerHubTelemetrySignal {
  signal_name: string;
  value: number | string | null;
  timestamp: string;
}

export interface PowerHubAlert {
  alert_id: string;
  device_id?: string;
  din?: string;
  alert_name: string;
  description: string;
  severity: "informational" | "performance" | "critical";
  origin: string;
  reported_at: string;
  resolved_at?: string;
  is_active: boolean;
}

export interface PowerHubClient {
  getGroups(): Promise<{ groups: PowerHubGroup[] }>;
  getSites(): Promise<{ sites: { site_id: string; site_name: string }[] }>;
  getSiteDetail(siteId: string): Promise<PowerHubSiteDetail>;
  getLastTelemetry(
    targetId: string,
    signals: string[]
  ): Promise<{ signals: PowerHubTelemetrySignal[] }>;
  getActiveAlerts(
    siteId: string,
    sinceTime?: string
  ): Promise<{ alerts: PowerHubAlert[] }>;
}

// ─── Rate Limiter ───────────────────────────────────────────���────────────────

class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per ms

  constructor(maxPerSecond: number) {
    this.maxTokens = maxPerSecond;
    this.tokens = maxPerSecond;
    this.refillRate = maxPerSecond / 1000;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    // Wait until a token is available
    const waitMs = Math.ceil((1 - this.tokens) / this.refillRate);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    this.refill();
    this.tokens -= 1;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}

// ─── Client Implementation ───────────────────────────────────────────────────

interface CachedToken {
  jwt: string;
  expiresAt: number; // Unix ms
}

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 500;

export function createPowerHubClient(): PowerHubClient {
  if (process.env.POWERHUB_ENABLED !== "true") {
    throw new Error("PowerHub is disabled (POWERHUB_ENABLED != true)");
  }

  const proxyUrl = process.env.TESLA_POWERHUB_PROXY_URL;
  const instanceId = process.env.TESLA_POWERHUB_INSTANCE_ID;
  const userId = process.env.TESLA_POWERHUB_USER_ID;

  if (!proxyUrl || !instanceId || !userId) {
    throw new Error(
      "Missing PowerHub env vars: TESLA_POWERHUB_PROXY_URL, TESLA_POWERHUB_INSTANCE_ID, TESLA_POWERHUB_USER_ID"
    );
  }

  let cachedToken: CachedToken | null = null;
  const rateLimiter = new TokenBucket(4); // 4 req/sec (under Tesla's 5 limit)

  async function getToken(): Promise<string> {
    // Return cached if still valid (with 60s buffer)
    if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
      return cachedToken.jwt;
    }

    await rateLimiter.acquire();

    const res = await fetch(`${proxyUrl}/asset/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, instance_id: instanceId }),
    });

    if (!res.ok) {
      throw new Error(`Token request failed: ${res.status} ${res.statusText}`);
    }

    const data: PowerHubTokenResponse = await res.json();
    cachedToken = {
      jwt: data.token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    return cachedToken.jwt;
  }

  function clearToken(): void {
    cachedToken = null;
  }

  async function apiCall<T>(path: string, options?: RequestInit): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await rateLimiter.acquire();

      const token = await getToken();
      const url = `${proxyUrl}${path}`;

      const res = await fetch(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...options?.headers,
        },
      });

      if (res.ok) {
        return res.json() as Promise<T>;
      }

      // 401: clear token, re-auth, retry once
      if (res.status === 401 && attempt === 0) {
        clearToken();
        continue;
      }

      // 403: immediate failure (IP/cert issue)
      if (res.status === 403) {
        throw new Error(
          `PowerHub API 403 Forbidden: ${path} — check IP allowlist or mTLS cert`
        );
      }

      // 429 or 5xx: exponential backoff
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`PowerHub API ${res.status}: ${path}`);
        if (attempt < MAX_RETRIES) {
          const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, backoff));
          continue;
        }
      }

      throw new Error(`PowerHub API ${res.status}: ${await res.text()}`);
    }

    throw lastError || new Error("PowerHub API: max retries exceeded");
  }

  // ─── Endpoint Wrappers ─────────────────────────────────────────────────────

  return {
    async getGroups() {
      return apiCall<{ groups: PowerHubGroup[] }>(
        `/asset/groups?instance_id=${instanceId}`
      );
    },

    async getSites() {
      // Walk the group tree to collect all site_ids
      const { groups } = await apiCall<{ groups: PowerHubGroup[] }>(
        `/asset/groups?instance_id=${instanceId}`
      );
      const sites: { site_id: string; site_name: string }[] = [];

      function walkGroups(groupList: PowerHubGroup[]) {
        for (const group of groupList) {
          if (group.sites) {
            sites.push(...group.sites);
          }
          if (group.subgroups) {
            walkGroups(group.subgroups);
          }
        }
      }
      walkGroups(groups);

      return { sites };
    },

    async getSiteDetail(siteId: string) {
      return apiCall<PowerHubSiteDetail>(`/asset/sites/${siteId}`);
    },

    async getLastTelemetry(targetId: string, signals: string[]) {
      const signalList = signals.join(",");
      return apiCall<{ signals: PowerHubTelemetrySignal[] }>(
        `/telemetry/last?target_id=${targetId}&signals=${signalList}`
      );
    },

    async getActiveAlerts(siteId: string, sinceTime?: string) {
      let path = `/alerts/last?target_id=${siteId}&active_only=true`;
      if (sinceTime) {
        path += `&since_time=${sinceTime}`;
      }
      return apiCall<{ alerts: PowerHubAlert[] }>(path);
    },
  };
}
```

- [ ] **Step 2: Run tests**

Run: `npx jest src/__tests__/powerhub-client.test.ts --no-coverage`
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/tesla-powerhub.ts
git commit -m "feat(powerhub): implement PowerHub API client with auth and rate limiting"
```

---

## Chunk 3: Linkage Logic & Sync Orchestration

### Task 7: Write Failing Tests for Linkage Logic

**Files:**
- Create: `src/__tests__/powerhub-linkage.test.ts`

- [ ] **Step 1: Write linkage tests**

```typescript
/**
 * PowerHub site-to-deal linkage logic tests.
 * Tests address normalization, three-tier matching, and confidence scoring.
 */
import {
  normalizeAddress,
  computeAddressHash,
  matchSiteToProperty,
  matchSiteToDeals,
  type LinkageResult,
} from "@/lib/powerhub-linkage";

describe("Address Normalization", () => {
  it("should lowercase and trim", () => {
    expect(normalizeAddress("  123 Main St  ")).toBe("123 main st");
  });

  it("should remove unit/apt/suite suffixes", () => {
    expect(normalizeAddress("456 Oak Ave Apt 2B")).toBe("456 oak ave");
    expect(normalizeAddress("789 Pine Rd Suite 100")).toBe("789 pine rd");
    expect(normalizeAddress("321 Elm St #4")).toBe("321 elm st");
    expect(normalizeAddress("555 Birch Unit A")).toBe("555 birch");
  });

  it("should remove periods", () => {
    expect(normalizeAddress("123 N. Main St.")).toBe("123 n main st");
  });

  it("should collapse whitespace", () => {
    expect(normalizeAddress("123   Main    St")).toBe("123 main st");
  });
});

describe("Address Hash", () => {
  it("should produce consistent SHA-256 for same input", () => {
    const hash1 = computeAddressHash("123 main st", "denver", "co", "80202");
    const hash2 = computeAddressHash("123 main st", "denver", "co", "80202");
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex
  });

  it("should produce different hashes for different addresses", () => {
    const hash1 = computeAddressHash("123 main st", "denver", "co", "80202");
    const hash2 = computeAddressHash("456 oak ave", "denver", "co", "80202");
    expect(hash1).not.toBe(hash2);
  });
});

describe("Tier 1: Property Match", () => {
  it("should match when addressHash matches a HubSpotPropertyCache row", async () => {
    const mockPrisma = {
      hubSpotPropertyCache: {
        findFirst: jest.fn().mockResolvedValue({
          id: "prop-1",
          addressHash: "abc123hash",
          fullAddress: "123 Main St, Denver, CO 80202",
        }),
      },
    };

    const result = await matchSiteToProperty(
      { addressHash: "abc123hash" },
      mockPrisma as any
    );

    expect(result).toEqual({
      method: "PROPERTY",
      confidence: "HIGH",
      propertyId: "prop-1",
      dealId: null,
    });
  });

  it("should return null when no property matches", async () => {
    const mockPrisma = {
      hubSpotPropertyCache: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    const result = await matchSiteToProperty(
      { addressHash: "no-match" },
      mockPrisma as any
    );

    expect(result).toBeNull();
  });
});

describe("Tier 2: Address Match to Deals", () => {
  it("should match HIGH confidence when street+city+state+zip all match", async () => {
    const result = matchSiteToDeals(
      { street: "123 main st", city: "denver", state: "co", zip: "80202" },
      [
        {
          dealId: "deal-1",
          street: "123 main st",
          city: "denver",
          state: "co",
          zip: "80202",
        },
      ]
    );

    expect(result).toEqual({
      method: "ADDRESS_MATCH",
      confidence: "HIGH",
      propertyId: null,
      dealId: "deal-1",
    });
  });

  it("should match MEDIUM confidence when street+city match but zip differs", async () => {
    const result = matchSiteToDeals(
      { street: "123 main st", city: "denver", state: "co", zip: "80202" },
      [
        {
          dealId: "deal-2",
          street: "123 main st",
          city: "denver",
          state: "co",
          zip: "80203",
        },
      ]
    );

    expect(result).toEqual({
      method: "ADDRESS_MATCH",
      confidence: "MEDIUM",
      propertyId: null,
      dealId: "deal-2",
    });
  });

  it("should return null when no deals match", () => {
    const result = matchSiteToDeals(
      { street: "999 nowhere ln", city: "denver", state: "co", zip: "80202" },
      [
        {
          dealId: "deal-1",
          street: "123 main st",
          city: "denver",
          state: "co",
          zip: "80202",
        },
      ]
    );

    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/powerhub-linkage.test.ts --no-coverage`
Expected: FAIL — "Cannot find module '@/lib/powerhub-linkage'"

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/powerhub-linkage.test.ts
git commit -m "test(powerhub): add failing tests for site-to-deal linkage logic"
```

---

### Task 8: Implement Linkage Logic

**Files:**
- Create: `src/lib/powerhub-linkage.ts`

- [ ] **Step 1: Implement linkage module**

```typescript
/**
 * PowerHub Site-to-Deal Linkage
 *
 * Three-tier matching:
 *   1. Property match — address hash matches HubSpotPropertyCache
 *   2. Address match — normalized address matches HubSpot deal property_address
 *   3. Manual — admin links via UI (or left UNLINKED for admin queue)
 */

import { createHash } from "crypto";
import type { PrismaClient } from "@/generated/prisma/client";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LinkageResult {
  method: "PROPERTY" | "ADDRESS_MATCH" | "MANUAL";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  propertyId: string | null;
  dealId: string | null;
}

export interface NormalizedSiteAddress {
  street: string;
  city: string;
  state: string;
  zip: string | null;
}

export interface DealAddress {
  dealId: string;
  street: string;
  city: string;
  state: string;
  zip: string | null;
}

// ─── Address Normalization ───────────────────────────────────────────────────

/**
 * Normalize a street address for comparison:
 * - Lowercase
 * - Remove periods
 * - Strip unit/apt/suite/# suffixes
 * - Collapse whitespace
 * - Trim
 */
export function normalizeAddress(raw: string): string {
  let addr = raw.toLowerCase().trim();
  // Remove periods
  addr = addr.replace(/\./g, "");
  // Strip unit/apt/suite/# and everything after
  addr = addr.replace(/\s+(apt|suite|ste|unit|#)\s*.*/i, "");
  // Collapse whitespace
  addr = addr.replace(/\s+/g, " ").trim();
  return addr;
}

/**
 * Compute SHA-256 hash of normalized address components.
 * Matches the pattern used by HubSpotPropertyCache.addressHash.
 */
export function computeAddressHash(
  street: string,
  city: string,
  state: string,
  zip: string | null
): string {
  const input = `${street}|${city}|${state}|${zip || ""}`.toLowerCase();
  return createHash("sha256").update(input).digest("hex");
}

// ─── Tier 1: Property Match ─────────────────────────────────────────────────

/**
 * Look up HubSpotPropertyCache by addressHash.
 * Returns linkage result if found, null if no match.
 */
export async function matchSiteToProperty(
  site: { addressHash: string | null },
  prisma: PrismaClient
): Promise<LinkageResult | null> {
  if (!site.addressHash) return null;

  const property = await prisma.hubSpotPropertyCache.findFirst({
    where: { addressHash: site.addressHash },
    select: { id: true },
  });

  if (!property) return null;

  return {
    method: "PROPERTY",
    confidence: "HIGH",
    propertyId: property.id,
    dealId: null,
  };
}

// ─── Tier 2: Address Match to Deals ─────────────────────────────────────────

/**
 * Compare normalized site address against a list of deal addresses.
 * Returns the best match or null.
 */
export function matchSiteToDeals(
  site: NormalizedSiteAddress,
  deals: DealAddress[]
): LinkageResult | null {
  // First pass: exact match (street + city + state + zip)
  for (const deal of deals) {
    if (
      deal.street === site.street &&
      deal.city === site.city &&
      deal.state === site.state &&
      deal.zip === site.zip
    ) {
      return {
        method: "ADDRESS_MATCH",
        confidence: "HIGH",
        propertyId: null,
        dealId: deal.dealId,
      };
    }
  }

  // Second pass: street + city match only (zip mismatch = MEDIUM)
  for (const deal of deals) {
    if (
      deal.street === site.street &&
      deal.city === site.city &&
      deal.state === site.state
    ) {
      return {
        method: "ADDRESS_MATCH",
        confidence: "MEDIUM",
        propertyId: null,
        dealId: deal.dealId,
      };
    }
  }

  return null;
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

/**
 * Run the full three-tier linkage for a site.
 * Returns the best match or UNLINKED status.
 */
export async function linkSite(
  siteAddress: { street: string; city: string; state: string; zip: string | null },
  dealAddresses: DealAddress[],
  prisma: PrismaClient
): Promise<LinkageResult & { method: "PROPERTY" | "ADDRESS_MATCH" | "MANUAL" } | null> {
  const normalizedStreet = normalizeAddress(siteAddress.street);
  const addressHash = computeAddressHash(
    normalizedStreet,
    siteAddress.city.toLowerCase(),
    siteAddress.state.toLowerCase(),
    siteAddress.zip
  );

  // Tier 1: Property match
  const propertyMatch = await matchSiteToProperty({ addressHash }, prisma);
  if (propertyMatch) return propertyMatch;

  // Tier 2: Address match
  const normalizedSite: NormalizedSiteAddress = {
    street: normalizedStreet,
    city: siteAddress.city.toLowerCase(),
    state: siteAddress.state.toLowerCase(),
    zip: siteAddress.zip,
  };
  const dealMatch = matchSiteToDeals(normalizedSite, dealAddresses);
  if (dealMatch) return dealMatch;

  // Tier 3: No match — stays UNLINKED (admin handles manually)
  return null;
}
```

- [ ] **Step 2: Run tests**

Run: `npx jest src/__tests__/powerhub-linkage.test.ts --no-coverage`
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/powerhub-linkage.ts
git commit -m "feat(powerhub): implement three-tier site-to-deal linkage"
```

---

### Task 9: Implement Sync Orchestration

**Files:**
- Create: `src/lib/powerhub-sync.ts`

- [ ] **Step 1: Implement sync module**

```typescript
/**
 * PowerHub Sync Orchestration
 *
 * Three sync operations:
 * 1. Asset sync — discovers sites, devices, runs linkage
 * 2. Telemetry poll — fetches latest signals per site
 * 3. Alert poll — fetches active alerts, resolves cleared ones
 *
 * All operations are designed to be called from Vercel Cron handlers.
 */

import { createPowerHubClient, type PowerHubSiteDetail } from "./tesla-powerhub";
import {
  normalizeAddress,
  computeAddressHash,
  linkSite,
  type DealAddress,
} from "./powerhub-linkage";
import { prisma } from "./db";
import { appCache } from "./cache";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Telemetry signals to poll per site */
const TELEMETRY_SIGNALS = [
  "solar_instant_power",
  "solar_energy_exported",
  "battery_instant_power",
  "battery_state_of_energy",
  "battery_expected_energy_remaining",
  "site_instant_power",
  "site_energy_imported",
  "site_energy_exported",
  "load_instant_real_power",
  "grid_connected_status",
  "command_real_mode",
] as const;

/** Process sites in chunks to respect rate limit (4 req/sec) */
const CHUNK_SIZE = 4;
const CHUNK_DELAY_MS = 1100; // 1.1s between chunks for safety

// ─── Asset Sync ──────────────────────────────────────────────────────────────

export interface AssetSyncResult {
  sitesDiscovered: number;
  sitesCreated: number;
  sitesUpdated: number;
  sitesLinked: number;
  errors: string[];
}

/**
 * Discover all sites from Tesla, upsert PowerhubSite rows, and run linkage
 * for any UNLINKED sites.
 */
export async function syncAssets(): Promise<AssetSyncResult> {
  const client = createPowerHubClient();
  const result: AssetSyncResult = {
    sitesDiscovered: 0,
    sitesCreated: 0,
    sitesUpdated: 0,
    sitesLinked: 0,
    errors: [],
  };

  // 1. Get all sites from Tesla
  const { sites: siteList } = await client.getSites();
  result.sitesDiscovered = siteList.length;

  // 2. Fetch deal addresses for linkage (batch query)
  const dealAddresses = await fetchDealAddresses();

  // 3. Process sites in chunks
  for (let i = 0; i < siteList.length; i += CHUNK_SIZE) {
    const chunk = siteList.slice(i, i + CHUNK_SIZE);

    await Promise.all(
      chunk.map(async (siteSummary) => {
        try {
          const detail = await client.getSiteDetail(siteSummary.site_id);
          await upsertSite(detail, dealAddresses, result);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`Site ${siteSummary.site_id}: ${msg}`);
        }
      })
    );

    // Pause between chunks
    if (i + CHUNK_SIZE < siteList.length) {
      await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS));
    }
  }

  return result;
}

async function upsertSite(
  detail: PowerHubSiteDetail,
  dealAddresses: DealAddress[],
  result: AssetSyncResult
): Promise<void> {
  const devices = detail.equipment || [];
  const gateways = devices.filter((d) => d.device_type === "gateway");
  const batteries = devices.filter((d) => d.device_type === "battery");
  const inverters = devices.filter((d) => d.device_type === "inverter");

  const totalBatteryEnergy = batteries.reduce(
    (sum, b) => sum + (b.nameplate_energy_wh || 0),
    0
  );
  const totalBatteryPower = batteries.reduce(
    (sum, b) => sum + (b.nameplate_power_w || 0),
    0
  );

  // Normalize address for hash
  const street = normalizeAddress(detail.address || "");
  const city = (detail.city || "").toLowerCase().trim();
  const state = (detail.state || "").toLowerCase().trim();
  const zip = detail.zip || null;
  const addressHash = street && city && state
    ? computeAddressHash(street, city, state, zip)
    : null;

  const existing = await prisma.powerhubSite.findUnique({
    where: { siteId: detail.site_id },
    select: { id: true, linkMethod: true },
  });

  const siteData = {
    siteName: detail.site_name,
    instanceId: process.env.TESLA_POWERHUB_INSTANCE_ID!,
    address: detail.address || "",
    city: detail.city || "",
    state: detail.state || "",
    zip,
    addressHash,
    devices: JSON.parse(JSON.stringify(devices)),
    totalBatteryEnergy: totalBatteryEnergy || null,
    totalBatteryPower: totalBatteryPower || null,
    totalGateways: gateways.length,
    totalBatteries: batteries.length,
    totalInverters: inverters.length,
    lastAssetSyncAt: new Date(),
  };

  if (existing) {
    await prisma.powerhubSite.update({
      where: { siteId: detail.site_id },
      data: siteData,
    });
    result.sitesUpdated++;

    // Only run linkage if still UNLINKED
    if (existing.linkMethod === "UNLINKED" && addressHash) {
      const linkResult = await linkSite(
        { street, city, state, zip },
        dealAddresses,
        prisma
      );
      if (linkResult) {
        await prisma.powerhubSite.update({
          where: { siteId: detail.site_id },
          data: {
            propertyId: linkResult.propertyId,
            dealId: linkResult.dealId,
            linkMethod: linkResult.method,
            linkConfidence: linkResult.confidence,
          },
        });
        result.sitesLinked++;
      }
    }
  } else {
    // Create new site
    let linkData = {};
    if (addressHash) {
      const linkResult = await linkSite(
        { street, city, state, zip },
        dealAddresses,
        prisma
      );
      if (linkResult) {
        linkData = {
          propertyId: linkResult.propertyId,
          dealId: linkResult.dealId,
          linkMethod: linkResult.method,
          linkConfidence: linkResult.confidence,
        };
        result.sitesLinked++;
      }
    }

    await prisma.powerhubSite.create({
      data: {
        siteId: detail.site_id,
        ...siteData,
        ...linkData,
      },
    });
    result.sitesCreated++;
  }
}

/** Fetch all deal addresses from HubSpot project cache for linkage matching */
async function fetchDealAddresses(): Promise<DealAddress[]> {
  const deals = await prisma.hubSpotProjectCache.findMany({
    where: {
      address: { not: null },
    },
    select: {
      dealId: true,
      address: true,
      city: true,
      state: true,
      zipCode: true,
    },
  });

  return deals
    .filter((d) => d.address)
    .map((d) => ({
      dealId: d.dealId,
      street: normalizeAddress(d.address!),
      city: (d.city || "").toLowerCase().trim(),
      state: (d.state || "").toLowerCase().trim(),
      zip: d.zipCode || null,
    }));
}

// ─── Telemetry Poll ───────────────────────────────────────────────────────��──

export interface TelemetryPollResult {
  sitesPolled: number;
  sitesUpdated: number;
  historyRowsInserted: number;
  errors: string[];
}

/**
 * Poll latest telemetry for all ACTIVE sites, upsert snapshots,
 * insert history rows.
 */
export async function pollTelemetry(): Promise<TelemetryPollResult> {
  const client = createPowerHubClient();
  const result: TelemetryPollResult = {
    sitesPolled: 0,
    sitesUpdated: 0,
    historyRowsInserted: 0,
    errors: [],
  };

  const activeSites = await prisma.powerhubSite.findMany({
    where: { status: "ACTIVE" },
    select: { siteId: true },
  });

  for (let i = 0; i < activeSites.length; i += CHUNK_SIZE) {
    const chunk = activeSites.slice(i, i + CHUNK_SIZE);

    await Promise.all(
      chunk.map(async (site) => {
        try {
          result.sitesPolled++;
          const { signals } = await client.getLastTelemetry(
            site.siteId,
            [...TELEMETRY_SIGNALS]
          );

          if (!signals || signals.length === 0) return;

          // Build snapshot data from signals
          const signalMap = new Map(
            signals.map((s) => [s.signal_name, s])
          );
          const timestamp = signals[0]?.timestamp
            ? new Date(signals[0].timestamp)
            : new Date();

          const snapshotData = {
            timestamp,
            solarPowerW: numericValue(signalMap.get("solar_instant_power")),
            solarEnergyTodayWh: numericValue(signalMap.get("solar_energy_exported")),
            batteryPowerW: numericValue(signalMap.get("battery_instant_power")),
            batterySocPercent: numericValue(signalMap.get("battery_state_of_energy")),
            batteryEnergyRemainingWh: numericValue(signalMap.get("battery_expected_energy_remaining")),
            gridPowerW: numericValue(signalMap.get("site_instant_power")),
            gridEnergyImportedWh: numericValue(signalMap.get("site_energy_imported")),
            gridEnergyExportedWh: numericValue(signalMap.get("site_energy_exported")),
            loadPowerW: numericValue(signalMap.get("load_instant_real_power")),
            gridConnectedStatus: stringValue(signalMap.get("grid_connected_status")),
            batteryMode: stringValue(signalMap.get("command_real_mode")),
            raw: JSON.parse(JSON.stringify(signals)),
          };

          // Upsert snapshot (one per site)
          await prisma.powerhubTelemetrySnapshot.upsert({
            where: { siteId: site.siteId },
            create: { siteId: site.siteId, ...snapshotData },
            update: snapshotData,
          });

          // Insert history rows
          const historyRows = signals
            .filter((s) => s.value !== null)
            .map((s) => ({
              siteId: site.siteId,
              timestamp,
              signalName: s.signal_name,
              value: typeof s.value === "number" ? s.value : null,
              valueString: typeof s.value === "string" ? s.value : null,
              source: "POLL" as const,
            }));

          if (historyRows.length > 0) {
            await prisma.powerhubTelemetryHistory.createMany({
              data: historyRows,
            });
            result.historyRowsInserted += historyRows.length;
          }

          // Update site metadata
          await prisma.powerhubSite.update({
            where: { siteId: site.siteId },
            data: { lastTelemetryAt: new Date() },
          });

          result.sitesUpdated++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`Telemetry ${site.siteId}: ${msg}`);
        }
      })
    );

    if (i + CHUNK_SIZE < activeSites.length) {
      await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS));
    }
  }

  // Emit SSE invalidation
  appCache.invalidate("powerhub:telemetry");

  return result;
}

// ─── Alert Poll ──────────────────────────────────────────────────────────────

export interface AlertPollResult {
  sitesPolled: number;
  alertsCreated: number;
  alertsResolved: number;
  errors: string[];
}

/**
 * Poll active alerts for all ACTIVE sites, upsert new alerts,
 * resolve alerts no longer in the response.
 */
export async function pollAlerts(): Promise<AlertPollResult> {
  const client = createPowerHubClient();
  const result: AlertPollResult = {
    sitesPolled: 0,
    alertsCreated: 0,
    alertsResolved: 0,
    errors: [],
  };

  const activeSites = await prisma.powerhubSite.findMany({
    where: { status: "ACTIVE" },
    select: { siteId: true, lastAlertCheckAt: true },
  });

  for (let i = 0; i < activeSites.length; i += CHUNK_SIZE) {
    const chunk = activeSites.slice(i, i + CHUNK_SIZE);

    await Promise.all(
      chunk.map(async (site) => {
        try {
          result.sitesPolled++;

          const sinceTime = site.lastAlertCheckAt?.toISOString();
          const { alerts } = await client.getActiveAlerts(
            site.siteId,
            sinceTime || undefined
          );

          // Upsert each alert
          const activeAlertKeys = new Set<string>();
          for (const alert of alerts) {
            const deviceId = alert.device_id || "site";
            const key = `${site.siteId}|${deviceId}|${alert.alert_name}|${alert.reported_at}`;
            activeAlertKeys.add(key);

            const existing = await prisma.powerhubAlert.findUnique({
              where: {
                siteId_deviceId_alertName_reportedAt: {
                  siteId: site.siteId,
                  deviceId,
                  alertName: alert.alert_name,
                  reportedAt: new Date(alert.reported_at),
                },
              },
            });

            if (!existing) {
              await prisma.powerhubAlert.create({
                data: {
                  siteId: site.siteId,
                  deviceId,
                  din: alert.din || null,
                  alertName: alert.alert_name,
                  description: alert.description,
                  severity: alert.severity.toUpperCase() as any,
                  isActive: true,
                  origin: alert.origin,
                  reportedAt: new Date(alert.reported_at),
                },
              });
              result.alertsCreated++;
            }
          }

          // Resolve alerts that are no longer active
          const currentlyActive = await prisma.powerhubAlert.findMany({
            where: { siteId: site.siteId, isActive: true },
            select: { id: true, deviceId: true, alertName: true, reportedAt: true },
          });

          for (const existing of currentlyActive) {
            const key = `${site.siteId}|${existing.deviceId}|${existing.alertName}|${existing.reportedAt.toISOString()}`;
            if (!activeAlertKeys.has(key)) {
              await prisma.powerhubAlert.update({
                where: { id: existing.id },
                data: { isActive: false, resolvedAt: new Date() },
              });
              result.alertsResolved++;
            }
          }

          // Update site metadata
          await prisma.powerhubSite.update({
            where: { siteId: site.siteId },
            data: { lastAlertCheckAt: new Date() },
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`Alerts ${site.siteId}: ${msg}`);
        }
      })
    );

    if (i + CHUNK_SIZE < activeSites.length) {
      await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS));
    }
  }

  // Emit SSE invalidation — cascades to service priority queue via cacheKeyToQueryKeys
  appCache.invalidate("powerhub:alerts");

  return result;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function numericValue(signal: { value: number | string | null } | undefined): number | null {
  if (!signal || signal.value === null) return null;
  const n = Number(signal.value);
  return Number.isFinite(n) ? n : null;
}

function stringValue(signal: { value: number | string | null } | undefined): string | null {
  if (!signal || signal.value === null) return null;
  return String(signal.value);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No type errors (may need to adjust import paths based on actual Prisma field names in HubSpotProjectCache).

- [ ] **Step 3: Commit**

```bash
git add src/lib/powerhub-sync.ts
git commit -m "feat(powerhub): implement sync orchestration (assets, telemetry, alerts)"
```

---

### Task 10: Service Priority Queue Integration

**Files:**
- Modify: `src/lib/service-priority.ts` (~line 127, before the "Cap at 100" line)
- Create: `src/__tests__/powerhub-priority.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
/**
 * Tests that PowerHub alert scoring integrates correctly.
 */
import { scorePriorityItem, type PriorityItem } from "@/lib/service-priority";

describe("PowerHub Alert Scoring", () => {
  const baseItem: PriorityItem = {
    id: "deal-1",
    type: "deal",
    title: "Test Service Deal",
    stage: "Warranty Claim",
    lastModified: new Date().toISOString(),
    createDate: new Date().toISOString(),
  };

  it("should add 25 points for a critical PowerHub alert", () => {
    const item = { ...baseItem, powerhubAlertSeverity: "CRITICAL" as const };
    const result = scorePriorityItem(item);
    expect(result.score).toBeGreaterThanOrEqual(25);
    expect(result.reasons).toContain(expect.stringContaining("PowerHub"));
  });

  it("should add 10 points for a performance PowerHub alert", () => {
    const item = { ...baseItem, powerhubAlertSeverity: "PERFORMANCE" as const };
    const result = scorePriorityItem(item);
    expect(result.score).toBeGreaterThanOrEqual(10);
  });

  it("should add 0 points when no PowerHub alert", () => {
    const result = scorePriorityItem(baseItem);
    // Only other factors contribute
    expect(result.reasons).not.toContain(expect.stringContaining("PowerHub"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/powerhub-priority.test.ts --no-coverage`
Expected: FAIL — `powerhubAlertSeverity` not in PriorityItem type.

- [ ] **Step 3: Add powerhubAlertSeverity to PriorityItem interface**

In `src/lib/service-priority.ts`, add to the `PriorityItem` interface:

```typescript
  powerhubAlertSeverity?: "CRITICAL" | "PERFORMANCE" | "INFORMATIONAL" | null;
```

- [ ] **Step 4: Add scoring factor before "Cap at 100" (around line 142)**

```typescript
  // 6. PowerHub alert severity
  if (item.powerhubAlertSeverity === "CRITICAL") {
    score += 25;
    reasons.push("PowerHub: Critical system alert");
    categories.add("powerhub_alert");
  } else if (item.powerhubAlertSeverity === "PERFORMANCE") {
    score += 10;
    reasons.push("PowerHub: Performance alert");
    categories.add("powerhub_alert");
  }
```

Also add `"powerhub_alert"` to the `ReasonCategory` type union AND `ALL_REASON_CATEGORIES` array in `src/lib/service-enrichment.ts`:

```typescript
// In the ReasonCategory type union, add:
| "powerhub_alert"

// In the ALL_REASON_CATEGORIES array, add:
"powerhub_alert",
```

- [ ] **Step 5: Run tests**

Run: `npx jest src/__tests__/powerhub-priority.test.ts --no-coverage`
Expected: All tests PASS.

- [ ] **Step 6: Run full test suite to ensure no regressions**

Run: `npx jest --no-coverage`
Expected: All existing tests still PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/service-enrichment.ts src/lib/service-priority.ts src/__tests__/powerhub-priority.test.ts
git commit -m "feat(powerhub): add PowerHub alert scoring to service priority queue"
```

---

## Chunk 4: API Routes & Cron Handlers

### Task 11: Cron Handlers

**Files:**
- Create: `src/app/api/cron/powerhub-assets/route.ts`
- Create: `src/app/api/cron/powerhub-telemetry/route.ts`
- Create: `src/app/api/cron/powerhub-alerts/route.ts`

- [ ] **Step 1: Implement asset sync cron handler**

```typescript
// src/app/api/cron/powerhub-assets/route.ts
import { NextResponse } from "next/server";
import { syncAssets } from "@/lib/powerhub-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  // Validate CRON_SECRET
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (process.env.POWERHUB_ENABLED !== "true") {
    return NextResponse.json({ skipped: true, reason: "POWERHUB_ENABLED is false" });
  }

  try {
    const result = await syncAssets();
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[powerhub-assets] Sync failed:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Implement telemetry poll cron handler**

```typescript
// src/app/api/cron/powerhub-telemetry/route.ts
import { NextResponse } from "next/server";
import { pollTelemetry } from "@/lib/powerhub-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (process.env.POWERHUB_ENABLED !== "true") {
    return NextResponse.json({ skipped: true, reason: "POWERHUB_ENABLED is false" });
  }

  try {
    const result = await pollTelemetry();
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[powerhub-telemetry] Poll failed:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
```

- [ ] **Step 3: Implement alert poll cron handler**

```typescript
// src/app/api/cron/powerhub-alerts/route.ts
import { NextResponse } from "next/server";
import { pollAlerts } from "@/lib/powerhub-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (process.env.POWERHUB_ENABLED !== "true") {
    return NextResponse.json({ skipped: true, reason: "POWERHUB_ENABLED is false" });
  }

  try {
    const result = await pollAlerts();
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[powerhub-alerts] Poll failed:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
```

- [ ] **Step 4: Commit cron handlers**

```bash
git add src/app/api/cron/powerhub-assets/ src/app/api/cron/powerhub-telemetry/ src/app/api/cron/powerhub-alerts/
git commit -m "feat(powerhub): add cron handlers for asset sync, telemetry, and alerts"
```

---

### Task 12: Data API Routes

**Files:**
- Create: `src/app/api/powerhub/sites/route.ts`
- Create: `src/app/api/powerhub/sites/[siteId]/route.ts`
- Create: `src/app/api/powerhub/sites/[siteId]/history/route.ts`
- Create: `src/app/api/powerhub/sites/[siteId]/alerts/route.ts`
- Create: `src/app/api/powerhub/fleet/route.ts`

- [ ] **Step 1: List sites route**

```typescript
// src/app/api/powerhub/sites/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.POWERHUB_ENABLED !== "true") {
    return NextResponse.json({ error: "PowerHub disabled" }, { status: 404 });
  }

  const sites = await prisma.powerhubSite.findMany({
    orderBy: { siteName: "asc" },
    include: {
      telemetrySnapshot: true,
      alerts: {
        where: { isActive: true },
        select: { id: true, severity: true, alertName: true },
      },
    },
  });

  return NextResponse.json({ sites });
}
```

- [ ] **Step 2: Site detail route**

```typescript
// src/app/api/powerhub/sites/[siteId]/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ siteId: string }> }
) {
  if (process.env.POWERHUB_ENABLED !== "true") {
    return NextResponse.json({ error: "PowerHub disabled" }, { status: 404 });
  }

  const { siteId } = await params;

  const site = await prisma.powerhubSite.findUnique({
    where: { siteId },
    include: {
      telemetrySnapshot: true,
      alerts: {
        where: { isActive: true },
        orderBy: { reportedAt: "desc" },
      },
    },
  });

  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  return NextResponse.json({ site });
}
```

- [ ] **Step 3: Telemetry history route**

```typescript
// src/app/api/powerhub/sites/[siteId]/history/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ siteId: string }> }
) {
  if (process.env.POWERHUB_ENABLED !== "true") {
    return NextResponse.json({ error: "PowerHub disabled" }, { status: 404 });
  }

  const { siteId } = await params;
  const url = new URL(request.url);
  const signals = url.searchParams.get("signals")?.split(",") || [];
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");

  const where: any = { siteId };
  if (signals.length > 0) {
    where.signalName = { in: signals };
  }
  if (start || end) {
    where.timestamp = {};
    if (start) where.timestamp.gte = new Date(start);
    if (end) where.timestamp.lte = new Date(end);
  }

  const history = await prisma.powerhubTelemetryHistory.findMany({
    where,
    orderBy: { timestamp: "desc" },
    take: 1000, // Cap at 1000 rows per request
  });

  return NextResponse.json({ history });
}
```

- [ ] **Step 4: Alert history route**

```typescript
// src/app/api/powerhub/sites/[siteId]/alerts/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ siteId: string }> }
) {
  if (process.env.POWERHUB_ENABLED !== "true") {
    return NextResponse.json({ error: "PowerHub disabled" }, { status: 404 });
  }

  const { siteId } = await params;

  const alerts = await prisma.powerhubAlert.findMany({
    where: { siteId },
    orderBy: { reportedAt: "desc" },
    take: 100,
  });

  return NextResponse.json({ alerts });
}
```

- [ ] **Step 5: Fleet aggregates route**

```typescript
// src/app/api/powerhub/fleet/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.POWERHUB_ENABLED !== "true") {
    return NextResponse.json({ error: "PowerHub disabled" }, { status: 404 });
  }

  const [siteCount, activeSites, snapshots, activeAlerts] = await Promise.all([
    prisma.powerhubSite.count(),
    prisma.powerhubSite.count({ where: { status: "ACTIVE" } }),
    prisma.powerhubTelemetrySnapshot.findMany({
      select: {
        solarPowerW: true,
        batterySocPercent: true,
        gridConnectedStatus: true,
      },
    }),
    prisma.powerhubAlert.count({ where: { isActive: true } }),
  ]);

  // Aggregate fleet metrics
  const totalSolarPowerW = snapshots.reduce(
    (sum, s) => sum + (s.solarPowerW || 0),
    0
  );
  const avgBatterySoc =
    snapshots.length > 0
      ? snapshots.reduce((sum, s) => sum + (s.batterySocPercent || 0), 0) /
        snapshots.filter((s) => s.batterySocPercent != null).length
      : null;
  const gridConnectedCount = snapshots.filter(
    (s) => s.gridConnectedStatus === "Grid Connected"
  ).length;

  return NextResponse.json({
    fleet: {
      totalSites: siteCount,
      activeSites,
      totalSolarPowerW,
      avgBatterySocPercent: avgBatterySoc ? Math.round(avgBatterySoc * 10) / 10 : null,
      gridConnectedCount,
      gridDisconnectedCount: activeSites - gridConnectedCount,
      activeAlertCount: activeAlerts,
    },
  });
}
```

- [ ] **Step 6: Commit data routes**

```bash
git add src/app/api/powerhub/
git commit -m "feat(powerhub): add data API routes (sites, fleet, history, alerts)"
```

---

### Task 13: Admin Action Routes

**Files:**
- Create: `src/app/api/powerhub/link/route.ts`
- Create: `src/app/api/powerhub/unlink/route.ts`
- Create: `src/app/api/powerhub/sync/route.ts`

- [ ] **Step 1: Manual link route (admin only)**

```typescript
// src/app/api/powerhub/link/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  if (process.env.POWERHUB_ENABLED !== "true") {
    return NextResponse.json({ error: "PowerHub disabled" }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user?.roles?.includes("ADMIN")) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { siteId, dealId } = await request.json();
  if (!siteId || !dealId) {
    return NextResponse.json({ error: "siteId and dealId required" }, { status: 400 });
  }

  const site = await prisma.powerhubSite.findUnique({
    where: { siteId },
  });
  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  await prisma.powerhubSite.update({
    where: { siteId },
    data: {
      dealId,
      linkMethod: "MANUAL",
      linkConfidence: "HIGH",
    },
  });

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: Unlink route (admin only)**

```typescript
// src/app/api/powerhub/unlink/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  if (process.env.POWERHUB_ENABLED !== "true") {
    return NextResponse.json({ error: "PowerHub disabled" }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user?.roles?.includes("ADMIN")) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { siteId } = await request.json();
  if (!siteId) {
    return NextResponse.json({ error: "siteId required" }, { status: 400 });
  }

  await prisma.powerhubSite.update({
    where: { siteId },
    data: {
      dealId: null,
      propertyId: null,
      linkMethod: "UNLINKED",
      linkConfidence: "LOW",
    },
  });

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 3: Manual sync trigger (admin only)**

```typescript
// src/app/api/powerhub/sync/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { syncAssets, pollTelemetry, pollAlerts } from "@/lib/powerhub-sync";

export async function POST(request: Request) {
  if (process.env.POWERHUB_ENABLED !== "true") {
    return NextResponse.json({ error: "PowerHub disabled" }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user?.roles?.includes("ADMIN")) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { type } = await request.json();

  try {
    let result;
    switch (type) {
      case "assets":
        result = await syncAssets();
        break;
      case "telemetry":
        result = await pollTelemetry();
        break;
      case "alerts":
        result = await pollAlerts();
        break;
      default:
        return NextResponse.json(
          { error: "type must be 'assets', 'telemetry', or 'alerts'" },
          { status: 400 }
        );
    }

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
```

- [ ] **Step 4: Commit admin routes**

```bash
git add src/app/api/powerhub/link/ src/app/api/powerhub/unlink/ src/app/api/powerhub/sync/
git commit -m "feat(powerhub): add admin action routes (link, unlink, sync)"
```

---

## Chunk 5: UI Components & Dashboard Pages

### Task 14: Fleet Dashboard Page

**Files:**
- Create: `src/app/dashboards/powerhub/page.tsx`
- Create: `src/components/powerhub/FleetTable.tsx`
- Create: `src/components/powerhub/SiteDetail.tsx`

- [ ] **Step 1: Create FleetTable component**

```tsx
// src/components/powerhub/FleetTable.tsx
"use client";

import { Fragment, useState } from "react";
import SiteDetail from "./SiteDetail";

interface PowerhubSiteRow {
  siteId: string;
  siteName: string;
  address: string;
  city: string;
  state: string;
  status: string;
  linkMethod: string;
  linkConfidence: string;
  dealId: string | null;
  totalBatteries: number;
  totalInverters: number;
  telemetrySnapshot: {
    solarPowerW: number | null;
    batterySocPercent: number | null;
    gridConnectedStatus: string | null;
  } | null;
  alerts: Array<{
    id: string;
    severity: string;
    alertName: string;
  }>;
}

interface FleetTableProps {
  sites: PowerhubSiteRow[];
  loading?: boolean;
}

export default function FleetTable({ sites, loading }: FleetTableProps) {
  const [expandedSiteId, setExpandedSiteId] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="animate-pulse space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-14 bg-surface rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-t-border text-left text-muted">
            <th className="pb-3 pr-4 font-medium">Site</th>
            <th className="pb-3 pr-4 font-medium">Location</th>
            <th className="pb-3 pr-4 font-medium">Solar</th>
            <th className="pb-3 pr-4 font-medium">Battery</th>
            <th className="pb-3 pr-4 font-medium">Grid</th>
            <th className="pb-3 pr-4 font-medium">Alerts</th>
            <th className="pb-3 font-medium">Link</th>
          </tr>
        </thead>
        <tbody>
          {sites.map((site) => {
            const snapshot = site.telemetrySnapshot;
            const isExpanded = expandedSiteId === site.siteId;
            const criticalAlerts = site.alerts.filter(
              (a) => a.severity === "CRITICAL"
            ).length;
            const perfAlerts = site.alerts.filter(
              (a) => a.severity === "PERFORMANCE"
            ).length;

            return (
              <Fragment key={site.siteId}>
                <tr
                  className="border-b border-t-border cursor-pointer hover:bg-surface transition-colors"
                  onClick={() =>
                    setExpandedSiteId(isExpanded ? null : site.siteId)
                  }
                >
                  <td className="py-3 pr-4">
                    <div className="font-medium text-foreground">
                      {site.siteName}
                    </div>
                    <div className="text-xs text-muted">{site.address}</div>
                  </td>
                  <td className="py-3 pr-4 text-muted">
                    {site.city}, {site.state}
                  </td>
                  <td className="py-3 pr-4">
                    {snapshot?.solarPowerW != null
                      ? `${(snapshot.solarPowerW / 1000).toFixed(1)} kW`
                      : "—"}
                  </td>
                  <td className="py-3 pr-4">
                    {snapshot?.batterySocPercent != null
                      ? `${Math.round(snapshot.batterySocPercent)}%`
                      : "—"}
                  </td>
                  <td className="py-3 pr-4">
                    {snapshot?.gridConnectedStatus === "Grid Connected" ? (
                      <span className="text-green-500">✓ On-grid</span>
                    ) : snapshot?.gridConnectedStatus ? (
                      <span className="text-red-500">⚠ Off-grid</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-3 pr-4">
                    {criticalAlerts > 0 && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 mr-1">
                        {criticalAlerts} Critical
                      </span>
                    )}
                    {perfAlerts > 0 && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                        {perfAlerts} Perf
                      </span>
                    )}
                    {site.alerts.length === 0 && (
                      <span className="text-muted">None</span>
                    )}
                  </td>
                  <td className="py-3">
                    {site.linkMethod === "UNLINKED" ? (
                      <span className="text-yellow-500 text-xs">Unlinked</span>
                    ) : (
                      <span className="text-green-500 text-xs">
                        ✓ {site.linkMethod}
                      </span>
                    )}
                  </td>
                </tr>
                {isExpanded && (
                  <tr>
                    <td colSpan={7} className="bg-surface-2 p-4">
                      <SiteDetail siteId={site.siteId} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

```

- [ ] **Step 2: Create SiteDetail component**

```tsx
// src/components/powerhub/SiteDetail.tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

interface SiteDetailProps {
  siteId: string;
}

export default function SiteDetail({ siteId }: SiteDetailProps) {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.powerhub.site(siteId),
    queryFn: async () => {
      const res = await fetch(`/api/powerhub/sites/${siteId}`);
      if (!res.ok) throw new Error("Failed to fetch site detail");
      return res.json();
    },
  });

  if (isLoading) {
    return <div className="animate-pulse h-32 bg-surface rounded" />;
  }

  const site = data?.site;
  if (!site) return <div className="text-muted">No data</div>;

  const snapshot = site.telemetrySnapshot;
  const devices = site.devices || [];

  return (
    <div className="space-y-4">
      {/* Telemetry snapshot */}
      {snapshot && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricBox label="Solar" value={formatPower(snapshot.solarPowerW)} />
          <MetricBox label="Battery SOC" value={formatPercent(snapshot.batterySocPercent)} />
          <MetricBox label="Grid" value={formatPower(snapshot.gridPowerW)} />
          <MetricBox label="Load" value={formatPower(snapshot.loadPowerW)} />
          <MetricBox label="Battery Mode" value={snapshot.batteryMode || "—"} />
          <MetricBox label="Grid Status" value={snapshot.gridConnectedStatus || "—"} />
        </div>
      )}

      {/* Active alerts */}
      {site.alerts?.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-foreground mb-2">Active Alerts</h4>
          <div className="space-y-1">
            {site.alerts.map((alert: any) => (
              <div
                key={alert.id}
                className="flex items-center gap-2 text-sm p-2 rounded bg-surface"
              >
                <SeverityBadge severity={alert.severity} />
                <span className="text-foreground">{alert.alertName}</span>
                <span className="text-muted text-xs ml-auto">
                  {alert.deviceId !== "site" ? `Device: ${alert.deviceId.slice(0, 8)}...` : "Site-level"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Device inventory */}
      <div>
        <h4 className="text-sm font-medium text-foreground mb-2">
          Devices ({devices.length})
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
          {devices.map((device: any, i: number) => (
            <div key={i} className="p-2 bg-surface rounded">
              <div className="font-medium capitalize">{device.device_type}</div>
              <div className="text-muted">
                {device.manufacturer} {device.model}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MetricBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-2 bg-surface rounded">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const colors = {
    CRITICAL: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    PERFORMANCE: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    INFORMATIONAL: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${colors[severity as keyof typeof colors] || colors.INFORMATIONAL}`}>
      {severity}
    </span>
  );
}

function formatPower(watts: number | null): string {
  if (watts == null) return "—";
  if (Math.abs(watts) >= 1000) return `${(watts / 1000).toFixed(1)} kW`;
  return `${Math.round(watts)} W`;
}

function formatPercent(pct: number | null): string {
  if (pct == null) return "—";
  return `${Math.round(pct)}%`;
}
```

- [ ] **Step 3: Create fleet dashboard page**

```tsx
// src/app/dashboards/powerhub/page.tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useSSE } from "@/hooks/useSSE";
import DashboardShell from "@/components/DashboardShell";
import { StatCard } from "@/components/ui/MetricCard";
import FleetTable from "@/components/powerhub/FleetTable";

export default function PowerHubDashboard() {
  const fleetQuery = useQuery({
    queryKey: queryKeys.powerhub.fleet(),
    queryFn: async () => {
      const res = await fetch("/api/powerhub/fleet");
      if (!res.ok) throw new Error("Failed to fetch fleet data");
      return res.json();
    },
  });

  const sitesQuery = useQuery({
    queryKey: queryKeys.powerhub.sites(),
    queryFn: async () => {
      const res = await fetch("/api/powerhub/sites");
      if (!res.ok) throw new Error("Failed to fetch sites");
      return res.json();
    },
  });

  // Real-time updates via SSE
  useSSE(
    () => {
      fleetQuery.refetch();
      sitesQuery.refetch();
    },
    { url: "/api/stream", cacheKeyFilter: "powerhub" }
  );

  const fleet = fleetQuery.data?.fleet;

  // Guard: feature flag
  if (process.env.NEXT_PUBLIC_POWERHUB_ENABLED !== "true") {
    return null;
  }

  return (
    <DashboardShell
      title="PowerHub Fleet Monitor"
      accentColor="cyan"
      lastUpdated={new Date().toISOString()}
      fullWidth
    >
      {/* Hero metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Fleet Solar"
          value={
            fleet?.totalSolarPowerW != null
              ? `${(fleet.totalSolarPowerW / 1000).toFixed(1)} kW`
              : "—"
          }
          color="cyan"
        />
        <StatCard
          label="Avg Battery SOC"
          value={
            fleet?.avgBatterySocPercent != null
              ? `${fleet.avgBatterySocPercent}%`
              : "—"
          }
          color="green"
        />
        <StatCard
          label="Sites Online"
          value={
            fleet
              ? `${fleet.gridConnectedCount} / ${fleet.totalSites}`
              : "—"
          }
          color="blue"
        />
        <StatCard
          label="Active Alerts"
          value={fleet?.activeAlertCount?.toString() || "0"}
          color={fleet?.activeAlertCount > 0 ? "red" : "green"}
        />
      </div>

      {/* Site table */}
      <div className="bg-surface rounded-xl p-4 shadow-card">
        <FleetTable
          sites={sitesQuery.data?.sites || []}
          loading={sitesQuery.isLoading}
        />
      </div>
    </DashboardShell>
  );
}
```

- [ ] **Step 4: Commit fleet dashboard**

```bash
git add src/app/dashboards/powerhub/ src/components/powerhub/FleetTable.tsx src/components/powerhub/SiteDetail.tsx
git commit -m "feat(powerhub): add fleet monitoring dashboard with expandable site table"
```

---

### Task 15: Admin Linkage Manager & System Health Embed

**Files:**
- Create: `src/app/dashboards/admin/powerhub/page.tsx`
- Create: `src/components/powerhub/SystemHealth.tsx`
- Create: `src/components/powerhub/SyncStatus.tsx`
- Create: `src/components/powerhub/LinkDialog.tsx`

- [ ] **Step 1: Create SyncStatus component**

```tsx
// src/components/powerhub/SyncStatus.tsx
"use client";

interface SyncStatusProps {
  lastAssetSync: string | null;
  lastTelemetryPoll: string | null;
  lastAlertPoll: string | null;
  onForceSync: (type: "assets" | "telemetry" | "alerts") => void;
  syncing: boolean;
}

export default function SyncStatus({
  lastAssetSync,
  lastTelemetryPoll,
  lastAlertPoll,
  onForceSync,
  syncing,
}: SyncStatusProps) {
  return (
    <div className="bg-surface rounded-xl p-4 shadow-card mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-foreground">Sync Status</h3>
        <button
          onClick={() => onForceSync("assets")}
          disabled={syncing}
          className="px-3 py-1.5 text-xs font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
        >
          {syncing ? "Syncing..." : "Force Sync All"}
        </button>
      </div>
      <div className="grid grid-cols-3 gap-4 text-sm">
        <SyncItem label="Assets" timestamp={lastAssetSync} />
        <SyncItem label="Telemetry" timestamp={lastTelemetryPoll} />
        <SyncItem label="Alerts" timestamp={lastAlertPoll} />
      </div>
    </div>
  );
}

function SyncItem({ label, timestamp }: { label: string; timestamp: string | null }) {
  const ago = timestamp ? formatRelativeTime(new Date(timestamp)) : "Never";
  const isRecent = timestamp && Date.now() - new Date(timestamp).getTime() < 30 * 60 * 1000;

  return (
    <div>
      <div className="text-muted text-xs">{label}</div>
      <div className={`font-medium ${isRecent ? "text-green-500" : "text-yellow-500"}`}>
        {ago} {isRecent ? "✓" : "⚠"}
      </div>
    </div>
  );
}

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
```

- [ ] **Step 2: Create LinkDialog component**

```tsx
// src/components/powerhub/LinkDialog.tsx
"use client";

import { useState } from "react";

interface LinkDialogProps {
  siteId: string;
  siteName: string;
  onClose: () => void;
  onLinked: () => void;
}

export default function LinkDialog({ siteId, siteName, onClose, onLinked }: LinkDialogProps) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [linking, setLinking] = useState(false);

  async function handleSearch() {
    if (!search.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/deals/search?q=${encodeURIComponent(search)}&limit=10`);
      const data = await res.json();
      setResults(data.deals || []);
    } finally {
      setSearching(false);
    }
  }

  async function handleLink(dealId: string) {
    setLinking(true);
    try {
      const res = await fetch("/api/powerhub/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId, dealId }),
      });
      if (res.ok) {
        onLinked();
        onClose();
      }
    } finally {
      setLinking(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-surface-elevated rounded-xl p-6 w-full max-w-lg shadow-xl">
        <h3 className="text-lg font-medium text-foreground mb-1">
          Link Site to Deal
        </h3>
        <p className="text-sm text-muted mb-4">{siteName}</p>

        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Search deals by name, address, or ID..."
            className="flex-1 px-3 py-2 bg-surface border border-t-border rounded-lg text-sm text-foreground placeholder-muted"
          />
          <button
            onClick={handleSearch}
            disabled={searching}
            className="px-4 py-2 bg-cyan-600 text-white text-sm rounded-lg hover:bg-cyan-700 disabled:opacity-50"
          >
            {searching ? "..." : "Search"}
          </button>
        </div>

        {results.length > 0 && (
          <div className="max-h-64 overflow-y-auto space-y-2 mb-4">
            {results.map((deal: any) => (
              <div
                key={deal.id}
                className="flex items-center justify-between p-3 bg-surface rounded-lg"
              >
                <div>
                  <div className="text-sm font-medium text-foreground">
                    {deal.dealname || deal.name}
                  </div>
                  <div className="text-xs text-muted">
                    {deal.property_address || "No address"}
                  </div>
                </div>
                <button
                  onClick={() => handleLink(String(deal.id))}
                  disabled={linking}
                  className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                >
                  Link
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create SystemHealth component (Customer 360 embed)**

```tsx
// src/components/powerhub/SystemHealth.tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

interface SystemHealthProps {
  siteId: string;
}

/**
 * Embedded system health panel for Customer 360 view.
 * Shows solar production, battery SOC, grid status, and active alerts
 * for a linked PowerHub site.
 */
export default function SystemHealth({ siteId }: SystemHealthProps) {
  const enabled = process.env.NEXT_PUBLIC_POWERHUB_ENABLED === "true";

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.powerhub.site(siteId),
    queryFn: async () => {
      const res = await fetch(`/api/powerhub/sites/${siteId}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled, // Don't fetch when feature is disabled
    retry: false, // Don't retry if site doesn't exist
  });

  if (!enabled) return null;

  if (isLoading) {
    return (
      <div className="animate-pulse h-24 bg-surface rounded-lg" />
    );
  }

  if (!data?.site) return null;

  const site = data.site;
  const snapshot = site.telemetrySnapshot;
  const activeAlerts = site.alerts || [];

  return (
    <div className="bg-surface rounded-xl p-4 shadow-card">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-cyan-500">⚡</span>
        <h4 className="text-sm font-medium text-foreground">
          System Health — {site.siteName}
        </h4>
      </div>

      {snapshot ? (
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div className="text-center">
            <div className="text-xs text-muted">Solar</div>
            <div className="text-sm font-medium text-foreground">
              {snapshot.solarPowerW != null
                ? `${(snapshot.solarPowerW / 1000).toFixed(1)} kW`
                : "—"}
            </div>
          </div>
          <div className="text-center">
            <div className="text-xs text-muted">Battery</div>
            <div className="text-sm font-medium text-foreground">
              {snapshot.batterySocPercent != null
                ? `${Math.round(snapshot.batterySocPercent)}%`
                : "—"}
            </div>
          </div>
          <div className="text-center">
            <div className="text-xs text-muted">Grid</div>
            <div className="text-sm font-medium text-foreground">
              {snapshot.gridConnectedStatus === "Grid Connected"
                ? "Connected"
                : "Disconnected"}
            </div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted mb-3">No telemetry data yet</p>
      )}

      {activeAlerts.length > 0 && (
        <div className="border-t border-t-border pt-2">
          <div className="text-xs text-yellow-500">
            ⚠ {activeAlerts.length} active alert{activeAlerts.length !== 1 ? "s" : ""}:{" "}
            {activeAlerts.map((a: any) => a.alertName).join(", ")}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create admin linkage manager page**

```tsx
// src/app/dashboards/admin/powerhub/page.tsx
"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import DashboardShell from "@/components/DashboardShell";
import SyncStatus from "@/components/powerhub/SyncStatus";
import LinkDialog from "@/components/powerhub/LinkDialog";

export default function AdminPowerHubPage() {
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [linkTarget, setLinkTarget] = useState<{
    siteId: string;
    siteName: string;
  } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.powerhub.sites(),
    queryFn: async () => {
      const res = await fetch("/api/powerhub/sites");
      if (!res.ok) throw new Error("Failed to fetch sites");
      return res.json();
    },
  });

  async function handleForceSync(type: "assets" | "telemetry" | "alerts") {
    setSyncing(true);
    try {
      await fetch("/api/powerhub/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.powerhub.root });
    } finally {
      setSyncing(false);
    }
  }

  async function handleUnlink(siteId: string) {
    await fetch("/api/powerhub/unlink", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteId }),
    });
    queryClient.invalidateQueries({ queryKey: queryKeys.powerhub.root });
  }

  const sites = data?.sites || [];

  // Derive sync timestamps from newest site data
  const lastAssetSync = sites[0]?.lastAssetSyncAt || null;
  const lastTelemetryPoll = sites.reduce(
    (latest: string | null, s: any) =>
      s.lastTelemetryAt && (!latest || s.lastTelemetryAt > latest)
        ? s.lastTelemetryAt
        : latest,
    null
  );
  const lastAlertPoll = sites.reduce(
    (latest: string | null, s: any) =>
      s.lastAlertCheckAt && (!latest || s.lastAlertCheckAt > latest)
        ? s.lastAlertCheckAt
        : latest,
    null
  );

  if (process.env.NEXT_PUBLIC_POWERHUB_ENABLED !== "true") {
    return null;
  }

  return (
    <DashboardShell title="PowerHub Site Linkage" accentColor="purple">
      <SyncStatus
        lastAssetSync={lastAssetSync}
        lastTelemetryPoll={lastTelemetryPoll}
        lastAlertPoll={lastAlertPoll}
        onForceSync={handleForceSync}
        syncing={syncing}
      />

      <div className="bg-surface rounded-xl p-4 shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-t-border text-left text-muted">
              <th className="pb-3 pr-4 font-medium">Site</th>
              <th className="pb-3 pr-4 font-medium">Address</th>
              <th className="pb-3 pr-4 font-medium">Linked Deal</th>
              <th className="pb-3 pr-4 font-medium">Method</th>
              <th className="pb-3 pr-4 font-medium">Confidence</th>
              <th className="pb-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sites.map((site: any) => (
              <tr
                key={site.siteId}
                className="border-b border-t-border"
              >
                <td className="py-3 pr-4 font-medium text-foreground">
                  {site.siteName}
                </td>
                <td className="py-3 pr-4 text-muted">
                  {site.address}, {site.city}, {site.state}
                </td>
                <td className="py-3 pr-4">
                  {site.dealId ? (
                    <span className="text-foreground">Deal #{site.dealId}</span>
                  ) : (
                    <span className="text-yellow-500">— UNLINKED —</span>
                  )}
                </td>
                <td className="py-3 pr-4 text-muted">{site.linkMethod}</td>
                <td className="py-3 pr-4 text-muted">{site.linkConfidence}</td>
                <td className="py-3">
                  {site.linkMethod === "UNLINKED" ? (
                    <button
                      onClick={() =>
                        setLinkTarget({
                          siteId: site.siteId,
                          siteName: site.siteName,
                        })
                      }
                      className="px-2 py-1 text-xs bg-cyan-600 text-white rounded hover:bg-cyan-700"
                    >
                      Link
                    </button>
                  ) : (
                    <button
                      onClick={() => handleUnlink(site.siteId)}
                      className="px-2 py-1 text-xs text-red-500 hover:text-red-400"
                    >
                      Unlink
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {isLoading && (
          <div className="text-center py-8 text-muted">Loading sites...</div>
        )}
        {!isLoading && sites.length === 0 && (
          <div className="text-center py-8 text-muted">
            No PowerHub sites synced yet. Run an asset sync to discover sites.
          </div>
        )}
      </div>

      {linkTarget && (
        <LinkDialog
          siteId={linkTarget.siteId}
          siteName={linkTarget.siteName}
          onClose={() => setLinkTarget(null)}
          onLinked={() =>
            queryClient.invalidateQueries({ queryKey: queryKeys.powerhub.root })
          }
        />
      )}
    </DashboardShell>
  );
}
```

- [ ] **Step 5: Commit admin page and remaining components**

```bash
git add src/app/dashboards/admin/powerhub/ src/components/powerhub/
git commit -m "feat(powerhub): add admin linkage manager, SystemHealth embed, and supporting components"
```

---

### Task 16: Suite Landing Page Cards

**Files:**
- Modify: `src/app/suites/service/page.tsx`
- Modify: `src/app/suites/design-engineering/page.tsx`

- [ ] **Step 1: Add PowerHub card to Service Suite**

In `src/app/suites/service/page.tsx`, add a card entry to the suite's cards array (follow the existing card pattern in the file):

```tsx
{
  title: "PowerHub Fleet Monitor",
  description: "Tesla system health, solar production, and battery status across all sites",
  href: "/dashboards/powerhub",
  icon: "⚡",
  accentColor: "cyan",
  enabled: process.env.NEXT_PUBLIC_POWERHUB_ENABLED === "true",
}
```

Wrap the card in a conditional: only render if `process.env.NEXT_PUBLIC_POWERHUB_ENABLED === "true"`.

- [ ] **Step 2: Add PowerHub card to D&E Suite**

Same pattern in `src/app/suites/design-engineering/page.tsx`:

```tsx
{
  title: "PowerHub Fleet Monitor",
  description: "Monitor installed Tesla systems — production validation and system health",
  href: "/dashboards/powerhub",
  icon: "⚡",
  accentColor: "cyan",
  enabled: process.env.NEXT_PUBLIC_POWERHUB_ENABLED === "true",
}
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/suites/service/page.tsx src/app/suites/design-engineering/page.tsx
git commit -m "feat(powerhub): add fleet dashboard card to Service and D&E suite pages"
```

---

### Task 17: Final Integration Test & Cleanup

- [ ] **Step 1: Run full test suite**

Run: `npx jest --no-coverage`
Expected: All tests pass.

- [ ] **Step 2: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Run linter**

Run: `npx eslint src/lib/tesla-powerhub.ts src/lib/powerhub-linkage.ts src/lib/powerhub-sync.ts src/app/api/powerhub/ src/app/api/cron/powerhub-* src/app/dashboards/powerhub/ src/components/powerhub/ --fix`
Expected: No errors (warnings acceptable).

- [ ] **Step 4: Verify feature flag gating**

With `POWERHUB_ENABLED=false`:
- All API routes should return 404
- Cron handlers should return `{ skipped: true }`
- UI components should render null

- [ ] **Step 5: Final commit (if any lint fixes)**

```bash
git add -A
git commit -m "chore(powerhub): lint fixes and final cleanup"
```

---

## Summary

| Chunk | Tasks | What it delivers |
|-------|-------|-----------------|
| 1 | 1–4 | Database schema, middleware, roles, query keys, vercel.json |
| 2 | 5–6 | Tesla API client with auth, rate limiting, error handling |
| 3 | 7–10 | Linkage logic, sync orchestration, priority queue integration |
| 4 | 11–13 | Cron handlers + all 8 API routes |
| 5 | 14–17 | Fleet dashboard, admin page, System Health embed, suite cards |

**Total commits:** ~15 incremental commits following TDD pattern.

**Prerequisites before going live:**
1. mTLS certificate from Tesla (manual process)
2. mTLS proxy deployed with static IP
3. `POWERHUB_ENABLED` env vars set in Vercel
4. First asset sync run manually via admin UI
