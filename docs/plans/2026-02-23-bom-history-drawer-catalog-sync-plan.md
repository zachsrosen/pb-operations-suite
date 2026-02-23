# BOM History Drawer + Catalog Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a slide-over history drawer to the BOM page, an approval-gated "push to systems" action on unmatched BOM rows, and a new `/dashboards/catalog` page for SKU management with a pending approvals queue.

**Architecture:** Three independent deliverables implemented in order. The drawer is pure frontend (no schema change). The push-to-systems feature requires a new `PendingCatalogPush` Prisma model and API routes. The catalog page is a new dashboard consuming existing `/api/inventory/skus` plus the new push-request routes. All four external system integrations (Zoho, HubSpot, Zuper, internal) fire server-side on admin approval only.

**Tech Stack:** Next.js 15 App Router, React 19, Prisma 7 on Neon Postgres, Tailwind v4 CSS tokens, `requireApiAuth` + role checks for all write routes, existing `useToast` for feedback.

---

## Important Codebase Notes

- **Auth in API routes:** `import { requireApiAuth } from "@/lib/api-auth"` — returns `{ email, role }` or a `NextResponse` 401/403. Always check `if (authResult instanceof NextResponse) return authResult`.
- **Prisma client:** `import { prisma } from "@/lib/db"` — check `if (!prisma)` and return 503.
- **Theme tokens:** Use `bg-surface`, `bg-surface-2`, `bg-surface-elevated`, `text-foreground`, `text-muted`, `border-t-border`, `shadow-card` — never hardcode colors.
- **`EquipmentCategory` enum** currently has: `MODULE`, `INVERTER`, `BATTERY`, `EV_CHARGER`. The BOM page uses more categories (`RACKING`, `RAPID_SHUTDOWN`, `ELECTRICAL_BOS`, `MONITORING`) that are **not** in the Prisma enum — these are BOM-only display categories. The push-to-systems flow must handle this mismatch (only push items whose category is a valid `EquipmentCategory`).
- **Existing SKU route:** `POST /api/inventory/skus` already upserts to Postgres. Reuse it.
- **Zoho:** `zohoItemId` field already exists on `EquipmentSku`. Zoho client lives in `src/lib/zoho-inventory.ts`.
- **HubSpot / Zuper:** No existing product-creation helpers. Stubs are acceptable in Phase 1 with TODO comments.
- **Admin roles:** `ADMIN`, `OWNER`, `MANAGER` can approve pushes.

---

## Phase 1 — BOM History Drawer

### Task 1: Extract shared BOM history types and helpers

**Files:**
- Create: `src/lib/bom-history.ts`

**Step 1: Create the shared util file**

```ts
// src/lib/bom-history.ts

export interface BomSnapshot {
  id: string;
  dealId: string;
  dealName: string;
  version: number;
  sourceFile: string | null;
  savedBy: string | null;
  createdAt: string;
  customer: string | null;
  address: string | null;
  systemSizeKwdc: number | string | null;
  moduleCount: number | string | null;
  itemCount: number;
}

export function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? "s" : ""} ago`;
  if (diffHr < 24) return `${diffHr} hour${diffHr !== 1 ? "s" : ""} ago`;
  if (diffDay === 1) return "yesterday";
  if (diffDay < 7) return `${diffDay} days ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function getDateGroup(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const nowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const itemDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((nowDate.getTime() - itemDate.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return "This Week";
  return "Older";
}

export const GROUP_ORDER = ["Today", "Yesterday", "This Week", "Older"] as const;
```

**Step 2: Run lint to confirm no errors**

```bash
npm run lint -- --max-warnings=0 src/lib/bom-history.ts
```
Expected: no errors.

**Step 3: Commit**

```bash
git add src/lib/bom-history.ts
git commit -m "feat: extract BOM history types and helpers to shared util"
```

---

### Task 2: Build the BomHistoryDrawer component

**Files:**
- Create: `src/components/BomHistoryDrawer.tsx`

**Step 1: Write the component**

```tsx
// src/components/BomHistoryDrawer.tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import { BomSnapshot, relativeTime, getDateGroup, GROUP_ORDER } from "@/lib/bom-history";

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (snap: BomSnapshot) => void;
}

export default function BomHistoryDrawer({ open, onClose, onSelect }: Props) {
  const [snapshots, setSnapshots] = useState<BomSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Fetch once when drawer first opens
  useEffect(() => {
    if (!open || snapshots.length > 0) return;
    setLoading(true);
    setError(null);
    fetch("/api/bom/history/all")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setSnapshots(data.snapshots ?? []);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [open, snapshots.length]);

  const filtered = useMemo(() => {
    if (!search.trim()) return snapshots;
    const q = search.toLowerCase();
    return snapshots.filter(
      (s) =>
        s.dealName?.toLowerCase().includes(q) ||
        s.customer?.toLowerCase().includes(q) ||
        s.address?.toLowerCase().includes(q)
    );
  }, [snapshots, search]);

  const grouped = useMemo(() => {
    const map: Record<string, BomSnapshot[]> = {};
    for (const s of filtered) {
      const g = getDateGroup(s.createdAt);
      if (!map[g]) map[g] = [];
      map[g].push(s);
    }
    return map;
  }, [filtered]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div className="fixed right-0 top-0 z-50 h-full w-full max-w-lg bg-surface shadow-card-lg flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-t-border bg-surface-2 flex-shrink-0">
          <h2 className="text-base font-semibold text-foreground">BOM History</h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-foreground transition-colors text-lg leading-none"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-t-border flex-shrink-0">
          <input
            type="text"
            placeholder="Search deal, customer, or address…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
          />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {loading && (
            <p className="text-sm text-muted animate-pulse text-center py-8">Loading history…</p>
          )}
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div className="text-center py-12 text-muted text-sm">
              {search ? "No results for that search." : "No BOM snapshots saved yet."}
            </div>
          )}
          {!loading && !error && filtered.length > 0 &&
            GROUP_ORDER.filter((g) => grouped[g]?.length).map((group) => (
              <div key={group}>
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-widest text-muted">{group}</span>
                  <span className="text-xs text-muted">({grouped[group].length})</span>
                  <div className="flex-1 border-t border-t-border" />
                </div>
                <div className="rounded-xl border border-t-border bg-surface overflow-hidden">
                  {grouped[group].map((s) => (
                    <button
                      key={s.id}
                      onClick={() => { onSelect(s); onClose(); }}
                      className="w-full text-left border-b border-t-border last:border-b-0 px-4 py-3 hover:bg-surface-2 transition-colors"
                    >
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="inline-flex items-center rounded-md bg-cyan-500/15 px-1.5 py-0.5 text-xs font-semibold text-cyan-400 ring-1 ring-cyan-500/30">
                          v{s.version}
                        </span>
                        <span className="font-medium text-sm text-foreground truncate">{s.dealName}</span>
                      </div>
                      {s.customer && <div className="text-xs text-muted truncate">{s.customer}</div>}
                      {s.address && <div className="text-xs text-muted truncate">{s.address}</div>}
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted">
                        {s.systemSizeKwdc != null && <span>{s.systemSizeKwdc} kWdc</span>}
                        {s.moduleCount != null && <span>{s.moduleCount} modules</span>}
                        <span>{s.itemCount} items</span>
                        <span className="ml-auto">{relativeTime(s.createdAt)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))
          }
        </div>

        {/* Footer count */}
        {!loading && snapshots.length > 0 && (
          <div className="px-5 py-3 border-t border-t-border bg-surface-2 flex-shrink-0">
            <p className="text-xs text-muted text-center">
              {filtered.length} of {snapshots.length} snapshot{snapshots.length !== 1 ? "s" : ""}
            </p>
          </div>
        )}
      </div>
    </>
  );
}
```

**Step 2: Run lint**

```bash
npm run lint -- --max-warnings=0 src/components/BomHistoryDrawer.tsx
```
Expected: no errors.

**Step 3: Commit**

```bash
git add src/components/BomHistoryDrawer.tsx
git commit -m "feat: add BomHistoryDrawer slide-over component"
```

---

### Task 3: Wire BomHistoryDrawer into the BOM page

**Files:**
- Modify: `src/app/dashboards/bom/page.tsx`

**Step 1: Add import near top of page.tsx**

After the existing imports, add:
```tsx
import BomHistoryDrawer from "@/components/BomHistoryDrawer";
import type { BomSnapshot as BomSnapshotGlobal } from "@/lib/bom-history";
```

**Step 2: Add `historyDrawerOpen` state**

Find the block of `useState` declarations (around line 370–390) and add:
```tsx
const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
```

**Step 3: Replace the "⏱ BOM History" button**

Find (around line 1604):
```tsx
<button
  onClick={() => router.push("/dashboards/bom/history")}
  className="px-4 py-2 rounded-lg bg-surface border border-t-border text-sm text-foreground hover:bg-surface-2 transition-colors"
>
  ⏱ BOM History
</button>
```

Replace with:
```tsx
<button
  onClick={() => setHistoryDrawerOpen(true)}
  className="px-4 py-2 rounded-lg bg-surface border border-t-border text-sm text-foreground hover:bg-surface-2 transition-colors"
>
  ⏱ BOM History
</button>
```

**Step 4: Add the drawer just before the closing `</DashboardShell>`**

Find `</DashboardShell>` near the end of the return statement and add before it:
```tsx
<BomHistoryDrawer
  open={historyDrawerOpen}
  onClose={() => setHistoryDrawerOpen(false)}
  onSelect={(snap: BomSnapshotGlobal) => {
    // Navigate to the deal and load the BOM (same as clicking a row on history page)
    router.push(`/dashboards/bom?deal=${snap.dealId}&load=latest`);
  }}
/>
```

**Step 5: Run lint and dev server**

```bash
npm run lint -- --max-warnings=0 src/app/dashboards/bom/page.tsx
npm run dev
```

Open `/dashboards/bom`, extract a BOM, click "⏱ BOM History" — drawer should slide in from right.

**Step 6: Commit**

```bash
git add src/app/dashboards/bom/page.tsx
git commit -m "feat: replace BOM history navigation with slide-over drawer"
```

---

## Phase 2 — Prisma Schema + Push Request API

### Task 4: Add PendingCatalogPush to Prisma schema

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: Add enum and model at end of schema (before final closing)**

```prisma
enum PushStatus {
  PENDING
  APPROVED
  REJECTED
}

model PendingCatalogPush {
  id          String     @id @default(cuid())
  status      PushStatus @default(PENDING)
  // Item data snapshot (what was in the BOM row at time of request)
  brand       String
  model       String
  description String
  category    String     // BOM category string (may not be EquipmentCategory enum)
  unitSpec    String?
  unitLabel   String?
  // Which systems to push to
  systems     String[]   // ["INTERNAL", "ZOHO", "HUBSPOT", "ZUPER"]
  // Context
  requestedBy String     // user email
  dealId      String?
  note        String?    // rejection note from admin
  // Results after approval (nullable until approved)
  internalSkuId  String?
  zohoItemId     String?
  hubspotProductId String?
  zuperItemId    String?
  createdAt   DateTime   @default(now())
  resolvedAt  DateTime?

  @@index([status])
  @@index([requestedBy])
}
```

**Step 2: Run migration**

```bash
npx prisma migrate dev --name add_pending_catalog_push
```
Expected: migration created and applied, `npx prisma generate` runs automatically.

**Step 3: Verify**

```bash
npx prisma studio
```
Check that `PendingCatalogPush` table exists. Close studio.

**Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): add PendingCatalogPush model for approval-gated system sync"
```

---

### Task 5: Build POST /api/catalog/push-requests (submit request)

**Files:**
- Create: `src/app/api/catalog/push-requests/route.ts`

**Step 1: Write the route**

```ts
// src/app/api/catalog/push-requests/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";

const VALID_SYSTEMS = ["INTERNAL", "ZOHO", "HUBSPOT", "ZUPER"];

export async function POST(request: NextRequest) {
  if (!prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { brand, model, description, category, unitSpec, unitLabel, systems, dealId } = body as Record<string, unknown>;

  if (!brand || !model || !description || !category) {
    return NextResponse.json({ error: "brand, model, description, category are required" }, { status: 400 });
  }
  if (!Array.isArray(systems) || systems.length === 0) {
    return NextResponse.json({ error: "systems must be a non-empty array" }, { status: 400 });
  }
  const invalidSystems = (systems as string[]).filter((s) => !VALID_SYSTEMS.includes(s));
  if (invalidSystems.length > 0) {
    return NextResponse.json({ error: `Invalid systems: ${invalidSystems.join(", ")}` }, { status: 400 });
  }

  const push = await prisma.pendingCatalogPush.create({
    data: {
      brand: String(brand).trim(),
      model: String(model).trim(),
      description: String(description).trim(),
      category: String(category),
      unitSpec: unitSpec ? String(unitSpec) : null,
      unitLabel: unitLabel ? String(unitLabel) : null,
      systems: systems as string[],
      requestedBy: authResult.email,
      dealId: dealId ? String(dealId) : null,
    },
  });

  return NextResponse.json({ push }, { status: 201 });
}

export async function GET(request: NextRequest) {
  if (!prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const status = request.nextUrl.searchParams.get("status") ?? "PENDING";

  const pushes = await prisma.pendingCatalogPush.findMany({
    where: { status: status as "PENDING" | "APPROVED" | "REJECTED" },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ pushes, count: pushes.length });
}
```

**Step 2: Run lint**

```bash
npm run lint -- --max-warnings=0 src/app/api/catalog/push-requests/route.ts
```

**Step 3: Test manually**

```bash
curl -X POST http://localhost:3000/api/catalog/push-requests \
  -H "Content-Type: application/json" \
  -d '{"brand":"Tesla","model":"1707000-XX-Y","description":"TESLA POWERWALL 3","category":"BATTERY","systems":["INTERNAL","ZOHO"]}'
```
Expected: 201 with push object (will 401 without session in prod — test via browser).

**Step 4: Commit**

```bash
git add src/app/api/catalog/push-requests/route.ts
git commit -m "feat(api): POST/GET /api/catalog/push-requests for approval queue"
```

---

### Task 6: Build approve + reject endpoints

**Files:**
- Create: `src/app/api/catalog/push-requests/[id]/approve/route.ts`
- Create: `src/app/api/catalog/push-requests/[id]/reject/route.ts`

**Step 1: Write approve route**

```ts
// src/app/api/catalog/push-requests/[id]/approve/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";
import { EquipmentCategory } from "@/generated/prisma/enums";

const ADMIN_ROLES = ["ADMIN", "OWNER", "MANAGER"];
const INTERNAL_CATEGORIES = Object.values(EquipmentCategory) as string[];

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  if (!ADMIN_ROLES.includes(authResult.role)) {
    return NextResponse.json({ error: "Admin role required" }, { status: 403 });
  }

  const { id } = await params;
  const push = await prisma.pendingCatalogPush.findUnique({ where: { id } });
  if (!push) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (push.status !== "PENDING") {
    return NextResponse.json({ error: `Already ${push.status.toLowerCase()}` }, { status: 409 });
  }

  const results: Record<string, string | null> = {
    internalSkuId: null,
    zohoItemId: null,
    hubspotProductId: null,
    zuperItemId: null,
  };

  // INTERNAL catalog
  if (push.systems.includes("INTERNAL") && INTERNAL_CATEGORIES.includes(push.category)) {
    const sku = await prisma.equipmentSku.upsert({
      where: {
        category_brand_model: {
          category: push.category as EquipmentCategory,
          brand: push.brand,
          model: push.model,
        },
      },
      update: { isActive: true },
      create: {
        category: push.category as EquipmentCategory,
        brand: push.brand,
        model: push.model,
        unitSpec: push.unitSpec ? parseFloat(push.unitSpec) : null,
        unitLabel: push.unitLabel,
      },
    });
    results.internalSkuId = sku.id;
  }

  // ZOHO — TODO: implement when Zoho item-create API is wired
  if (push.systems.includes("ZOHO")) {
    // TODO: call zoho-inventory create item API
    // const zohoRes = await createZohoItem({ name: push.model, description: push.description, ... });
    // results.zohoItemId = zohoRes.item_id;
    console.log("[catalog/approve] ZOHO push not yet implemented for:", push.model);
  }

  // HUBSPOT — TODO: implement when HubSpot product API is wired
  if (push.systems.includes("HUBSPOT")) {
    // TODO: call HubSpot Products API
    console.log("[catalog/approve] HUBSPOT push not yet implemented for:", push.model);
  }

  // ZUPER — TODO: implement when Zuper parts API is wired
  if (push.systems.includes("ZUPER")) {
    // TODO: call Zuper parts/items API
    console.log("[catalog/approve] ZUPER push not yet implemented for:", push.model);
  }

  const updated = await prisma.pendingCatalogPush.update({
    where: { id },
    data: {
      status: "APPROVED",
      resolvedAt: new Date(),
      ...results,
    },
  });

  return NextResponse.json({ push: updated });
}
```

**Step 2: Write reject route**

```ts
// src/app/api/catalog/push-requests/[id]/reject/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";

const ADMIN_ROLES = ["ADMIN", "OWNER", "MANAGER"];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  if (!ADMIN_ROLES.includes(authResult.role)) {
    return NextResponse.json({ error: "Admin role required" }, { status: 403 });
  }

  const { id } = await params;
  const push = await prisma.pendingCatalogPush.findUnique({ where: { id } });
  if (!push) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (push.status !== "PENDING") {
    return NextResponse.json({ error: `Already ${push.status.toLowerCase()}` }, { status: 409 });
  }

  let note: string | undefined;
  try { const body = await request.json(); note = body.note; } catch { /* optional */ }

  const updated = await prisma.pendingCatalogPush.update({
    where: { id },
    data: { status: "REJECTED", resolvedAt: new Date(), note: note ?? null },
  });

  return NextResponse.json({ push: updated });
}
```

**Step 3: Run lint on both**

```bash
npm run lint -- --max-warnings=0 src/app/api/catalog/push-requests/
```

**Step 4: Commit**

```bash
git add src/app/api/catalog/push-requests/
git commit -m "feat(api): approve/reject endpoints for catalog push requests"
```

---

## Phase 3 — BOM Page "Push to Systems" Button

### Task 7: Add PushToSystemsModal component

**Files:**
- Create: `src/components/PushToSystemsModal.tsx`

**Step 1: Write the modal**

```tsx
// src/components/PushToSystemsModal.tsx
"use client";

import { useState } from "react";
import { useToast } from "@/contexts/ToastContext";

export interface PushItem {
  brand: string;
  model: string;
  description: string;
  category: string;
  unitSpec?: string | number | null;
  unitLabel?: string | null;
  dealId?: string;
}

interface Props {
  item: PushItem | null;
  onClose: () => void;
}

const SYSTEMS = [
  { key: "INTERNAL", label: "Internal Catalog", description: "Postgres EquipmentSku" },
  { key: "ZOHO",     label: "Zoho Inventory",   description: "Product in Zoho" },
  { key: "HUBSPOT",  label: "HubSpot Products",  description: "Product in HubSpot" },
  { key: "ZUPER",    label: "Zuper Parts",        description: "Part in Zuper" },
] as const;

export default function PushToSystemsModal({ item, onClose }: Props) {
  const { addToast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(
    new Set(["INTERNAL", "ZOHO", "HUBSPOT", "ZUPER"])
  );
  const [submitting, setSubmitting] = useState(false);

  if (!item) return null;

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function handleSubmit() {
    if (selected.size === 0) {
      addToast({ type: "error", title: "Select at least one system" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/catalog/push-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand: item!.brand,
          model: item!.model,
          description: item!.description,
          category: item!.category,
          unitSpec: item!.unitSpec != null ? String(item!.unitSpec) : undefined,
          unitLabel: item!.unitLabel ?? undefined,
          systems: Array.from(selected),
          dealId: item!.dealId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to submit");
      addToast({ type: "success", title: "Submitted for approval", description: "An admin will review and push to selected systems." });
      onClose();
    } catch (err: unknown) {
      addToast({ type: "error", title: err instanceof Error ? err.message : "Failed to submit" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-surface rounded-xl shadow-card-lg border border-t-border">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-t-border">
            <h2 className="text-sm font-semibold text-foreground">Add to Systems</h2>
            <button onClick={onClose} className="text-muted hover:text-foreground text-lg leading-none">✕</button>
          </div>

          {/* Item preview */}
          <div className="px-5 py-3 border-b border-t-border bg-surface-2">
            <div className="text-xs text-muted uppercase tracking-wide mb-1">{item.category}</div>
            <div className="font-medium text-sm text-foreground">{item.brand} — {item.model}</div>
            <div className="text-xs text-muted mt-0.5 truncate">{item.description}</div>
          </div>

          {/* System checkboxes */}
          <div className="px-5 py-4 space-y-3">
            <p className="text-xs text-muted">Select systems to push this item to:</p>
            {SYSTEMS.map(({ key, label, description }) => (
              <label key={key} className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={selected.has(key)}
                  onChange={() => toggle(key)}
                  className="mt-0.5 accent-cyan-500"
                />
                <div>
                  <div className="text-sm font-medium text-foreground group-hover:text-cyan-400 transition-colors">{label}</div>
                  <div className="text-xs text-muted">{description}</div>
                </div>
              </label>
            ))}
          </div>

          {/* Footer */}
          <div className="px-5 py-4 border-t border-t-border flex items-center justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-muted hover:text-foreground border border-t-border hover:bg-surface-2 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting || selected.size === 0}
              className="px-4 py-2 rounded-lg text-sm bg-cyan-600 text-white hover:bg-cyan-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? "Submitting…" : "Submit for Approval"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
```

**Step 2: Lint**

```bash
npm run lint -- --max-warnings=0 src/components/PushToSystemsModal.tsx
```

**Step 3: Commit**

```bash
git add src/components/PushToSystemsModal.tsx
git commit -m "feat: add PushToSystemsModal for approval-gated catalog sync"
```

---

### Task 8: Wire "+ Add" button into BOM page rows

**Files:**
- Modify: `src/app/dashboards/bom/page.tsx`

**Context:** The BOM table renders rows in a `<tbody>`. Each row shows a red/green dot indicator. Find the row rendering area (search for `animate-value-flash` or the red dot indicator logic). The `+Add` button should be visible on hover for rows where the catalog match is absent (red dot).

**Step 1: Add imports**

```tsx
import PushToSystemsModal, { type PushItem } from "@/components/PushToSystemsModal";
```

**Step 2: Add state for modal**

```tsx
const [pushItem, setPushItem] = useState<PushItem | null>(null);
```

**Step 3: In each BOM table row, find the catalog-status indicator**

Look for the row render that contains the red/green dot (search `bg-green-500` or `bg-red-400` in the file). In the same row's action area, add on hover:

```tsx
{/* Show + Add button only for unmatched items (red dot) */}
{!rowHasCatalogMatch && (
  <button
    onClick={() => setPushItem({
      brand: item.brand ?? "",
      model: item.model ?? "",
      description: item.description,
      category: item.category,
      unitSpec: item.unitSpec,
      unitLabel: item.unitLabel,
      dealId: linkedProject?.hs_object_id,
    })}
    className="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-cyan-600 dark:text-cyan-400 hover:underline ml-2"
    title="Request to add to systems"
  >
    + Add
  </button>
)}
```

Note: `rowHasCatalogMatch` is whatever boolean/expression is currently used to render the red vs green dot. Match the existing pattern exactly.

**Step 4: Add modal render before `</DashboardShell>`**

```tsx
<PushToSystemsModal
  item={pushItem}
  onClose={() => setPushItem(null)}
/>
```

**Step 5: Lint + dev test**

```bash
npm run lint -- --max-warnings=0 src/app/dashboards/bom/page.tsx
npm run dev
```

Extract a BOM, hover a row with a red dot — "+ Add" should appear. Click it — modal opens with item pre-filled.

**Step 6: Commit**

```bash
git add src/app/dashboards/bom/page.tsx
git commit -m "feat: add push-to-systems button on unmatched BOM rows"
```

---

## Phase 4 — Catalog Management Page

### Task 9: Build /dashboards/catalog page (SKUs tab)

**Files:**
- Create: `src/app/dashboards/catalog/page.tsx`

**Step 1: Write the page (SKUs tab first)**

```tsx
// src/app/dashboards/catalog/page.tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import DashboardShell from "@/components/DashboardShell";
import { useToast } from "@/contexts/ToastContext";
import { useSession } from "next-auth/react";

type Tab = "skus" | "pending";

interface Sku {
  id: string;
  category: string;
  brand: string;
  model: string;
  unitSpec: number | null;
  unitLabel: string | null;
  isActive: boolean;
  zohoItemId: string | null;
  stockLevels: { location: string; quantityOnHand: number }[];
}

interface PushRequest {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  brand: string;
  model: string;
  description: string;
  category: string;
  systems: string[];
  requestedBy: string;
  dealId: string | null;
  createdAt: string;
}

const ADMIN_ROLES = ["ADMIN", "OWNER", "MANAGER"];
const CATEGORIES = ["MODULE", "INVERTER", "BATTERY", "EV_CHARGER"];

export default function CatalogPage() {
  const { data: session } = useSession();
  const { addToast } = useToast();
  const [tab, setTab] = useState<Tab>("skus");
  const [skus, setSkus] = useState<Sku[]>([]);
  const [skuLoading, setSkuLoading] = useState(true);
  const [pendingPushes, setPendingPushes] = useState<PushRequest[]>([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [search, setSearch] = useState("");

  const userRole = (session?.user as { role?: string })?.role ?? "";
  const isAdmin = ADMIN_ROLES.includes(userRole);

  // Fetch SKUs
  useEffect(() => {
    setSkuLoading(true);
    fetch("/api/inventory/skus?active=false")
      .then((r) => r.json())
      .then((d) => setSkus(d.skus ?? []))
      .catch(() => addToast({ type: "error", title: "Failed to load SKUs" }))
      .finally(() => setSkuLoading(false));
  }, [addToast]);

  // Fetch pending pushes when tab switches
  useEffect(() => {
    if (tab !== "pending") return;
    setPendingLoading(true);
    fetch("/api/catalog/push-requests?status=PENDING")
      .then((r) => r.json())
      .then((d) => setPendingPushes(d.pushes ?? []))
      .catch(() => addToast({ type: "error", title: "Failed to load pending requests" }))
      .finally(() => setPendingLoading(false));
  }, [tab, addToast]);

  const filtered = useMemo(() => {
    return skus.filter((s) => {
      if (categoryFilter && s.category !== categoryFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return s.brand.toLowerCase().includes(q) || s.model.toLowerCase().includes(q);
      }
      return true;
    });
  }, [skus, categoryFilter, search]);

  async function handleApprove(id: string) {
    try {
      const res = await fetch(`/api/catalog/push-requests/${id}/approve`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPendingPushes((prev) => prev.filter((p) => p.id !== id));
      addToast({ type: "success", title: "Approved and pushed to selected systems" });
    } catch (err: unknown) {
      addToast({ type: "error", title: err instanceof Error ? err.message : "Approval failed" });
    }
  }

  async function handleReject(id: string) {
    try {
      const res = await fetch(`/api/catalog/push-requests/${id}/reject`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPendingPushes((prev) => prev.filter((p) => p.id !== id));
      addToast({ type: "success", title: "Request rejected" });
    } catch (err: unknown) {
      addToast({ type: "error", title: err instanceof Error ? err.message : "Reject failed" });
    }
  }

  return (
    <DashboardShell title="Equipment Catalog" accentColor="cyan">
      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-t-border">
        {(["skus", "pending"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t
                ? "border-cyan-500 text-cyan-500"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {t === "skus" ? "Equipment SKUs" : (
              <span className="flex items-center gap-2">
                Pending Approvals
                {pendingPushes.length > 0 && tab !== "pending" && (
                  <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-cyan-500 text-white text-xs font-bold">
                    {pendingPushes.length}
                  </span>
                )}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* SKUs Tab */}
      {tab === "skus" && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-lg border border-t-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
            >
              <option value="">All categories</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input
              type="text"
              placeholder="Search brand or model…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-lg border border-t-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-cyan-500/50 flex-1 min-w-48"
            />
          </div>

          {/* Table */}
          {skuLoading ? (
            <p className="text-sm text-muted animate-pulse py-8 text-center">Loading SKUs…</p>
          ) : (
            <div className="rounded-xl border border-t-border bg-surface shadow-card overflow-hidden">
              <div className="grid grid-cols-[120px_1fr_1fr_80px_140px_80px] gap-x-3 border-b border-t-border bg-surface-2 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted">
                <span>Category</span>
                <span>Brand</span>
                <span>Model</span>
                <span>Unit</span>
                <span>Sync Status</span>
                <span>Stock</span>
              </div>
              {filtered.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted">No SKUs found.</div>
              ) : filtered.map((sku) => (
                <div key={sku.id} className="grid grid-cols-[120px_1fr_1fr_80px_140px_80px] gap-x-3 items-center border-b border-t-border last:border-b-0 px-4 py-3 text-sm hover:bg-surface-2 transition-colors">
                  <span className="text-xs text-muted">{sku.category}</span>
                  <span className="font-medium text-foreground truncate">{sku.brand}</span>
                  <span className="text-muted truncate">{sku.model}</span>
                  <span className="text-muted text-xs">{sku.unitSpec != null ? `${sku.unitSpec} ${sku.unitLabel ?? ""}` : "—"}</span>
                  <span className="flex items-center gap-1.5 text-xs">
                    <span title="Internal" className={`w-2 h-2 rounded-full ${sku.id ? "bg-green-500" : "bg-red-400"}`} />
                    <span title="Zoho" className={`w-2 h-2 rounded-full ${sku.zohoItemId ? "bg-green-500" : "bg-red-400"}`} />
                    <span title="HubSpot" className="w-2 h-2 rounded-full bg-red-400" />
                    <span title="Zuper" className="w-2 h-2 rounded-full bg-red-400" />
                    <span className="text-muted ml-1">Z·H·Z</span>
                  </span>
                  <span className="text-xs text-muted">
                    {sku.stockLevels.reduce((sum, l) => sum + l.quantityOnHand, 0)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Pending Tab */}
      {tab === "pending" && (
        <div>
          {pendingLoading ? (
            <p className="text-sm text-muted animate-pulse py-8 text-center">Loading requests…</p>
          ) : pendingPushes.length === 0 ? (
            <div className="rounded-xl border border-t-border bg-surface shadow-card px-8 py-16 text-center">
              <p className="text-lg font-medium text-foreground">No pending requests</p>
              <p className="mt-1 text-sm text-muted">Push requests submitted by the team will appear here.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-t-border bg-surface shadow-card overflow-hidden">
              <div className="grid grid-cols-[1fr_1fr_140px_120px_120px] gap-x-3 border-b border-t-border bg-surface-2 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted">
                <span>Item</span>
                <span>Systems</span>
                <span>Requested By</span>
                <span>Time</span>
                {isAdmin && <span>Actions</span>}
              </div>
              {pendingPushes.map((p) => (
                <div key={p.id} className="grid grid-cols-[1fr_1fr_140px_120px_120px] gap-x-3 items-center border-b border-t-border last:border-b-0 px-4 py-3 text-sm hover:bg-surface-2 transition-colors">
                  <div>
                    <div className="font-medium text-foreground">{p.brand} — {p.model}</div>
                    <div className="text-xs text-muted truncate">{p.description}</div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {p.systems.map((s) => (
                      <span key={s} className="inline-flex items-center rounded-md bg-cyan-500/15 px-1.5 py-0.5 text-xs font-medium text-cyan-400 ring-1 ring-cyan-500/30">
                        {s}
                      </span>
                    ))}
                  </div>
                  <span className="text-xs text-muted truncate">{p.requestedBy}</span>
                  <span className="text-xs text-muted">
                    {new Date(p.createdAt).toLocaleDateString()}
                  </span>
                  {isAdmin && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleApprove(p.id)}
                        className="text-xs text-green-400 hover:underline"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleReject(p.id)}
                        className="text-xs text-red-400 hover:underline"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </DashboardShell>
  );
}
```

**Step 2: Lint**

```bash
npm run lint -- --max-warnings=0 src/app/dashboards/catalog/page.tsx
```

**Step 3: Verify in dev**

```bash
npm run dev
```

Navigate to `/dashboards/catalog`. SKUs tab should load. Pending tab should show empty state.

**Step 4: Commit**

```bash
git add src/app/dashboards/catalog/page.tsx
git commit -m "feat: add /dashboards/catalog page with SKU table and pending approvals"
```

---

## Phase 5 — Tests + Final Verification

### Task 10: Write tests for push-request API routes

**Files:**
- Create: `src/__tests__/api/catalog-push-requests.test.ts`

**Step 1: Write tests**

```ts
// src/__tests__/api/catalog-push-requests.test.ts
import { NextRequest } from "next/server";
import { POST as postRequest, GET as getRequests } from "@/app/api/catalog/push-requests/route";

jest.mock("@/lib/api-auth", () => ({
  requireApiAuth: jest.fn().mockResolvedValue({ email: "test@photonbrothers.com", role: "ADMIN" }),
}));

const mockCreate = jest.fn();
const mockFindMany = jest.fn();
jest.mock("@/lib/db", () => ({
  prisma: {
    pendingCatalogPush: {
      create: (...args: unknown[]) => mockCreate(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
  },
}));

function makeRequest(body: unknown, method = "POST") {
  return new NextRequest("http://localhost/api/catalog/push-requests", {
    method,
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/catalog/push-requests", () => {
  it("creates a push request with valid data", async () => {
    const fakePush = { id: "push_1", status: "PENDING" };
    mockCreate.mockResolvedValue(fakePush);

    const req = makeRequest({
      brand: "Tesla", model: "1707000-XX-Y", description: "Powerwall 3",
      category: "BATTERY", systems: ["INTERNAL", "ZOHO"],
    });
    const res = await postRequest(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.push.id).toBe("push_1");
  });

  it("returns 400 if systems is empty", async () => {
    const req = makeRequest({
      brand: "Tesla", model: "1707000-XX-Y", description: "Powerwall 3",
      category: "BATTERY", systems: [],
    });
    const res = await postRequest(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 if required fields missing", async () => {
    const req = makeRequest({ brand: "Tesla", systems: ["INTERNAL"] });
    const res = await postRequest(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid system name", async () => {
    const req = makeRequest({
      brand: "Tesla", model: "1707000-XX-Y", description: "Powerwall 3",
      category: "BATTERY", systems: ["INVALID_SYSTEM"],
    });
    const res = await postRequest(req);
    expect(res.status).toBe(400);
  });
});
```

**Step 2: Run tests**

```bash
npm run test -- --testPathPattern=catalog-push-requests --no-coverage
```
Expected: 4 tests pass.

**Step 3: Commit**

```bash
git add src/__tests__/api/catalog-push-requests.test.ts
git commit -m "test: add push-requests API validation tests"
```

---

### Task 11: Full build verification

**Step 1: Run all tests**

```bash
npm run test -- --no-coverage
```
Expected: all existing tests still pass + new tests pass.

**Step 2: Run build**

```bash
npm run build
```
Expected: no TypeScript errors, no build failures.

**Step 3: Final commit if any lint fixes were needed**

```bash
git add -A
git commit -m "fix: lint and type cleanup from catalog sync feature"
```

---

---

## Phase 6 — Google Drive OAuth Token (Auto-Pull Plansets)

### Background

The BOM page already auto-fetches Drive files when a project has a `designFolderUrl` (via `useEffect` → `GET /api/bom/drive-files`). That route currently uses a **service account** (`getServiceAccountToken`). The user has now added `drive.readonly` scope to the Google OAuth flow, so each signed-in user's session token already has Drive access. We'll store the OAuth `access_token` in the JWT and use it in the Drive route, falling back to the service account if unavailable.

**Why user token is better:** The service account needs explicit sharing on each Drive folder. The user's own Google account already has natural access to the company Workspace Drive.

---

### Task 12: Store Google OAuth access_token in JWT

**Files:**
- Modify: `src/auth.ts`

**Step 1: Extend the JWT type to include accessToken and refreshToken**

In the `declare module "next-auth/jwt"` block, add:
```ts
interface JWT {
  role?: string;
  roleSyncedAt?: number;
  accessToken?: string;
  refreshToken?: string;
  accessTokenExpires?: number;
}
```

**Step 2: Capture tokens in the jwt callback**

In the `jwt` callback, the `account` parameter contains the OAuth tokens on first sign-in. Add token capture before the role sync logic:

Find:
```ts
async jwt({ token, user }) {
  if (user) {
    token.id = user.id;
  }
```

Replace with:
```ts
async jwt({ token, user, account }) {
  if (user) {
    token.id = user.id;
  }
  // Capture OAuth tokens on initial sign-in
  if (account?.access_token) {
    token.accessToken = account.access_token;
    token.refreshToken = account.refresh_token ?? token.refreshToken;
    token.accessTokenExpires = account.expires_at
      ? account.expires_at * 1000  // convert to ms
      : Date.now() + 3600 * 1000;
  }
```

**Step 3: Extend Session type to expose accessToken to server**

In the `declare module "next-auth"` block, add `accessToken` to the Session user:
```ts
interface Session {
  user: {
    id?: string;
    email?: string | null;
    name?: string | null;
    image?: string | null;
    role?: string;
    accessToken?: string;
  };
}
```

**Step 4: Pass accessToken through in the session callback**

In the `session` callback, add:
```ts
if (token.accessToken) {
  session.user.accessToken = token.accessToken as string;
}
```

**Step 5: Lint**

```bash
npm run lint -- --max-warnings=0 src/auth.ts
```
Expected: no errors.

**Step 6: Commit**

```bash
git add src/auth.ts
git commit -m "feat(auth): store Google OAuth access_token in JWT for Drive API calls"
```

---

### Task 13: Update drive-files route to use user OAuth token with service account fallback

**Files:**
- Modify: `src/app/api/bom/drive-files/route.ts`

**Step 1: Update the route to try user token first, then fall back to service account**

Replace the entire file content with:

```ts
// src/app/api/bom/drive-files/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { getServiceAccountToken } from "@/lib/google-auth";
import { auth } from "@/auth";

export const runtime = "nodejs";
export const maxDuration = 15;

interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
  size: string;
}

async function getDriveToken(): Promise<string> {
  // Prefer user's OAuth token — already has natural Drive access via Workspace
  try {
    const session = await auth();
    const userToken = (session?.user as { accessToken?: string })?.accessToken;
    if (userToken) return userToken;
  } catch {
    // fall through to service account
  }

  // Fallback: service account (requires manual folder sharing)
  return getServiceAccountToken(["https://www.googleapis.com/auth/drive.readonly"]);
}

export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const folderId = request.nextUrl.searchParams.get("folderId");
  if (!folderId) return NextResponse.json({ error: "folderId required" }, { status: 400 });

  // Validate folderId format to prevent Drive query injection
  if (!/^[a-zA-Z0-9_-]{10,}$/.test(folderId)) {
    return NextResponse.json({ error: "Invalid folderId format" }, { status: 400 });
  }

  try {
    const token = await getDriveToken();

    const query = encodeURIComponent(
      `'${folderId}' in parents and mimeType='application/pdf' and trashed=false`
    );
    const fields = encodeURIComponent("files(id,name,modifiedTime,size)");
    const url = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=${fields}&orderBy=modifiedTime%20desc`;

    const driveRes = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!driveRes.ok) {
      const err = await driveRes.json().catch(() => ({})) as { error?: { message?: string } };
      return NextResponse.json(
        { files: [], error: err.error?.message ?? `Drive error ${driveRes.status}` },
        { status: 200 }
      );
    }

    const data = await driveRes.json() as { files: DriveFile[] };
    return NextResponse.json({ files: data.files ?? [] });
  } catch (e) {
    return NextResponse.json(
      { files: [], error: e instanceof Error ? e.message : "Drive fetch failed" },
      { status: 200 }
    );
  }
}
```

**Step 2: Lint**

```bash
npm run lint -- --max-warnings=0 src/app/api/bom/drive-files/route.ts
```

**Step 3: Test manually**

Start dev server, link a BOM deal that has a `designFolderUrl`, confirm Drive PDFs load in the import panel.

**Step 4: Commit**

```bash
git add src/app/api/bom/drive-files/route.ts
git commit -m "feat(api): use user OAuth token for Drive file listing, fall back to service account"
```

---

---

## Phase 7 — Project Search → Auto-Extract from Design Folder

### Background

The BOM page has three import tabs (Upload PDF, Google Drive URL, Paste JSON). When a project is linked and has a `designFolderUrl`, the Drive PDFs already auto-fetch — but they only appear in a collapsible panel *after* a BOM is already extracted. Before extraction, the user has no way to see/use those Drive files directly.

The user wants to: search project by HubSpot name → see planset PDFs from that project's design folder → click one to extract.

### Changes

1. When `!bom` AND `linkedProject?.designFolderUrl` is set AND drive files have loaded, auto-switch the active import tab to a new `"project-files"` tab (or repurpose the drive tab) showing those files
2. Add a visible project search bar at the top of the empty (no-BOM) state so users can search without needing a `?deal=` URL param
3. After project selection, if drive files load, prompt with one-click extract

---

### Task 14: Auto-show project Drive files on import panel when project is linked

**Files:**
- Modify: `src/app/dashboards/bom/page.tsx`

**Step 1: Add a new `"project-files"` import tab type**

Find:
```ts
type ImportTab = "upload" | "drive" | "paste";
```
Replace with:
```ts
type ImportTab = "upload" | "drive" | "paste" | "project-files";
```

**Step 2: Auto-switch to project-files tab when drive files load**

Find the `useEffect` that loads drive files (around line 502):
```ts
useEffect(() => {
  const folderId = linkedProject?.designFolderUrl;
  if (!folderId) { setDriveFiles([]); return; }
  setDriveFilesLoading(true);
  setDriveFilesError(null);
  fetch(`/api/bom/drive-files?folderId=${encodeURIComponent(folderId)}`)
    .then((data: { files: DriveFile[]; error?: string }) => {
      setDriveFiles(data.files ?? []);
      if (data.error) setDriveFilesError(data.error);
    })
    .catch(() => setDriveFilesError("Failed to load design files"))
    .finally(() => setDriveFilesLoading(false));
}, [linkedProject?.designFolderUrl]);
```

Add auto-switch after files load — update the `.then()` block:
```ts
.then((data: { files: DriveFile[]; error?: string }) => {
  const files = data.files ?? [];
  setDriveFiles(files);
  if (data.error) setDriveFilesError(data.error);
  // Auto-switch import panel to show project files if no BOM yet
  if (files.length > 0) {
    setImportTab("project-files");
  }
})
```

**Step 3: Add the project-files tab to the tab bar**

In the tab bar render (around line 1099), add the new tab button. Only show it when `linkedProject?.designFolderUrl` exists:

```tsx
{(["upload", "drive", "paste"] as ImportTab[]).map((tab) => ( ... ))}
{linkedProject?.designFolderUrl && (
  <button
    onClick={() => { setImportTab("project-files"); setImportError(null); }}
    className={`px-5 py-3 text-sm font-medium transition-colors ${
      importTab === "project-files"
        ? "text-cyan-500 border-b-2 border-cyan-500 bg-surface"
        : "text-muted hover:text-foreground"
    }`}
  >
    📁 Design Folder
    {driveFiles.length > 0 && (
      <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-cyan-500/20 text-cyan-400 text-xs px-1.5 py-0.5">
        {driveFiles.length}
      </span>
    )}
  </button>
)}
```

**Step 4: Add the project-files tab content panel**

After the `paste` tab content block (`{importTab === "paste" && ( ... )}`), add:

```tsx
{importTab === "project-files" && (
  <div className="space-y-3">
    <p className="text-sm text-muted">
      Planset PDFs found in <span className="text-foreground font-medium">{linkedProject?.dealname}</span>&apos;s design folder. Click a file to extract the BOM.
    </p>

    {driveFilesLoading && (
      <p className="text-sm text-muted animate-pulse py-4 text-center">Loading design files…</p>
    )}
    {driveFilesError && (
      <p className="text-sm text-red-500">{driveFilesError}</p>
    )}
    {!driveFilesLoading && !driveFilesError && driveFiles.length === 0 && (
      <p className="text-sm text-muted py-4 text-center">No PDFs found in this project&apos;s design folder.</p>
    )}

    {driveFiles.map((file) => (
      <div
        key={file.id}
        className="flex items-center justify-between gap-3 rounded-lg border border-t-border bg-surface-2 px-4 py-3 hover:bg-surface-elevated transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground truncate">{file.name}</div>
          <div className="text-xs text-muted mt-0.5">
            {file.size ? `${(parseInt(file.size) / 1024 / 1024).toFixed(1)} MB · ` : ""}
            Modified {new Date(file.modifiedTime).toLocaleDateString()}
          </div>
        </div>
        <button
          onClick={() => handleExtractDriveFile(file)}
          disabled={extracting}
          className="flex-shrink-0 px-4 py-1.5 rounded-lg bg-cyan-600 text-white text-sm font-medium hover:bg-cyan-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          {extractingDriveFileId === file.id ? (
            <>
              <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Extracting…
            </>
          ) : (
            "Extract BOM"
          )}
        </button>
      </div>
    ))}
  </div>
)}
```

**Step 5: Reset tab when project is cleared**

Find where `linkedProject` is set to null (project unlinked). After `setLinkedProject(null)`, add:
```ts
setImportTab("upload"); // Reset to default when project cleared
setDriveFiles([]);
```

**Step 6: Lint + dev test**

```bash
npm run lint -- --max-warnings=0 src/app/dashboards/bom/page.tsx
npm run dev
```

Test flow:
1. Go to `/dashboards/bom`
2. Search and select a project that has a `designFolderUrl`
3. "Design Folder" tab should appear and auto-select
4. PDF list should display
5. Click "Extract BOM" on a file → extraction runs

**Step 7: Commit**

```bash
git add src/app/dashboards/bom/page.tsx
git commit -m "feat: auto-show project design folder PDFs on BOM import panel"
```

---

## Summary of New Files

| File | Purpose |
|------|---------|
| `src/lib/bom-history.ts` | Shared BomSnapshot type + helpers |
| `src/components/BomHistoryDrawer.tsx` | Slide-over drawer for all-deal BOM history |
| `src/components/PushToSystemsModal.tsx` | Approval-request modal for BOM row items |
| `src/app/api/catalog/push-requests/route.ts` | Create + list push requests |
| `src/app/api/catalog/push-requests/[id]/approve/route.ts` | Admin approve → fire system calls |
| `src/app/api/catalog/push-requests/[id]/reject/route.ts` | Admin reject with note |
| `src/app/dashboards/catalog/page.tsx` | Catalog management page |
| `src/__tests__/api/catalog-push-requests.test.ts` | API validation tests |

## Modified Files

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add `PendingCatalogPush` model + `PushStatus` enum |
| `src/app/dashboards/bom/page.tsx` | Drawer button + drawer render + push modal |
| `src/auth.ts` | Store OAuth access_token + refresh_token in JWT |
| `src/app/api/bom/drive-files/route.ts` | Use user OAuth token; fall back to service account |
