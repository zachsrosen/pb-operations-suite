# EagleView → HubSpot status stamping

**Date:** 2026-06-18
**Status:** Design approved, pending spec review
**Related:** `docs/superpowers/specs/2026-04-24-eagleview-truedesign-auto-pull-design.md` (the original auto-pull pipeline), PR #1066 (folder URL-vs-ID fix), branch `fix/bot-stuck-deals-active-stages` (reliability fixes: failure persistence, 204 handling, terminal-status detection, filetype mapping)

## Motivation

The EagleView TrueDesign auto-pull pipeline orders aerial designs, stores deliverables in Google Drive, and tracks lifecycle in the `EagleViewOrder` DB row. Today it writes **nothing structured to HubSpot** — the only HubSpot writes are free-text timeline notes on the deal ("ordered" / "delivered"). Consequences:

- PMs/designers viewing a deal cannot see EagleView status or reach the files without hunting through Drive.
- No HubSpot workflow can react to "EagleView delivered" (e.g. advance a stage, notify, kick off design).
- No HubSpot list/report can show EagleView state, counts, or aging.

This was a contributing factor to 38 orders stranding silently: there was no HubSpot-side signal that anything was wrong.

## Goals

1. Stamp a small set of structured HubSpot properties at each EagleView order lifecycle transition (Ordered, Delivered, Failed, Cancelled), enabling PM/ops visibility, workflow triggers, and reporting.
2. Stamp the object the order originated from: the **ticket** when the order row has a `ticketId`, otherwise the **deal**.
3. Backfill the existing order backlog (104 delivered + failed/cancelled rows) so current state is visible in HubSpot.
4. Make stamping best-effort and flag-gated so it can never block or break order placement / file delivery.

## Non-goals (explicitly deferred)

- Reconciling the typed Drive file-id columns (`imageDriveFileId`, `shadeJsonDriveFileId`, etc.) for the 34 already-delivered orders that have a `driveFolderId`. (The filetype-mapping fix on the reliability branch already corrects this for *new* deliveries.)
- Investigating/remediating the 70 delivered orders that have a null `driveFolderId` (a second/older delivery path). Scoped separately once understood.
- Any change to how files are downloaded or stored in Drive.

## HubSpot properties

Created on **both** the `deals` and `tickets` object types with identical internal names, grouped under a new property group `eagleview` (label "EagleView").

| Internal name | Type | Field type | Notes |
|---|---|---|---|
| `eagleview_status` | enumeration | select (dropdown) | Options: `Ordered`, `Delivered`, `Failed`, `Cancelled`. Internal values equal labels. |
| `eagleview_report_id` | string | text | EagleView ReportId (stored as text; it is a numeric string but never used arithmetically). |
| `eagleview_drive_folder_url` | string | text | `https://drive.google.com/drive/folders/<driveFolderId>`. Empty when no folder recorded. |
| `eagleview_ordered_date` | date | date | Date the order was placed (from `EagleViewOrder.orderedAt`). |
| `eagleview_delivered_date` | date | date | Date deliverables were stored (from `EagleViewOrder.deliveredAt`). |

**Date formatting.** `updateDealProperty` / `updateTicketProperties` both accept `Record<string, string | null>` — every value must be a **string**, so `Date` fields are formatted before the call, not passed raw. There is no existing write-side date helper (the only date helper, `parseDate` in `hubspot.ts`, is read-side). The stamping layer formats a `Date` to `YYYY-MM-DD` in UTC, mirroring the existing UTC pattern at `hubspot.ts:901`:

```ts
function toHubSpotDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
```

HubSpot accepts `YYYY-MM-DD` strings on `date` properties. This formatter lives in the `buildEagleViewProps` pure helper (below) so forward-stamp and backfill share it.

### Property creation

A one-time idempotent setup script `scripts/_create-eagleview-hubspot-props.ts`:
- Ensures the `eagleview` property group exists on `deals` and on `tickets` (create if missing).
- Creates each property on each object type if it does not already exist (look up by internal name first; skip on conflict).
- Uses `HUBSPOT_ACCESS_TOKEN`. Dry-run by default; `--apply` to write.
- Re-runnable safely.

The exact enum option config and group config are defined by the table above; the script is the source of truth for the wire format.

## Stamping architecture

### Order origin: thread `ticketId` into the order at creation

**Problem (found in spec review):** today `ticketId` is NOT known inside `orderTrueDesign`. The order route resolves a ticket→deal association, calls `orderTrueDesign({ dealId })`, and only *afterward* writes `ticketId` onto the row in a separate `update`. For a ticket with no associated deal, the route passes a **synthetic `dealId = "ticket:<id>"`**. So an inline `Ordered`/`Failed` stamp inside `orderTrueDesign` would always see `ticketId === null` and, for synthetic deals, call `updateDealProperty("ticket:123", …)` against a non-existent deal.

**Fix:** make `ticketId` a first-class part of order creation so the correct CRM target is resolvable at every transition:
- Add `ticketId?: string | null` to `OrderTrueDesignInput` and to `ClaimOrderInput`; `claimOrder` writes it into the `create` data (the row now carries `ticketId` from birth).
- The order route passes `ticketId` into `orderTrueDesign` and **drops its now-redundant post-hoc `update({ data: { ticketId } })`**.
- The tdp-order webhook (deal-origin, HubSpot workflow) passes no `ticketId` — unchanged.

With this, target resolution is uniform everywhere (orchestrator, poll cron, backfill): **ticket if `order.ticketId` is set, else `order.dealId`**. When `ticketId` is set we stamp the ticket and never touch the (possibly synthetic) deal id.

### New dependency: `stampStatus`

Add one function to `PipelineDeps` (dependency injection, so it is mockable in tests and has no direct HubSpot import in the orchestrator):

```ts
/** Best-effort stamp of EagleView lifecycle state onto the originating CRM object. */
stampStatus: (
  target: { dealId: string; ticketId: string | null },
  fields: EagleViewStampFields,
) => Promise<void>;

interface EagleViewStampFields {
  status: "Ordered" | "Delivered" | "Failed" | "Cancelled";
  reportId?: string;
  driveFolderUrl?: string | null;
  orderedDate?: Date | null;
  deliveredDate?: Date | null;
}
```

**Pure helper `buildEagleViewProps(fields)`** maps `EagleViewStampFields` → `Record<string, string>` (the HubSpot property map): `status`→`eagleview_status`, `reportId`→`eagleview_report_id`, `driveFolderUrl`→`eagleview_drive_folder_url`, `orderedDate`/`deliveredDate`→`toHubSpotDate(...)` on `eagleview_ordered_date`/`eagleview_delivered_date`. Only present/non-null keys are included. This helper holds the date formatting and is unit-tested directly and reused by the backfill.

The **real implementation** of `stampStatus` (in `eagleview-pipeline-deps.ts`):
1. If `EAGLEVIEW_HUBSPOT_STAMP_ENABLED` is not `"true"`, return immediately (no-op).
2. `const props = buildEagleViewProps(fields)`.
3. If `target.ticketId` is set, call `updateTicketProperties(target.ticketId, props)`; otherwise call `updateDealProperty(target.dealId, props)`.
4. Wrap in try/catch: on failure, `Sentry.captureException` + `console.warn`, then return normally. **Stamping never throws to the caller.**

Because `updateDealProperty` / `updateTicketProperties` already return booleans and swallow most errors, the wrapper is a thin safety net plus the flag check and object-resolution logic.

`stampStatus` is a **required** member of `PipelineDeps` (not optional), so every constructor of that interface must supply it: the real `defaultPipelineDeps()` and the test `mkDeps()`. The ticket-vs-deal branch checks `target.ticketId` **first**, so a ticket-origin order's synthetic `dealId = "ticket:<id>"` is never passed to `updateDealProperty`.

### Integration points

All transitions already exist in code; each gains one `await deps.stampStatus(...)` call (best-effort, so a failure is logged but does not change control flow):

| Location | Transition | Fields |
|---|---|---|
| `orderTrueDesign` step 6 (after DB row set to ORDERED with real reportId) | → `Ordered` | status, reportId, orderedDate |
| `orderTrueDesign` `markFailed` paths (geocode/availability/place_order/tdp_unavailable) | → `Failed` | status |
| `fetchAndStoreDeliverables` success (DB row set to DELIVERED) | → `Delivered` | status, reportId, driveFolderUrl, deliveredDate |
| poll cron terminal branch (`classifyTerminalStatus` → FAILED/CANCELLED) | → `Failed` / `Cancelled` | status |

With `ticketId` threaded into order creation (above), `claim.order` carries both `dealId` and `ticketId` for every transition inside `orderTrueDesign`, so the stamp target is `{ dealId: claim.order.dealId, ticketId: claim.order.ticketId }` at all of those call sites.

Notes:
- `recordDeliveryFailure` does **not** change status (stays ORDERED, retryable) — so it does **not** stamp. The order remains `Ordered` in HubSpot until it delivers or hits a terminal status. This is intentional: a transient file-pull failure is not a HubSpot-visible state change.
- The `markFailed` helper currently takes `(prisma, orderId, reason)`. All four `markFailed` calls are inside `orderTrueDesign` with `claim.order` in scope, so the stamp is emitted at those call sites using `claim.order`'s `{ dealId, ticketId }` — no signature change to `markFailed` required.
- `failWithoutClaim` (deal_not_found, address_incomplete) never created a DB row. Default: **do not** stamp these (no order exists, nothing to report on). Recorded to avoid ambiguity.
- The poll cron and the file-delivery webhook stamp via the same `defaultPipelineDeps().stampStatus`, resolving deal-vs-ticket from the `EagleViewOrder` row they already loaded (which carries `ticketId`).

### Feature flag

`EAGLEVIEW_HUBSPOT_STAMP_ENABLED` (string `"true"` to enable). Default disabled. Added to `.env.example`. Synced to Vercel production before flip. Stays off until the properties exist in HubSpot (run the creation script first), then flipped on. The flag is checked inside the real `stampStatus` implementation so all call sites are uniformly gated.

## Backfill

`scripts/_backfill-eagleview-hubspot-stamps.ts` (dry-run by default; `--apply`):
- Iterate every `EagleViewOrder` row (or filter to non-`ORDERED` for terminal states plus current ORDERED for completeness).
- Map DB `status` → property value: `DELIVERED`→`Delivered`, `FAILED`→`Failed`, `CANCELLED`→`Cancelled`, `ORDERED`→`Ordered`.
- Resolve target: ticket if `ticketId`, else deal.
- Build fields from the row: `reportId`, `orderedDate` from `orderedAt`, `deliveredDate` from `deliveredAt` (when present), `driveFolderUrl` from `driveFolderId` (when present; omit otherwise — covers the 70 no-folder rows).
- Write via the same `stampStatus` logic (reuse the real dep so behavior matches forward stamping, but the backfill bypasses the feature flag — backfill is an explicit operator action).
- Log per-row outcome; summarize counts at the end.
- Skip `pending:` reportId rows (never placed).

## Error handling

- Stamping is best-effort everywhere: a HubSpot failure is captured to Sentry + logged, never propagated. Order placement and file delivery succeed regardless.
- The feature flag short-circuits forward stamping entirely when off.
- The backfill is idempotent: re-running overwrites the same properties with the same values; safe to re-run after partial failure.

## Testing (TDD)

Extend `src/__tests__/eagleview-pipeline.test.ts`:
- Add a `stampStatus` jest mock to the fake `PipelineDeps` (`mkDeps`).
- `orderTrueDesign` happy path stamps `{status:"Ordered", reportId, orderedDate}` with target `{ dealId, ticketId: null }` (deal-origin input).
- `orderTrueDesign` failure (e.g. placeOrder throws) stamps `{status:"Failed"}`.
- `fetchAndStoreDeliverables` success stamps `{status:"Delivered", reportId, driveFolderUrl, deliveredDate}`; assert `driveFolderUrl` contains the folder id.
- Ticket resolution: `orderTrueDesign({ dealId, ticketId })` persists `ticketId` on the row (via `claimOrder`) and the stamp target carries that `ticketId`. Add a ticket-origin test.
- Best-effort: a `stampStatus` that rejects does **not** fail `orderTrueDesign` / `fetchAndStoreDeliverables` (result still ORDERED/DELIVERED).
- `recordDeliveryFailure` paths do **not** call `stampStatus` (status unchanged).

Unit-test the pure `buildEagleViewProps(fields)` directly (in `eagleview-client.test.ts` or a small new file): correct internal-name mapping, omission of absent keys, and `Date` → `YYYY-MM-DD` UTC formatting (including a date near a timezone boundary to lock in UTC).

No new tests are needed for `updateDealProperty` / `updateTicketProperties` (existing, unchanged primitives).

## Rollout / operator steps (in order)

1. Merge code (stamping behind `EAGLEVIEW_HUBSPOT_STAMP_ENABLED`, default off) — no behavior change while off.
2. Run `scripts/_create-eagleview-hubspot-props.ts --apply` to create properties on deals + tickets.
3. Add `EAGLEVIEW_HUBSPOT_STAMP_ENABLED=true` to Vercel production env (and `.env`).
4. Run `scripts/_backfill-eagleview-hubspot-stamps.ts` (dry-run, then `--apply`).
5. Verify a sample deal/ticket in HubSpot shows the properties; confirm new orders stamp going forward.

## Follow-ups (tracked, out of scope here)

- Typed Drive column reconcile for the 34 delivered orders with a folder.
- Investigate the 70 delivered orders with null `driveFolderId` (second delivery path) and remediate.
- Optional: a HubSpot workflow that fires on `eagleview_status = Delivered` (Zach owns workflow config).
