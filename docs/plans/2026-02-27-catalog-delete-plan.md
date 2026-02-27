# Catalog SKU Hard Delete — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add ADMIN-only hard-delete capability for catalog SKUs with audit logging, external-sync guards, and a confirmation modal.

**Architecture:** New `DELETE /api/inventory/skus/[id]` route with two-step force flow. New `CatalogAuditLog` Prisma model for snapshots. New `DeleteSkuModal` component shared by list and edit pages. All deletion logic runs in a single Prisma `$transaction`.

**Tech Stack:** Next.js API route, Prisma 7.3, React 19, Tailwind v4 CSS tokens

**Design Doc:** `docs/plans/2026-02-27-catalog-delete-design.md`

---

## Task 1: Prisma Schema — CatalogAuditLog Model

**Files:**
- Modify: `prisma/schema.prisma` (append after line ~914, after PendingCatalogPush model)

**Step 1: Add the model**

Add at end of schema (before any closing comments):

```prisma
model CatalogAuditLog {
  id              String   @id @default(cuid())
  action          String   // "SKU_DELETE" — constrained at app level
  skuId           String   // original SKU id, preserved post-deletion
  snapshot        Json     // full SKU + specs + stock at deletion time
  deletedByUserId String   // User.id (stable)
  deletedByEmail  String   // email at time of action
  createdAt       DateTime @default(now())

  @@index([skuId])
  @@index([deletedByUserId])
}
```

**Step 2: Generate Prisma client and create migration**

Run: `npx prisma migrate dev --name add-catalog-audit-log`
Expected: Migration created, client regenerated.

**Step 3: Verify generation**

Run: `npx prisma generate`
Expected: No errors, `src/generated/prisma` updated.

**Step 4: Commit**

```bash
git add prisma/ src/generated/
git commit -m "feat(schema): add CatalogAuditLog model for SKU deletion audit trail"
```

---

## Task 2: DELETE API Route — Tests

**Files:**
- Create: `src/__tests__/api/catalog-sku-delete.test.ts`

**Step 1: Write test file with all cases**

```typescript
// src/__tests__/api/catalog-sku-delete.test.ts

// ── Auth ──────────────────────────────────────────────────────────────────────
const mockRequireApiAuth = jest.fn();
jest.mock("@/lib/api-auth", () => ({
  requireApiAuth: (...args: unknown[]) => mockRequireApiAuth(...args),
}));

// ── Sentry ────────────────────────────────────────────────────────────────────
jest.mock("@sentry/nextjs", () => ({ captureException: jest.fn() }));
jest.mock("@/lib/sentry-request", () => ({ tagSentryRequest: jest.fn() }));

// ── Prisma ────────────────────────────────────────────────────────────────────
const mockFindUnique = jest.fn();
const mockDelete = jest.fn();
const mockTransaction = jest.fn();
const mockUserFindUnique = jest.fn();
const mockAuditCreate = jest.fn();
const mockPushUpdateMany = jest.fn();
const mockPushCount = jest.fn();

jest.mock("@/lib/db", () => ({
  prisma: {
    equipmentSku: { findUnique: (...args: unknown[]) => mockFindUnique(...args) },
    user: { findUnique: (...args: unknown[]) => mockUserFindUnique(...args) },
    catalogAuditLog: { create: (...args: unknown[]) => mockAuditCreate(...args) },
    pendingCatalogPush: {
      updateMany: (...args: unknown[]) => mockPushUpdateMany(...args),
      count: (...args: unknown[]) => mockPushCount(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

import { NextRequest } from "next/server";

// Import after mocks
const { DELETE } = require("@/app/api/inventory/skus/[id]/route") as {
  DELETE: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
};

function makeRequest(body?: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/inventory/skus/test-id", {
    method: "DELETE",
    ...(body ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}),
  });
}

function makeCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

const ADMIN_USER = { email: "admin@test.com", role: "ADMIN", ip: "127.0.0.1", userAgent: "test" };
const NON_ADMIN_USER = { email: "user@test.com", role: "PROJECT_MANAGER", ip: "127.0.0.1", userAgent: "test" };

const BASIC_SKU = {
  id: "sku-1",
  category: "MODULE",
  brand: "TestBrand",
  model: "TestModel",
  description: null,
  vendorName: null,
  vendorPartNumber: null,
  unitSpec: 400,
  unitLabel: "W",
  unitCost: 100,
  sellPrice: 200,
  sku: null,
  hardToProcure: false,
  length: null,
  width: null,
  weight: null,
  isActive: true,
  zohoItemId: null,
  hubspotProductId: null,
  zuperItemId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  stockLevels: [],
  moduleSpec: null,
  inverterSpec: null,
  batterySpec: null,
  evChargerSpec: null,
  mountingHardwareSpec: null,
  electricalHardwareSpec: null,
  relayDeviceSpec: null,
};

const DB_USER = { id: "user-db-1", email: "admin@test.com" };

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireApiAuth.mockResolvedValue(ADMIN_USER);
  mockUserFindUnique.mockResolvedValue(DB_USER);
  mockPushCount.mockResolvedValue(0);
  // Default: transaction executes the callback
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
    const tx = {
      equipmentSku: {
        findUnique: mockFindUnique,
        delete: mockDelete,
      },
      user: { findUnique: mockUserFindUnique },
      catalogAuditLog: { create: mockAuditCreate },
      pendingCatalogPush: {
        updateMany: mockPushUpdateMany,
        count: mockPushCount,
      },
    };
    return fn(tx);
  });
});

describe("DELETE /api/inventory/skus/[id]", () => {
  it("returns 401 when not authenticated", async () => {
    const { NextResponse } = await import("next/server");
    mockRequireApiAuth.mockResolvedValue(
      NextResponse.json({ error: "Authentication required" }, { status: 401 })
    );
    const res = await DELETE(makeRequest(), makeCtx("sku-1"));
    expect(res.status).toBe(401);
  });

  it("returns 403 when user is not ADMIN", async () => {
    mockRequireApiAuth.mockResolvedValue(NON_ADMIN_USER);
    const res = await DELETE(makeRequest(), makeCtx("sku-1"));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/ADMIN/i);
  });

  it("returns 404 when SKU not found", async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await DELETE(makeRequest(), makeCtx("nonexistent"));
    expect(res.status).toBe(404);
  });

  it("returns 409 when SKU is synced externally and force=false", async () => {
    mockFindUnique.mockResolvedValue({ ...BASIC_SKU, zohoItemId: "z-1", hubspotProductId: "h-1" });
    const res = await DELETE(makeRequest(), makeCtx("sku-1"));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.syncedSystems).toContain("ZOHO");
    expect(body.syncedSystems).toContain("HUBSPOT");
    expect(body.syncedSystems).not.toContain("ZUPER");
  });

  it("returns 409 when SKU has pending push requests and force=false", async () => {
    mockFindUnique.mockResolvedValue(BASIC_SKU);
    mockPushCount.mockResolvedValue(2);
    const res = await DELETE(makeRequest(), makeCtx("sku-1"));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.pendingCount).toBe(2);
  });

  it("deletes SKU with force=true even when synced", async () => {
    mockFindUnique.mockResolvedValue({ ...BASIC_SKU, zohoItemId: "z-1" });
    mockDelete.mockResolvedValue({ id: "sku-1" });
    mockAuditCreate.mockResolvedValue({ id: "audit-1" });
    const res = await DELETE(makeRequest({ force: true }), makeCtx("sku-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(true);
    expect(body.auditLogId).toBe("audit-1");
  });

  it("deletes unsynced SKU without force", async () => {
    mockFindUnique.mockResolvedValue(BASIC_SKU);
    mockDelete.mockResolvedValue({ id: "sku-1" });
    mockAuditCreate.mockResolvedValue({ id: "audit-1" });
    const res = await DELETE(makeRequest(), makeCtx("sku-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(true);
  });

  it("creates audit log with full snapshot", async () => {
    mockFindUnique.mockResolvedValue(BASIC_SKU);
    mockDelete.mockResolvedValue({ id: "sku-1" });
    mockAuditCreate.mockResolvedValue({ id: "audit-1" });
    await DELETE(makeRequest(), makeCtx("sku-1"));
    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "SKU_DELETE",
        skuId: "sku-1",
        snapshot: expect.objectContaining({ id: "sku-1", brand: "TestBrand" }),
        deletedByUserId: "user-db-1",
        deletedByEmail: "admin@test.com",
      }),
    });
  });

  it("nulls out PendingCatalogPush.internalSkuId references", async () => {
    mockFindUnique.mockResolvedValue(BASIC_SKU);
    mockDelete.mockResolvedValue({ id: "sku-1" });
    mockAuditCreate.mockResolvedValue({ id: "audit-1" });
    await DELETE(makeRequest(), makeCtx("sku-1"));
    expect(mockPushUpdateMany).toHaveBeenCalledWith({
      where: { internalSkuId: "sku-1" },
      data: { internalSkuId: null },
    });
  });

  it("returns 400 for missing id param", async () => {
    const res = await DELETE(makeRequest(), makeCtx(""));
    expect(res.status).toBe(400);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/api/catalog-sku-delete.test.ts --no-cache 2>&1 | tail -20`
Expected: FAIL — module `@/app/api/inventory/skus/[id]/route` not found.

**Step 3: Commit test file**

```bash
git add src/__tests__/api/catalog-sku-delete.test.ts
git commit -m "test: add failing tests for DELETE /api/inventory/skus/[id]"
```

---

## Task 3: DELETE API Route — Implementation

**Files:**
- Create: `src/app/api/inventory/skus/[id]/route.ts`

**Step 1: Implement the DELETE handler**

```typescript
/**
 * DELETE /api/inventory/skus/[id]
 *
 * Hard-deletes a SKU with audit logging.
 * ADMIN role only. Two-step flow: returns 409 with warnings if
 * SKU is synced or has pending pushes — re-send with { force: true }.
 */

import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";
import { tagSentryRequest } from "@/lib/sentry-request";

const SKU_INCLUDE = {
  stockLevels: { select: { location: true, quantityOnHand: true } },
  moduleSpec: true,
  inverterSpec: true,
  batterySpec: true,
  evChargerSpec: true,
  mountingHardwareSpec: true,
  electricalHardwareSpec: true,
  relayDeviceSpec: true,
} as const;

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  tagSentryRequest(request);

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  // Auth — ADMIN only
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  if (authResult.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Insufficient permissions. Requires ADMIN role." },
      { status: 403 }
    );
  }

  const { id } = await params;
  if (!id || !id.trim()) {
    return NextResponse.json({ error: "SKU id is required" }, { status: 400 });
  }

  // Parse optional body for force flag
  let force = false;
  try {
    const body = await request.json().catch(() => null);
    if (body && typeof body === "object" && "force" in body) {
      force = body.force === true;
    }
  } catch {
    // No body is fine — force defaults to false
  }

  try {
    const result = await prisma.$transaction(async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => {
      // Step 1: Find SKU with all relations
      const sku = await tx.equipmentSku.findUnique({
        where: { id },
        include: SKU_INCLUDE,
      });

      if (!sku) {
        return { status: 404, body: { error: "SKU not found" } };
      }

      // Step 2: Check external sync guards
      if (!force) {
        const syncedSystems: string[] = [];
        if (sku.zohoItemId) syncedSystems.push("ZOHO");
        if (sku.hubspotProductId) syncedSystems.push("HUBSPOT");
        if (sku.zuperItemId) syncedSystems.push("ZUPER");

        if (syncedSystems.length > 0) {
          return {
            status: 409,
            body: {
              warning: "SKU is synced to external systems.",
              syncedSystems,
            },
          };
        }

        // Step 3: Check pending push requests
        const pendingCount = await tx.pendingCatalogPush.count({
          where: {
            internalSkuId: id,
            status: { not: "REJECTED" },
          },
        });

        if (pendingCount > 0) {
          return {
            status: 409,
            body: {
              warning: `SKU has ${pendingCount} pending push request(s).`,
              pendingCount,
            },
          };
        }
      }

      // Step 4: Look up user DB id for audit trail
      const dbUser = await tx.user.findUnique({
        where: { email: authResult.email },
        select: { id: true },
      });

      // Step 5: Create audit log
      const auditLog = await tx.catalogAuditLog.create({
        data: {
          action: "SKU_DELETE",
          skuId: id,
          snapshot: JSON.parse(JSON.stringify(sku)),
          deletedByUserId: dbUser?.id ?? "unknown",
          deletedByEmail: authResult.email,
        },
      });

      // Step 6: Null out PendingCatalogPush references
      await tx.pendingCatalogPush.updateMany({
        where: { internalSkuId: id },
        data: { internalSkuId: null },
      });

      // Step 7: Delete SKU (cascade handles specs, stock, transactions)
      await tx.equipmentSku.delete({ where: { id } });

      return {
        status: 200,
        body: { deleted: true, auditLogId: auditLog.id },
      };
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    Sentry.captureException(error);
    console.error("SKU delete error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

**Step 2: Run tests**

Run: `npx jest src/__tests__/api/catalog-sku-delete.test.ts --no-cache 2>&1 | tail -20`
Expected: All 9 tests PASS.

**Step 3: Commit**

```bash
git add src/app/api/inventory/skus/[id]/route.ts
git commit -m "feat(api): add DELETE /api/inventory/skus/[id] with audit logging"
```

---

## Task 4: DeleteSkuModal Component

**Files:**
- Create: `src/components/catalog/DeleteSkuModal.tsx`

**Step 1: Implement the modal**

```tsx
"use client";

import { useState } from "react";

interface DeleteSkuModalProps {
  sku: { id: string; category: string; brand: string; model: string };
  warning?: string;
  syncedSystems?: string[];
  pendingCount?: number;
  onConfirm: () => void;
  onCancel: () => void;
  deleting: boolean;
}

export default function DeleteSkuModal({
  sku,
  warning,
  syncedSystems,
  pendingCount,
  onConfirm,
  onCancel,
  deleting,
}: DeleteSkuModalProps) {
  const [confirmText, setConfirmText] = useState("");

  const matches = confirmText.trim().toLowerCase() === sku.model.trim().toLowerCase();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-surface-elevated rounded-xl border border-t-border shadow-card-lg w-full max-w-md mx-4 p-6">
        <h3 className="text-lg font-semibold text-foreground mb-2">Delete SKU</h3>

        <div className="rounded-lg bg-surface-2 border border-t-border p-3 mb-4 text-sm">
          <div className="text-muted">
            {sku.category} &middot; {sku.brand} &middot;{" "}
            <span className="text-foreground font-medium">{sku.model}</span>
          </div>
        </div>

        {syncedSystems && syncedSystems.length > 0 && (
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 mb-3 text-sm text-amber-400">
            This SKU is synced to{" "}
            <span className="font-semibold">{syncedSystems.join(", ")}</span>.
            Deleting it will not remove the external records.
          </div>
        )}

        {pendingCount != null && pendingCount > 0 && (
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 mb-3 text-sm text-amber-400">
            This SKU has <span className="font-semibold">{pendingCount}</span> pending
            push request(s) that will be unlinked.
          </div>
        )}

        {warning && !syncedSystems?.length && !pendingCount && (
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 mb-3 text-sm text-amber-400">
            {warning}
          </div>
        )}

        <p className="text-sm text-muted mb-2">
          This action is <span className="text-red-400 font-medium">permanent</span> and
          cannot be undone. Type the model name to confirm:
        </p>

        <div className="mb-1 text-xs text-muted font-mono">{sku.model}</div>

        <input
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="Type model name to confirm"
          className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-red-500/50 mb-4"
          autoFocus
        />

        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={deleting}
            className="rounded-lg border border-t-border bg-surface px-4 py-2 text-sm font-medium text-muted hover:text-foreground hover:bg-surface-2 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!matches || deleting}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {deleting ? "Deleting..." : "Delete permanently"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/catalog/DeleteSkuModal.tsx
git commit -m "feat(ui): add DeleteSkuModal confirmation component"
```

---

## Task 5: Integrate Delete into Catalog List Page

**Files:**
- Modify: `src/app/dashboards/catalog/page.tsx`

**Step 1: Add delete state and handler**

After the existing state declarations (around line 187, after `const isAdmin = ...`), add:

```typescript
const [deleteTarget, setDeleteTarget] = useState<{
  sku: Sku;
  warning?: string;
  syncedSystems?: string[];
  pendingCount?: number;
} | null>(null);
const [deleting, setDeleting] = useState(false);

const handleDeleteClick = useCallback(async (sku: Sku) => {
  setDeleting(true);
  try {
    const res = await fetch(`/api/inventory/skus/${sku.id}`, { method: "DELETE" });
    const data = await res.json();
    if (res.status === 200 && data.deleted) {
      setSkus((prev) => prev.filter((s) => s.id !== sku.id));
      fetchSkus(); // re-fetch to recompute summary cards
      addToast({ type: "success", title: "SKU deleted" });
      setDeleteTarget(null);
      return;
    }
    if (res.status === 409) {
      setDeleteTarget({
        sku,
        warning: data.warning,
        syncedSystems: data.syncedSystems,
        pendingCount: data.pendingCount,
      });
      return;
    }
    addToast({ type: "error", title: data.error || "Delete failed" });
  } catch {
    addToast({ type: "error", title: "Delete failed" });
  } finally {
    setDeleting(false);
  }
}, [addToast, fetchSkus]);

const handleForceDelete = useCallback(async () => {
  if (!deleteTarget) return;
  setDeleting(true);
  try {
    const res = await fetch(`/api/inventory/skus/${deleteTarget.sku.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: true }),
    });
    const data = await res.json();
    if (res.status === 200 && data.deleted) {
      setSkus((prev) => prev.filter((s) => s.id !== deleteTarget.sku.id));
      fetchSkus();
      addToast({ type: "success", title: "SKU deleted" });
      setDeleteTarget(null);
      return;
    }
    addToast({ type: "error", title: data.error || "Delete failed" });
  } catch {
    addToast({ type: "error", title: "Delete failed" });
  } finally {
    setDeleting(false);
  }
}, [deleteTarget, addToast, fetchSkus]);
```

**Step 2: Add import for DeleteSkuModal**

At top of file, add:
```typescript
import DeleteSkuModal from "@/components/catalog/DeleteSkuModal";
```

**Step 3: Add Delete button to actions column**

In the actions column (around line 718, after the Full Edit `</Link>`), add inside the `isAdmin` block:

```tsx
{userRole === "ADMIN" && (
  <button
    onClick={() => handleDeleteClick(sku)}
    className="text-red-400 hover:text-red-300"
  >
    Delete
  </button>
)}
```

**Step 4: Add modal render**

Before the closing `</DashboardShell>` tag, add:

```tsx
{deleteTarget && (
  <DeleteSkuModal
    sku={deleteTarget.sku}
    warning={deleteTarget.warning}
    syncedSystems={deleteTarget.syncedSystems}
    pendingCount={deleteTarget.pendingCount}
    onConfirm={handleForceDelete}
    onCancel={() => setDeleteTarget(null)}
    deleting={deleting}
  />
)}
```

**Step 5: Run build to verify**

Run: `npx next build 2>&1 | grep -E "error|catalog"`
Expected: No errors, catalog routes present.

**Step 6: Commit**

```bash
git add src/app/dashboards/catalog/page.tsx
git commit -m "feat(ui): add SKU delete button + modal to catalog list page"
```

---

## Task 6: Integrate Delete into Edit Page

**Files:**
- Modify: `src/app/dashboards/catalog/edit/[id]/page.tsx`

**Step 1: Add imports**

Add at top:
```typescript
import DeleteSkuModal from "@/components/catalog/DeleteSkuModal";
import { useSession } from "next-auth/react";
```

**Step 2: Add session check and delete state**

Inside the component, after existing state declarations:

```typescript
const { data: session } = useSession();
const userRole = (session?.user as { role?: string } | undefined)?.role ?? "";

const [deleteTarget, setDeleteTarget] = useState<{
  warning?: string;
  syncedSystems?: string[];
  pendingCount?: number;
} | null>(null);
const [showDeleteModal, setShowDeleteModal] = useState(false);
const [deleting, setDeleting] = useState(false);

const handleDeleteClick = async () => {
  setDeleting(true);
  try {
    const res = await fetch(`/api/inventory/skus/${skuId}`, { method: "DELETE" });
    const data = await res.json();
    if (res.status === 200 && data.deleted) {
      addToast({ type: "success", title: "SKU deleted" });
      router.replace("/dashboards/catalog");
      return;
    }
    if (res.status === 409) {
      setDeleteTarget({
        warning: data.warning,
        syncedSystems: data.syncedSystems,
        pendingCount: data.pendingCount,
      });
      setShowDeleteModal(true);
      return;
    }
    addToast({ type: "error", title: data.error || "Delete failed" });
  } catch {
    addToast({ type: "error", title: "Delete failed" });
  } finally {
    setDeleting(false);
  }
};

const handleForceDelete = async () => {
  setDeleting(true);
  try {
    const res = await fetch(`/api/inventory/skus/${skuId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: true }),
    });
    const data = await res.json();
    if (res.status === 200 && data.deleted) {
      addToast({ type: "success", title: "SKU deleted" });
      router.replace("/dashboards/catalog");
      return;
    }
    addToast({ type: "error", title: data.error || "Delete failed" });
  } catch {
    addToast({ type: "error", title: "Delete failed" });
  } finally {
    setDeleting(false);
  }
};
```

**Step 3: Add Delete button**

Before the Cancel button in the button row (around line 393), add:

```tsx
{userRole === "ADMIN" && (
  <button
    type="button"
    onClick={handleDeleteClick}
    disabled={deleting}
    className="rounded-lg border border-red-500/30 bg-surface px-6 py-2.5 text-sm font-medium text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors mr-auto"
  >
    {deleting ? "Deleting..." : "Delete SKU"}
  </button>
)}
```

**Step 4: Add modal render**

Before the closing `</DashboardShell>` tag, add:

```tsx
{showDeleteModal && (
  <DeleteSkuModal
    sku={{ id: skuId, category, brand, model }}
    warning={deleteTarget?.warning}
    syncedSystems={deleteTarget?.syncedSystems}
    pendingCount={deleteTarget?.pendingCount}
    onConfirm={handleForceDelete}
    onCancel={() => setShowDeleteModal(false)}
    deleting={deleting}
  />
)}
```

**Step 5: Run build to verify**

Run: `npx next build 2>&1 | grep -E "error|catalog"`
Expected: No errors, both catalog routes present.

**Step 6: Run all delete tests**

Run: `npx jest src/__tests__/api/catalog-sku-delete.test.ts --no-cache`
Expected: All tests PASS.

**Step 7: Commit**

```bash
git add src/app/dashboards/catalog/edit/[id]/page.tsx
git commit -m "feat(ui): add SKU delete button + modal to edit page"
```

---

## Task 7: Final Verification and PR

**Step 1: Run full test suite**

Run: `npx jest --no-cache 2>&1 | tail -20`
Expected: All tests pass (or pre-existing failures only).

**Step 2: Run build**

Run: `npx next build 2>&1 | tail -30`
Expected: Build succeeds, `/dashboards/catalog`, `/dashboards/catalog/new`, `/dashboards/catalog/edit/[id]`, `/api/inventory/skus/[id]` all in route list.

**Step 3: Push and open PR**

```bash
git push -u origin feat/catalog-delete
gh pr create --title "feat(catalog): ADMIN-only SKU hard delete with audit logging" --body "$(cat <<'PREOF'
## Summary
- New `DELETE /api/inventory/skus/[id]` endpoint with ADMIN-only auth
- Two-step force flow: 409 with sync/pending warnings, re-send with `force: true`
- `CatalogAuditLog` table captures full SKU snapshot before deletion
- Nulls `PendingCatalogPush.internalSkuId` references before cascade delete
- `DeleteSkuModal` component with model-name confirmation gate
- Delete buttons on catalog list page and edit page (ADMIN only)

## Test plan
- [ ] API: 401/403/404/409/200 response codes
- [ ] Audit log contains full snapshot
- [ ] PendingCatalogPush references nulled
- [ ] Modal shows sync warnings from server
- [ ] Model-name confirmation prevents accidental clicks
- [ ] Edit page redirects with router.replace after delete
- [ ] List page re-fetches summary after delete

Generated with [Claude Code](https://claude.ai/code)
PREOF
)"
```
