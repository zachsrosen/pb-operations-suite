# Vendor Canonicalization + Picker — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the free-text vendor input with a Zoho-backed picker that stores both `vendorName` (snapshot) and `zohoVendorId` (durable identity), with pair-aware server validation and downstream sync.

**Architecture:** New `VendorLookup` Prisma model synced from Zoho via cron. `VendorPicker` component reads from a GET endpoint. Form state gains `zohoVendorId` + `SET_VENDOR` action. Server validates vendor pairs, approval route passes `vendor_id` to Zoho on both create and update paths.

**Tech Stack:** Next.js 16, Prisma 7, Zoho Inventory API, React 19, Tailwind v4

**Spec:** `docs/superpowers/specs/2026-03-15-vendor-canonicalization-design.md`

---

## Chunk 1: Foundation (Schema + Utility)

### Task 1: Prisma Migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: migration via `npx prisma migrate dev`

- [ ] **Step 1: Add VendorLookup model to schema**

Add after line 779 (end of `EquipmentSku` model) in `prisma/schema.prisma`:

```prisma
model VendorLookup {
  id              String   @id @default(cuid())
  zohoVendorId    String   @unique
  name            String
  isActive        Boolean  @default(true)
  lastSyncedAt    DateTime
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([isActive, name])
}
```

- [ ] **Step 2: Add zohoVendorId to EquipmentSku**

Add inside the `EquipmentSku` model (before line 768, after the last field):

```prisma
  zohoVendorId           String?
```

And add to the indexes section (before the closing `}`):

```prisma
  @@index([zohoVendorId])
```

- [ ] **Step 3: Add zohoVendorId to PendingCatalogPush**

Add inside the `PendingCatalogPush` model (before line 1065, after the last data field):

```prisma
  zohoVendorId    String?
```

And add to the indexes section:

```prisma
  @@index([zohoVendorId])
```

- [ ] **Step 4: Generate migration**

Run: `npx prisma migrate dev --name vendor_lookup_and_zoho_vendor_id`

Expected: Migration created successfully, `prisma generate` runs, no errors.

- [ ] **Step 5: Verify the migration SQL has explicit UNIQUE constraint**

Read the generated migration file. Confirm it contains `UNIQUE` constraint on `zohoVendorId` column of `VendorLookup` table (not just an index).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add VendorLookup model and zohoVendorId to EquipmentSku/PendingCatalogPush"
```

---

### Task 2: Vendor Name Normalization Utility

**Files:**
- Create: `src/lib/vendor-normalize.ts`
- Create: `src/__tests__/lib/vendor-normalize.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/lib/vendor-normalize.test.ts`:

```typescript
import { normalizeVendorName, matchVendorName } from "@/lib/vendor-normalize";

describe("normalizeVendorName", () => {
  it("lowercases", () => {
    expect(normalizeVendorName("RELL POWER")).toBe("rell power");
  });

  it("trims whitespace", () => {
    expect(normalizeVendorName("  Rell Power  ")).toBe("rell power");
  });

  it("strips Inc suffix", () => {
    expect(normalizeVendorName("SolarEdge Technologies Inc")).toBe("solaredge technologies");
  });

  it("strips LLC suffix", () => {
    expect(normalizeVendorName("BayWa r.e. LLC")).toBe("baywa r.e.");
  });

  it("strips Corp suffix", () => {
    expect(normalizeVendorName("Enphase Corp")).toBe("enphase");
  });

  it("strips Ltd suffix", () => {
    expect(normalizeVendorName("Jinko Solar Ltd")).toBe("jinko solar");
  });

  it("strips Co suffix", () => {
    expect(normalizeVendorName("Tesla Energy Co")).toBe("tesla energy");
  });

  it("strips suffix with trailing period", () => {
    expect(normalizeVendorName("SolarEdge Technologies Inc.")).toBe("solaredge technologies");
  });

  it("returns empty string for blank input", () => {
    expect(normalizeVendorName("")).toBe("");
    expect(normalizeVendorName("  ")).toBe("");
  });
});

describe("matchVendorName", () => {
  const vendors = [
    { zohoVendorId: "v1", name: "Rell Power" },
    { zohoVendorId: "v2", name: "SolarEdge Technologies" },
    { zohoVendorId: "v3", name: "BayWa r.e." },
  ];

  it("returns exact match", () => {
    expect(matchVendorName("Rell Power", vendors)).toEqual({
      zohoVendorId: "v1",
      name: "Rell Power",
    });
  });

  it("returns normalized match (case)", () => {
    expect(matchVendorName("rell power", vendors)).toEqual({
      zohoVendorId: "v1",
      name: "Rell Power",
    });
  });

  it("returns normalized match (suffix stripped)", () => {
    expect(matchVendorName("SolarEdge Technologies Inc", vendors)).toEqual({
      zohoVendorId: "v2",
      name: "SolarEdge Technologies",
    });
  });

  it("returns null for no match", () => {
    expect(matchVendorName("Unknown Vendor", vendors)).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(matchVendorName("", vendors)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/lib/vendor-normalize.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

Create `src/lib/vendor-normalize.ts`:

```typescript
const STRIP_SUFFIXES = /\s+(?:Inc|LLC|Corp|Ltd|Co)\.?\s*$/i;

/** Normalize a vendor name for comparison: lowercase, trim, strip business suffixes. */
export function normalizeVendorName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  return trimmed.replace(STRIP_SUFFIXES, "").trim().toLowerCase();
}

interface VendorEntry {
  zohoVendorId: string;
  name: string;
}

/**
 * Match a raw vendor string against a list of known vendors.
 * Returns the matched vendor (with original name) or null.
 * Uses exact match first, then normalized comparison.
 */
export function matchVendorName(
  raw: string,
  vendors: VendorEntry[]
): VendorEntry | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Exact match first
  const exact = vendors.find((v) => v.name === trimmed);
  if (exact) return exact;

  // Normalized match
  const normalized = normalizeVendorName(trimmed);
  if (!normalized) return null;
  return vendors.find((v) => normalizeVendorName(v.name) === normalized) ?? null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/lib/vendor-normalize.test.ts`

Expected: All 12 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/vendor-normalize.ts src/__tests__/lib/vendor-normalize.test.ts
git commit -m "feat: add vendor name normalization utility with suffix stripping"
```

---

## Chunk 2: API Routes + Form State

### Task 3: Form State — zohoVendorId + SET_VENDOR

**Files:**
- Modify: `src/lib/catalog-form-state.ts`
- Modify: `src/__tests__/lib/catalog-form-state.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `src/__tests__/lib/catalog-form-state.test.ts`, in a new describe block:

```typescript
describe("SET_VENDOR action", () => {
  it("sets both vendorName and zohoVendorId atomically", () => {
    const state = catalogFormReducer(initialFormState, {
      type: "SET_VENDOR",
      vendorName: "Rell Power",
      zohoVendorId: "v123",
    });
    expect(state.vendorName).toBe("Rell Power");
    expect(state.zohoVendorId).toBe("v123");
  });

  it("clears both when called with empty values", () => {
    const withVendor = {
      ...initialFormState,
      vendorName: "Rell Power",
      zohoVendorId: "v123",
    };
    const state = catalogFormReducer(withVendor, {
      type: "SET_VENDOR",
      vendorName: "",
      zohoVendorId: "",
    });
    expect(state.vendorName).toBe("");
    expect(state.zohoVendorId).toBe("");
  });
});

describe("SET_FIELD vendorName clears zohoVendorId", () => {
  it("clears zohoVendorId when vendorName is set via SET_FIELD", () => {
    const withVendor = {
      ...initialFormState,
      vendorName: "Rell Power",
      zohoVendorId: "v123",
    };
    const state = catalogFormReducer(withVendor, {
      type: "SET_FIELD",
      field: "vendorName",
      value: "Something else",
    });
    expect(state.vendorName).toBe("Something else");
    expect(state.zohoVendorId).toBe("");
  });

  it("does not clear zohoVendorId when other fields set via SET_FIELD", () => {
    const withVendor = {
      ...initialFormState,
      vendorName: "Rell Power",
      zohoVendorId: "v123",
    };
    const state = catalogFormReducer(withVendor, {
      type: "SET_FIELD",
      field: "brand",
      value: "NewBrand",
    });
    expect(state.zohoVendorId).toBe("v123");
  });
});

describe("PREFILL_FROM_PRODUCT with zohoVendorId", () => {
  it("copies zohoVendorId when present (valid pair)", () => {
    const state = catalogFormReducer(initialFormState, {
      type: "PREFILL_FROM_PRODUCT",
      data: {
        category: "MODULE",
        brand: "Tesla",
        vendorName: "Rell Power",
        zohoVendorId: "v123",
      },
      source: "clone",
    });
    expect(state.vendorName).toBe("Rell Power");
    expect(state.zohoVendorId).toBe("v123");
  });

  it("sets vendorHint and clears vendorName when source has vendorName but no zohoVendorId (legacy)", () => {
    const state = catalogFormReducer(initialFormState, {
      type: "PREFILL_FROM_PRODUCT",
      data: {
        category: "MODULE",
        brand: "Tesla",
        vendorName: "Rell Power",
      },
      source: "clone",
    });
    expect(state.vendorName).toBe("");
    expect(state.zohoVendorId).toBe("");
    expect(state.vendorHint).toBe("Rell Power");
    expect(state.prefillFields.has("vendorName")).toBe(false);
  });

  it("passes through vendorHint from datasheet extract", () => {
    const state = catalogFormReducer(initialFormState, {
      type: "PREFILL_FROM_PRODUCT",
      data: {
        category: "MODULE",
        vendorHint: "SolarEdge Inc",
      },
      source: "datasheet",
    });
    expect(state.vendorHint).toBe("SolarEdge Inc");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/lib/catalog-form-state.test.ts`

Expected: FAIL — `zohoVendorId` not on type, `SET_VENDOR` not in action union.

- [ ] **Step 3: Add zohoVendorId and vendorHint to CatalogFormState interface**

In `src/lib/catalog-form-state.ts`, add after the `vendorName` field (around line 12):

```typescript
  vendorName: string;
  zohoVendorId: string;
  vendorHint: string;   // UI-only hint from AI extract or legacy clone; not persisted to DB
```

- [ ] **Step 4: Add zohoVendorId and vendorHint to initialFormState**

After `vendorName: "",` (around line 43):

```typescript
  zohoVendorId: "",
  vendorHint: "",
```

- [ ] **Step 5: Add SET_VENDOR to CatalogFormAction union**

Add to the union type (around line 59-66):

```typescript
  | { type: "SET_VENDOR"; vendorName: string; zohoVendorId: string }
```

- [ ] **Step 6: Add SET_VENDOR case and guard SET_FIELD in reducer**

Replace the `SET_FIELD` case (line 73-74):

```typescript
    case "SET_FIELD": {
      const next = { ...state, [action.field]: action.value };
      // Defensive invariant: if vendorName is changed directly, clear zohoVendorId
      if (action.field === "vendorName") {
        next.zohoVendorId = "";
      }
      return next;
    }
```

Add a new case right after `SET_FIELD`:

```typescript
    case "SET_VENDOR":
      return {
        ...state,
        vendorName: action.vendorName,
        zohoVendorId: action.zohoVendorId,
      };
```

- [ ] **Step 7: Update PREFILL_FROM_PRODUCT for legacy vendor handling**

In the `PREFILL_FROM_PRODUCT` case (around line 93-138), add logic after the `for` loop that builds `updates` but before the clone-clear block. Insert after the `Object.entries(action.data)` loop ends:

```typescript
      // Legacy vendor handling: if vendorName present but zohoVendorId missing,
      // move vendorName to vendorHint so the picker shows it as a suggestion,
      // and clear vendorName so the user must re-select from the list.
      if (updates.vendorName && !updates.zohoVendorId) {
        (updates as Record<string, unknown>).vendorHint = updates.vendorName;
        delete (updates as Record<string, unknown>).vendorName;
        filledFields.delete("vendorName");
      }
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx jest src/__tests__/lib/catalog-form-state.test.ts`

Expected: All tests PASS (existing + 6 new).

- [ ] **Step 9: Commit**

```bash
git add src/lib/catalog-form-state.ts src/__tests__/lib/catalog-form-state.test.ts
git commit -m "feat: add zohoVendorId to form state with SET_VENDOR action and legacy clone guard"
```

---

### Task 4: Vendor Sync Route (POST /api/catalog/vendors/sync)

**Files:**
- Create: `src/app/api/catalog/vendors/sync/route.ts`
- Create: `src/__tests__/api/vendor-sync.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/api/vendor-sync.test.ts`:

```typescript
import { POST } from "@/app/api/catalog/vendors/sync/route";
import { prisma } from "@/lib/db";
import { NextRequest } from "next/server";

// Mock auth
jest.mock("@/lib/solar-auth", () => ({
  getServerSession: jest.fn(),
  requireRole: jest.fn(),
}));

// Mock Zoho client
const mockListVendors = jest.fn();
jest.mock("@/lib/zoho-inventory", () => ({
  getZohoClient: () => ({ listVendors: mockListVendors }),
}));

// Mock Prisma
jest.mock("@/lib/db", () => ({
  prisma: {
    vendorLookup: {
      upsert: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

const { requireRole } = jest.requireMock("@/lib/solar-auth");

function makeRequest(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/catalog/vendors/sync", {
    method: "POST",
    headers,
  });
}

describe("POST /api/catalog/vendors/sync", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    requireRole.mockResolvedValue({ user: { role: "ADMIN" } });
  });

  it("upserts vendors from Zoho and soft-deletes missing ones", async () => {
    mockListVendors.mockResolvedValue([
      { contact_id: "z1", contact_name: "Rell Power" },
      { contact_id: "z2", contact_name: "BayWa r.e." },
    ]);
    (prisma.vendorLookup.findMany as jest.Mock).mockResolvedValue([
      { zohoVendorId: "z1" },
      { zohoVendorId: "z3" }, // z3 no longer in Zoho
    ]);

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    // Should upsert both vendors
    expect(prisma.vendorLookup.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.vendorLookup.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { zohoVendorId: "z1" },
        update: expect.objectContaining({ name: "Rell Power", isActive: true }),
        create: expect.objectContaining({ zohoVendorId: "z1", name: "Rell Power" }),
      })
    );

    // Should soft-delete z3 (missing from Zoho response)
    expect(prisma.vendorLookup.updateMany).toHaveBeenCalledWith({
      where: { zohoVendorId: { in: ["z3"] } },
      data: { isActive: false },
    });
  });

  it("returns 502 when Zoho is unreachable", async () => {
    mockListVendors.mockRejectedValue(new Error("Zoho timeout"));

    const res = await POST(makeRequest());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain("Zoho");
  });

  it("accepts cron auth via CRON_SECRET header", async () => {
    const origSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "test-secret";
    requireRole.mockRejectedValue(new Error("Not authenticated"));

    mockListVendors.mockResolvedValue([]);
    (prisma.vendorLookup.findMany as jest.Mock).mockResolvedValue([]);

    const res = await POST(makeRequest({ authorization: "Bearer test-secret" }));
    expect(res.status).toBe(200);

    process.env.CRON_SECRET = origSecret;
  });

  it("rejects cron request with wrong secret", async () => {
    const origSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "test-secret";
    requireRole.mockRejectedValue(new Error("Not authenticated"));

    const res = await POST(makeRequest({ authorization: "Bearer wrong-secret" }));
    expect(res.status).toBe(401);

    process.env.CRON_SECRET = origSecret;
  });

  it("rejects unauthenticated requests", async () => {
    requireRole.mockRejectedValue(new Error("Not authenticated"));

    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/api/vendor-sync.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

Create `src/app/api/catalog/vendors/sync/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/solar-auth";
import { getZohoClient } from "@/lib/zoho-inventory";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest) {
  // Auth: admin role OR cron secret
  const cronHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  const isCron = cronSecret && cronHeader === `Bearer ${cronSecret}`;

  if (!isCron) {
    try {
      await requireRole(["ADMIN", "OWNER"]);
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const zoho = getZohoClient();
    const zohoVendors = await zoho.listVendors();

    const now = new Date();
    const zohoIds = new Set<string>();

    // Upsert all vendors from Zoho
    for (const v of zohoVendors) {
      zohoIds.add(v.contact_id);
      await prisma.vendorLookup.upsert({
        where: { zohoVendorId: v.contact_id },
        update: {
          name: v.contact_name,
          isActive: true,
          lastSyncedAt: now,
        },
        create: {
          zohoVendorId: v.contact_id,
          name: v.contact_name,
          isActive: true,
          lastSyncedAt: now,
        },
      });
    }

    // Soft-delete vendors no longer in Zoho
    const existing = await prisma.vendorLookup.findMany({
      select: { zohoVendorId: true },
    });
    const missing = existing
      .map((e) => e.zohoVendorId)
      .filter((id) => !zohoIds.has(id));

    if (missing.length > 0) {
      await prisma.vendorLookup.updateMany({
        where: { zohoVendorId: { in: missing } },
        data: { isActive: false },
      });
    }

    return NextResponse.json({
      synced: zohoVendors.length,
      deactivated: missing.length,
    });
  } catch (error) {
    console.error("[vendor-sync] Zoho sync failed:", error);
    return NextResponse.json(
      { error: `Zoho sync failed: ${error instanceof Error ? error.message : String(error)}` },
      { status: 502 }
    );
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/api/vendor-sync.test.ts`

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/catalog/vendors/sync/route.ts src/__tests__/api/vendor-sync.test.ts
git commit -m "feat: add vendor sync route with Zoho upsert and soft-delete"
```

---

### Task 5: Vendor List Route (GET /api/catalog/vendors)

**Files:**
- Create: `src/app/api/catalog/vendors/route.ts`
- Create: `src/__tests__/api/vendor-list.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/api/vendor-list.test.ts`:

```typescript
import { GET } from "@/app/api/catalog/vendors/route";
import { prisma } from "@/lib/db";
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  prisma: {
    vendorLookup: { findMany: jest.fn() },
  },
}));

function makeRequest(params = "") {
  return new NextRequest(`http://localhost/api/catalog/vendors${params}`);
}

describe("GET /api/catalog/vendors", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns active vendors sorted by name", async () => {
    (prisma.vendorLookup.findMany as jest.Mock).mockResolvedValue([
      { zohoVendorId: "z1", name: "BayWa r.e." },
      { zohoVendorId: "z2", name: "Rell Power" },
    ]);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.vendors).toEqual([
      { zohoVendorId: "z1", name: "BayWa r.e." },
      { zohoVendorId: "z2", name: "Rell Power" },
    ]);
    expect(prisma.vendorLookup.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isActive: true }),
        orderBy: { name: "asc" },
      })
    );
  });

  it("includes inactive vendor when includeId is specified", async () => {
    (prisma.vendorLookup.findMany as jest.Mock).mockResolvedValue([
      { zohoVendorId: "z1", name: "Active Vendor" },
      { zohoVendorId: "z-inactive", name: "Old Vendor" },
    ]);

    const res = await GET(makeRequest("?includeId=z-inactive"));
    expect(res.status).toBe(200);

    // Should query with OR condition including the specific ID
    expect(prisma.vendorLookup.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { isActive: true },
            { zohoVendorId: "z-inactive" },
          ],
        },
      })
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/api/vendor-list.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

Create `src/app/api/catalog/vendors/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const includeId = req.nextUrl.searchParams.get("includeId");

  const where = includeId
    ? { OR: [{ isActive: true }, { zohoVendorId: includeId }] }
    : { isActive: true };

  const vendors = await prisma.vendorLookup.findMany({
    where,
    select: { zohoVendorId: true, name: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ vendors });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/api/vendor-list.test.ts`

Expected: All 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/catalog/vendors/route.ts src/__tests__/api/vendor-list.test.ts
git commit -m "feat: add GET /api/catalog/vendors with includeId escape hatch"
```

---

## Chunk 3: UI Components

### Task 6: VendorPicker Component

**Files:**
- Create: `src/components/catalog/VendorPicker.tsx`

Reference: Model after `src/components/catalog/BrandDropdown.tsx` but with these differences:
- Fetches from `/api/catalog/vendors` instead of using a static array
- No "Add new" / custom entry mode — picker-only
- Calls `onChange(vendorName, zohoVendorId)` instead of `onChange(brand)`
- Has a "Refresh" button and "not found" admin escalation message
- Supports `hint` prop for placeholder text (used by datasheet/legacy clone prefill)

- [ ] **Step 1: Create VendorPicker component**

Create `src/components/catalog/VendorPicker.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Vendor {
  zohoVendorId: string;
  name: string;
}

interface VendorPickerProps {
  vendorName: string;
  zohoVendorId: string;
  onChange: (vendorName: string, zohoVendorId: string) => void;
  /** Placeholder hint from AI extraction or legacy clone */
  hint?: string;
}

export default function VendorPicker({
  vendorName,
  zohoVendorId,
  onChange,
  hint,
}: VendorPickerProps) {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchVendors = useCallback(async (includeId?: string) => {
    setLoading(true);
    setFetchError(false);
    try {
      const params = includeId ? `?includeId=${encodeURIComponent(includeId)}` : "";
      const res = await fetch(`/api/catalog/vendors${params}`);
      if (!res.ok) throw new Error("Failed to fetch vendors");
      const data = await res.json();
      setVendors(data.vendors ?? []);
    } catch {
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch (include current vendor if it might be inactive)
  useEffect(() => {
    fetchVendors(zohoVendorId || undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Click outside to close
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const filtered = vendors.filter((v) =>
    v.name.toLowerCase().includes(query.toLowerCase())
  );

  function select(v: Vendor) {
    onChange(v.name, v.zohoVendorId);
    setQuery("");
    setOpen(false);
  }

  function clear() {
    onChange("", "");
    setQuery("");
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        setOpen(true);
        e.preventDefault();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
        e.preventDefault();
        break;
      case "ArrowUp":
        setHighlighted((h) => Math.max(h - 1, 0));
        e.preventDefault();
        break;
      case "Enter":
        if (filtered[highlighted]) select(filtered[highlighted]);
        e.preventDefault();
        break;
      case "Escape":
        setOpen(false);
        e.preventDefault();
        break;
    }
  }

  const displayValue = vendorName || "";
  const placeholder = hint
    ? `AI suggested: ${hint} — select to confirm`
    : "Search vendors...";

  return (
    <div ref={containerRef} className="relative">
      {vendorName ? (
        <div className="flex items-center gap-2">
          <span className="flex-1 rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground">
            {displayValue}
          </span>
          <button
            type="button"
            onClick={clear}
            className="text-xs text-muted hover:text-foreground"
          >
            Clear
          </button>
        </div>
      ) : (
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHighlighted(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
        />
      )}

      {open && !vendorName && (
        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-t-border bg-surface-elevated shadow-card">
          {loading && (
            <div className="px-3 py-2 text-xs text-muted">Loading vendors...</div>
          )}
          {fetchError && (
            <div className="px-3 py-2 text-xs text-red-400">
              Failed to load vendors.{" "}
              <button
                type="button"
                onClick={() => fetchVendors()}
                className="underline hover:text-foreground"
              >
                Retry
              </button>
            </div>
          )}
          {!loading && !fetchError && filtered.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted">
              {query
                ? "No matching vendor found."
                : "No vendors available."}
              <div className="mt-1">
                <button
                  type="button"
                  onClick={() => fetchVendors()}
                  className="text-cyan-400 underline hover:text-cyan-300 mr-2"
                >
                  Refresh list
                </button>
                <span className="text-muted">
                  or contact admin to add it in Zoho
                </span>
              </div>
            </div>
          )}
          {!loading &&
            filtered.map((v, i) => (
              <button
                key={v.zohoVendorId}
                type="button"
                onClick={() => select(v)}
                className={`w-full px-3 py-2 text-left text-sm ${
                  i === highlighted
                    ? "bg-cyan-500/10 text-foreground"
                    : "text-foreground hover:bg-surface-2"
                }`}
              >
                {v.name}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/catalog/VendorPicker.tsx
git commit -m "feat: add VendorPicker component with search, refresh, and admin escalation"
```

---

### Task 7: DetailsStep Integration

**Files:**
- Modify: `src/components/catalog/DetailsStep.tsx`

- [ ] **Step 1: Add VendorPicker import**

At the top of `DetailsStep.tsx`, add:

```typescript
import VendorPicker from "./VendorPicker";
```

- [ ] **Step 2: Replace free-text vendor input with VendorPicker**

Find the vendorName input block (around lines 203-216) — the `<div>` with `fieldClass("vendorName")` containing the `<input>` for vendor name. Replace the entire `<input>` element with:

```tsx
            <VendorPicker
              vendorName={state.vendorName}
              zohoVendorId={state.zohoVendorId}
              onChange={(name, id) => {
                dispatch({ type: "SET_VENDOR", vendorName: name, zohoVendorId: id });
                dispatch({ type: "CLEAR_PREFILL_FIELD", field: "vendorName" });
              }}
            />
```

Keep the surrounding `<div>`, `<label>`, and `<FieldTooltip>` intact.

- [ ] **Step 3: Verify dev server renders correctly**

Run: `npm run dev` and navigate to the submit-product wizard. Confirm the DetailsStep shows the VendorPicker dropdown instead of a text input. Confirm the Brand dropdown on BasicsStep is unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/components/catalog/DetailsStep.tsx
git commit -m "feat: replace free-text vendor input with VendorPicker in DetailsStep"
```

---

## Chunk 4: Server Validation + Downstream

### Task 8: Pair-Aware Vendor Validation on POST Route

**Files:**
- Modify: `src/app/api/catalog/push-requests/route.ts`
- Modify: `src/__tests__/api/catalog-push-requests.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `src/__tests__/api/catalog-push-requests.test.ts`, in a new describe block:

```typescript
describe("vendor pair validation", () => {
  it("rejects vendorName without zohoVendorId", async () => {
    const res = await POST(
      makeRequest({
        ...validPayload(),
        vendorName: "Rell Power",
        zohoVendorId: "",
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("selected from the list");
  });

  it("rejects zohoVendorId without vendorName", async () => {
    const res = await POST(
      makeRequest({
        ...validPayload(),
        vendorName: "",
        zohoVendorId: "v123",
      })
    );
    expect(res.status).toBe(400);
  });

  it("rejects mismatched vendorName vs VendorLookup", async () => {
    // Mock prisma.vendorLookup.findUnique to return a different name
    (prisma.vendorLookup.findUnique as jest.Mock).mockResolvedValue({
      zohoVendorId: "v123",
      name: "Rell Power",
    });

    const res = await POST(
      makeRequest({
        ...validPayload(),
        vendorName: "Wrong Name",
        zohoVendorId: "v123",
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("does not match");
  });

  it("accepts valid vendor pair", async () => {
    (prisma.vendorLookup.findUnique as jest.Mock).mockResolvedValue({
      zohoVendorId: "v123",
      name: "Rell Power",
    });

    const res = await POST(
      makeRequest({
        ...validPayload(),
        vendorName: "Rell Power",
        zohoVendorId: "v123",
      })
    );
    expect(res.status).toBe(201);
  });

  it("accepts both blank (vendor is optional)", async () => {
    const res = await POST(
      makeRequest({
        ...validPayload(),
        vendorName: "",
        zohoVendorId: "",
      })
    );
    expect(res.status).toBe(201);
  });
});
```

Note: `validPayload()` and `makeRequest()` should already exist as test helpers in this file. If `prisma.vendorLookup.findUnique` is not in the mock, add it to the existing Prisma mock setup:

```typescript
vendorLookup: { findUnique: jest.fn() },
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/api/catalog-push-requests.test.ts`

Expected: New tests FAIL (no vendor validation in route yet).

- [ ] **Step 3: Add vendor pair validation to POST route**

In `src/app/api/catalog/push-requests/route.ts`, after destructuring `zohoVendorId` from the body (add it to the destructuring on line 31-36), and after the existing top-level validation block, add:

```typescript
  // Extract zohoVendorId (add to destructuring)
  const zohoVendorId = body.zohoVendorId as string | undefined;

  // Vendor pair validation
  const hasVendorName = !isBlank(vendorName);
  const hasZohoVendorId = !isBlank(zohoVendorId);

  if (hasVendorName && !hasZohoVendorId) {
    return NextResponse.json(
      { error: "Vendor must be selected from the list" },
      { status: 400 }
    );
  }
  if (!hasVendorName && hasZohoVendorId) {
    return NextResponse.json(
      { error: "Vendor ID provided without vendor name" },
      { status: 400 }
    );
  }
  if (hasVendorName && hasZohoVendorId) {
    const lookup = await prisma.vendorLookup.findUnique({
      where: { zohoVendorId: String(zohoVendorId) },
    });
    if (!lookup || lookup.name !== String(vendorName).trim()) {
      return NextResponse.json(
        { error: "Vendor name does not match the selected vendor record" },
        { status: 400 }
      );
    }
  }
```

Also add `zohoVendorId` to the `PendingCatalogPush.create()` call:

```typescript
  zohoVendorId: hasZohoVendorId ? String(zohoVendorId).trim() : null,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/api/catalog-push-requests.test.ts`

Expected: All tests PASS (existing + 5 new).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/catalog/push-requests/route.ts src/__tests__/api/catalog-push-requests.test.ts
git commit -m "feat: add pair-aware vendor validation to catalog push-requests POST route"
```

---

### Task 9: Approval Route + Zoho Downstream Changes

**Files:**
- Modify: `src/app/api/catalog/push-requests/[id]/approve/route.ts`
- Modify: `src/lib/zoho-inventory.ts`
- Modify: `src/app/dashboards/submit-product/page.tsx`

- [ ] **Step 1: Add zohoVendorId to UpsertZohoItemInput**

In `src/lib/zoho-inventory.ts`, add to the `UpsertZohoItemInput` interface (around line 36-51):

```typescript
  zohoVendorId?: string | null;
```

- [ ] **Step 2: Wire vendor_id in createOrUpdateItem**

In `createOrUpdateItem()`, after the line that sets `vendorName` (around line 691):

```typescript
    const zohoVendorId = trimOrUndefined(input.zohoVendorId);
```

In the item payload construction (around line 775, where `vendor_name` is set):

```typescript
      ...(zohoVendorId ? { vendor_id: zohoVendorId } : {}),
```

- [ ] **Step 3: Add vendor fields to existing-item update path**

In `src/lib/zoho-inventory.ts`, replace the existing-item update block at lines 722-743. The current code only updates `group_name`:

```typescript
    // CURRENT (lines 722-743):
    if (existingItemId) {
      const groupName = input.category ? getZohoGroupName(input.category) : undefined;
      if (groupName) {
        try {
          const updateResult = await this.updateItem(existingItemId, { group_name: groupName });
          // ... warning logic ...
        } catch (error) { /* ... */ }
      }
      return { zohoItemId: existingItemId, created: false };
    }
```

Replace the entire `if (existingItemId) { ... }` block (lines 722-744) with:

```typescript
    if (existingItemId) {
      // Best-effort update of group, vendor fields on existing items
      const groupName = input.category ? getZohoGroupName(input.category) : undefined;
      const updatePayload: Record<string, unknown> = {};
      if (groupName) updatePayload.group_name = groupName;
      if (vendorName) updatePayload.vendor_name = vendorName;
      if (zohoVendorId) updatePayload.vendor_id = zohoVendorId;

      if (Object.keys(updatePayload).length > 0) {
        try {
          const updateResult = await this.updateItem(existingItemId, updatePayload);
          if (updateResult.status !== "updated") {
            console.warn(
              `[zoho-inventory] Best-effort update on existing item ${existingItemId} ` +
                `returned status "${updateResult.status}": ${updateResult.message}`
            );
          }
        } catch (error) {
          console.warn(
            `[zoho-inventory] Failed to update existing item ${existingItemId}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
      return { zohoItemId: existingItemId, created: false };
    }
```

- [ ] **Step 4: Add zohoVendorId to approval route EquipmentSku upsert**

In `src/app/api/catalog/push-requests/[id]/approve/route.ts`, find the `commonFields` object or the `EquipmentSku.upsert` call (around lines 131-147). Add `zohoVendorId` to the fields being copied from `push`:

```typescript
  zohoVendorId: push.zohoVendorId,
```

- [ ] **Step 5: Add zohoVendorId to Zoho downstream call**

In the same approval route, find the `createOrUpdateZohoItem` call (around lines 268-282). Add:

```typescript
  zohoVendorId: push.zohoVendorId,
```

- [ ] **Step 6: Add zohoVendorId to handleSubmit payload**

In `src/app/dashboards/submit-product/page.tsx`, find the payload construction (around lines 195-217). Add after the `vendorName` line:

```typescript
  zohoVendorId: state.zohoVendorId || null,
```

- [ ] **Step 7: Run existing tests to verify nothing broke**

Run: `npx jest --testPathIgnorePatterns=".worktrees" --no-coverage`

Expected: No new failures.

- [ ] **Step 8: Commit**

```bash
git add src/lib/zoho-inventory.ts src/app/api/catalog/push-requests/[id]/approve/route.ts src/app/dashboards/submit-product/page.tsx
git commit -m "feat: wire zohoVendorId through approval route and Zoho create+update paths"
```

---

## Chunk 5: Prefill Paths + Backfill

### Task 10: Clone Normalization + URL Prefill

**Files:**
- Modify: `src/app/dashboards/submit-product/page.tsx`
- Modify: `src/app/api/catalog/search/route.ts` (if zohoVendorId not in SELECT)

- [ ] **Step 1: Add zohoVendorId to clone field map**

In `src/app/dashboards/submit-product/page.tsx`, find `CLONE_FIELD_MAP` (around line 35-47). Add `"zohoVendorId"` to the array.

- [ ] **Step 2: Add zohoVendorId to search route SELECT**

In `src/app/api/catalog/search/route.ts`, find the `select` object in the Prisma query (around lines 24-52). Add:

```typescript
  zohoVendorId: true,
```

- [ ] **Step 3: Handle URL query param vendor prefill**

In the submit-product page, find the URL param prefill section (around line 105-130). If `vendorName` is prefilled via URL, attempt to resolve `zohoVendorId`:

This requires a fetch to `/api/catalog/vendors` — but since it's SSR/client, the simplest approach is: set `vendorName` in state, leave `zohoVendorId` blank, and let the user confirm via the picker. The picker will show the hint. No fetch needed at prefill time.

No code change needed here — the existing behavior (set vendorName, no zohoVendorId) combined with the legacy-clone logic in `PREFILL_FROM_PRODUCT` already handles this correctly by clearing vendorName when zohoVendorId is missing.

**For URL params specifically**: URL prefill goes through `SET_FIELD`, not `PREFILL_FROM_PRODUCT`. The `SET_FIELD` guard already clears `zohoVendorId` when `vendorName` is set. This means the user will see an empty vendor picker and need to select. This is acceptable for URL params.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboards/submit-product/page.tsx src/app/api/catalog/search/route.ts
git commit -m "feat: include zohoVendorId in clone field map and search SELECT"
```

---

### Task 11: Datasheet Extract Vendor Matching

**Files:**
- Modify: `src/app/api/catalog/extract-from-datasheet/route.ts`

- [ ] **Step 1: Add vendor matching after AI extraction**

In `src/app/api/catalog/extract-from-datasheet/route.ts`, find the return statement (around lines 195-197). Before returning, if the AI extracted a `vendorName` (or similar field), attempt to match it:

```typescript
import { prisma } from "@/lib/db";
import { matchVendorName } from "@/lib/vendor-normalize";
```

After the `extracted` object is built (around line 183), add:

```typescript
  // Attempt vendor matching if AI extracted a vendor
  const extractedVendor = extracted.vendorName as string | undefined;
  if (extractedVendor) {
    const lookups = await prisma.vendorLookup.findMany({
      where: { isActive: true },
      select: { zohoVendorId: true, name: true },
    });
    const match = matchVendorName(extractedVendor, lookups);
    if (match) {
      extracted.vendorName = match.name;
      extracted.zohoVendorId = match.zohoVendorId;
    } else {
      // Keep as hint, no zohoVendorId — user must pick manually
      extracted.vendorHint = extractedVendor;
      delete extracted.vendorName;
    }
  }
```

- [ ] **Step 2: Pass vendorHint through to VendorPicker**

`vendorHint` is already in `CatalogFormState` (added in Task 3). It is **not persisted** to the database — it's UI-only guidance that gets discarded after submission. The `PREFILL_FROM_PRODUCT` reducer already handles it as a passthrough field (Task 3, Step 7).

In `src/components/catalog/DetailsStep.tsx`, pass the hint to the VendorPicker:

```tsx
<VendorPicker
  vendorName={state.vendorName}
  zohoVendorId={state.zohoVendorId}
  hint={state.vendorHint}
  onChange={(name, id) => {
    dispatch({ type: "SET_VENDOR", vendorName: name, zohoVendorId: id });
    dispatch({ type: "CLEAR_PREFILL_FIELD", field: "vendorName" });
  }}
/>
```

Note: this replaces the VendorPicker from Task 7 (which didn't pass `hint`). Ensure `hint={state.vendorHint}` is present.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/catalog/extract-from-datasheet/route.ts src/lib/catalog-form-state.ts src/components/catalog/DetailsStep.tsx src/app/dashboards/submit-product/page.tsx
git commit -m "feat: add vendor matching on datasheet extract with hint fallback"
```

---

### Task 12: Backfill Script

**Files:**
- Create: `scripts/backfill-vendor-ids.ts`

- [ ] **Step 1: Write backfill script**

Create `scripts/backfill-vendor-ids.ts`:

```typescript
import { PrismaClient } from "../src/generated/prisma/client";
import { matchVendorName } from "../src/lib/vendor-normalize";

const prisma = new PrismaClient();
const applyMode = process.argv.includes("--apply");

async function main() {
  console.log(`Mode: ${applyMode ? "APPLY" : "DRY-RUN"}`);

  // Load all active vendor lookups
  const lookups = await prisma.vendorLookup.findMany({
    where: { isActive: true },
    select: { zohoVendorId: true, name: true },
  });
  console.log(`Loaded ${lookups.length} active vendors from VendorLookup`);

  // Find SKUs with vendorName but no zohoVendorId
  const skus = await prisma.equipmentSku.findMany({
    where: {
      vendorName: { not: null },
      zohoVendorId: null,
    },
    select: { id: true, vendorName: true, brand: true, model: true },
  });
  console.log(`Found ${skus.length} SKUs with vendorName but no zohoVendorId\n`);

  let matched = 0;
  let unmatched = 0;

  for (const sku of skus) {
    const result = matchVendorName(sku.vendorName!, lookups);
    if (result) {
      matched++;
      console.log(
        `  MATCH: "${sku.vendorName}" → "${result.name}" (${result.zohoVendorId}) — ${sku.brand} ${sku.model}`
      );
      if (applyMode) {
        await prisma.equipmentSku.update({
          where: { id: sku.id },
          data: { zohoVendorId: result.zohoVendorId },
        });
      }
    } else {
      unmatched++;
      console.log(
        `  NO MATCH: "${sku.vendorName}" — ${sku.brand} ${sku.model}`
      );
    }
  }

  console.log(`\nEquipmentSku: ${matched} matched, ${unmatched} unmatched`);

  // Also backfill PendingCatalogPush records
  const pushes = await prisma.pendingCatalogPush.findMany({
    where: {
      vendorName: { not: null },
      zohoVendorId: null,
    },
    select: { id: true, vendorName: true, brand: true, model: true },
  });
  console.log(`\nFound ${pushes.length} PendingCatalogPush records with vendorName but no zohoVendorId`);

  let pushMatched = 0;
  let pushUnmatched = 0;

  for (const push of pushes) {
    const result = matchVendorName(push.vendorName!, lookups);
    if (result) {
      pushMatched++;
      console.log(
        `  MATCH: "${push.vendorName}" → "${result.name}" (${result.zohoVendorId}) — ${push.brand} ${push.model}`
      );
      if (applyMode) {
        await prisma.pendingCatalogPush.update({
          where: { id: push.id },
          data: { zohoVendorId: result.zohoVendorId },
        });
      }
    } else {
      pushUnmatched++;
      console.log(
        `  NO MATCH: "${push.vendorName}" — ${push.brand} ${push.model}`
      );
    }
  }

  console.log(`PendingCatalogPush: ${pushMatched} matched, ${pushUnmatched} unmatched`);
  const totalMatched = matched + pushMatched;
  if (!applyMode && totalMatched > 0) {
    console.log(`\nRun with --apply to write the ${totalMatched} matches.`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Test dry-run locally**

Run: `npx tsx scripts/backfill-vendor-ids.ts`

Expected: Lists SKUs with/without matches, no writes. (Will show 0 matches if VendorLookup is empty — that's fine, the sync must run first.)

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill-vendor-ids.ts
git commit -m "feat: add vendor ID backfill script with dry-run and apply modes"
```

---

### Task 13: Vercel Cron Configuration

**Files:**
- Modify: `vercel.json` (or create if it doesn't exist)

- [ ] **Step 1: Check for existing vercel.json**

Run: `cat vercel.json 2>/dev/null || echo "not found"`

- [ ] **Step 2: Add cron job for vendor sync**

Add or update `vercel.json` with a cron entry:

```json
{
  "crons": [
    {
      "path": "/api/catalog/vendors/sync",
      "schedule": "0 */6 * * *"
    }
  ]
}
```

If `vercel.json` already exists with other config, merge the `crons` array.

- [ ] **Step 3: Ensure CRON_SECRET is in Vercel env vars**

Document: The `CRON_SECRET` env var must be set in Vercel project settings. Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` for cron requests.

- [ ] **Step 4: Commit**

```bash
git add vercel.json
git commit -m "feat: add Vercel cron for vendor sync every 6 hours"
```

---

## Execution Order & Parallelism

| Batch | Tasks | Can Parallelize |
|-------|-------|-----------------|
| 1 | Task 1 (migration), Task 2 (normalize utility) | Yes — independent |
| 2 | Task 3 (form state), Task 4 (sync route), Task 5 (GET route) | Yes — independent after batch 1 |
| 3 | Task 6 (VendorPicker), Task 7 (DetailsStep), Task 8 (server validation) | Task 6 first, then Task 7 depends on 6. Task 8 is independent. |
| 4 | Task 9 (approval + Zoho downstream) | Solo — touches multiple integration files |
| 5 | Task 10 (clone/URL prefill), Task 11 (datasheet matching), Task 12 (backfill), Task 13 (cron) | Yes — all independent |
