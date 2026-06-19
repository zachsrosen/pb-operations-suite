# EagleView → HubSpot Status Stamping Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stamp structured HubSpot properties (status, report id, dates, Drive folder URL) onto the originating deal or ticket at every EagleView order lifecycle transition, behind a feature flag, plus a one-time backfill of existing orders.

**Architecture:** A single best-effort `stampStatus` dependency is injected into the pipeline (`PipelineDeps`) and called at each status transition in `orderTrueDesign`, `fetchAndStoreDeliverables`, and the poll cron. A pure `buildEagleViewProps` helper maps a typed fields object to the HubSpot property map (handling date→string formatting). `ticketId` is threaded into order creation so the deal-vs-ticket target is resolvable everywhere. Two operational scripts create the HubSpot properties and backfill existing rows.

**Tech Stack:** TypeScript, Next.js API routes, Prisma (Neon Postgres), HubSpot SDK (`@hubspot/api-client`), Jest, tsx for scripts.

**Spec:** `docs/superpowers/specs/2026-06-18-eagleview-hubspot-status-stamping-design.md`

---

## Pre-work: isolated branch

This feature must NOT mix with the uncommitted EagleView reliability work. Use @superpowers:using-git-worktrees to create a worktree off `origin/main`:

```bash
git fetch origin
# create worktree off main (see using-git-worktrees skill for the exact dir convention)
git worktree add ../pb-ops-eagleview-hubspot-stamp -b feat/eagleview-hubspot-stamp origin/main
```

Run `npm install` and `npx prisma generate` in the new worktree. All tasks below run there. Commit the spec + this plan as the first commit.

```bash
git add docs/superpowers/specs/2026-06-18-eagleview-hubspot-status-stamping-design.md docs/superpowers/plans/2026-06-18-eagleview-hubspot-status-stamping.md
git commit -m "docs(eagleview): spec + plan for HubSpot status stamping"
```

Note: this feature adds NO Prisma migration — `EagleViewOrder.ticketId` already exists. (The `failedAttempts` column from the reliability branch is unrelated to this feature; if `main` doesn't have it yet, that's fine — nothing here touches it.)

---

## File Structure

- **Modify** `src/lib/eagleview-dedup.ts` — add `ticketId` to `ClaimOrderInput` + the `create` data.
- **Modify** `src/lib/eagleview-pipeline.ts` — add `ticketId` to `OrderTrueDesignInput`; pass to `claimOrder`; add `EagleViewStampFields` type, `buildEagleViewProps` + `toHubSpotDate` helpers, `stampStatus` to `PipelineDeps`; call `stampStatus` at each transition.
- **Modify** `src/lib/eagleview-pipeline-deps.ts` — implement the real `stampStatus` (flag check, target resolution, best-effort write).
- **Modify** `src/app/api/eagleview/order/route.ts` — pass `ticketId` into `orderTrueDesign`; drop the post-hoc `update({ data: { ticketId } })`.
- **Modify** `src/app/api/cron/eagleview-poll-orders/route.ts` — stamp on the terminal branch.
- **Modify** `src/__tests__/eagleview-pipeline.test.ts` — add `stampStatus` mock + transition assertions + ticket-origin test.
- **Modify** `src/__tests__/eagleview-client.test.ts` — unit-test `buildEagleViewProps` (or a new small test file; this file already imports from `@/lib/eagleview-pipeline`? No — keep `buildEagleViewProps` exported from `eagleview-pipeline.ts` and test in `eagleview-pipeline.test.ts`).
- **Create** `scripts/_create-eagleview-hubspot-props.ts` — idempotent property creation.
- **Create** `scripts/_backfill-eagleview-hubspot-stamps.ts` — backfill existing orders.
- **Modify** `.env.example` — document `EAGLEVIEW_HUBSPOT_STAMP_ENABLED`.

---

## Chunk 1: Core stamping wiring

### Task 1: Thread `ticketId` into order creation

**Files:**
- Modify: `src/lib/eagleview-dedup.ts`
- Modify: `src/lib/eagleview-pipeline.ts` (`OrderTrueDesignInput`, `orderTrueDesign` claim call)
- Modify: `src/app/api/eagleview/order/route.ts`
- Test: `src/__tests__/eagleview-pipeline.test.ts`

- [ ] **Step 1: Write the failing test**

In `eagleview-pipeline.test.ts`, add inside `describe("orderTrueDesign", ...)`:

```ts
it("persists ticketId on the order row when provided", async () => {
  const p = makeFakePrisma();
  const deps = mkDeps(p);
  await orderTrueDesign(deps, { dealId: "d1", ticketId: "t99", triggeredBy: "test" });
  expect(p.rows[0].ticketId).toBe("t99");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/eagleview-pipeline.test.ts -t "persists ticketId"`
Expected: FAIL — `ticketId` is `null` (not threaded) and/or a TS error that `ticketId` is not on `OrderTrueDesignInput`.

- [ ] **Step 3: Add `ticketId` to `ClaimOrderInput` and the create data**

In `src/lib/eagleview-dedup.ts`, `ClaimOrderInput`:

```ts
export interface ClaimOrderInput {
  dealId: string;
  ticketId?: string | null;
  productCode: EagleViewProduct;
  address: AddressParts;
  triggeredBy: string;
  surveyDate?: Date | null;
}
```

And in `claimOrder`'s `create({ data: {...} })`, add the line after `dealId`:

```ts
        dealId: input.dealId,
        ticketId: input.ticketId ?? null,
```

- [ ] **Step 4: Add `ticketId` to `OrderTrueDesignInput` and pass it to `claimOrder`**

In `src/lib/eagleview-pipeline.ts`, `OrderTrueDesignInput`:

```ts
export interface OrderTrueDesignInput {
  dealId: string;
  ticketId?: string | null;
  triggeredBy: string;
  surveyDate?: Date | null;
}
```

In `orderTrueDesign`, the `claimOrder` call — add `ticketId`:

```ts
  const claim = await claimOrder(deps.prisma, {
    dealId: input.dealId,
    ticketId: input.ticketId ?? null,
    productCode: "TDP",
    address: addressParts,
    triggeredBy: input.triggeredBy,
    surveyDate: input.surveyDate ?? null,
  });
```

No change is needed to the fake prisma `create` double: it already sets `ticketId: (args.data.ticketId as string | null) ?? null` (eagleview-pipeline.test.ts:74), so the threaded `ticketId` flows through automatically.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest src/__tests__/eagleview-pipeline.test.ts -t "persists ticketId"`
Expected: PASS.

- [ ] **Step 6: Update the order route to pass `ticketId` and drop the post-hoc update**

In `src/app/api/eagleview/order/route.ts`, change the call:

```ts
    const result = await orderTrueDesign(defaultPipelineDeps(), {
      dealId,
      ticketId: ticketId ?? null,
      triggeredBy: auth.email ?? "manual",
    });
```

And DELETE the now-redundant block:

```ts
    // If ticketId provided, link it to the order row
    if (ticketId && result.orderId) {
      await prisma.eagleViewOrder.update({
        where: { id: result.orderId },
        data: { ticketId },
      }).catch(() => { /* best-effort */ });
    }
```

(Leave the `result` return as-is.)

- [ ] **Step 7: Verify the full pipeline suite + typecheck the route**

Run: `npx jest src/__tests__/eagleview-pipeline.test.ts`
Expected: PASS (all existing + new).
Run: `npx tsc --noEmit 2>&1 | grep -E "eagleview"`
Expected: no output (no new type errors in eagleview files).

- [ ] **Step 8: Commit**

```bash
git add src/lib/eagleview-dedup.ts src/lib/eagleview-pipeline.ts src/app/api/eagleview/order/route.ts src/__tests__/eagleview-pipeline.test.ts
git commit -m "feat(eagleview): thread ticketId into order creation"
```

---

### Task 2: `buildEagleViewProps` pure helper + `toHubSpotDate`

**Files:**
- Modify: `src/lib/eagleview-pipeline.ts` (add types + helpers, exported)
- Test: `src/__tests__/eagleview-pipeline.test.ts`

- [ ] **Step 1: Write the failing test**

Add a new `describe` block at the end of `eagleview-pipeline.test.ts`. Import `buildEagleViewProps` and the `EagleViewStampFields` type at the top:

```ts
import {
  orderTrueDesign,
  fetchAndStoreDeliverables,
  buildEagleViewProps,
  type PipelineDeps,
  type DealAddressFields,
} from "@/lib/eagleview-pipeline";
```

```ts
describe("buildEagleViewProps", () => {
  it("maps fields to HubSpot internal names and formats dates as UTC YYYY-MM-DD", () => {
    const props = buildEagleViewProps({
      status: "Delivered",
      reportId: "12345",
      driveFolderUrl: "https://drive.google.com/drive/folders/abc",
      orderedDate: new Date("2026-06-01T00:00:00Z"),
      deliveredDate: new Date("2026-06-18T23:30:00Z"),
    });
    expect(props).toEqual({
      eagleview_status: "Delivered",
      eagleview_report_id: "12345",
      eagleview_drive_folder_url: "https://drive.google.com/drive/folders/abc",
      eagleview_ordered_date: "2026-06-01",
      eagleview_delivered_date: "2026-06-18",
    });
  });

  it("omits absent/null keys", () => {
    expect(buildEagleViewProps({ status: "Failed" })).toEqual({
      eagleview_status: "Failed",
    });
  });

  it("formats a date near a UTC boundary without timezone drift", () => {
    // 2026-06-18T23:30:00Z must stay 2026-06-18 regardless of local TZ.
    const props = buildEagleViewProps({
      status: "Delivered",
      deliveredDate: new Date(Date.UTC(2026, 5, 18, 23, 30, 0)),
    });
    expect(props.eagleview_delivered_date).toBe("2026-06-18");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/eagleview-pipeline.test.ts -t "buildEagleViewProps"`
Expected: FAIL — `buildEagleViewProps is not a function`.

- [ ] **Step 3: Implement the type + helpers**

In `src/lib/eagleview-pipeline.ts`, add near the top (after the existing interfaces, before `orderTrueDesign`):

```ts
export interface EagleViewStampFields {
  status: "Ordered" | "Delivered" | "Failed" | "Cancelled";
  reportId?: string;
  driveFolderUrl?: string | null;
  orderedDate?: Date | null;
  deliveredDate?: Date | null;
}

/** Format a Date to YYYY-MM-DD in UTC (HubSpot date props accept this string). */
function toHubSpotDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Map typed stamp fields to the HubSpot property map. Omits absent/null keys. */
export function buildEagleViewProps(
  fields: EagleViewStampFields,
): Record<string, string> {
  const props: Record<string, string> = { eagleview_status: fields.status };
  if (fields.reportId) props.eagleview_report_id = fields.reportId;
  if (fields.driveFolderUrl) props.eagleview_drive_folder_url = fields.driveFolderUrl;
  if (fields.orderedDate) props.eagleview_ordered_date = toHubSpotDate(fields.orderedDate);
  if (fields.deliveredDate) props.eagleview_delivered_date = toHubSpotDate(fields.deliveredDate);
  return props;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/eagleview-pipeline.test.ts -t "buildEagleViewProps"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/eagleview-pipeline.ts src/__tests__/eagleview-pipeline.test.ts
git commit -m "feat(eagleview): add buildEagleViewProps + date formatting"
```

---

### Task 3: Add `stampStatus` to `PipelineDeps` + the test double

**Files:**
- Modify: `src/lib/eagleview-pipeline.ts` (`PipelineDeps` interface)
- Modify: `src/__tests__/eagleview-pipeline.test.ts` (`mkDeps` + spies)
- Test: same file

- [ ] **Step 1: Add `stampStatus` to `PipelineDeps`**

In `src/lib/eagleview-pipeline.ts`, append to the `PipelineDeps` interface (after `postDealNote`):

```ts
  /**
   * Best-effort stamp of EagleView lifecycle state onto the originating CRM
   * object (ticket if ticketId set, else deal). Must never throw.
   */
  stampStatus: (
    target: { dealId: string; ticketId: string | null },
    fields: EagleViewStampFields,
  ) => Promise<void>;
```

- [ ] **Step 2: Add the mock to the test double and run the suite (expect compile failure first)**

In `eagleview-pipeline.test.ts` `mkDeps`, add to the spies type, the const, the returned `client`/deps object, and the `spies` object:

```ts
  const stampStatus = jest.fn(async () => undefined);
```
Add `stampStatus,` to the returned deps object and to `spies`. Add `stampStatus: jest.Mock;` to the `spies` type.

- [ ] **Step 3: Run the suite to verify still green**

Run: `npx jest src/__tests__/eagleview-pipeline.test.ts`
Expected: PASS (no behavior change yet; `stampStatus` is defined but not yet called).

- [ ] **Step 4: Commit**

```bash
git add src/lib/eagleview-pipeline.ts src/__tests__/eagleview-pipeline.test.ts
git commit -m "feat(eagleview): add stampStatus dependency to PipelineDeps"
```

---

### Task 4: Stamp Ordered + Failed in `orderTrueDesign`

**Files:**
- Modify: `src/lib/eagleview-pipeline.ts`
- Test: `src/__tests__/eagleview-pipeline.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe("orderTrueDesign — HubSpot stamping", () => {
  it("stamps Ordered with report id + ordered date on the deal", async () => {
    const p = makeFakePrisma();
    const deps = mkDeps(p);
    await orderTrueDesign(deps, { dealId: "d1", triggeredBy: "test" });
    expect(deps.spies.stampStatus).toHaveBeenCalledWith(
      { dealId: "d1", ticketId: null },
      expect.objectContaining({ status: "Ordered", reportId: "12345" }),
    );
    const fields = deps.spies.stampStatus.mock.calls[0][1];
    expect(fields.orderedDate).toBeInstanceOf(Date);
  });

  it("stamps Failed when placeOrder throws", async () => {
    const p = makeFakePrisma();
    const deps = mkDeps(p);
    deps.spies.placeOrder.mockRejectedValueOnce(new Error("HTTP 500"));
    await orderTrueDesign(deps, { dealId: "d1", triggeredBy: "test" });
    expect(deps.spies.stampStatus).toHaveBeenCalledWith(
      { dealId: "d1", ticketId: null },
      { status: "Failed" },
    );
  });

  it("targets the ticket when the order originated from a ticket", async () => {
    const p = makeFakePrisma();
    const deps = mkDeps(p);
    await orderTrueDesign(deps, { dealId: "d1", ticketId: "t7", triggeredBy: "test" });
    expect(deps.spies.stampStatus).toHaveBeenCalledWith(
      { dealId: "d1", ticketId: "t7" },
      expect.objectContaining({ status: "Ordered" }),
    );
  });

  it("does not fail the order if stampStatus throws (best-effort)", async () => {
    const p = makeFakePrisma();
    const deps = mkDeps(p);
    deps.spies.stampStatus.mockRejectedValue(new Error("hubspot down"));
    const r = await orderTrueDesign(deps, { dealId: "d1", triggeredBy: "test" });
    expect(r.status).toBe("ORDERED");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/__tests__/eagleview-pipeline.test.ts -t "orderTrueDesign — HubSpot stamping"`
Expected: FAIL — `stampStatus` not called.

- [ ] **Step 3: Implement**

In `orderTrueDesign`, after step 6 (the `update` setting `reportId` + status ORDERED), and before step 7's `postDealNote`, add a best-effort stamp:

```ts
  await deps
    .stampStatus(
      { dealId: claim.order.dealId, ticketId: claim.order.ticketId ?? null },
      { status: "Ordered", reportId: realReportId, orderedDate: claim.order.orderedAt },
    )
    .catch((err) => console.warn("[eagleview-pipeline] stamp Ordered failed", err));
```

For the four `markFailed` failure paths (geocode_failed, tdp_unavailable_at_address, availability_check_failed, place_order_failed): immediately after each `await markFailed(...)`, add:

```ts
    await deps
      .stampStatus(
        { dealId: claim.order.dealId, ticketId: claim.order.ticketId ?? null },
        { status: "Failed" },
      )
      .catch((err) => console.warn("[eagleview-pipeline] stamp Failed failed", err));
```

(Note: `failWithoutClaim` paths — deal_not_found, address_incomplete — do NOT stamp; no order row exists. Leave them unchanged.)

To DRY the four repetitions, optionally extract a local helper inside `orderTrueDesign`:

```ts
  const stampFailed = () =>
    deps
      .stampStatus(
        { dealId: claim.order.dealId, ticketId: claim.order.ticketId ?? null },
        { status: "Failed" },
      )
      .catch((err) => console.warn("[eagleview-pipeline] stamp Failed failed", err));
```

and call `await stampFailed();` after each `markFailed`. (Only valid after `claim` exists, which is true for all four.)

- [ ] **Step 4: Run to verify pass**

Run: `npx jest src/__tests__/eagleview-pipeline.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/lib/eagleview-pipeline.ts src/__tests__/eagleview-pipeline.test.ts
git commit -m "feat(eagleview): stamp Ordered/Failed in orderTrueDesign"
```

---

### Task 5: Stamp Delivered in `fetchAndStoreDeliverables`

**Files:**
- Modify: `src/lib/eagleview-pipeline.ts`
- Test: `src/__tests__/eagleview-pipeline.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe("fetchAndStoreDeliverables — HubSpot stamping", () => {
  it("stamps Delivered with report id, folder url, delivered date", async () => {
    const p = makeFakePrisma();
    const deps = mkDeps(p);
    await orderTrueDesign(deps, { dealId: "d1", triggeredBy: "test" });
    await fetchAndStoreDeliverables(deps, "12345");
    const call = deps.spies.stampStatus.mock.calls.find((c) => c[1].status === "Delivered");
    expect(call).toBeDefined();
    expect(call![0]).toEqual({ dealId: "d1", ticketId: null });
    expect(call![1].reportId).toBe("12345");
    expect(call![1].driveFolderUrl).toContain("drive_folder_123");
    expect(call![1].deliveredDate).toBeInstanceOf(Date);
  });

  it("does NOT stamp on retryable failure (status stays ORDERED)", async () => {
    const p = makeFakePrisma();
    const deps = mkDeps(p);
    await orderTrueDesign(deps, { dealId: "d1", triggeredBy: "test" });
    deps.spies.stampStatus.mockClear();
    deps.spies.getFileLinks.mockResolvedValueOnce({ links: [] });
    await fetchAndStoreDeliverables(deps, "12345");
    expect(deps.spies.stampStatus).not.toHaveBeenCalled();
  });
});
```

(The folder URL is built from `driveFolderId` = `drive_folder_123` in the mock; expect the URL to contain it.)

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/__tests__/eagleview-pipeline.test.ts -t "fetchAndStoreDeliverables — HubSpot stamping"`
Expected: FAIL — first test: no Delivered stamp.

- [ ] **Step 3: Implement**

In `fetchAndStoreDeliverables`, after the `update` that sets status DELIVERED and before the delivered `postDealNote`, add:

```ts
  await deps
    .stampStatus(
      { dealId: order.dealId, ticketId: order.ticketId ?? null },
      {
        status: "Delivered",
        reportId: reportIdStr,
        driveFolderUrl: `https://drive.google.com/drive/folders/${driveFolderId}`,
        deliveredDate: new Date(),
      },
    )
    .catch((err) => console.warn("[eagleview-pipeline] stamp Delivered failed", err));
```

(Do NOT add any stamp inside `recordDeliveryFailure` — status remains ORDERED, no HubSpot-visible change. The second test guards this.)

- [ ] **Step 4: Run to verify pass**

Run: `npx jest src/__tests__/eagleview-pipeline.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/lib/eagleview-pipeline.ts src/__tests__/eagleview-pipeline.test.ts
git commit -m "feat(eagleview): stamp Delivered in fetchAndStoreDeliverables"
```

---

### Task 6: Implement the real `stampStatus` in `defaultPipelineDeps`

**Files:**
- Modify: `src/lib/eagleview-pipeline-deps.ts`

This is the production wiring. It is exercised end-to-end by the order/delivery/cron routes; the DI-level behavior is already covered by Tasks 4–5. No new unit test (the function is a thin flag-check + branch over already-tested primitives). Verify via typecheck.

- [ ] **Step 1: Add imports**

In `src/lib/eagleview-pipeline-deps.ts`:

```ts
import * as Sentry from "@sentry/nextjs";
import { updateDealProperty } from "@/lib/hubspot";
import { updateTicketProperties } from "@/lib/hubspot-tickets";
import { buildEagleViewProps } from "@/lib/eagleview-pipeline";
```

(Keep existing imports. `EagleViewStampFields` type is imported via the existing `import type { PipelineDeps, DealAddressFields } from "@/lib/eagleview-pipeline"` — add `EagleViewStampFields` to that type import.)

- [ ] **Step 2: Implement and wire into the returned deps**

Add a module-level function:

```ts
async function stampStatus(
  target: { dealId: string; ticketId: string | null },
  fields: EagleViewStampFields,
): Promise<void> {
  if (process.env.EAGLEVIEW_HUBSPOT_STAMP_ENABLED !== "true") return;
  try {
    const props = buildEagleViewProps(fields);
    // Ticket branch FIRST so a ticket-origin synthetic dealId ("ticket:<id>")
    // is never passed to updateDealProperty.
    if (target.ticketId) {
      await updateTicketProperties(target.ticketId, props);
    } else {
      await updateDealProperty(target.dealId, props);
    }
  } catch (err) {
    Sentry.captureException(err, {
      tags: { feature: "eagleview", phase: "stampStatus" },
      extra: { target, status: fields.status },
    });
    console.warn("[eagleview-pipeline-deps] stampStatus failed", err);
  }
}
```

Add `stampStatus,` to the object returned by `defaultPipelineDeps()`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "eagleview"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/lib/eagleview-pipeline-deps.ts
git commit -m "feat(eagleview): real stampStatus impl (flag-gated, best-effort)"
```

---

### Task 7: Stamp terminal statuses in the poll cron

**Files:**
- Modify: `src/app/api/cron/eagleview-poll-orders/route.ts`

The cron loads the `order` row (with `dealId` + `ticketId`) and already computes `terminal` via `classifyTerminalStatus`. Add a best-effort stamp in the terminal branch. No unit test (route-level; logic is `classifyTerminalStatus` which is already tested, plus the stamp primitive tested via DI).

- [ ] **Step 1: Implement**

In the `else if (terminal)` branch, after the `prisma.eagleViewOrder.update({...})` call, add:

```ts
        await deps
          .stampStatus(
            { dealId: order.dealId, ticketId: order.ticketId ?? null },
            { status: terminal === "CANCELLED" ? "Cancelled" : "Failed" },
          )
          .catch((err) => console.warn("[eagleview-poll] stamp terminal failed", err));
```

(`deps` is the `defaultPipelineDeps()` already constructed at the top of the handler.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "eagleview"`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/eagleview-poll-orders/route.ts
git commit -m "feat(eagleview): stamp terminal status from poll cron"
```

---

## Chunk 2: Operational scripts + flag

### Task 8: HubSpot property-creation script

**Files:**
- Create: `scripts/_create-eagleview-hubspot-props.ts`

Operational throwaway script — verified by dry-run, not unit tests (per TDD exception for operational/generated code).

- [ ] **Step 1: Write the script**

```ts
/**
 * One-time idempotent setup: create EagleView properties on HubSpot deals + tickets.
 *
 * Dry-run:  tsx scripts/_create-eagleview-hubspot-props.ts
 * Apply:    tsx scripts/_create-eagleview-hubspot-props.ts --apply
 *
 * Safe to re-run; skips properties/group that already exist. Safe to delete after use.
 */
import "dotenv/config";
import { hubspotClient } from "../src/lib/hubspot";

const GROUP_NAME = "eagleview";
const GROUP_LABEL = "EagleView";

const PROPS = [
  {
    name: "eagleview_status",
    label: "EagleView Status",
    type: "enumeration",
    fieldType: "select",
    options: ["Ordered", "Delivered", "Failed", "Cancelled"].map((v) => ({
      label: v,
      value: v,
    })),
  },
  { name: "eagleview_report_id", label: "EagleView Report ID", type: "string", fieldType: "text" },
  { name: "eagleview_drive_folder_url", label: "EagleView Drive Folder URL", type: "string", fieldType: "text" },
  { name: "eagleview_ordered_date", label: "EagleView Ordered Date", type: "date", fieldType: "date" },
  { name: "eagleview_delivered_date", label: "EagleView Delivered Date", type: "date", fieldType: "date" },
] as const;

const OBJECT_TYPES = ["deals", "tickets"] as const;

async function ensureGroup(objectType: string, apply: boolean) {
  try {
    await hubspotClient.crm.properties.groupsApi.getByName(objectType, GROUP_NAME);
    console.log(`  group ${GROUP_NAME} exists on ${objectType}`);
  } catch {
    console.log(`  ${apply ? "CREATE" : "WOULD CREATE"} group ${GROUP_NAME} on ${objectType}`);
    if (apply) {
      await hubspotClient.crm.properties.groupsApi.create(objectType, {
        name: GROUP_NAME,
        label: GROUP_LABEL,
      });
    }
  }
}

async function ensureProp(objectType: string, prop: (typeof PROPS)[number], apply: boolean) {
  try {
    await hubspotClient.crm.properties.coreApi.getByName(objectType, prop.name);
    console.log(`  prop ${prop.name} exists on ${objectType}`);
    return;
  } catch {
    /* not found — create */
  }
  console.log(`  ${apply ? "CREATE" : "WOULD CREATE"} prop ${prop.name} on ${objectType}`);
  if (apply) {
    await hubspotClient.crm.properties.coreApi.create(objectType, {
      name: prop.name,
      label: prop.label,
      type: prop.type,
      fieldType: prop.fieldType,
      groupName: GROUP_NAME,
      ...(("options" in prop) ? { options: prop.options } : {}),
    } as Parameters<typeof hubspotClient.crm.properties.coreApi.create>[1]);
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(apply ? "APPLY mode\n" : "DRY-RUN (pass --apply)\n");
  for (const objectType of OBJECT_TYPES) {
    console.log(`== ${objectType} ==`);
    await ensureGroup(objectType, apply);
    for (const prop of PROPS) await ensureProp(objectType, prop, apply);
  }
  console.log("\nDone.");
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Dry-run to verify it inspects correctly (no writes)**

Run: `npx tsx scripts/_create-eagleview-hubspot-props.ts`
Expected: lists WOULD CREATE for group + 5 props on each of deals/tickets (or "exists" if already there). No errors.

- [ ] **Step 3: Typecheck the script**

Run: `npx tsc --noEmit 2>&1 | grep -E "_create-eagleview"`
Expected: no output. (If the SDK's `create` typing is strict, the `as Parameters<...>` cast handles it; adjust the cast if tsc complains.)

- [ ] **Step 4: Commit**

```bash
git add scripts/_create-eagleview-hubspot-props.ts
git commit -m "chore(eagleview): script to create HubSpot properties"
```

> **Operator note (not a code step):** actually creating the properties (`--apply`) happens during rollout, after merge — see Rollout. Do not `--apply` during implementation.

---

### Task 9: Backfill script for existing orders

**Files:**
- Create: `scripts/_backfill-eagleview-hubspot-stamps.ts`

- [ ] **Step 1: Write the script**

```ts
/**
 * One-time backfill: stamp EagleView properties on the originating deal/ticket
 * for existing order rows, from DB state. Bypasses the feature flag (explicit
 * operator action). Idempotent. Safe to delete after use.
 *
 * Dry-run:  tsx scripts/_backfill-eagleview-hubspot-stamps.ts
 * Apply:    tsx scripts/_backfill-eagleview-hubspot-stamps.ts --apply
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { updateDealProperty } from "../src/lib/hubspot";
import { updateTicketProperties } from "../src/lib/hubspot-tickets";
import { buildEagleViewProps, type EagleViewStampFields } from "../src/lib/eagleview-pipeline";

const STATUS_MAP: Record<string, EagleViewStampFields["status"]> = {
  ORDERED: "Ordered",
  DELIVERED: "Delivered",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(apply ? "APPLY mode\n" : "DRY-RUN (pass --apply)\n");

  const rows = await prisma.eagleViewOrder.findMany({ orderBy: { orderedAt: "asc" } });
  let stamped = 0, skipped = 0, failed = 0;

  for (const o of rows) {
    if (o.reportId.startsWith("pending:")) { skipped++; continue; }
    const status = STATUS_MAP[o.status];
    if (!status) { skipped++; continue; }

    const fields: EagleViewStampFields = {
      status,
      reportId: o.reportId,
      orderedDate: o.orderedAt,
      deliveredDate: o.deliveredAt ?? null,
      driveFolderUrl: o.driveFolderId
        ? `https://drive.google.com/drive/folders/${o.driveFolderId}`
        : null,
    };
    const props = buildEagleViewProps(fields);
    const targetLabel = o.ticketId ? `ticket ${o.ticketId}` : `deal ${o.dealId}`;
    console.log(`  ${apply ? "STAMP" : "WOULD STAMP"} ${o.reportId} → ${targetLabel} (${status})`);

    if (apply) {
      try {
        const ok = o.ticketId
          ? await updateTicketProperties(o.ticketId, props)
          : await updateDealProperty(o.dealId, props);
        ok ? stamped++ : failed++;
        if (!ok) console.warn(`    write returned false for ${targetLabel}`);
      } catch (e) {
        failed++;
        console.warn(`    error stamping ${targetLabel}:`, e instanceof Error ? e.message : e);
      }
    }
  }

  console.log(`\nDone. stamped=${stamped} skipped=${skipped} failed=${failed} total=${rows.length}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Dry-run to verify it lists existing rows (no writes)**

Run: `npx tsx scripts/_backfill-eagleview-hubspot-stamps.ts`
Expected: lists WOULD STAMP for each non-pending order (the 104 delivered + failed/cancelled rows), with the correct deal/ticket target. No errors. (Synthetic `ticket:<id>` deals only appear under the ticket branch since those rows have `ticketId` set.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "_backfill-eagleview"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add scripts/_backfill-eagleview-hubspot-stamps.ts
git commit -m "chore(eagleview): backfill script for HubSpot stamps"
```

> **Operator note:** running `--apply` happens during rollout, after the properties exist.

---

### Task 10: Document the feature flag

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add the flag**

Add near other EagleView env vars in `.env.example`:

```
# When "true", EagleView order lifecycle stamps status onto the originating
# HubSpot deal/ticket (eagleview_status, etc.). Requires the properties to exist
# first (scripts/_create-eagleview-hubspot-props.ts). Default off.
EAGLEVIEW_HUBSPOT_STAMP_ENABLED=false
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs(eagleview): document EAGLEVIEW_HUBSPOT_STAMP_ENABLED"
```

---

## Final verification

- [ ] Run the full EagleView suites: `npx jest src/__tests__/eagleview-pipeline.test.ts src/__tests__/eagleview-client.test.ts` → all pass.
- [ ] `npx tsc --noEmit 2>&1 | grep -E "eagleview|_create-eagleview|_backfill-eagleview"` → no output.
- [ ] `npx eslint` on every touched file → 0 errors.
- [ ] Open a PR from `feat/eagleview-hubspot-stamp` → `main`.

## Rollout (operator, after merge — in order)

1. Merge the PR (stamping is flag-off; no behavior change live).
2. `npx tsx scripts/_create-eagleview-hubspot-props.ts --apply` (creates props on deals + tickets).
3. Add `EAGLEVIEW_HUBSPOT_STAMP_ENABLED=true` to Vercel production env (and local `.env`); verify with `vercel env ls production`.
4. `npx tsx scripts/_backfill-eagleview-hubspot-stamps.ts` (dry-run), then `--apply`.
5. Spot-check a delivered deal + a ticket-origin order in HubSpot; confirm new orders stamp going forward.

## Out of scope (deferred follow-ups)

- Typed Drive column reconcile for the 34 delivered orders with a folder.
- Investigate the 70 delivered orders with null `driveFolderId`.
