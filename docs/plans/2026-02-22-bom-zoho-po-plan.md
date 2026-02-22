# BOM → Zoho Purchase Order Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** From the BOM page, allow users to create a draft Purchase Order in Zoho Inventory with one click after a BOM is saved and a HubSpot project is linked.

**Architecture:** Add `zohoItemId` to `EquipmentSku` and `zohoPoId` to `ProjectBomSnapshot` in the Prisma schema, extend `ZohoInventoryClient` with `listVendors()` and `createPurchaseOrder()`, add two API routes (`GET /api/bom/zoho-vendors`, `POST /api/bom/create-po`), and add a vendor dropdown + Create PO button to the BOM page action bar.

**Tech Stack:** Prisma 7.3, Next.js App Router API routes, TypeScript, Tailwind v4 / theme tokens, existing `ZohoInventoryClient` in `src/lib/zoho-inventory.ts`.

---

## Task 1: Prisma Schema — Add `zohoItemId` and `zohoPoId`

**Files:**
- Modify: `prisma/schema.prisma` (lines 586–604 for `EquipmentSku`, lines 687–702 for `ProjectBomSnapshot`)

**Step 1: Add `zohoItemId` to `EquipmentSku`**

In `prisma/schema.prisma`, find the `EquipmentSku` model (around line 586). Add the new field after `isActive`:

```prisma
model EquipmentSku {
  id          String            @id @default(cuid())
  category    EquipmentCategory
  brand       String
  model       String
  unitSpec    Float?
  unitLabel   String?
  isActive    Boolean           @default(true)
  zohoItemId  String?           // Zoho Inventory item_id for PO line item matching

  createdAt   DateTime          @default(now())
  updatedAt   DateTime          @updatedAt

  // Relations
  stockLevels InventoryStock[]

  @@unique([category, brand, model])
  @@index([category])
  @@index([isActive])
}
```

**Step 2: Add `zohoPoId` to `ProjectBomSnapshot`**

In `prisma/schema.prisma`, find the `ProjectBomSnapshot` model (around line 687). Add the new field after `savedBy`:

```prisma
model ProjectBomSnapshot {
  id          String   @id @default(cuid())
  dealId      String
  dealName    String
  version     Int
  bomData     Json
  sourceFile  String?
  blobUrl     String?
  savedBy     String
  zohoPoId    String?  // Zoho PO ID once created

  createdAt   DateTime @default(now())

  @@index([dealId])
  @@index([dealId, version])
  @@index([createdAt])
}
```

**Step 3: Run the migration**

```bash
cd /Users/zach/Downloads/PB-Operations-Suite
npx prisma migrate dev --name add_zoho_fields
```

Expected: Migration created and applied. No errors.

**Step 4: Verify types were regenerated**

```bash
npx prisma generate
```

Expected: `@prisma/client` regenerated. No errors.

**Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add zohoItemId to EquipmentSku and zohoPoId to ProjectBomSnapshot"
```

---

## Task 2: Extend `ZohoInventoryClient` with `listVendors()` and `createPurchaseOrder()`

**Files:**
- Modify: `src/lib/zoho-inventory.ts`

**Step 1: Add interfaces and new public methods**

Open `src/lib/zoho-inventory.ts`. After the existing `ZohoInventoryItem` interface (around line 17), add:

```typescript
export interface ZohoVendor {
  contact_id: string;
  contact_name: string;
}

interface ZohoVendorListResponse {
  code?: number;
  message?: string;
  contacts?: ZohoVendor[];
}

export interface ZohoPurchaseOrderLineItem {
  item_id?: string;        // Omit when no Zoho SKU match
  name: string;
  quantity: number;
  description?: string;
}

export interface ZohoPurchaseOrderPayload {
  vendor_id: string;
  reference_number: string;
  notes?: string;
  status: "draft";
  line_items: ZohoPurchaseOrderLineItem[];
}

interface ZohoPurchaseOrderCreateResponse {
  code?: number;
  message?: string;
  purchaseorder?: {
    purchaseorder_id: string;
    purchaseorder_number: string;
  };
}
```

**Step 2: Add `listVendors()` public method to `ZohoInventoryClient`**

Add after the existing `listItems()` method (around line 158):

```typescript
async listVendors(): Promise<ZohoVendor[]> {
  const response = await this.request<ZohoVendorListResponse>("/contacts", {
    contact_type: "vendor",
    per_page: 200,
  });
  return Array.isArray(response.contacts) ? response.contacts : [];
}
```

**Step 3: Add `createPurchaseOrder()` public method to `ZohoInventoryClient`**

Add after `listVendors()`:

```typescript
async createPurchaseOrder(
  payload: ZohoPurchaseOrderPayload
): Promise<{ purchaseorder_id: string; purchaseorder_number: string }> {
  const result = await this.requestPost<ZohoPurchaseOrderCreateResponse>(
    "/purchaseorders",
    payload
  );
  const po = result.purchaseorder;
  if (!po?.purchaseorder_id) {
    throw new Error(result.message ?? "Zoho did not return a purchase order ID");
  }
  return {
    purchaseorder_id: po.purchaseorder_id,
    purchaseorder_number: po.purchaseorder_number,
  };
}
```

**Step 4: Add private `requestPost<T>()` method to `ZohoInventoryClient`**

The existing `request<T>()` is GET-only. Add `requestPost<T>()` after the `request<T>()` method (around line 224):

```typescript
private async requestPost<T>(path: string, body: unknown): Promise<T> {
  if (!this.organizationId) {
    throw new Error("ZOHO_INVENTORY_ORG_ID is not configured");
  }

  const params = new URLSearchParams();
  params.set("organization_id", this.organizationId);

  const url = `${buildUrl(this.configuredBaseUrl, path)}?${params.toString()}`;

  const doFetch = async (token: string) => {
    return withTimeout(
      fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        cache: "no-store",
      }),
      this.timeoutMs
    );
  };

  let token = await this.getAccessToken();
  let response = await doFetch(token);

  if (response.status === 401 && this.canRefreshToken()) {
    this.dynamicAccessToken = undefined;
    this.dynamicTokenExpiresAtMs = 0;
    token = await this.getAccessToken(true);
    response = await doFetch(token);
  }

  const raw = await response.text();
  let json: Record<string, unknown> = {};
  try {
    json = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    json = { message: raw };
  }

  if (!response.ok) {
    const message =
      typeof json.message === "string"
        ? json.message
        : `Zoho Inventory request failed (${response.status})`;
    throw new Error(message);
  }

  const code = typeof json.code === "number" ? json.code : undefined;
  if (code !== undefined && code !== 0) {
    const message =
      typeof json.message === "string"
        ? json.message
        : `Zoho Inventory API error (code ${code})`;
    throw new Error(message);
  }

  return json as unknown as T;
}
```

**Step 5: Verify TypeScript compiles**

```bash
cd /Users/zach/Downloads/PB-Operations-Suite
npx tsc --noEmit
```

Expected: No errors on `src/lib/zoho-inventory.ts`.

**Step 6: Commit**

```bash
git add src/lib/zoho-inventory.ts
git commit -m "feat: add listVendors and createPurchaseOrder to ZohoInventoryClient"
```

---

## Task 3: Update History Route `select` to Include `zohoPoId`

**Files:**
- Modify: `src/app/api/bom/history/route.ts`

**Step 1: Add `zohoPoId` to the `GET` select**

In `src/app/api/bom/history/route.ts`, find the `GET` handler's `prisma.projectBomSnapshot.findMany` call (around line 79). Add `zohoPoId` to the `select` block:

```typescript
select: {
  id: true,
  dealId: true,
  dealName: true,
  version: true,
  bomData: true,
  sourceFile: true,
  blobUrl: true,
  savedBy: true,
  createdAt: true,
  zohoPoId: true,   // ← add this line
},
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

**Step 3: Commit**

```bash
git add src/app/api/bom/history/route.ts
git commit -m "feat: include zohoPoId in bom/history GET select"
```

---

## Task 4: `GET /api/bom/zoho-vendors` Route

**Files:**
- Create: `src/app/api/bom/zoho-vendors/route.ts`

**Step 1: Create the route file**

```typescript
// src/app/api/bom/zoho-vendors/route.ts
import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { zohoInventory } from "@/lib/zoho-inventory";

export const runtime = "nodejs";

// In-memory TTL cache — `revalidate` is unreliable for authenticated routes
// because Next.js would need to key on auth token, which it doesn't do.
let vendorsCache: { vendors: { contact_id: string; contact_name: string }[]; expiresAt: number } | null = null;
const VENDORS_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function GET() {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  if (!zohoInventory.isConfigured()) {
    return NextResponse.json(
      { error: "Zoho Inventory is not configured" },
      { status: 503 }
    );
  }

  if (vendorsCache && Date.now() < vendorsCache.expiresAt) {
    return NextResponse.json({ vendors: vendorsCache.vendors });
  }

  try {
    const vendors = await zohoInventory.listVendors();
    vendorsCache = { vendors, expiresAt: Date.now() + VENDORS_TTL_MS };
    return NextResponse.json({ vendors });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch vendors";
    console.error("[bom/zoho-vendors]", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

**Step 3: Commit**

```bash
git add src/app/api/bom/zoho-vendors/route.ts
git commit -m "feat: add GET /api/bom/zoho-vendors route"
```

---

## Task 5: `POST /api/bom/create-po` Route

**Files:**
- Create: `src/app/api/bom/create-po/route.ts`

**Step 1: Create the route file**

```typescript
// src/app/api/bom/create-po/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { zohoInventory } from "@/lib/zoho-inventory";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const ALLOWED_ROLES = new Set([
  "ADMIN",
  "OWNER",
  "MANAGER",
  "OPERATIONS",
  "OPERATIONS_MANAGER",
  "PROJECT_MANAGER",
  "DESIGNER",
]);

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  if (!ALLOWED_ROLES.has(authResult.role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  if (!zohoInventory.isConfigured()) {
    return NextResponse.json(
      { error: "Zoho Inventory is not configured" },
      { status: 503 }
    );
  }

  let body: { dealId?: string; version?: number; vendorId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { dealId, version, vendorId } = body;
  if (!dealId || typeof version !== "number" || !vendorId) {
    return NextResponse.json(
      { error: "dealId, version, and vendorId are required" },
      { status: 400 }
    );
  }

  // 1. Load the BOM snapshot
  const snapshot = await prisma.projectBomSnapshot.findFirst({
    where: { dealId: String(dealId), version },
  });
  if (!snapshot) {
    return NextResponse.json({ error: "BOM snapshot not found" }, { status: 404 });
  }

  // 2. If PO already created, return existing ID (idempotency guard)
  // This handles the primary duplicate risk: UI retry after Zoho success + DB failure.
  // Concurrent-click protection is handled by `creatingPo` UI state (button disables on click).
  if (snapshot.zohoPoId) {
    return NextResponse.json({
      purchaseorder_id: snapshot.zohoPoId,
      purchaseorder_number: null,
      unmatchedCount: 0,
      alreadyExisted: true,
    });
  }

  // 3. Build line items — look up zohoItemId per BOM item
  const bomData = snapshot.bomData as {
    project?: { address?: string };
    items?: Array<{
      category: string;
      brand?: string | null;
      model?: string | null;
      description: string;
      qty: number | string;
    }>;
  };

  const bomItems = Array.isArray(bomData?.items) ? bomData.items : [];

  // Batch-lookup SKUs by (category, brand, model) to get zohoItemId
  const skuLookups = bomItems
    .filter((item) => item.category && item.brand && item.model)
    .map((item) => ({
      category: item.category as import("@prisma/client").EquipmentCategory,
      brand: item.brand!,
      model: item.model!,
    }));

  const skuMap = new Map<string, string | null>(); // "category:brand:model" → zohoItemId
  if (skuLookups.length > 0) {
    const skus = await prisma.equipmentSku.findMany({
      where: {
        OR: skuLookups.map((s) => ({
          category: s.category,
          brand: s.brand,
          model: s.model,
        })),
      },
      select: { category: true, brand: true, model: true, zohoItemId: true },
    });
    for (const sku of skus) {
      skuMap.set(`${sku.category}:${sku.brand}:${sku.model}`, sku.zohoItemId ?? null);
    }
  }

  let unmatchedCount = 0;
  const lineItems = bomItems.map((item) => {
    const key = `${item.category}:${item.brand ?? ""}:${item.model ?? ""}`;
    const zohoItemId = skuMap.get(key) ?? null;
    const name =
      item.model
        ? `${item.brand ? item.brand + " " : ""}${item.model}`
        : item.description;

    if (!zohoItemId) unmatchedCount++;

    // Quantity: parse carefully — `|| 1` would silently over-order on invalid values.
    // Use 1 as minimum only when the parsed value is truly 0/NaN after rounding.
    const parsedQty = Math.round(Number(item.qty));
    const quantity = Number.isFinite(parsedQty) && parsedQty > 0 ? parsedQty : 1;

    return {
      ...(zohoItemId ? { item_id: zohoItemId } : {}),
      name,
      quantity,
      description: item.description,
    };
  });

  // 4. Create PO in Zoho
  const address = bomData?.project?.address ?? "";
  let poResult: { purchaseorder_id: string; purchaseorder_number: string };
  try {
    poResult = await zohoInventory.createPurchaseOrder({
      vendor_id: vendorId,
      reference_number: snapshot.dealName,
      notes: `Generated from PB Ops BOM v${version}${address ? ` — ${address}` : ""}`,
      status: "draft",
      line_items: lineItems,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Zoho API error";
    console.error("[bom/create-po] Zoho error:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // 5. Store zohoPoId on snapshot
  await prisma.projectBomSnapshot.update({
    where: { id: snapshot.id },
    data: { zohoPoId: poResult.purchaseorder_id },
  });

  return NextResponse.json({
    purchaseorder_id: poResult.purchaseorder_id,
    purchaseorder_number: poResult.purchaseorder_number,
    unmatchedCount,
  });
}
```

**Step 2: Check that `prisma` is exported from `@/lib/prisma`**

```bash
grep -r "export.*prisma\|PrismaClient" /Users/zach/Downloads/PB-Operations-Suite/src/lib/prisma.ts 2>/dev/null || \
grep -rn "from.*@/lib/prisma" /Users/zach/Downloads/PB-Operations-Suite/src/app/api/bom/save/route.ts | head -3
```

If `@/lib/prisma` doesn't export `prisma`, look for the correct import path via:
```bash
grep -rn "new PrismaClient\|export.*prisma" /Users/zach/Downloads/PB-Operations-Suite/src/lib/ | head -10
```

Use whatever path the existing `bom/save/route.ts` or `bom/history` routes use.

**Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

**Step 4: Commit**

```bash
git add src/app/api/bom/create-po/route.ts
git commit -m "feat: add POST /api/bom/create-po route"
```

---

## Task 6: BOM Page UI — Vendor Dropdown + Create PO Button

**Files:**
- Modify: `src/app/dashboards/bom/page.tsx`

**Step 1: Add `zohoPoId` to `BomSnapshot` interface and add state variables**

First, open `src/app/dashboards/bom/page.tsx` and find the `BomSnapshot` interface (around line 109). Add `zohoPoId`:

```typescript
interface BomSnapshot {
  id: string;
  dealId: string;
  dealName: string;
  version: number;
  bomData: BomData;
  sourceFile: string | null;
  blobUrl: string | null;
  savedBy: string | null;
  createdAt: string;
  zohoPoId: string | null;   // ← add this field
}
```

Then find the state declarations block (around line 374–385 where `saving`, `savedVersion` are). Add after `savedVersion`:

```typescript
// Zoho PO state
const [zohoVendors, setZohoVendors] = useState<{ contact_id: string; contact_name: string }[]>([]);
const [selectedVendorId, setSelectedVendorId] = useState<string>("");
const [zohoPoId, setZohoPoId] = useState<string | null>(null);
const [creatingPo, setCreatingPo] = useState(false);
const zohoConfigured = !!process.env.NEXT_PUBLIC_ZOHO_CONFIGURED; // see step 2
```

Wait — env vars aren't available client-side unless prefixed `NEXT_PUBLIC_`. The BOM page is a client component. The cleanest approach: fetch vendors lazily when the PO section becomes visible (i.e., when `savedVersion !== null && linkedProject !== null`). If vendors load successfully, Zoho is configured; if they 404/503, hide the section.

Revised state (replace the `zohoConfigured` line above):

```typescript
const [zohoVendors, setZohoVendors] = useState<{ contact_id: string; contact_name: string }[] | null>(null);
const [vendorsLoading, setVendorsLoading] = useState(false);
const [selectedVendorId, setSelectedVendorId] = useState<string>("");
const [zohoPoId, setZohoPoId] = useState<string | null>(null);
const [creatingPo, setCreatingPo] = useState(false);
```

**Step 2: Fetch vendors when BOM is saved + project linked**

Add a `useEffect` after the snapshot-loading effect (after line ~475). Find the block that uses `[linkedProject]` as dependency:

```typescript
// Fetch Zoho vendors when we have a saved BOM + linked project
useEffect(() => {
  if (!savedVersion || !linkedProject || zohoVendors !== null) return;
  setVendorsLoading(true);
  fetch("/api/bom/zoho-vendors")
    .then((r) => r.ok ? r.json() : Promise.reject(r.status))
    .then((data: { vendors: { contact_id: string; contact_name: string }[] }) => {
      setZohoVendors(data.vendors ?? []);
    })
    .catch(() => {
      setZohoVendors([]); // empty = Zoho not configured or unavailable; hide section
    })
    .finally(() => setVendorsLoading(false));
}, [savedVersion, linkedProject, zohoVendors]);
```

**Step 3: Load `zohoPoId` from snapshot when history loads**

Find the snapshot-loading `useEffect` (around line 458–476 where `linkedProject` history is fetched). After `setSavedVersion(latest.version)`, add:

```typescript
// After setSavedVersion(latest.version):
setZohoPoId(latest.zohoPoId ?? null);
// Note: zohoPoId is now typed on BomSnapshot (Step 1 above), so no cast needed.
```

Also find every `setSavedVersion(null)` site (lines 458, 621, 1218, 1358, 1386) and pair them with `setZohoPoId(null)` so the PO state clears when the project is unlinked or a new project is searched.

**Step 4: Add `createPo` handler function**

Add near the other action handlers (around line 607, after `saveSnapshot`):

```typescript
const createPo = useCallback(async () => {
  if (!linkedProject || !savedVersion || !selectedVendorId) return;
  setCreatingPo(true);
  try {
    const res = await fetch("/api/bom/create-po", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dealId: linkedProject.hs_object_id,
        version: savedVersion,
        vendorId: selectedVendorId,
      }),
    });
    const data = await res.json() as {
      purchaseorder_id?: string;
      purchaseorder_number?: string;
      unmatchedCount?: number;
      error?: string;
    };
    if (!res.ok || !data.purchaseorder_id) {
      addToast({ type: "error", title: data.error ?? "Failed to create PO" });
      return;
    }
    setZohoPoId(data.purchaseorder_id);
    const unmatch = data.unmatchedCount ?? 0;
    addToast({
      type: "success",
      title: `PO ${data.purchaseorder_number ?? ""} created in Zoho`,
      ...(unmatch > 0 ? { description: `${unmatch} item${unmatch === 1 ? "" : "s"} had no Zoho SKU match — added as description-only lines` } : {}),
    });
  } catch {
    addToast({ type: "error", title: "Network error creating PO" });
  } finally {
    setCreatingPo(false);
  }
}, [linkedProject, savedVersion, selectedVendorId, addToast]);
```

**Step 5: Add the UI in the action bar**

Find the section that shows the linked project info (around line 1338–1363, the block `{linkedProject ? ( ... ) : ( search input )}`).

Inside the `linkedProject` branch, after the "Save current BOM" button and before "Unlink", add the Zoho PO section:

```tsx
{/* Zoho PO — only show when saved + vendors available */}
{savedVersion && zohoVendors && zohoVendors.length > 0 && (
  zohoPoId ? (
    <a
      href={`https://inventory.zoho.com/app#/purchaseorders/${zohoPoId}`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline"
    >
      View PO in Zoho →
    </a>
  ) : (
    <div className="flex items-center gap-2">
      <select
        value={selectedVendorId}
        onChange={(e) => setSelectedVendorId(e.target.value)}
        className="text-xs rounded bg-surface-2 border border-t-border text-foreground px-2 py-1 focus:outline-none focus:ring-1 focus:ring-cyan-500"
      >
        <option value="">Select vendor…</option>
        {zohoVendors.map((v) => (
          <option key={v.contact_id} value={v.contact_id}>
            {v.contact_name}
          </option>
        ))}
      </select>
      <button
        onClick={createPo}
        disabled={!selectedVendorId || creatingPo}
        title={!selectedVendorId ? "Select a vendor first" : "Create draft PO in Zoho Inventory"}
        className="text-xs rounded bg-cyan-600 text-white px-3 py-1 hover:bg-cyan-700 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {creatingPo ? "Creating…" : "Create PO in Zoho"}
      </button>
    </div>
  )
)}
```

**Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

**Step 7: Run dev server and test manually**

```bash
npm run dev
```

Test flow:
1. Navigate to `/dashboards/bom?deal=<a deal with a saved BOM>`
2. Confirm the saved version loads
3. Confirm vendor dropdown appears with vendors from Zoho
4. Select a vendor → "Create PO in Zoho" button enables
5. Click → spinner shows → success toast with "PO created" and PO number
6. Button replaced by "View PO in Zoho →" link
7. Click link → opens Zoho Inventory in new tab at the correct PO
8. Refresh page → "View PO in Zoho →" shown immediately (loaded from `zohoPoId` in snapshot)

**Step 8: Commit**

```bash
git add src/app/dashboards/bom/page.tsx
git commit -m "feat: add Zoho PO vendor dropdown and Create PO button to BOM page"
```

---

## Task 7: Build Check + PR

**Step 1: Full build**

```bash
npm run build
```

Expected: Build succeeds with no TypeScript errors or missing imports.

If build fails:
- Check import paths for `prisma` client — look at what `src/app/api/bom/save/route.ts` imports
- Check `EquipmentCategory` enum import in `create-po/route.ts`

**Step 2: Create PR**

```bash
git push -u origin HEAD
gh pr create --title "feat: BOM → Zoho Purchase Order" --body "$(cat <<'EOF'
## Summary
- Add \`zohoItemId\` to \`EquipmentSku\` and \`zohoPoId\` to \`ProjectBomSnapshot\` (Prisma migration)
- Extend \`ZohoInventoryClient\` with \`listVendors()\` and \`createPurchaseOrder()\`
- Update \`GET /api/bom/history\` select to include \`zohoPoId\`
- Add \`GET /api/bom/zoho-vendors\` (vendor selector, in-memory 5-min TTL cache)
- Add \`POST /api/bom/create-po\` (idempotent; lookup SKU→zohoItemId, build PO, store ID)
- Add vendor dropdown + "Create PO in Zoho" button on BOM page action bar
- Unmatched items fall back to description-only lines; count shown in toast

## Test plan
- [ ] Prisma migration applies cleanly
- [ ] Vendor dropdown populates from Zoho
- [ ] PO created as draft in Zoho Inventory
- [ ] Unmatched items toast warning fires when applicable
- [ ] "View PO in Zoho →" link appears after creation and on reload
- [ ] `npm run build` passes

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Notes for Implementer

- **`prisma` import path**: Check `src/app/api/bom/save/route.ts` (or similar existing route) for the correct Prisma client import — it may be `@/lib/prisma`, `@/lib/db`, or imported from the generated client directly.
- **`EquipmentCategory` import**: The Prisma-generated enum is importable as `import { EquipmentCategory } from "@/generated/prisma"` or `"@prisma/client"` — confirm with the schema output path in `prisma/schema.prisma` (`output = "src/generated/prisma"`).
- **Zoho PO URL format**: The "View PO" link uses `https://inventory.zoho.com/app#/purchaseorders/{id}`. If the org is on a non-US region (`.eu`, `.com.au`, etc.), this URL may need adjustment — confirm with the team.
- **Vendor count**: If a Zoho org has >200 vendors, `listVendors()` currently fetches only 1 page (200 items). This is fine for PB's scale but noted for future if needed.
