# Enphase Enlighten API Integration — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Enphase Enlighten monitoring API integration at full parity with Tesla PowerHub — API client, Prisma models, crosslink propagation, HubSpot card, cron sync, OAuth setup.

**Architecture:** Mirror the existing PowerHub modules (`tesla-powerhub.ts`, `powerhub-crosslink.ts`, `powerhub-sync.ts`) with Enphase-specific counterparts. Separate `enphase_*` columns on `HubSpotPropertyCache`. DB-based refresh token persistence for OAuth2 token rotation.

**Tech Stack:** Next.js 16 API routes, Prisma 7 (Neon Postgres), Enphase v4 REST API (OAuth2 auth-code), HubSpot CRM API, Jest for testing.

**Spec:** `docs/superpowers/specs/2026-05-21-enphase-enlighten-integration-design.md`

---

## Chunk 1: Schema + API Client + Tests

### Task 1: Prisma Schema — Enums and EnphaseSite Model

**Files:**
- Modify: `prisma/schema.prisma`

Reference: Existing `PowerhubSite` model at line ~4250, `PowerhubLinkMethod`/`PowerhubLinkConfidence` enums at line ~4219 in `prisma/schema.prisma`.

- [ ] **Step 1: Add ENPHASE_STATUS_CHANGE to ActivityType enum and Enphase enums to schema.prisma**

Add `ENPHASE_STATUS_CHANGE` to the `ActivityType` enum (before the closing `}`, around line 312):

```prisma
  // Enphase Enlighten
  ENPHASE_STATUS_CHANGE
```

Then add after the `PowerhubTelemetrySource` enum (around line 4248):

```prisma
// ─── Enphase Enlighten ──────────────────────────────────────────────────────

enum EnphaseLinkMethod {
  PROPERTY
  ADDRESS_MATCH
  MANUAL
  GEO
  UNLINKED
}

enum EnphaseLinkConfidence {
  HIGH
  MEDIUM
  LOW
}
```

- [ ] **Step 2: Add EnphaseSite model**

Add after the enums:

```prisma
model EnphaseSite {
  id               String  @id @default(cuid())
  systemId         Int     @unique
  systemName       String
  systemPublicName String?

  portalUrl          String?
  primaryForProperty Boolean @default(false)

  address     String
  city        String
  state       String
  zip         String?
  addressHash String?

  propertyId     String?
  property       HubSpotPropertyCache? @relation(fields: [propertyId], references: [id])
  dealId         String?
  linkMethod     EnphaseLinkMethod     @default(UNLINKED)
  linkConfidence EnphaseLinkConfidence @default(LOW)

  modules        Int      @default(0)
  systemSizeW    Float?
  timezone       String?
  connectionType String?
  envoySerial    String?
  status         String   @default("normal")
  operationalAt  DateTime?

  latitude       Float?
  longitude      Float?
  linkDistanceM  Float?

  devices            Json    @default("[]")
  microinverterCount Int     @default(0)
  batteryCount       Int     @default(0)

  lastAssetSyncAt     DateTime
  lastTelemetrySyncAt DateTime?
  lastStatusCheckAt   DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  telemetrySnapshot EnphaseTelemetrySnapshot?
  telemetryHistory  EnphaseTelemetryHistory[]

  @@index([addressHash])
  @@index([propertyId])
  @@index([dealId])
  @@index([status])
  @@index([latitude, longitude])
}
```

- [ ] **Step 3: Add EnphaseTelemetrySnapshot model**

```prisma
model EnphaseTelemetrySnapshot {
  id       String      @id @default(cuid())
  systemId Int         @unique
  site     EnphaseSite @relation(fields: [systemId], references: [systemId])

  timestamp DateTime

  currentProductionW    Float?
  todayProductionWh     Float?
  lifetimeProductionWh  Float?
  lastDayProductionWh   Float?

  currentConsumptionW   Float?
  todayConsumptionWh    Float?
  lifetimeConsumptionWh Float?

  batteryPercentCharge  Float?
  batteryCapacityWh     Float?
  batteryChargeW        Float?

  gridImportW           Float?
  gridExportW           Float?

  systemStatus          String?
  microReportingCount   Int?
  microTotalCount       Int?
  lastReportAt          DateTime?

  raw Json?

  updatedAt DateTime @updatedAt
}
```

- [ ] **Step 4: Add EnphaseTelemetryHistory model**

```prisma
model EnphaseTelemetryHistory {
  id       String      @id @default(cuid())
  systemId Int
  site     EnphaseSite @relation(fields: [systemId], references: [systemId])

  timestamp   DateTime
  signalName  String
  value       Float?
  valueString String?
  source      String   @default("POLL")

  @@index([systemId, signalName, timestamp])
  @@index([systemId, timestamp])
}
```

- [ ] **Step 5: Add enphase columns to HubSpotPropertyCache**

Find the Tesla PowerHub denormalized fields block (after `teslaHardwareSummary String?`, around line 861) and add below it:

```prisma
  // Enphase Enlighten denormalized fields (populated from primary EnphaseSite)
  enphasePortalUrl       String?
  enphaseSystemId        String?
  enphaseEnvoySerial     String?
  enphaseMicroCount      String?
  enphaseBatterySerials  String?
  enphaseBatteryModel    String?
  enphaseSystemSize      String?
  enphaseHardwareSummary String?
```

- [ ] **Step 6: Add enphaseSites relation to HubSpotPropertyCache**

Find the `powerhubSites PowerhubSite[]` relation (around line 872) and add below it:

```prisma
  enphaseSites     EnphaseSite[]
```

- [ ] **Step 7: Run prisma format and validate**

Run: `npx prisma format && npx prisma validate`
Expected: "Your schema is valid" — no errors.

- [ ] **Step 8: Generate migration**

Run: `npx prisma migrate dev --name enphase_models --create-only`
Expected: Creates `prisma/migrations/YYYYMMDD_enphase_models/migration.sql`

- [ ] **Step 9: Add partial unique index to migration SQL**

Open the generated migration file and append at the end:

```sql
-- Partial unique index: at most one primary EnphaseSite per property
CREATE UNIQUE INDEX "EnphaseSite_primary_per_property"
  ON "EnphaseSite" ("propertyId")
  WHERE "primaryForProperty" = true AND "propertyId" IS NOT NULL;
```

Reference: PowerHub has an identical index `PowerhubSite_primary_per_property` — search the existing migrations for the pattern.

- [ ] **Step 10: Apply migration locally**

Run: `npx prisma migrate dev`
Expected: Migration applies successfully, client regenerates.

- [ ] **Step 11: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(enphase): add Prisma schema — EnphaseSite, telemetry models, HubSpotPropertyCache columns"
```

---

### Task 2: API Client — Types and Token Management

**Files:**
- Create: `src/lib/enphase-enlighten.ts`
- Test: `src/__tests__/lib/enphase-enlighten.test.ts`

Reference: `src/lib/tesla-powerhub.ts` for the client pattern (TokenBucket, apiCall wrapper, typed envelope unwrapping).

- [ ] **Step 1: Write the failing test for computeEnphasePortalUrl**

Create `src/__tests__/lib/enphase-enlighten.test.ts`:

```typescript
import { computeEnphasePortalUrl } from "@/lib/enphase-enlighten";

describe("computeEnphasePortalUrl", () => {
  let savedTemplate: string | undefined;
  beforeEach(() => {
    savedTemplate = process.env.ENPHASE_PORTAL_URL_TEMPLATE;
  });
  afterEach(() => {
    if (savedTemplate === undefined) {
      delete process.env.ENPHASE_PORTAL_URL_TEMPLATE;
    } else {
      process.env.ENPHASE_PORTAL_URL_TEMPLATE = savedTemplate;
    }
  });

  it("uses the default Enlighten URL when env var is unset", () => {
    delete process.env.ENPHASE_PORTAL_URL_TEMPLATE;
    expect(computeEnphasePortalUrl(12345)).toBe(
      "https://enlighten.enphaseenergy.com/systems/12345"
    );
  });

  it("uses the configured template when env var is set", () => {
    process.env.ENPHASE_PORTAL_URL_TEMPLATE = "https://custom.com/sys/{systemId}/view";
    expect(computeEnphasePortalUrl(99999)).toBe("https://custom.com/sys/99999/view");
  });

  it("returns null for 0 systemId", () => {
    expect(computeEnphasePortalUrl(0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/lib/enphase-enlighten.test.ts --no-coverage -t "computeEnphasePortalUrl"`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the API client with types and portal URL**

Create `src/lib/enphase-enlighten.ts`:

```typescript
/**
 * Enphase Enlighten API Client
 *
 * Handles OAuth2 authorization code grant with refresh token rotation,
 * rate limiting, and typed endpoint wrappers for the Enphase v4 API.
 *
 * Architecture:
 * - Optional Fly.io proxy via ENPHASE_PROXY_URL (for IP allowlisting)
 * - Auth uses OAuth2 authorization code grant (installer account)
 * - Refresh tokens rotate: each refresh returns a NEW token that must be persisted
 * - Refresh token stored in SystemConfig DB row (not env var) for cold-start safety
 * - Token bucket rate limiter stays under Enphase's ~10 req/sec limit
 * - Data endpoints live under /api/v4/ prefix
 *
 * Required env vars:
 * - ENPHASE_API_KEY           — API key from Enphase developer portal
 * - ENPHASE_CLIENT_ID         — OAuth app client ID
 * - ENPHASE_CLIENT_SECRET     — OAuth app client secret
 * - ENPHASE_REFRESH_TOKEN     — Initial seed refresh token (DB takes precedence after first use)
 *
 * Optional env vars:
 * - ENPHASE_PROXY_URL         — Fly.io proxy URL (omit to call api.enphaseenergy.com directly)
 * - ENPHASE_PORTAL_URL_TEMPLATE — Portal deep-link template (default: Enlighten URL)
 */

import { prisma } from "@/lib/db";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EnphaseSystem {
  system_id: number;
  system_name: string;
  system_public_name: string;
  status: string;
  timezone: string;
  connection_type: string;
  meta: {
    enroll_date: string;
    operational_date: string;
    last_report_date: string;
    last_energy_at: number;
    operational_at: number;
  };
  energy_lifetime: number;
  energy_today: number;
  system_size: number; // watts DC
  address: {
    state: string;
    country: string;
    postal_code: string;
    city?: string;
    address1?: string;
    address2?: string;
  };
  modules: number;
}

export interface EnphaseSystemSummary {
  system_id: number;
  current_power: number;       // watts
  energy_lifetime: number;     // Wh
  energy_today: number;        // Wh
  last_report_at: number;      // Unix epoch
  status: string;
  modules: number;
  size_w: number;
  summary_date: string;
  last_interval_end_at: number;
  // Consumption (if CT meters present)
  current_consumption?: number;
  consumption_today?: number;
  consumption_lifetime?: number;
}

export interface EnphaseDevices {
  micro_inverters?: EnphaseMicroInverter[];
  batteries?: EnphaseBattery[];
  encharges?: EnphaseEncharge[];
  enpower?: EnphaseEnpower[];
  meters?: EnphaseMeter[];
}

export interface EnphaseMicroInverter {
  id: number;
  serial_number: string;
  model: string;
  part_number: string;
  status: string;
  last_report_date: string;
  producing: boolean;
}

export interface EnphaseBattery {
  serial_number: string;
  model: string;
  part_number: string;
  status: string;
  last_report_date: string;
  percent_full: number;
}

export interface EnphaseEncharge {
  serial_number: string;
  model: string;
  part_number: string;
  status: string;
  last_report_date: string;
  percent_full: number;
}

export interface EnphaseEnpower {
  serial_number: string;
  model: string;
  part_number: string;
  status: string;
  last_report_date: string;
}

export interface EnphaseMeter {
  serial_number: string;
  model: string;
  status: string;
  state: string;
}

export interface EnphaseProductionStats {
  system_id: number;
  granularity: string;
  intervals: { end_at: number; wh_del: number; devices_reporting: number }[];
  meta: { status: string; last_report_at: number };
}

export interface EnphaseConsumptionStats {
  system_id: number;
  granularity: string;
  intervals: { end_at: number; wh_del: number; devices_reporting: number }[];
}

export interface EnphaseBatteryTelemetry {
  system_id: number;
  intervals: {
    end_at: number;
    charge_energy_wh: number;
    discharge_energy_wh: number;
    soc: number;
  }[];
}

export interface EnphaseBatteryLifetime {
  system_id: number;
  start_date: string;
  charge_energy_wh: number[];
  discharge_energy_wh: number[];
}

export interface EnphaseClient {
  listSystems(): Promise<EnphaseSystem[]>;
  getSystemSummary(systemId: number): Promise<EnphaseSystemSummary>;
  getSystemDevices(systemId: number): Promise<EnphaseDevices>;
  getProductionStats(systemId: number): Promise<EnphaseProductionStats>;
  getConsumptionStats(systemId: number): Promise<EnphaseConsumptionStats>;
  getBatteryTelemetry(systemId: number): Promise<EnphaseBatteryTelemetry>;
  getBatteryLifetime(systemId: number): Promise<EnphaseBatteryLifetime>;
}

// ─── Rate Limiter ────────────────────────────────────────────────────────────

class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number;

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

// ─── Token Persistence ──────────────────────────────────────────────────────

const REFRESH_TOKEN_KEY = "enphase_refresh_token";

/**
 * Read the current refresh token. Priority: DB SystemConfig → env var fallback.
 */
async function readRefreshToken(): Promise<string | null> {
  try {
    const row = await prisma.systemConfig.findUnique({ where: { key: REFRESH_TOKEN_KEY } });
    if (row?.value) return row.value;
  } catch {
    // DB read failure — fall through to env
  }
  return process.env.ENPHASE_REFRESH_TOKEN || null;
}

/**
 * Persist a new refresh token to DB. Called after every successful token refresh
 * because Enphase rotates refresh tokens (old one is invalidated).
 */
async function persistRefreshToken(token: string): Promise<void> {
  await prisma.systemConfig.upsert({
    where: { key: REFRESH_TOKEN_KEY },
    create: { key: REFRESH_TOKEN_KEY, value: token },
    update: { value: token },
  });
}

// ─── Client Implementation ───────────────────────────────────────────────────

interface CachedToken {
  accessToken: string;
  expiresAt: number; // Unix ms
}

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 500;
const ENPHASE_API_BASE = "https://api.enphaseenergy.com";

export function createEnphaseClient(): EnphaseClient {
  if (process.env.ENPHASE_ENABLED !== "true") {
    throw new Error("Enphase is disabled (ENPHASE_ENABLED != true)");
  }

  const apiKey = process.env.ENPHASE_API_KEY;
  const clientId = process.env.ENPHASE_CLIENT_ID;
  const clientSecret = process.env.ENPHASE_CLIENT_SECRET;

  if (!apiKey || !clientId || !clientSecret) {
    throw new Error(
      "Missing Enphase env vars: ENPHASE_API_KEY, ENPHASE_CLIENT_ID, ENPHASE_CLIENT_SECRET"
    );
  }

  const baseUrl = process.env.ENPHASE_PROXY_URL || ENPHASE_API_BASE;
  let cachedToken: CachedToken | null = null;
  let tokenPromise: Promise<string> | null = null;
  const rateLimiter = new TokenBucket(8);

  async function getToken(): Promise<string> {
    if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
      return cachedToken.accessToken;
    }

    if (tokenPromise) return tokenPromise;

    tokenPromise = (async () => {
      try {
        const refreshToken = await readRefreshToken();
        if (!refreshToken) {
          throw new Error(
            "No Enphase refresh token available. Run the OAuth setup flow at /api/admin/enphase/oauth/authorize"
          );
        }

        const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
        const res = await fetch(`${ENPHASE_API_BASE}/oauth/token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${basicAuth}`,
          },
          body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
        });

        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Enphase token refresh failed: ${res.status} ${body}`);
        }

        const data = await res.json();
        const accessToken: string = data.access_token;
        const newRefreshToken: string = data.refresh_token;

        // Persist the rotated refresh token — old one is now invalid
        await persistRefreshToken(newRefreshToken);

        // Cache access token with expiry
        const expiresIn = (data.expires_in || 43200) * 1000; // default 12hr
        cachedToken = { accessToken, expiresAt: Date.now() + expiresIn };

        return accessToken;
      } finally {
        tokenPromise = null;
      }
    })();

    return tokenPromise;
  }

  function clearToken(): void {
    cachedToken = null;
  }

  async function apiCall<T>(path: string, options?: RequestInit): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await rateLimiter.acquire();

      const token = await getToken();
      const separator = path.includes("?") ? "&" : "?";
      const url = `${baseUrl}${path}${separator}key=${apiKey}`;

      const res = await fetch(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...options?.headers,
        },
      });

      if (res.ok) {
        return (await res.json()) as T;
      }

      if (res.status === 401 && attempt === 0) {
        clearToken();
        continue;
      }

      if (res.status === 403) {
        throw new Error(`Enphase API 403 Forbidden: ${path}`);
      }

      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`Enphase API ${res.status}: ${path}`);
        if (attempt < MAX_RETRIES) {
          const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, backoff));
          continue;
        }
      }

      throw new Error(`Enphase API ${res.status}: ${await res.text()}`);
    }

    throw lastError || new Error("Enphase API: max retries exceeded");
  }

  // ─── Endpoint Wrappers ─────────────────────────────────────────────────────

  return {
    async listSystems() {
      // Enphase paginates with ?next= cursor
      const all: EnphaseSystem[] = [];
      let next: string | undefined;
      do {
        const path = next
          ? `/api/v4/systems?next=${next}`
          : "/api/v4/systems";
        const page = await apiCall<{ systems: EnphaseSystem[]; next?: string }>(path);
        all.push(...(page.systems || []));
        next = page.next;
      } while (next);
      return all;
    },

    async getSystemSummary(systemId: number) {
      return apiCall<EnphaseSystemSummary>(`/api/v4/systems/${systemId}/summary`);
    },

    async getSystemDevices(systemId: number) {
      return apiCall<EnphaseDevices>(`/api/v4/systems/${systemId}/devices`);
    },

    async getProductionStats(systemId: number) {
      return apiCall<EnphaseProductionStats>(
        `/api/v4/systems/${systemId}/telemetry/production_meter`
      );
    },

    async getConsumptionStats(systemId: number) {
      return apiCall<EnphaseConsumptionStats>(
        `/api/v4/systems/${systemId}/telemetry/consumption_meter`
      );
    },

    async getBatteryTelemetry(systemId: number) {
      return apiCall<EnphaseBatteryTelemetry>(
        `/api/v4/systems/${systemId}/telemetry/battery`
      );
    },

    async getBatteryLifetime(systemId: number) {
      return apiCall<EnphaseBatteryLifetime>(
        `/api/v4/systems/${systemId}/battery_lifetime`
      );
    },
  };
}

/**
 * Compute the Enlighten portal deep-link URL for a system.
 */
export function computeEnphasePortalUrl(systemId: number): string | null {
  if (!systemId) return null;
  const template =
    process.env.ENPHASE_PORTAL_URL_TEMPLATE ||
    "https://enlighten.enphaseenergy.com/systems/{systemId}";
  return template.replaceAll("{systemId}", String(systemId));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/lib/enphase-enlighten.test.ts --no-coverage`
Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/enphase-enlighten.ts src/__tests__/lib/enphase-enlighten.test.ts
git commit -m "feat(enphase): add API client with OAuth2 token rotation, rate limiter, typed endpoints"
```

---

### Task 3: Crosslink Module — Device Summary + Primary Site Selection

**Files:**
- Create: `src/lib/enphase-crosslink.ts`
- Test: `src/__tests__/lib/enphase-crosslink.test.ts`

Reference: `src/lib/powerhub-crosslink.ts` for the exact crosslink cascade pattern. `src/__tests__/lib/powerhub-crosslink.test.ts` for testing patterns with mocked Prisma.

- [ ] **Step 1: Write failing tests for buildEnphaseDeviceSummary**

Create `src/__tests__/lib/enphase-crosslink.test.ts`:

```typescript
import {
  buildEnphaseDeviceSummary,
  pickPrimaryEnphaseSite,
} from "@/lib/enphase-crosslink";

describe("buildEnphaseDeviceSummary", () => {
  it("extracts envoy, micros, and batteries from devices JSON", () => {
    const devices = {
      micro_inverters: [
        { serial_number: "MI001", model: "IQ8PLUS-72-2-US", part_number: "800-01968-r02" },
        { serial_number: "MI002", model: "IQ8PLUS-72-2-US", part_number: "800-01968-r02" },
      ],
      encharges: [
        { serial_number: "BAT001", model: "ENCHARGE-10T-1P-NA", part_number: "830-01760-r33" },
      ],
      enpower: [
        { serial_number: "ENV001", model: "IQ Combiner 4C", part_number: "800-01763-r06" },
      ],
    };
    const summary = buildEnphaseDeviceSummary(devices);
    expect(summary.envoySerial).toBe("ENV001");
    expect(summary.envoyModel).toBe("IQ Combiner 4C");
    expect(summary.microModel).toBe("IQ8PLUS-72-2-US");
    expect(summary.microCount).toBe(2);
    expect(summary.batterySerials).toBe("BAT001");
    expect(summary.batteryModel).toBe("ENCHARGE-10T-1P-NA");
    expect(summary.formatted).toContain("Envoy: ENV001");
    expect(summary.formatted).toContain("2× IQ8PLUS-72-2-US");
    expect(summary.formatted).toContain("Battery: BAT001");
  });

  it("returns nulls for empty devices", () => {
    const summary = buildEnphaseDeviceSummary({});
    expect(summary.envoySerial).toBeNull();
    expect(summary.microCount).toBe(0);
    expect(summary.formatted).toBeNull();
  });

  it("semicolon-joins multiple battery serials", () => {
    const devices = {
      encharges: [
        { serial_number: "B1", model: "ENCHARGE-10T", part_number: "x" },
        { serial_number: "B2", model: "ENCHARGE-10T", part_number: "x" },
      ],
    };
    const summary = buildEnphaseDeviceSummary(devices);
    expect(summary.batterySerials).toBe("B1; B2");
  });
});

describe("pickPrimaryEnphaseSite", () => {
  const makeSite = (overrides: Partial<{
    id: string;
    systemName: string;
    operationalAt: Date | null;
    createdAt: Date;
  }>) => ({
    id: overrides.id || "site1",
    systemName: overrides.systemName || "Test System",
    operationalAt: overrides.operationalAt ?? null,
    createdAt: overrides.createdAt || new Date("2024-01-01"),
  });

  it("returns null for empty array", () => {
    expect(pickPrimaryEnphaseSite([])).toBeNull();
  });

  it("picks newest operationalAt", () => {
    const sites = [
      makeSite({ id: "a", operationalAt: new Date("2024-01-01") }),
      makeSite({ id: "b", operationalAt: new Date("2024-06-15") }),
    ];
    expect(pickPrimaryEnphaseSite(sites)!.id).toBe("b");
  });

  it("falls back to createdAt when operationalAt is null", () => {
    const sites = [
      makeSite({ id: "a", createdAt: new Date("2024-01-01") }),
      makeSite({ id: "b", createdAt: new Date("2024-06-15") }),
    ];
    expect(pickPrimaryEnphaseSite(sites)!.id).toBe("b");
  });

  it("operationalAt beats createdAt-only site", () => {
    const sites = [
      makeSite({ id: "a", operationalAt: new Date("2023-01-01") }),
      makeSite({ id: "b", createdAt: new Date("2025-01-01") }),
    ];
    expect(pickPrimaryEnphaseSite(sites)!.id).toBe("a");
  });

  it("tie-breaks on systemName desc then id desc", () => {
    const sites = [
      makeSite({ id: "a", systemName: "Alpha", operationalAt: new Date("2024-01-01") }),
      makeSite({ id: "b", systemName: "Zeta", operationalAt: new Date("2024-01-01") }),
    ];
    expect(pickPrimaryEnphaseSite(sites)!.id).toBe("b");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/lib/enphase-crosslink.test.ts --no-coverage`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the crosslink module**

Create `src/lib/enphase-crosslink.ts`:

```typescript
/**
 * Enphase Enlighten Cross-System Propagation
 *
 * Mirrors powerhub-crosslink.ts for Enphase systems. Propagates
 * Enphase portal links and device info into HubSpot Property/Deal/Ticket
 * records and Zuper Property/Job custom fields.
 *
 * Entry points:
 *   - resolvePrimarySite(propertyId)
 *   - pushToHubSpotForProperty(propertyId)
 *   - enqueueCrossSystemPush(propertyId)
 *
 * All entry points no-op when ENPHASE_CROSSLINK_ENABLED !== "true".
 */

import { prisma } from "@/lib/db";
import { updateDealProperty } from "@/lib/hubspot";
import { updateTicketProperties } from "@/lib/hubspot-tickets";
import { updateProperty as updateHubSpotProperty } from "@/lib/hubspot-property";

const CROSSLINK_FLAG = "ENPHASE_CROSSLINK_ENABLED";

function isCrosslinkEnabled(): boolean {
  return process.env[CROSSLINK_FLAG] === "true";
}

// ─── Device Summary ─────────────────────────────────────────────────────────

export interface EnphaseDeviceSummary {
  envoySerial: string | null;
  envoyModel: string | null;
  microModel: string | null;
  microCount: number;
  batterySerials: string | null;
  batteryModel: string | null;
  meterInfo: string | null;
  formatted: string | null;
}

export function buildEnphaseDeviceSummary(devicesJson: unknown): EnphaseDeviceSummary {
  const root = (devicesJson ?? {}) as Record<string, unknown>;
  const asArray = (k: string): Record<string, unknown>[] => {
    const v = root[k];
    return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
  };
  const str = (v: unknown): string => (typeof v === "string" ? v : "");

  const micros = asArray("micro_inverters").map((d) => ({
    sn: str(d.serial_number),
    model: str(d.model),
  }));
  const batteries = [
    ...asArray("batteries").map((d) => ({ sn: str(d.serial_number), model: str(d.model) })),
    ...asArray("encharges").map((d) => ({ sn: str(d.serial_number), model: str(d.model) })),
  ];
  const envoys = [
    ...asArray("enpower").map((d) => ({ sn: str(d.serial_number), model: str(d.model) })),
  ];
  const meters = asArray("meters").map((d) => ({
    sn: str(d.serial_number),
    model: str(d.model),
  }));

  const envoySerial = envoys[0]?.sn || null;
  const envoyModel = envoys[0]?.model || null;
  const microModel = micros[0]?.model || null;
  const microCount = micros.length;
  const batterySerials =
    batteries.length > 0
      ? batteries.map((b) => b.sn).filter((s) => s.length > 0).join("; ") || null
      : null;
  const batteryModel = batteries[0]?.model || null;
  const meterInfo = meters.length > 0
    ? meters.map((m) => `${m.sn} (${m.model})`).join("; ")
    : null;

  const lines: string[] = [];
  if (envoySerial) lines.push(`Envoy: ${envoySerial}${envoyModel ? ` (${envoyModel})` : ""}`);
  if (microCount > 0) lines.push(`Microinverters: ${microCount}× ${microModel || "unknown"}`);
  for (const b of batteries) {
    if (b.sn) lines.push(`Battery: ${b.sn}${b.model ? ` (${b.model})` : ""}`);
  }
  for (const m of meters) {
    if (m.sn) lines.push(`Meter: ${m.sn}${m.model ? ` (${m.model})` : ""}`);
  }
  const formatted = lines.length > 0 ? lines.join("\n") : null;

  return {
    envoySerial,
    envoyModel,
    microModel,
    microCount,
    batterySerials,
    batteryModel,
    meterInfo,
    formatted,
  };
}

// ─── Primary Site Selection ─────────────────────────────────────────────────

export interface PrimaryEnphaseSiteCandidate {
  id: string;
  systemName: string;
  operationalAt: Date | null;
  createdAt: Date;
}

/**
 * Pick the primary Enphase site from candidates.
 *
 * Rules:
 *   1. Sites with operationalAt beat sites without
 *   2. Newest operationalAt wins
 *   3. If all null, newest createdAt wins
 *   4. Tie-break: systemName desc, then id desc
 */
export function pickPrimaryEnphaseSite<T extends PrimaryEnphaseSiteCandidate>(
  sites: T[]
): T | null {
  if (sites.length === 0) return null;

  const enriched = sites.map((s) => ({ site: s, hasOp: s.operationalAt != null }));
  enriched.sort((a, b) => {
    // operationalAt present beats absent
    if (a.hasOp && !b.hasOp) return -1;
    if (!a.hasOp && b.hasOp) return 1;
    // Both have operationalAt: newest wins
    if (a.hasOp && b.hasOp) {
      const diff = b.site.operationalAt!.getTime() - a.site.operationalAt!.getTime();
      if (diff !== 0) return diff;
    } else {
      // Both missing: newest createdAt wins
      const diff = b.site.createdAt.getTime() - a.site.createdAt.getTime();
      if (diff !== 0) return diff;
    }
    // Tie-break: systemName desc
    if (a.site.systemName !== b.site.systemName) {
      return b.site.systemName.localeCompare(a.site.systemName);
    }
    // Final: id desc
    return b.site.id.localeCompare(a.site.id);
  });

  return enriched[0].site;
}

// ─── Crosslink Cascade ──────────────────────────────────────────────────────

async function retryOnUniqueConflict<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;
      const code = (err as { code?: string })?.code;
      if (code !== "P2002") throw err;
      await new Promise((r) => setTimeout(r, 50 * (i + 1)));
    }
  }
  throw lastErr;
}

export async function resolvePrimarySite(propertyId: string): Promise<{
  id: string;
  systemId: number;
  systemName: string;
  portalUrl: string | null;
} | null> {
  const sites = await prisma.enphaseSite.findMany({
    where: { propertyId },
    select: {
      id: true,
      systemId: true,
      systemName: true,
      portalUrl: true,
      operationalAt: true,
      createdAt: true,
      primaryForProperty: true,
      devices: true,
      systemSizeW: true,
      microinverterCount: true,
    },
  });

  if (sites.length === 0) {
    await prisma.hubSpotPropertyCache.updateMany({
      where: { id: propertyId },
      data: {
        enphasePortalUrl: null,
        enphaseSystemId: null,
        enphaseEnvoySerial: null,
        enphaseMicroCount: null,
        enphaseBatterySerials: null,
        enphaseBatteryModel: null,
        enphaseSystemSize: null,
        enphaseHardwareSummary: null,
      },
    });
    return null;
  }

  const primary = pickPrimaryEnphaseSite(sites)!;

  await prisma.enphaseSite.updateMany({
    where: { propertyId, id: { not: primary.id } },
    data: { primaryForProperty: false },
  });
  await retryOnUniqueConflict(() =>
    prisma.enphaseSite.update({
      where: { id: primary.id },
      data: { primaryForProperty: true },
    })
  );

  const summary = buildEnphaseDeviceSummary(primary.devices);
  const systemSizeKw = primary.systemSizeW ? (primary.systemSizeW / 1000).toFixed(1) : null;

  await prisma.hubSpotPropertyCache.updateMany({
    where: { id: propertyId },
    data: {
      enphasePortalUrl: primary.portalUrl,
      enphaseSystemId: String(primary.systemId),
      enphaseEnvoySerial: summary.envoySerial,
      enphaseMicroCount: String(summary.microCount),
      enphaseBatterySerials: summary.batterySerials,
      enphaseBatteryModel: summary.batteryModel,
      enphaseSystemSize: systemSizeKw ? `${systemSizeKw} kW` : null,
      enphaseHardwareSummary: summary.formatted,
    },
  });

  return {
    id: primary.id,
    systemId: primary.systemId,
    systemName: primary.systemName,
    portalUrl: primary.portalUrl,
  };
}

export async function pushToHubSpotForProperty(propertyId: string): Promise<void> {
  if (!isCrosslinkEnabled()) return;

  const cache = await prisma.hubSpotPropertyCache.findUnique({
    where: { id: propertyId },
    include: { dealLinks: true, ticketLinks: true },
  });
  if (!cache) {
    console.warn(`[enphase-crosslink] Property ${propertyId} not found in cache; skipping push`);
    return;
  }

  const props = {
    enphase_portal_url: cache.enphasePortalUrl,
    enphase_system_id: cache.enphaseSystemId,
    enphase_envoy_serial: cache.enphaseEnvoySerial,
    enphase_micro_count: cache.enphaseMicroCount,
    enphase_battery_serials: cache.enphaseBatterySerials,
    enphase_battery_model: cache.enphaseBatteryModel,
    enphase_system_size: cache.enphaseSystemSize,
    enphase_hardware_summary: cache.enphaseHardwareSummary,
  };

  try {
    await updateHubSpotProperty(cache.hubspotObjectId, props);
  } catch (err) {
    console.error(`[enphase-crosslink] Failed to update HubSpot Property ${cache.hubspotObjectId}:`, err);
  }

  const dealResults = await Promise.allSettled(
    cache.dealLinks.map((link) => updateDealProperty(link.dealId, props))
  );
  const dealFailures = dealResults.filter(
    (r) => r.status === "rejected" || (r.status === "fulfilled" && r.value === false)
  ).length;
  if (dealFailures > 0) {
    console.warn(
      `[enphase-crosslink] ${dealFailures}/${cache.dealLinks.length} deal updates failed for property ${propertyId}`
    );
  }

  const ticketResults = await Promise.allSettled(
    cache.ticketLinks.map((link) => updateTicketProperties(link.ticketId, props))
  );
  const ticketFailures = ticketResults.filter(
    (r) => r.status === "rejected" || (r.status === "fulfilled" && r.value === false)
  ).length;
  if (ticketFailures > 0) {
    console.warn(
      `[enphase-crosslink] ${ticketFailures}/${cache.ticketLinks.length} ticket updates failed for property ${propertyId}`
    );
  }
}

export async function enqueueCrossSystemPush(propertyId: string): Promise<void> {
  if (!isCrosslinkEnabled()) return;
  try {
    await resolvePrimarySite(propertyId);
    await pushToHubSpotForProperty(propertyId);
  } catch (err) {
    console.error(`[enphase-crosslink] enqueueCrossSystemPush failed for ${propertyId}:`, err);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/lib/enphase-crosslink.test.ts --no-coverage`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/enphase-crosslink.ts src/__tests__/lib/enphase-crosslink.test.ts
git commit -m "feat(enphase): add crosslink module — device summary builder, primary site selection, HubSpot cascade"
```

---

## Chunk 2: Cron Jobs + OAuth Routes

### Task 4: Asset Discovery Cron

**Files:**
- Create: `src/app/api/cron/enphase-assets/route.ts`

Reference: `src/app/api/cron/powerhub-assets/route.ts` for the cron route pattern (CRON_SECRET auth, feature flag guard, maxDuration). `src/lib/powerhub-sync.ts` `syncAssets()` for the asset sync orchestration pattern. `src/lib/powerhub-linkage.ts` for address hash computation (`computeAddressHash`, `normalizeAddress`).

- [ ] **Step 1: Create the asset sync cron route**

Create `src/app/api/cron/enphase-assets/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { createEnphaseClient, computeEnphasePortalUrl } from "@/lib/enphase-enlighten";
import { enqueueCrossSystemPush } from "@/lib/enphase-crosslink";
import { normalizeAddress, computeAddressHash } from "@/lib/powerhub-linkage";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (process.env.ENPHASE_ENABLED !== "true") {
    return NextResponse.json({ skipped: true, reason: "ENPHASE_ENABLED is false" });
  }

  try {
    const client = createEnphaseClient();
    const systems = await client.listSystems();

    let created = 0;
    let updated = 0;
    let linked = 0;
    const errors: string[] = [];

    for (const system of systems) {
      try {
        const street = system.address?.address1 || "";
        const city = system.address?.city || "";
        const state = system.address?.state || "";
        const zip = system.address?.postal_code || null;
        const normalizedStreet = normalizeAddress(street);
        const addressHash = street && city && state
          ? computeAddressHash(normalizedStreet, city.toLowerCase(), state.toLowerCase(), zip)
          : null;

        const portalUrl = computeEnphasePortalUrl(system.system_id);
        const operationalAt = system.meta?.operational_at
          ? new Date(system.meta.operational_at * 1000)
          : null;

        // Fetch devices for this system
        let devices = {};
        try {
          devices = await client.getSystemDevices(system.system_id);
        } catch (err) {
          errors.push(`Device fetch failed for ${system.system_id}: ${err instanceof Error ? err.message : String(err)}`);
        }

        const microCount = Array.isArray((devices as Record<string, unknown>).micro_inverters)
          ? ((devices as Record<string, unknown>).micro_inverters as unknown[]).length
          : 0;
        const batteryCount = [
          ...((devices as Record<string, unknown>).batteries as unknown[] || []),
          ...((devices as Record<string, unknown>).encharges as unknown[] || []),
        ].length;

        // Find envoy serial from enpower devices
        const enpowerDevices = (devices as Record<string, unknown>).enpower;
        const envoySerial = Array.isArray(enpowerDevices) && enpowerDevices.length > 0
          ? String((enpowerDevices[0] as Record<string, unknown>).serial_number || "")
          : null;

        const existing = await prisma.enphaseSite.findUnique({
          where: { systemId: system.system_id },
        });

        if (existing) {
          await prisma.enphaseSite.update({
            where: { systemId: system.system_id },
            data: {
              systemName: system.system_name,
              systemPublicName: system.system_public_name || null,
              address: street,
              city,
              state,
              zip,
              addressHash,
              portalUrl,
              modules: system.modules || 0,
              systemSizeW: system.system_size || null,
              timezone: system.timezone || null,
              connectionType: system.connection_type || null,
              envoySerial,
              status: system.status || "normal",
              operationalAt,
              devices: devices as object,
              microinverterCount: microCount,
              batteryCount,
              lastAssetSyncAt: new Date(),
            },
          });
          updated++;
        } else {
          await prisma.enphaseSite.create({
            data: {
              systemId: system.system_id,
              systemName: system.system_name,
              systemPublicName: system.system_public_name || null,
              address: street,
              city,
              state,
              zip,
              addressHash,
              portalUrl,
              modules: system.modules || 0,
              systemSizeW: system.system_size || null,
              timezone: system.timezone || null,
              connectionType: system.connection_type || null,
              envoySerial,
              status: system.status || "normal",
              operationalAt,
              devices: devices as object,
              microinverterCount: microCount,
              batteryCount,
              lastAssetSyncAt: new Date(),
            },
          });
          created++;
        }

        // Auto-link by addressHash if unlinked
        if (addressHash) {
          const site = await prisma.enphaseSite.findUnique({
            where: { systemId: system.system_id },
          });
          if (site && site.linkMethod === "UNLINKED") {
            const propertyMatch = await prisma.hubSpotPropertyCache.findFirst({
              where: { addressHash },
            });
            if (propertyMatch) {
              await prisma.enphaseSite.update({
                where: { id: site.id },
                data: {
                  propertyId: propertyMatch.id,
                  linkMethod: "ADDRESS_MATCH",
                  linkConfidence: "MEDIUM",
                },
              });
              linked++;
              await enqueueCrossSystemPush(propertyMatch.id);
            }
          }
        }
      } catch (err) {
        errors.push(`System ${system.system_id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return NextResponse.json({
      success: true,
      sitesProcessed: systems.length,
      created,
      updated,
      linked,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[enphase-assets] Sync failed:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/cron/enphase-assets/route.ts
git commit -m "feat(enphase): add asset discovery cron — fleet sync with address-hash auto-linking"
```

---

### Task 5: Telemetry Sync Cron

**Files:**
- Create: `src/app/api/cron/enphase-telemetry/route.ts`

Reference: `src/app/api/cron/powerhub-telemetry/route.ts` and `src/lib/powerhub-sync.ts` `pollTelemetry()`.

- [ ] **Step 1: Create the telemetry sync cron route**

Create `src/app/api/cron/enphase-telemetry/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { createEnphaseClient } from "@/lib/enphase-enlighten";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (process.env.ENPHASE_ENABLED !== "true") {
    return NextResponse.json({ skipped: true, reason: "ENPHASE_ENABLED is false" });
  }

  try {
    const client = createEnphaseClient();
    const sites = await prisma.enphaseSite.findMany({
      select: { systemId: true },
    });

    let processed = 0;
    const errors: string[] = [];

    for (const site of sites) {
      try {
        const summary = await client.getSystemSummary(site.systemId);
        const now = new Date();
        const lastReportAt = summary.last_report_at
          ? new Date(summary.last_report_at * 1000)
          : null;

        await prisma.enphaseTelemetrySnapshot.upsert({
          where: { systemId: site.systemId },
          create: {
            systemId: site.systemId,
            timestamp: now,
            currentProductionW: summary.current_power ?? null,
            todayProductionWh: summary.energy_today ?? null,
            lifetimeProductionWh: summary.energy_lifetime ?? null,
            currentConsumptionW: summary.current_consumption ?? null,
            todayConsumptionWh: summary.consumption_today ?? null,
            lifetimeConsumptionWh: summary.consumption_lifetime ?? null,
            systemStatus: summary.status ?? null,
            microTotalCount: summary.modules ?? null,
            lastReportAt,
          },
          update: {
            timestamp: now,
            currentProductionW: summary.current_power ?? null,
            todayProductionWh: summary.energy_today ?? null,
            lifetimeProductionWh: summary.energy_lifetime ?? null,
            currentConsumptionW: summary.current_consumption ?? null,
            todayConsumptionWh: summary.consumption_today ?? null,
            lifetimeConsumptionWh: summary.consumption_lifetime ?? null,
            systemStatus: summary.status ?? null,
            microTotalCount: summary.modules ?? null,
            lastReportAt,
          },
        });

        // Append key metrics to history
        const historyEntries = [
          { signalName: "production_w", value: summary.current_power ?? null },
          { signalName: "consumption_w", value: summary.current_consumption ?? null },
        ].filter((e) => e.value != null);

        if (historyEntries.length > 0) {
          await prisma.enphaseTelemetryHistory.createMany({
            data: historyEntries.map((e) => ({
              systemId: site.systemId,
              timestamp: now,
              signalName: e.signalName,
              value: e.value,
              source: "POLL",
            })),
          });
        }

        await prisma.enphaseSite.update({
          where: { systemId: site.systemId },
          data: {
            lastTelemetrySyncAt: now,
            status: summary.status || "normal",
          },
        });

        processed++;
      } catch (err) {
        errors.push(`System ${site.systemId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return NextResponse.json({
      success: true,
      sitesProcessed: processed,
      totalSites: sites.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[enphase-telemetry] Sync failed:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/cron/enphase-telemetry/route.ts
git commit -m "feat(enphase): add telemetry sync cron — production/consumption/battery snapshots + history"
```

---

### Task 6: Status Check Cron

**Files:**
- Create: `src/app/api/cron/enphase-status-check/route.ts`

- [ ] **Step 1: Create the status check cron route**

Create `src/app/api/cron/enphase-status-check/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { createEnphaseClient } from "@/lib/enphase-enlighten";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (process.env.ENPHASE_ENABLED !== "true") {
    return NextResponse.json({ skipped: true, reason: "ENPHASE_ENABLED is false" });
  }

  try {
    const client = createEnphaseClient();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    // Check sites that are unhealthy OR haven't reported recently
    const sites = await prisma.enphaseSite.findMany({
      where: {
        OR: [
          { status: { not: "normal" } },
          { lastTelemetrySyncAt: { lt: oneHourAgo } },
          { lastTelemetrySyncAt: null },
        ],
      },
      select: { id: true, systemId: true, status: true },
    });

    let processed = 0;
    let transitions = 0;
    const errors: string[] = [];

    for (const site of sites) {
      try {
        const devices = await client.getSystemDevices(site.systemId);
        const micros = devices.micro_inverters || [];
        const reporting = micros.filter((m) => m.status === "normal" || m.producing).length;
        const total = micros.length;

        // Determine new status based on device reporting
        let newStatus = "normal";
        if (total > 0 && reporting === 0) {
          newStatus = "comm";
        } else if (total > 0 && reporting < total) {
          newStatus = "micro";
        }

        const oldStatus = site.status;
        await prisma.enphaseSite.update({
          where: { id: site.id },
          data: {
            status: newStatus,
            lastStatusCheckAt: new Date(),
          },
        });

        // Update snapshot micro counts if snapshot exists
        await prisma.enphaseTelemetrySnapshot.updateMany({
          where: { systemId: site.systemId },
          data: {
            microReportingCount: reporting,
            microTotalCount: total,
            systemStatus: newStatus,
          },
        });

        if (oldStatus !== newStatus) {
          transitions++;
          console.log(
            `[enphase-status-check] System ${site.systemId}: ${oldStatus} → ${newStatus} (${reporting}/${total} micros reporting)`
          );
          // Log to audit trail for admin visibility
          try {
            await prisma.activityLog.create({
              data: {
                type: "ENPHASE_STATUS_CHANGE",
                action: `Enphase system ${site.systemId} status: ${oldStatus} → ${newStatus} (${reporting}/${total} micros)`,
                metadata: {
                  systemId: site.systemId,
                  oldStatus,
                  newStatus,
                  reporting,
                  total,
                },
              },
            });
          } catch {
            // Best-effort audit logging — don't fail the cron on log write errors
          }
        }

        processed++;
      } catch (err) {
        errors.push(`System ${site.systemId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return NextResponse.json({
      success: true,
      sitesChecked: processed,
      totalFlagged: sites.length,
      statusTransitions: transitions,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[enphase-status-check] Check failed:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/cron/enphase-status-check/route.ts
git commit -m "feat(enphase): add status check cron — micro health monitoring with transition logging"
```

---

### Task 7: OAuth Admin Routes

**Files:**
- Create: `src/app/api/admin/enphase/oauth/authorize/route.ts`
- Create: `src/app/api/admin/enphase/oauth/callback/route.ts`

- [ ] **Step 1: Create OAuth authorize route**

Create `src/app/api/admin/enphase/oauth/authorize/route.ts`:

```typescript
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const clientId = process.env.ENPHASE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "ENPHASE_CLIENT_ID not configured" }, { status: 500 });
  }

  const redirectUri = `${process.env.AUTH_URL || "https://pbtechops.com"}/api/admin/enphase/oauth/callback`;
  const authUrl = new URL("https://api.enphaseenergy.com/oauth/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);

  return NextResponse.redirect(authUrl.toString());
}
```

- [ ] **Step 2: Create OAuth callback route**

Create `src/app/api/admin/enphase/oauth/callback/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  if (!code) {
    return NextResponse.json({ error: "Missing authorization code" }, { status: 400 });
  }

  const clientId = process.env.ENPHASE_CLIENT_ID;
  const clientSecret = process.env.ENPHASE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "Missing ENPHASE_CLIENT_ID or ENPHASE_CLIENT_SECRET" }, { status: 500 });
  }

  const redirectUri = `${process.env.AUTH_URL || "https://pbtechops.com"}/api/admin/enphase/oauth/callback`;
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  try {
    const res = await fetch("https://api.enphaseenergy.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
      },
      body: `grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    });

    if (!res.ok) {
      const body = await res.text();
      return NextResponse.json({ error: "Token exchange failed", detail: body }, { status: 502 });
    }

    const data = await res.json();
    const refreshToken: string = data.refresh_token;
    const accessToken: string = data.access_token;

    // Persist refresh token to DB for runtime use
    await prisma.systemConfig.upsert({
      where: { key: "enphase_refresh_token" },
      create: { key: "enphase_refresh_token", value: refreshToken },
      update: { value: refreshToken },
    });

    // Return a simple HTML page showing the tokens
    const html = `
      <!DOCTYPE html>
      <html><head><title>Enphase OAuth Complete</title></head>
      <body style="font-family:system-ui;padding:2rem;">
        <h1>Enphase OAuth Setup Complete</h1>
        <p>Refresh token has been saved to the database.</p>
        <p>For backup, copy this to <code>ENPHASE_REFRESH_TOKEN</code> env var:</p>
        <pre style="background:#f0f0f0;padding:1rem;word-break:break-all;">${refreshToken}</pre>
        <p>Access token (expires in ${data.expires_in}s):</p>
        <pre style="background:#f0f0f0;padding:1rem;word-break:break-all;">${accessToken}</pre>
        <p><a href="/dashboards/admin">← Back to Admin</a></p>
      </body></html>
    `;

    return new NextResponse(html, {
      headers: { "Content-Type": "text/html" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "OAuth callback failed", detail: message }, { status: 500 });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/admin/enphase/oauth/
git commit -m "feat(enphase): add OAuth admin routes — authorize redirect + callback with DB token persistence"
```

---

## Chunk 3: HubSpot Card + Middleware + Config

### Task 8: HubSpot UI Extension Card Backend

**Files:**
- Create: `src/app/api/hubspot-card/enphase/route.ts`

Reference: `src/app/api/hubspot-card/powerhub/route.ts` for exact HMAC signature verification and object type resolution patterns.

- [ ] **Step 1: Create the HubSpot card route**

Create `src/app/api/hubspot-card/enphase/route.ts`:

```typescript
/**
 * Backend for the Enphase Enlighten HubSpot UI Extension card.
 *
 * Same auth + resolution pattern as the PowerHub card at
 * src/app/api/hubspot-card/powerhub/route.ts.
 */

import { NextResponse } from "next/server";
import { Signature } from "@hubspot/api-client";
import { z } from "zod";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const RequestSchema = z.object({
  objectType: z.string().min(1),
  objectId: z.string().min(1),
});

const TIMESTAMP_WINDOW_MS = 5 * 60 * 1000;

function verifyHubSpotSignature(
  method: string,
  url: string,
  body: string,
  signatureHeader: string | null,
  timestampHeader: string | null
): boolean {
  if (process.env.HUBSPOT_CARD_SKIP_SIG_VERIFY === "true") return true;
  if (!signatureHeader || !timestampHeader) return false;
  const secret = process.env.HUBSPOT_APP_SECRET;
  if (!secret) return false;
  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > TIMESTAMP_WINDOW_MS) return false;

  const parsed = new URL(url);
  const decodedPairs: string[] = [];
  for (const [k, v] of parsed.searchParams.entries()) {
    decodedPairs.push(`${k}=${v}`);
  }
  const canonicalUrl =
    parsed.origin + parsed.pathname + (decodedPairs.length ? `?${decodedPairs.join("&")}` : "");

  return Signature.isValid({
    signatureVersion: "v3",
    signature: signatureHeader,
    method,
    clientSecret: secret,
    requestBody: body,
    url: canonicalUrl,
    timestamp: ts as never,
  } as never);
}

const TYPE_DEALS = "0-3";
const TYPE_TICKETS = "0-5";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const sigHeader = request.headers.get("x-hubspot-signature-v3");
  const tsHeader = request.headers.get("x-hubspot-request-timestamp");

  if (!verifyHubSpotSignature("POST", request.url, rawBody, sigHeader, tsHeader)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let parsed;
  try {
    parsed = RequestSchema.parse(JSON.parse(rawBody));
  } catch (err) {
    return NextResponse.json(
      { error: "invalid_request", message: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }

  const { objectType, objectId } = parsed;
  const propertyObjectType = process.env.HUBSPOT_PROPERTY_OBJECT_TYPE;

  let propertyCache;
  if (propertyObjectType && objectType === propertyObjectType) {
    propertyCache = await prisma.hubSpotPropertyCache.findUnique({
      where: { hubspotObjectId: objectId },
      include: {
        enphaseSites: {
          where: { primaryForProperty: true },
          include: { telemetrySnapshot: true },
        },
      },
    });
  } else if (objectType === TYPE_DEALS) {
    const link = await prisma.propertyDealLink.findFirst({
      where: { dealId: objectId },
      include: {
        property: {
          include: {
            enphaseSites: {
              where: { primaryForProperty: true },
              include: { telemetrySnapshot: true },
            },
          },
        },
      },
    });
    propertyCache = link?.property ?? null;
  } else if (objectType === TYPE_TICKETS) {
    const link = await prisma.propertyTicketLink.findFirst({
      where: { ticketId: objectId },
      include: {
        property: {
          include: {
            enphaseSites: {
              where: { primaryForProperty: true },
              include: { telemetrySnapshot: true },
            },
          },
        },
      },
    });
    propertyCache = link?.property ?? null;
  } else {
    return NextResponse.json(
      { error: "unsupported_object_type", message: `Object type ${objectType} not supported` },
      { status: 400 }
    );
  }

  if (!propertyCache) {
    return NextResponse.json({ error: "no_property_link" }, { status: 404 });
  }

  const primarySite = propertyCache.enphaseSites[0] ?? null;
  if (!primarySite) {
    return NextResponse.json({ error: "no_enphase_site" }, { status: 404 });
  }

  const snapshot = primarySite.telemetrySnapshot
    ? {
        currentProductionW: primarySite.telemetrySnapshot.currentProductionW,
        todayProductionWh: primarySite.telemetrySnapshot.todayProductionWh,
        batteryPercentCharge: primarySite.telemetrySnapshot.batteryPercentCharge,
        systemStatus: primarySite.telemetrySnapshot.systemStatus || primarySite.status,
        microReportingCount: primarySite.telemetrySnapshot.microReportingCount,
        microTotalCount: primarySite.telemetrySnapshot.microTotalCount,
        lastReportAt: primarySite.telemetrySnapshot.lastReportAt?.toISOString() ?? null,
      }
    : null;

  const deviceModels = extractEnphaseDeviceModels(primarySite.devices);
  const equipment = {
    envoySerial: propertyCache.enphaseEnvoySerial,
    envoyModel: deviceModels.envoy,
    microModel: deviceModels.micro,
    microCount: primarySite.microinverterCount,
    batterySerials: propertyCache.enphaseBatterySerials,
    batteryModel: propertyCache.enphaseBatteryModel,
    batteryCount: primarySite.batteryCount,
    systemSizeKw: primarySite.systemSizeW ? primarySite.systemSizeW / 1000 : null,
  };

  return NextResponse.json({
    propertyId: propertyCache.id,
    hubspotPropertyId: propertyCache.hubspotObjectId,
    systemName: primarySite.systemName,
    systemId: primarySite.systemId,
    enphasePortalUrl: propertyCache.enphasePortalUrl,
    pbTechOpsUrl: `https://pbtechops.com/properties/${propertyCache.hubspotObjectId}?tab=monitoring`,
    snapshot,
    equipment,
  });
}

/**
 * Extract device models from EnphaseSite.devices JSON.
 * Mirrors extractDeviceModels() in the PowerHub card route.
 */
function extractEnphaseDeviceModels(raw: unknown): {
  envoy: string | null;
  micro: string | null;
} {
  const safe = (raw ?? {}) as Record<string, unknown>;
  const first = (key: string, field = "model"): string | null => {
    const arr = safe[key];
    if (!Array.isArray(arr)) return null;
    for (const item of arr as Record<string, unknown>[]) {
      const val = typeof item?.[field] === "string" ? (item[field] as string).trim() : "";
      if (val) return val;
    }
    return null;
  };
  return {
    envoy: first("enpower"),
    micro: first("micro_inverters"),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/hubspot-card/enphase/route.ts
git commit -m "feat(enphase): add HubSpot UI Extension card backend — property/deal/ticket resolution with telemetry"
```

---

### Task 9: Middleware + Config Updates

**Files:**
- Modify: `src/middleware.ts` (around line 80, after powerhub entries)
- Modify: `vercel.json`
- Modify: `.env.example`

- [ ] **Step 1: Add Enphase routes to PUBLIC_API_ROUTES in middleware.ts**

Find the PowerHub cron entries (lines 69-71) and the card entry (line 80) in `src/middleware.ts`. Add after line 80 (`"/api/hubspot-card/powerhub"`):

```typescript
  "/api/cron/enphase-assets",       // Enphase asset sync — CRON_SECRET validated in route
  "/api/cron/enphase-telemetry",    // Enphase telemetry poll — CRON_SECRET validated in route
  "/api/cron/enphase-status-check", // Enphase status check — CRON_SECRET validated in route
  "/api/hubspot-card/enphase",      // HubSpot UI Extension — HubSpot signature v3 validated in route
```

- [ ] **Step 2: Add Enphase cron schedules to vercel.json**

Find the PowerHub cron entries in `vercel.json` (around line 183-185) and add after them:

```json
    { "path": "/api/cron/enphase-assets", "schedule": "0 9 * * *" },
    { "path": "/api/cron/enphase-telemetry", "schedule": "*/15 * * * *" },
    { "path": "/api/cron/enphase-status-check", "schedule": "5,35 * * * *" },
```

- [ ] **Step 3: Add Enphase functions maxDuration to vercel.json**

Find the PowerHub functions entries (around lines 58-60) and add after them:

```json
    "src/app/api/cron/enphase-assets/route.ts": { "maxDuration": 300 },
    "src/app/api/cron/enphase-telemetry/route.ts": { "maxDuration": 120 },
    "src/app/api/cron/enphase-status-check/route.ts": { "maxDuration": 120 },
```

- [ ] **Step 4: Add Enphase env vars to .env.example**

Find the PowerHub section (around line 375) and add after it:

```
# ─── Enphase Enlighten ───────────────────────────────────────────────────────
# ENPHASE_ENABLED=true
# ENPHASE_API_KEY=
# ENPHASE_CLIENT_ID=
# ENPHASE_CLIENT_SECRET=
# ENPHASE_REFRESH_TOKEN=                    # Initial seed only; runtime uses DB after first refresh
# ENPHASE_PROXY_URL=                        # Optional — omit to call api.enphaseenergy.com directly
# ENPHASE_PORTAL_URL_TEMPLATE=https://enlighten.enphaseenergy.com/systems/{systemId}
# ENPHASE_CROSSLINK_ENABLED=false
# NEXT_PUBLIC_UI_ENPHASE_VIEWS_ENABLED=false
```

- [ ] **Step 5: Commit**

```bash
git add src/middleware.ts vercel.json .env.example
git commit -m "feat(enphase): register routes in middleware, add Vercel cron config, update .env.example"
```

---

### Task 10: Type Check + Final Validation

- [ ] **Step 1: Run full type check**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 2: Run all Enphase tests**

Run: `npx jest src/__tests__/lib/enphase --no-coverage`
Expected: All tests PASS.

- [ ] **Step 3: Run full test suite to check for regressions**

Run: `npm run test -- --no-coverage`
Expected: No regressions in existing tests.

- [ ] **Step 4: Run lint**

Run: `npm run lint`
Expected: No new lint errors.

- [ ] **Step 5: Verify build succeeds**

Run: `npm run build`
Expected: Build completes without errors.

---

### Task 11: CLAUDE.md Documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add Enphase section to Major Systems in CLAUDE.md**

Find the section "### 10. HubSpot Property Object" in CLAUDE.md and add a new section before or after it (after section numbering makes sense — could be section 13 or wherever fits):

```markdown
### N. Enphase Enlighten Integration (`lib/enphase-enlighten.ts`, `lib/enphase-crosslink.ts`)

Enphase monitoring API integration at full parity with Tesla PowerHub. OAuth2 authorization code grant with refresh token rotation (stored in SystemConfig DB row, not env var).

**API Client** (`enphase-enlighten.ts`):
- OAuth2 auth code flow with DB-persisted refresh token rotation
- Token bucket rate limiter (8 req/sec, under Enphase's ~10 limit)
- Typed wrappers: listSystems, getSystemSummary, getSystemDevices, telemetry endpoints
- Optional Fly.io proxy via `ENPHASE_PROXY_URL`

**Crosslink** (`enphase-crosslink.ts`): Same cascade as PowerHub — resolvePrimarySite → pushToHubSpotForProperty → Zuper dirty flag via updatedAt.

**DB Models:** `EnphaseSite`, `EnphaseTelemetrySnapshot`, `EnphaseTelemetryHistory` + 8 `enphase_*` columns on `HubSpotPropertyCache`.

**Cron Jobs:**
- `enphase-assets` (daily): Fleet discovery, device refresh, address-hash auto-linking to Properties
- `enphase-telemetry` (15 min): Production/consumption/battery snapshots
- `enphase-status-check` (30 min): Micro health monitoring, status transitions

**HubSpot Card**: `/api/hubspot-card/enphase/` — HMAC-signed card showing production, battery SoC, micro health, portal link.

**OAuth Setup**: `/api/admin/enphase/oauth/authorize` + `/callback` — one-time admin flow to obtain initial refresh token. Persists to SystemConfig DB row.

**Feature flags**: `ENPHASE_ENABLED`, `ENPHASE_CROSSLINK_ENABLED`, `NEXT_PUBLIC_UI_ENPHASE_VIEWS_ENABLED`
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add Enphase integration to CLAUDE.md Major Systems"
```
