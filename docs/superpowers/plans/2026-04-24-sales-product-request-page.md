# Sales Product Request Page Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Sales & Marketing Suite page where reps can request products (equipment or adders) be added to OpenSolar, feeding a Tech Ops review queue merged into `/dashboards/catalog/review`, behind `SALES_PRODUCT_REQUESTS_ENABLED`.

**Architecture:** Extend existing `PendingCatalogPush` with two additive columns for equipment requests; add new `AdderRequest` table for adders; rep submits through two new API routes; Tech Ops reviews via extended existing review page; OpenSolar push is stubbed today (real when the separate discovery spec ships); all gated by feature flag.

**Tech Stack:** Next.js 16 App Router, Prisma (Neon Postgres), React Query, React Email, TypeScript, Tailwind v4, Jest.

**Spec:** `docs/superpowers/specs/2026-04-24-sales-product-request-page-design.md`

---

## File Structure

### Created

**Schema / migration:**
- `prisma/schema.prisma` (modify — additive only)
- `prisma/migrations/<ts>_sales_product_requests/migration.sql` (generated)

**Shared library:**
- `src/lib/product-requests/dedup.ts` — normalized brand+model lookup across `InternalProduct`, `CatalogProduct`, pending `PendingCatalogPush`; adder name lookup across `Adder`, pending `AdderRequest`.
- `src/lib/product-requests/notifications.ts` — email dispatch helpers (submit → Tech Ops, resolve → rep).
- `src/lib/product-requests/opensolar-push.ts` — OpenSolar equipment push stub (gated by `OPENSOLAR_PRODUCT_SYNC_ENABLED`, synthetic-success when off, mirrors `lib/adders/opensolar-client.ts` pattern).
- `src/lib/product-requests/types.ts` — `EquipmentRequestPayload`, `AdderRequestPayload`, `MergedRequestRow` (for review queue).

**API routes:**
- `src/app/api/product-requests/equipment/route.ts` — POST (rep submit equipment).
- `src/app/api/product-requests/adder/route.ts` — POST (rep submit adder).
- `src/app/api/product-requests/mine/route.ts` — GET (rep's own submissions).
- `src/app/api/admin/product-requests/route.ts` — GET (merged reviewer list).
- `src/app/api/admin/product-requests/[id]/approve/route.ts` — POST (reviewer approve; `id` prefixed `eq_` or `ad_` to disambiguate tables).
- `src/app/api/admin/product-requests/[id]/decline/route.ts` — POST (reviewer decline).

**UI — rep page:**
- `src/app/dashboards/request-product/page.tsx` — `DashboardShell` wrapper.
- `src/app/dashboards/request-product/RequestProductClient.tsx` — state machine for mode select → form → confirmation.
- `src/app/dashboards/request-product/ModeSelectStep.tsx` — Equipment vs Adder picker.
- `src/app/dashboards/request-product/EquipmentRequestForm.tsx` — minimal form + datasheet dropzone.
- `src/app/dashboards/request-product/AdderRequestForm.tsx` — adder form.
- `src/app/dashboards/request-product/ConfirmationScreen.tsx` — "Submitted" success.
- `src/app/dashboards/request-product/MyRequestsTable.tsx` — rep's submissions table.

**UI — reviewer drawer:**
- `src/components/catalog/AdderRequestDrawer.tsx` — adder review drawer (equipment reuses existing catalog wizard).

**Emails:**
- `src/emails/SalesProductRequestNotification.tsx` — Tech Ops submit notification.
- `src/emails/SalesProductRequestApproved.tsx` — rep approved email.
- `src/emails/SalesProductRequestDeclined.tsx` — rep declined email.

**Tests:**
- `src/__tests__/product-requests/dedup.test.ts`
- `src/__tests__/product-requests/submit-equipment.test.ts`
- `src/__tests__/product-requests/submit-adder.test.ts`
- `src/__tests__/product-requests/approve-equipment.test.ts`
- `src/__tests__/product-requests/approve-adder.test.ts`

### Modified

- `src/app/suites/sales-marketing/page.tsx` — add "Request a Product" card (gated on `SALES_PRODUCT_REQUESTS_ENABLED`).
- `src/lib/roles.ts` — add `/dashboards/request-product` + `/api/product-requests/*` to rep-facing role `allowedRoutes`; add `/api/admin/product-requests` to `ADMIN_ONLY_EXCEPTIONS` pointing to `TECH_OPS`.
- `src/app/dashboards/catalog/review/page.tsx` — add `Source: Sales Request` filter chip; merge `/api/admin/product-requests` rows into existing list; open `AdderRequestDrawer` for adder rows, existing wizard for equipment rows.
- `src/lib/catalog-push-approve.ts` — queue OpenSolar push when `systems` contains `OPENSOLAR` and source is `SALES_REQUEST`.
- `.env.example` — document new env vars.

---

## Chunk 1: Schema + migration

### Task 1.1: Schema changes

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add columns to `PendingCatalogPush`**

In `PendingCatalogPush` model, add after `zohoVendorId`:

```prisma
  // Sales request additions (2026-04-24)
  openSolarId       String?
  salesRequestNote  String?
```

- [ ] **Step 2: Add `AdderRequest` model and enum**

At the end of the file (after the last adder-related model), add:

```prisma
enum AdderRequestStatus {
  PENDING
  ADDED
  DECLINED
}

model AdderRequest {
  id                String             @id @default(cuid())
  status            AdderRequestStatus @default(PENDING)
  category          AdderCategory
  unit              AdderUnit          @default(FLAT)
  name              String
  estimatedPrice    Float?
  description       String?
  salesRequestNote  String?
  requestedBy       String
  dealId            String?
  openSolarId       String?
  reviewerNote      String?
  adderCatalogId    String?
  createdAt         DateTime           @default(now())
  resolvedAt        DateTime?

  @@index([status])
  @@index([requestedBy])
  @@index([dealId])
}
```

- [ ] **Step 3: Add `ActivityType` enum values**

Locate the `ActivityType` enum and add at the end:

```prisma
  SALES_PRODUCT_REQUEST_SUBMITTED
  SALES_PRODUCT_REQUEST_APPROVED
  SALES_PRODUCT_REQUEST_DECLINED
```

- [ ] **Step 4: Generate Prisma client**

Run: `npx prisma format && npx prisma generate`
Expected: no errors; `src/generated/prisma` regenerated.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(schema): add AdderRequest model + PendingCatalogPush OpenSolar fields"
```

### Task 1.2: Create migration

**Files:**
- Create: `prisma/migrations/<timestamp>_sales_product_requests/migration.sql`

- [ ] **Step 1: Generate migration**

Run: `npx prisma migrate dev --name sales_product_requests --create-only`
Expected: new migration file created, DB NOT touched (`--create-only`).

- [ ] **Step 2: Review the generated SQL**

Verify it contains ONLY:
- `ALTER TABLE "PendingCatalogPush" ADD COLUMN "openSolarId" TEXT`
- `ALTER TABLE "PendingCatalogPush" ADD COLUMN "salesRequestNote" TEXT`
- `CREATE TYPE "AdderRequestStatus" AS ENUM (...)`
- `CREATE TABLE "AdderRequest" (...)`
- Three `ALTER TYPE "ActivityType" ADD VALUE ...` statements
- Three indexes on `AdderRequest`

No `DROP`, no `RENAME` — migration must be purely additive.

- [ ] **Step 3: Apply migration locally**

Run: `npx prisma migrate deploy`
Expected: migration applied, `AdderRequest` table exists.

- [ ] **Step 4: Commit**

```bash
git add prisma/migrations
git commit -m "feat(db): migration for sales product requests"
```

**Human action required at prod:** per prior feedback, orchestrator (not subagent) must run `npx prisma migrate deploy` against production DB **before** the feature code is merged to `main`. Migration is additive and safe.

---

## Chunk 2: Shared library + types

### Task 2.1: Types module

**Files:**
- Create: `src/lib/product-requests/types.ts`

- [ ] **Step 1: Define payload + row types**

```typescript
import type { AdderCategory, AdderUnit } from "@/generated/prisma";

export type EquipmentRequestPayload = {
  category: string; // FORM_CATEGORIES member
  brand: string;
  model: string;
  datasheetUrl?: string | null;
  salesRequestNote: string;
  dealId?: string | null;
  extractedMetadata?: Record<string, unknown> | null;
};

export type AdderRequestPayload = {
  category: AdderCategory;
  unit: AdderUnit;
  name: string;
  estimatedPrice?: number | null;
  description?: string | null;
  salesRequestNote: string;
  dealId?: string | null;
};

export type MergedRequestRow = {
  id: string; // prefixed "eq_<pushId>" or "ad_<adderRequestId>"
  type: "EQUIPMENT" | "ADDER";
  status: string;
  title: string;
  requestedBy: string;
  createdAt: string;
  dealId: string | null;
  salesRequestNote: string | null;
};
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/product-requests/types.ts
git commit -m "feat(product-requests): add shared payload + row types"
```

### Task 2.2: Dedup logic (TDD)

**Files:**
- Create: `src/lib/product-requests/dedup.ts`
- Test: `src/__tests__/product-requests/dedup.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { findEquipmentDuplicate, findAdderDuplicate } from "@/lib/product-requests/dedup";
import { prisma } from "@/lib/db";

jest.mock("@/lib/db", () => ({
  prisma: {
    internalProduct: { findFirst: jest.fn() },
    catalogProduct: { findFirst: jest.fn() },
    pendingCatalogPush: { findFirst: jest.fn() },
    adder: { findFirst: jest.fn() },
    adderRequest: { findFirst: jest.fn() },
  },
}));

const p = prisma as jest.Mocked<typeof prisma>;

describe("findEquipmentDuplicate", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns null when no matches exist", async () => {
    (p.internalProduct.findFirst as jest.Mock).mockResolvedValue(null);
    (p.catalogProduct.findFirst as jest.Mock).mockResolvedValue(null);
    (p.pendingCatalogPush.findFirst as jest.Mock).mockResolvedValue(null);
    expect(await findEquipmentDuplicate("REC", "Alpha 400")).toBeNull();
  });

  it("detects InternalProduct hit", async () => {
    (p.internalProduct.findFirst as jest.Mock).mockResolvedValue({ id: "ip_1" });
    const r = await findEquipmentDuplicate("REC", "Alpha 400");
    expect(r).toEqual({ source: "INTERNAL_PRODUCT", id: "ip_1" });
  });

  it("detects pending push hit", async () => {
    (p.internalProduct.findFirst as jest.Mock).mockResolvedValue(null);
    (p.catalogProduct.findFirst as jest.Mock).mockResolvedValue(null);
    (p.pendingCatalogPush.findFirst as jest.Mock).mockResolvedValue({ id: "pp_1" });
    const r = await findEquipmentDuplicate("REC", "Alpha 400");
    expect(r).toEqual({ source: "PENDING_PUSH", id: "pp_1" });
  });

  it("normalizes case + whitespace", async () => {
    (p.internalProduct.findFirst as jest.Mock).mockResolvedValue({ id: "ip_1" });
    await findEquipmentDuplicate("  rec  ", "ALPHA 400");
    expect(p.internalProduct.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          brand: { equals: "rec", mode: "insensitive" },
          model: { equals: "alpha 400", mode: "insensitive" },
        }),
      }),
    );
  });
});

describe("findAdderDuplicate", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns null when no matches exist", async () => {
    (p.adder.findFirst as jest.Mock).mockResolvedValue(null);
    (p.adderRequest.findFirst as jest.Mock).mockResolvedValue(null);
    expect(await findAdderDuplicate("MPU 200A")).toBeNull();
  });

  it("detects existing Adder", async () => {
    (p.adder.findFirst as jest.Mock).mockResolvedValue({ id: "a_1" });
    const r = await findAdderDuplicate("MPU 200A");
    expect(r).toEqual({ source: "ADDER", id: "a_1" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/__tests__/product-requests/dedup.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```typescript
// src/lib/product-requests/dedup.ts
import { prisma } from "@/lib/db";

export type EquipmentDuplicate =
  | { source: "INTERNAL_PRODUCT" | "CATALOG_PRODUCT" | "PENDING_PUSH"; id: string }
  | null;

export type AdderDuplicate =
  | { source: "ADDER" | "ADDER_REQUEST"; id: string }
  | null;

function norm(s: string): string {
  return s.trim().toLowerCase();
}

export async function findEquipmentDuplicate(
  brand: string,
  model: string,
): Promise<EquipmentDuplicate> {
  if (!prisma) return null;
  const b = norm(brand);
  const m = norm(model);
  const where = {
    brand: { equals: b, mode: "insensitive" as const },
    model: { equals: m, mode: "insensitive" as const },
  };

  const ip = await prisma.internalProduct.findFirst({ where, select: { id: true } });
  if (ip) return { source: "INTERNAL_PRODUCT", id: ip.id };

  const cp = await prisma.catalogProduct.findFirst({ where, select: { id: true } });
  if (cp) return { source: "CATALOG_PRODUCT", id: cp.id };

  const pp = await prisma.pendingCatalogPush.findFirst({
    where: { ...where, status: "PENDING" },
    select: { id: true },
  });
  if (pp) return { source: "PENDING_PUSH", id: pp.id };

  return null;
}

export async function findAdderDuplicate(name: string): Promise<AdderDuplicate> {
  if (!prisma) return null;
  const n = norm(name);
  const where = { name: { equals: n, mode: "insensitive" as const } };

  const a = await prisma.adder.findFirst({ where, select: { id: true } });
  if (a) return { source: "ADDER", id: a.id };

  const ar = await prisma.adderRequest.findFirst({
    where: { ...where, status: "PENDING" },
    select: { id: true },
  });
  if (ar) return { source: "ADDER_REQUEST", id: ar.id };

  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/__tests__/product-requests/dedup.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/product-requests/dedup.ts src/__tests__/product-requests/dedup.test.ts
git commit -m "feat(product-requests): dedup helpers for equipment + adders"
```

### Task 2.3: OpenSolar push stub

**Files:**
- Create: `src/lib/product-requests/opensolar-push.ts`

- [ ] **Step 1: Write the stub following the adder-client pattern**

```typescript
// Mirrors lib/adders/opensolar-client.ts. Synthetic-success when flag off.
import type { InternalProduct } from "@/generated/prisma";

export type OpenSolarProductPushResult = {
  ok: boolean;
  openSolarId: string | null;
  error?: string;
};

function isEnabled(): boolean {
  return process.env.OPENSOLAR_PRODUCT_SYNC_ENABLED === "true";
}

export async function pushProductToOpenSolar(
  product: Pick<InternalProduct, "id" | "brand" | "model" | "category">,
): Promise<OpenSolarProductPushResult> {
  if (!isEnabled()) {
    return { ok: true, openSolarId: `stub_${product.id}` };
  }
  // Real fetch() lands when OpenSolar API discovery spec completes.
  console.warn("[opensolar-push] flag on but real client not yet implemented");
  return { ok: true, openSolarId: `stub_${product.id}` };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/product-requests/opensolar-push.ts
git commit -m "feat(product-requests): OpenSolar equipment push stub"
```

### Task 2.4: Notifications module

**Files:**
- Create: `src/lib/product-requests/notifications.ts`

- [ ] **Step 1: Implement using existing email transport**

```typescript
import { sendEmail } from "@/lib/email"; // existing dual-provider helper
import SalesProductRequestNotification from "@/emails/SalesProductRequestNotification";
import SalesProductRequestApproved from "@/emails/SalesProductRequestApproved";
import SalesProductRequestDeclined from "@/emails/SalesProductRequestDeclined";

function techOpsRecipients(): string[] {
  const raw = process.env.TECH_OPS_REQUESTS_EMAIL || "";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export async function notifyTechOpsOfNewRequest(args: {
  requestId: string;
  type: "EQUIPMENT" | "ADDER";
  title: string;
  requestedBy: string;
  salesRequestNote: string;
  dealId: string | null;
  reviewUrl: string;
}) {
  const to = techOpsRecipients();
  if (to.length === 0) return;
  await sendEmail({
    to,
    subject: `[${args.type === "EQUIPMENT" ? "Product" : "Adder"} Request] ${args.title}`,
    react: SalesProductRequestNotification(args),
  });
}

export async function notifyRepOfApproval(args: {
  to: string; title: string; dealId: string | null;
}) {
  await sendEmail({
    to: args.to,
    subject: `Your product request was added to OpenSolar: ${args.title}`,
    react: SalesProductRequestApproved(args),
  });
}

export async function notifyRepOfDecline(args: {
  to: string; title: string; reviewerNote: string;
}) {
  await sendEmail({
    to: args.to,
    subject: `Your product request was declined: ${args.title}`,
    react: SalesProductRequestDeclined(args),
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/product-requests/notifications.ts
git commit -m "feat(product-requests): notification helpers"
```

---

## Chunk 3: Email templates

### Task 3.1: Tech Ops submit notification template

**Files:**
- Create: `src/emails/SalesProductRequestNotification.tsx`

- [ ] **Step 1: Model after `ProductUpdate.tsx`**

Read `src/emails/ProductUpdate.tsx` for the style baseline. Build a React Email component with:
- Heading: "New product request from sales"
- Rows: Type, Title, Requested by, Deal (link if present), Note
- Primary button: "Review request" → `reviewUrl`

- [ ] **Step 2: Verify renders in email preview**

Run: `npm run email:preview`
Navigate to the new template, confirm rendering.

- [ ] **Step 3: Commit**

```bash
git add src/emails/SalesProductRequestNotification.tsx
git commit -m "feat(emails): Tech Ops product request notification template"
```

### Task 3.2: Rep approved + declined templates

**Files:**
- Create: `src/emails/SalesProductRequestApproved.tsx`
- Create: `src/emails/SalesProductRequestDeclined.tsx`

- [ ] **Step 1: Build both templates**

`Approved`: "Your request is live" + title + "may take a few minutes to appear in OpenSolar" + deal link (if any).

`Declined`: "Your request couldn't be added" + title + reviewer note (as the main body) + "Reply to this email if you have questions" closer.

- [ ] **Step 2: Verify in email preview**

- [ ] **Step 3: Commit**

```bash
git add src/emails/SalesProductRequestApproved.tsx src/emails/SalesProductRequestDeclined.tsx
git commit -m "feat(emails): rep approved + declined templates"
```

---

## Chunk 4: Rep-submit API routes (TDD)

### Task 4.1: Equipment submit route

**Files:**
- Create: `src/app/api/product-requests/equipment/route.ts`
- Test: `src/__tests__/product-requests/submit-equipment.test.ts`

- [ ] **Step 1: Write failing tests**

Cover: auth required, flag disabled returns 503, required fields, category must be in `FORM_CATEGORIES`, dedup hit returns 409 with hint, happy path creates `PendingCatalogPush` row with `source="SALES_REQUEST"`, `systems` includes `OPENSOLAR`, emails Tech Ops, logs `ActivityType.SALES_PRODUCT_REQUEST_SUBMITTED`.

- [ ] **Step 2: Run to verify fail**

- [ ] **Step 3: Implement**

Structure (trimmed):

```typescript
export async function POST(req: NextRequest) {
  if (process.env.SALES_PRODUCT_REQUESTS_ENABLED !== "true") {
    return NextResponse.json({ error: "Feature disabled" }, { status: 503 });
  }
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Parse + validate body against EquipmentRequestPayload
  // Category must be in FORM_CATEGORIES
  // Dedup check → 409 with { duplicate: { source, id } } if hit
  // Create PendingCatalogPush with:
  //   source: "SALES_REQUEST"
  //   systems: ["INTERNAL", "HUBSPOT", "ZUPER", "ZOHO", "OPENSOLAR"]
  //   requestedBy: session.user.email
  //   salesRequestNote: payload.salesRequestNote
  //   metadata: payload.extractedMetadata ?? {}
  //   description: derived "Requested by <email>: <note>" until reviewer fills
  // Log activity
  // Fire notifyTechOpsOfNewRequest (await, but catch + log on failure — don't 500)
  // Return { id: push.id }
}
```

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add src/app/api/product-requests/equipment src/__tests__/product-requests/submit-equipment.test.ts
git commit -m "feat(api): POST /api/product-requests/equipment"
```

### Task 4.2: Adder submit route

**Files:**
- Create: `src/app/api/product-requests/adder/route.ts`
- Test: `src/__tests__/product-requests/submit-adder.test.ts`

- [ ] **Step 1: Write failing tests**

Cover: flag, auth, required fields (category in `AdderCategory`, unit in `AdderUnit`), dedup, happy path creates `AdderRequest`, emails Tech Ops, logs activity.

- [ ] **Step 2: Implement**

Mirror equipment route, writing to `AdderRequest` instead.

- [ ] **Step 3: Tests PASS**

- [ ] **Step 4: Commit**

```bash
git add src/app/api/product-requests/adder src/__tests__/product-requests/submit-adder.test.ts
git commit -m "feat(api): POST /api/product-requests/adder"
```

### Task 4.3: "My requests" route

**Files:**
- Create: `src/app/api/product-requests/mine/route.ts`

- [ ] **Step 1: Implement merged query**

```typescript
export async function GET() {
  if (process.env.SALES_PRODUCT_REQUESTS_ENABLED !== "true") {
    return NextResponse.json({ error: "Feature disabled" }, { status: 503 });
  }
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const email = session.user.email;

  const [eq, ad] = await Promise.all([
    prisma.pendingCatalogPush.findMany({
      where: { requestedBy: email, source: "SALES_REQUEST" },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.adderRequest.findMany({
      where: { requestedBy: email },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  const rows: MergedRequestRow[] = [
    ...eq.map((r) => ({ id: `eq_${r.id}`, type: "EQUIPMENT" as const, status: r.status, title: `${r.brand} ${r.model}`, requestedBy: r.requestedBy, createdAt: r.createdAt.toISOString(), dealId: r.dealId, salesRequestNote: r.salesRequestNote })),
    ...ad.map((r) => ({ id: `ad_${r.id}`, type: "ADDER" as const, status: r.status, title: r.name, requestedBy: r.requestedBy, createdAt: r.createdAt.toISOString(), dealId: r.dealId, salesRequestNote: r.salesRequestNote })),
  ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return NextResponse.json({ rows });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/product-requests/mine
git commit -m "feat(api): GET /api/product-requests/mine"
```

---

## Chunk 5: Admin reviewer API routes

### Task 5.1: Reviewer list route

**Files:**
- Create: `src/app/api/admin/product-requests/route.ts`

- [ ] **Step 1: Implement**

Same merge pattern as `/mine`, but without `requestedBy` filter and with an optional `?status=PENDING` query. Protected by the `/api/admin/*` prefix (existing middleware).

- [ ] **Step 2: Commit**

```bash
git add src/app/api/admin/product-requests
git commit -m "feat(api): GET /api/admin/product-requests (reviewer list)"
```

### Task 5.2: Approve route (TDD)

**Files:**
- Create: `src/app/api/admin/product-requests/[id]/approve/route.ts`
- Test: `src/__tests__/product-requests/approve-equipment.test.ts`
- Test: `src/__tests__/product-requests/approve-adder.test.ts`

- [ ] **Step 1: Equipment approve tests**

Cover: 404 when id not found, happy path promotes `PendingCatalogPush` to `InternalProduct` via existing `executeCatalogPushApproval`, pushes to OpenSolar via stub, writes `openSolarId` back, status flips to `APPROVED`, emails rep, logs `SALES_PRODUCT_REQUEST_APPROVED`.

- [ ] **Step 2: Adder approve tests**

Cover: creates `Adder` in transaction with request status flip to `ADDED`, writes `adderCatalogId` back, emails rep, logs activity.

- [ ] **Step 3: Implement**

```typescript
// Parse id prefix to route to correct table.
// "eq_..." → equipment path: call executeCatalogPushApproval, then pushProductToOpenSolar, then set openSolarId
// "ad_..." → adder path: wrap in prisma.$transaction({ adder.create, adderRequest.update })
```

- [ ] **Step 4: Tests PASS**

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/product-requests/[id]/approve src/__tests__/product-requests/approve-*.test.ts
git commit -m "feat(api): POST /api/admin/product-requests/[id]/approve"
```

### Task 5.3: Decline route

**Files:**
- Create: `src/app/api/admin/product-requests/[id]/decline/route.ts`

- [ ] **Step 1: Implement**

Requires `reviewerNote` in body (400 if empty). Equipment → status `REJECTED`, `note=reviewerNote`. Adder → status `DECLINED`, `reviewerNote=reviewerNote`. Both email the rep and log activity.

- [ ] **Step 2: Commit**

```bash
git add src/app/api/admin/product-requests/[id]/decline
git commit -m "feat(api): POST /api/admin/product-requests/[id]/decline"
```

---

## Chunk 6: Rep-facing UI

### Task 6.1: Page shell + client state machine

**Files:**
- Create: `src/app/dashboards/request-product/page.tsx`
- Create: `src/app/dashboards/request-product/RequestProductClient.tsx`

- [ ] **Step 1: Server page**

```tsx
import { redirect } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";
import { getCurrentUser } from "@/lib/auth-utils";
import RequestProductClient from "./RequestProductClient";

export default async function RequestProductPage() {
  if (process.env.SALES_PRODUCT_REQUESTS_ENABLED !== "true") redirect("/");
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/dashboards/request-product");
  return (
    <DashboardShell title="Request a Product" accentColor="cyan">
      <RequestProductClient userEmail={user.email} />
    </DashboardShell>
  );
}
```

- [ ] **Step 2: Client state machine**

Steps: `"mode" | "equipment" | "adder" | "confirmation"`. `dealId` picked up from `useSearchParams` on mount. Children receive `onSubmit` handlers that POST to the right route and advance state on success, show inline error otherwise.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/request-product/page.tsx src/app/dashboards/request-product/RequestProductClient.tsx
git commit -m "feat(ui): request-product page shell + client state machine"
```

### Task 6.2: Mode select + confirmation

**Files:**
- Create: `src/app/dashboards/request-product/ModeSelectStep.tsx`
- Create: `src/app/dashboards/request-product/ConfirmationScreen.tsx`

- [ ] **Step 1: Two large buttons**

`ModeSelectStep`: "Equipment (panel, inverter, battery, EV charger, etc.)" and "Adder (MPU, trenching, steep roof, etc.)". Each is a card with icon + short description.

`ConfirmationScreen`: check icon + "Submitted. Tech Ops has been notified." + "You'll get an email when it's added to OpenSolar" + two buttons ("Submit another" → resets state to `mode`, "Back to Sales & Marketing" → router.push).

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboards/request-product/ModeSelectStep.tsx src/app/dashboards/request-product/ConfirmationScreen.tsx
git commit -m "feat(ui): mode select + confirmation screens"
```

### Task 6.3: Equipment form + datasheet extraction

**Files:**
- Create: `src/app/dashboards/request-product/EquipmentRequestForm.tsx`

- [ ] **Step 1: Form fields**

Category dropdown (FORM_CATEGORIES), brand, model, datasheet URL, datasheet file drop (optional), salesRequestNote (textarea), deal search (optional, reuses existing deal search component if present; otherwise just a text input for deal ID prefilled from URL param).

- [ ] **Step 2: Datasheet upload flow**

If file dropped: POST to `/api/catalog/extract-from-datasheet` first, await extracted JSON, show "Extracting…" spinner. On success, hold JSON in component state and include in submit payload as `extractedMetadata`. On failure: show non-blocking warning banner, allow submit without metadata.

- [ ] **Step 3: Submit handler**

POST to `/api/product-requests/equipment`. On 409: surface `duplicate.source` human-readable ("This product is already in our catalog — search for it in OpenSolar"). On success: call `onSubmitted()` prop.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboards/request-product/EquipmentRequestForm.tsx
git commit -m "feat(ui): equipment request form with datasheet extraction"
```

### Task 6.4: Adder form

**Files:**
- Create: `src/app/dashboards/request-product/AdderRequestForm.tsx`

- [ ] **Step 1: Form fields**

Category (AdderCategory enum), unit (AdderUnit enum, default FLAT), name, estimatedPrice (number), description (textarea), salesRequestNote (textarea), deal ID (optional).

- [ ] **Step 2: Submit handler**

POST to `/api/product-requests/adder`. Same duplicate handling pattern as equipment form.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/request-product/AdderRequestForm.tsx
git commit -m "feat(ui): adder request form"
```

### Task 6.5: My requests table

**Files:**
- Create: `src/app/dashboards/request-product/MyRequestsTable.tsx`

- [ ] **Step 1: Fetch + render**

Fetch `/api/product-requests/mine` via React Query (5-min stale). Render as simple table: Date, Type, Title, Status (colored badge), Deal (link). No actions. Empty state: "No requests yet."

- [ ] **Step 2: Wire into client**

Rendered below the current step in `RequestProductClient`, always visible.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/request-product/MyRequestsTable.tsx
git commit -m "feat(ui): my requests table"
```

---

## Chunk 7: Reviewer UI integration

### Task 7.1: Adder request drawer

**Files:**
- Create: `src/components/catalog/AdderRequestDrawer.tsx`

- [ ] **Step 1: Drawer with form matching `Adder` model**

Fields: code (required, unique), name (prefilled from request), category, type (FIXED/PERCENTAGE, default FIXED), direction (ADD/DISCOUNT, default ADD), unit, basePrice (required), baseCost (required), marginTarget, description.

Approve button → POST `/api/admin/product-requests/${id}/approve` with filled adder fields in body.

Decline button → opens confirm with `reviewerNote` textarea → POST decline.

Top banner surfaces `salesRequestNote` (rep's "why I need this").

- [ ] **Step 2: Commit**

```bash
git add src/components/catalog/AdderRequestDrawer.tsx
git commit -m "feat(reviewer): adder request drawer"
```

### Task 7.2: Review page integration

**Files:**
- Modify: `src/app/dashboards/catalog/review/page.tsx`

- [ ] **Step 1: Add Source filter chip**

New filter state value `source: "ALL" | "BOM" | "SALES_REQUEST"`. When `SALES_REQUEST` (or `ALL`), fetch `/api/admin/product-requests` alongside existing data and merge into list.

- [ ] **Step 2: Render type badges**

Each row gets an `EQUIPMENT` or `ADDER` badge. Clicking an `ADDER` row opens `AdderRequestDrawer`. Clicking an `EQUIPMENT` row opens the existing catalog wizard with `salesRequestNote` shown as a top banner (pass as prop to existing wizard wrapper; add banner rendering in the drawer component).

- [ ] **Step 3: Update approve flow**

Equipment approves continue to use existing path but must forward `salesRequestNote`-origin rows through the same `/api/admin/product-requests/[id]/approve` endpoint so the OpenSolar push + rep email fire. Non-sales rows continue to use the existing approval endpoint.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboards/catalog/review/page.tsx
git commit -m "feat(reviewer): merge sales product requests into review queue"
```

### Task 7.3: Extend `executeCatalogPushApproval`

**Files:**
- Modify: `src/lib/catalog-push-approve.ts`

- [ ] **Step 1: After InternalProduct created, push to OpenSolar if applicable**

If `systems` includes `"OPENSOLAR"` AND `source === "SALES_REQUEST"`:
```typescript
import { pushProductToOpenSolar } from "@/lib/product-requests/opensolar-push";
// ...after InternalProduct created...
const result = await pushProductToOpenSolar(internalProduct);
if (result.ok && result.openSolarId) {
  await prisma.pendingCatalogPush.update({
    where: { id: push.id },
    data: { openSolarId: result.openSolarId },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/catalog-push-approve.ts
git commit -m "feat(catalog): queue OpenSolar push on sales-request approvals"
```

---

## Chunk 8: Wiring — suite card, roles, env

### Task 8.1: Sales & Marketing suite card

**Files:**
- Modify: `src/app/suites/sales-marketing/page.tsx`

- [ ] **Step 1: Conditionally include the card**

```tsx
const requestProductEnabled = process.env.SALES_PRODUCT_REQUESTS_ENABLED === "true";

const LINKS: SuitePageCard[] = [
  // ...existing cards...
  ...(requestProductEnabled ? [{
    href: "/dashboards/request-product",
    title: "Request a Product",
    description: "Can't find a panel, inverter, battery, or adder in OpenSolar? Request it here.",
    tag: "REQUEST",
    icon: "📦",
    section: "Tools",
  }] : []),
];
```

- [ ] **Step 2: Commit**

```bash
git add src/app/suites/sales-marketing/page.tsx
git commit -m "feat(suite): add Request a Product card (flag-gated)"
```

### Task 8.2: Role allowlist

**Files:**
- Modify: `src/lib/roles.ts`

- [ ] **Step 1: Add rep-facing routes to each relevant role**

For `ADMIN`, `OWNER`, `SALES_MANAGER`, `SALES`, `MARKETING`: append to `allowedRoutes`:
```
"/dashboards/request-product",
"/api/product-requests/equipment",
"/api/product-requests/adder",
"/api/product-requests/mine",
```

- [ ] **Step 2: Add admin routes to exceptions**

Append to `ADMIN_ONLY_EXCEPTIONS`:
```
"/api/admin/product-requests",
```

(Adder/equipment admin sub-routes are covered by the prefix.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/roles.ts
git commit -m "feat(roles): allowlist product request routes for sales + tech ops"
```

### Task 8.3: Env var documentation

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add entries**

```
# Sales Product Requests
SALES_PRODUCT_REQUESTS_ENABLED=false
OPENSOLAR_PRODUCT_SYNC_ENABLED=false
TECH_OPS_REQUESTS_EMAIL=
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs(env): document sales product request flags"
```

---

## Chunk 9: Verification + rollout

### Task 9.1: Type + lint + test pass

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 3: Tests**

Run: `npm test`
Expected: all green.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "chore: fix lint/type issues from product-requests wiring"
```

### Task 9.2: Manual QA checklist (preview deploy)

Document in PR description:
- [ ] Flag off: suite card hidden, page redirects home, APIs return 503.
- [ ] Flag on (preview env): rep can submit equipment (with + without datasheet), sees confirmation, sees own row in My Requests.
- [ ] Rep can submit adder, sees confirmation.
- [ ] Dedup: try to re-submit same product, get 409 + friendly message.
- [ ] Tech Ops receives email with review link.
- [ ] Tech Ops sees merged queue on `/dashboards/catalog/review` with Source filter; clicks equipment row → wizard opens with banner; clicks adder row → adder drawer opens.
- [ ] Approve equipment → `InternalProduct` created, `openSolarId` populated (stub), rep gets email, request status `APPROVED`.
- [ ] Approve adder → `Adder` created, rep gets email, request status `ADDED`.
- [ ] Decline either → reviewer note required, rep gets email with note, status `REJECTED`/`DECLINED`.

### Task 9.3: Rollout checklist (owner-orchestrated)

- [ ] Apply migration to production before merging (orchestrator runs `npx prisma migrate deploy`).
- [ ] Sync env vars to Vercel production (`SALES_PRODUCT_REQUESTS_ENABLED=false`, `OPENSOLAR_PRODUCT_SYNC_ENABLED=false`, `TECH_OPS_REQUESTS_EMAIL=<distro>`).
- [ ] Merge PR to main.
- [ ] Flip `SALES_PRODUCT_REQUESTS_ENABLED=true` in prod after a Tech Ops walk-through.
- [ ] Leave `OPENSOLAR_PRODUCT_SYNC_ENABLED=false` until the separate OpenSolar API discovery spec ships.

---

## Risks and pre-empted failure modes

- **`sendEmail` helper shape mismatch.** Open `src/lib/email.ts` early in Chunk 3 to confirm the signature; adjust `notifications.ts` if needed. If the helper expects `.html` strings instead of `.react`, `render()` from `@react-email/render` is already in deps.
- **`executeCatalogPushApproval` signature.** Confirm the function accepts the full push row and returns the created `InternalProduct`; the OpenSolar push step needs that return value.
- **Deal ID prefill.** Sales & Marketing suite doesn't have a deal-detail page, so the `?dealId=` param is best-effort. If a rep comes from an actual deal, it prefills; otherwise the field is manual. Don't over-engineer a deal search component here; a simple text input is enough for v1.
- **React Query cache key.** Use `["product-requests", "mine"]` for rep-side and `["product-requests", "admin"]` for reviewer. Invalidate both on submit/approve/decline.
