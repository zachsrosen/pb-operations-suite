# End-of-Day Summary Email — Design Spec

**Date:** 2026-03-27
**Author:** Zach + Claude
**Status:** Draft

---

## Goal

A daily end-of-day email sent to Zach at ~5 PM Denver summarizing what the Design and P&I teams accomplished that day. Covers status changes (before → after), milestone completions with attribution (who/when), and HubSpot task completions. Delivered via a Vercel cron route using the same infrastructure as the existing daily focus emails.

## Audience

Single recipient: `zach@photonbrothers.com`. No individual lead emails — just one rollup.

## Departments Covered

- **Design** — `design_status`, `layout_status`
- **Permitting** — `permitting_status`
- **Interconnection** — `interconnection_status`
- **PTO** — `pto_status`

Same leads, pipelines, excluded stages, and display name mappings as the existing daily focus system (`src/lib/daily-focus/config.ts`).

**Note on query structure:** The PI query defs use real HubSpot property names as `roleProperty` (e.g., `permit_tech`, `interconnections_tech`) while design query defs use the internal key `"design"`. The EOD system re-runs these queries using the same per-lead, per-def structure — not a single combined pass. For task queries (Step 5), all lead owner IDs are combined into a single HubSpot search.

---

## Architecture: Hybrid Snapshot + Property History

### Phase 1: Morning Snapshot (runs after daily focus cron, separate queries)

After the morning daily focus emails send (~7:05 AM Denver), the cron run executes a **separate, broader query** for each lead to snapshot ALL their active deals — not just deals in actionable statuses. This is critical because the daily-focus queries filter by specific status buckets (e.g., `permitting_status IN ["Ready For Permitting", ...]`). If a deal moves from "Ready For Permitting" to "Submitted to AHJ" during the day, it leaves the actionable bucket. If the evening re-ran the same narrow queries, that deal would vanish from the results and be misclassified as "resolved" instead of recognized as accomplished work.

**Broad snapshot query per lead (new, defined in `eod-summary/snapshot.ts`):**

For each PI lead, one query per `roleProperty` they're assigned to:
```
filters:
  - {roleProperty} = {ownerId}          // e.g., permit_tech = 78035785
  - dealstage NOT_IN EXCLUDED_STAGES    // same terminal-stage exclusion
  - pipeline IN INCLUDED_PIPELINES      // same pipeline filter
properties: hs_object_id, dealname, dealstage, pipeline, pb_location,
            design_status, layout_status, permitting_status,
            interconnection_status, pto_status
```

For each Design lead, one query:
```
filters:
  - design = {ownerId}
  - dealstage NOT_IN EXCLUDED_STAGES
  - pipeline IN INCLUDED_PIPELINES
properties: (same as above)
```

**Key difference from daily-focus queries:** No `statusProperty IN [...]` filter. This returns ALL active deals for a lead regardless of their current status, capturing the full state needed for accurate diffing.

**Snapshot fields per row:**
- `dealId`, `dealName`, `pipeline`, `dealStage`, `pbLocation`
- `designStatus`, `layoutStatus`, `permittingStatus`, `interconnectionStatus`, `ptoStatus`
- `ownerId` (HubSpot owner ID of the lead whose query produced this row)
- `snapshotDate` (date only, computed in Denver timezone via `toLocaleDateString("en-CA", { timeZone: "America/Denver" })`)

**Lead association:** A deal may be owned by multiple leads (e.g., Peter Zaun as `permit_tech` and Layla Counts as `interconnections_tech`). The snapshot stores one row per `(date, dealId, ownerId)` triple. Status fields are identical across rows for the same deal — the duplication is intentional to preserve the lead→deal relationship for later grouping and false-positive guards.

**API cost:** ~9 additional HubSpot search calls per morning run (6 PI leads × ~1.5 queries avg + 3 Design leads × 1 query). Sequential to respect rate limits. Results are paginated (limit 200, page if needed).

### Phase 2: Evening Query + Diff (new cron route, ~5 PM Denver)

**Step 1: Load morning snapshot**
```sql
SELECT * FROM DealStatusSnapshot WHERE snapshotDate = today
```

**Step 2: Re-query HubSpot (broad queries, same as morning snapshot)**
Run the same broad queries used for the morning snapshot — one per lead per `roleProperty`, filtered only by owner + excluded stages + included pipelines (NO status-value filter). Collect all results into a map keyed by `(dealId, ownerId)` to preserve lead association.

**Step 3: Diff**
For each deal in the evening results that also exists in the morning snapshot, compare the 5 monitored status fields + `dealStage`. Any field where `morning !== evening` is a "status change."

Deals in the evening results but NOT in the morning snapshot are "new" (appeared during the day — e.g., a deal entered Design & Engineering stage).

Deals in the morning snapshot but NOT in evening results are "resolved" (moved to an excluded stage like Complete or Cancelled, or reassigned to a non-tracked owner, or pipeline changed out of scope).

**False positive guard:** If any lead's evening HubSpot query failed (error path), exclude all snapshot rows with that lead's `ownerId` from the "resolved" list. A deal that has snapshot rows for multiple leads is only excluded if ALL of those leads' queries failed. The email notes which leads had query failures so the absence isn't misleading.

**Step 4: Milestone enrichment (targeted property history)**
For deals where a status change matches a defined milestone, call HubSpot's `basicApi.getById` with `propertiesWithHistory` populated:

```typescript
const deal = await hubspotClient.crm.deals.basicApi.getById(
  dealId,
  [statusProperty],           // properties
  [statusProperty],           // propertiesWithHistory
  undefined,                  // associations
  false                       // archived
);
```

The response includes `deal.propertiesWithHistory[statusProperty]` — an array of `{ value, timestamp, sourceType, sourceId }` entries. To extract attribution:

1. Find the history entry whose `value` matches the milestone status and `timestamp` falls within today (Denver timezone).
2. Filter to `sourceType === "CRM_UI"` or `sourceType === "INTEGRATION"` — skip `sourceType === "CALCULATED"` (formula fields) and `sourceType === "AUTOMATION"` (workflows) since those don't represent human action.
3. **Map `sourceId` to a person name.** The `sourceId` for `CRM_UI` entries is a HubSpot **user ID**, which is NOT necessarily the same as the `hubspotOwnerId` stored in `PI_LEADS`/`DESIGN_LEADS`. To resolve this:
   - At the start of each EOD run, call `GET /crm/v3/owners?limit=500` (via `hubspotClient.crm.owners.ownersApi.getPage()`). This returns owner objects, each with `id` (owner ID, matches roster) and `userId` (user ID, matches property history `sourceId`), plus `firstName`/`lastName`.
   - Build a `Map<string, string>` from `userId → "firstName lastName"`. Cache for the duration of the run.
   - When a milestone's `sourceId` matches an entry, display that name. If no match, display "Team member" as fallback.
4. Convert `timestamp` (ISO 8601 UTC) to Denver timezone for display.

**New code required:**
- A `getPropertyHistory(dealId, properties)` helper in `milestones.ts` that wraps `basicApi.getById` with retry logic (reuse `searchWithRetry` backoff pattern for 429s). This is new — no existing wrapper does this in the codebase.
- A `buildUserIdMap()` helper in `milestones.ts` that calls the owners API once per run and caches the `userId → name` mapping.

**Rate limit safety:** Cap at 20 property history calls per run. Excess milestones report without who/when detail. Each call fetches history for all 5 status properties at once to minimize requests.

**Step 5: Query completed tasks**
Search HubSpot tasks via `hubspotClient.crm.objects.tasks.searchApi.doSearch` (note: this uses the tasks object API, not the deals search — a new search wrapper is needed in `tasks.ts`):

```typescript
// Use hs_task_completion_date (preferred over hs_lastmodifieddate, which
// would also catch tasks edited-but-not-completed today)
filters:
  - hs_task_status = COMPLETED
  - hs_task_completion_date >= today 6:00 AM Denver (UTC offset)
  - hubspot_owner_id IN [all tracked lead owner IDs from PI_LEADS + DESIGN_LEADS]
properties: hs_task_subject, hubspot_owner_id, hs_task_completion_date
```

**Fallback:** If `hs_task_completion_date` is not available or always null, fall back to `hs_lastmodifieddate >= today`. Accept the imprecision (tasks modified-but-not-completed may appear).

**Associated deals:** After fetching tasks, resolve deal associations via `hubspotClient.crm.objects.tasks.associationsApi.getAll(taskId, "deals")` for each task. Cap at 50 association lookups per run. Tasks without deal associations show subject only.

Group by owner, resolve associated deal name if available.

**Step 6: Build and send email**
Build HTML email, send to `zach@photonbrothers.com` via `sendEmailMessage()` (Google Workspace → Resend fallback).

---

## Milestone Definitions

A "milestone" is a status change where the new value represents a significant completion point. These get property history enrichment for who/when attribution.

| Department | Status Property | Milestone Values |
|---|---|---|
| Design | `design_status` | "Stamped", "Design Complete" |
| Design | `layout_status` | "Sent" (DA sent to customer) |
| Permitting | `permitting_status` | "Approved By AHJ", "Permit Issued", "Submitted to AHJ" |
| Interconnection | `interconnection_status` | "IC Approved", "Submitted to Utility" |
| PTO | `pto_status` | "PTO Granted", "Submitted to Utility" |

---

## Email Format

### Subject Line

```
EOD Summary — Design / P&I — Fri Mar 27
```

Dry-run mode: `[DRY RUN] EOD Summary — Design / P&I — Fri Mar 27`

### Email Structure

**1. Headline Stats**
One-line summary at top of email:

```
3 status changes · 2 milestones · 5 tasks completed
```

If nothing happened: "All quiet — no status changes, milestones, or task completions today."

**2. Milestones Section**
Highlighted with a colored left border (green). Only shown if milestones exist.

```
─── MILESTONES ────────────────────────────────
  ★ Turner Residence | Westminster
    Permit Issued (was: Submitted to AHJ)
    Peter Zaun · 2:15 PM

  ★ Martinez Solar | Centennial
    Design Stamped (was: Ready for Review)
    Jacob Campbell · 11:30 AM
```

Each milestone: deal name (hyperlinked to HubSpot), location, what changed, who/when. Sorted by timestamp descending (most recent first).

**3. Status Changes by Department**
One subsection per department. Only shown if changes exist for that department. Grouped by lead within each department.

```
─── DESIGN ────────────────────────────────────
Jacob Campbell
  • Kim Battery | CA
    design_status: Initial Review → Ready for Review
  • Park Residence | DTC
    layout_status: Draft Created → Ready

Daniel Kelly
  • Nguyen Solar | COSP
    design_status: In Revision → Revision Final Review

─── PERMITTING ────────────────────────────────
Peter Zaun
  • Lee Residence | Westminster
    permitting_status: Ready For Permitting → Submitted to AHJ

─── INTERCONNECTION ───────────────────────────
(no changes today)

─── PTO ───────────────────────────────────────
Layla Counts
  • Garcia Battery | CA
    pto_status: Inspection Passed - Ready for Utility → Submitted to Utility
```

Deal names hyperlinked to `https://app.hubspot.com/contacts/21710069/record/0-3/{dealId}`. Pipeline suffix shown for non-Project pipeline deals (D&R, Service, Roofing).

Status display names use the same mappings from `daily-focus/config.ts` where applicable.

**4. New Deals Entering Scope**
Deals that appeared in the evening query but weren't in the morning snapshot. Brief list:

```
─── NEW DEALS IN SCOPE ────────────────────────
  + Wilson Solar | Westminster — entered Design & Engineering
  + Brown Residence | DTC — entered Permitting & IC
```

**5. Deals Resolved / Completed**
Deals that were in the morning snapshot but aren't in the evening results (moved to Complete, Cancelled, etc.):

```
─── DEALS RESOLVED ────────────────────────────
  ✓ Adams Solar | COSP — moved to Close Out
  ✓ Chen Battery | CA — moved to Project Complete
```

**6. Tasks Completed**
Grouped by lead. Only shown if tasks exist.

```
─── TASKS COMPLETED ───────────────────────────
Peter Zaun — 3 tasks
  ✓ Submit permit for Turner Residence
  ✓ Follow up on Martinez IC application
  ✓ Close out Kim project design

Jacob Campbell — 1 task
  ✓ Review stamped plans for Lee Residence
```

Task subject shown. If the task is associated with a deal, the deal name is shown (hyperlinked).

**7. Still Pending (summary line)**
Not a full list — just a count reference. "Morning items" = unique deal IDs in the morning snapshot. "Still pending" = deals from the snapshot that still appear in the evening query results (regardless of whether their status changed).

```
Morning focus had 23 deals across the team · 18 still in scope
```

**8. Footer**
```
Generated at 5:02 PM MDT · Powered by PB Operations Suite
```

---

## Data Model

### New Prisma Model: `DealStatusSnapshot`

```prisma
model DealStatusSnapshot {
  id                      Int      @id @default(autoincrement())
  snapshotDate            DateTime @db.Date
  dealId                  String
  dealName                String
  pipeline                String
  dealStage               String
  pbLocation              String?
  ownerId                 String   // HubSpot owner ID of the lead whose query produced this row
  designStatus            String?
  layoutStatus            String?
  permittingStatus        String?
  interconnectionStatus   String?
  ptoStatus               String?
  createdAt               DateTime @default(now())

  @@unique([snapshotDate, dealId, ownerId])
  @@index([snapshotDate])
}
```

**`ownerId` preserved, `ownerType` removed.** The snapshot stores one row per `(date, deal, lead)` triple. This enables:
- **Lead-scoped false-positive guard:** When a lead's evening query fails, exclude their snapshot rows from the "resolved" list.
- **Grouping changes by lead:** The email's "Status Changes by Department" section groups deals under the lead who owns them. Lead association comes from the snapshot; department is derived from *which status property changed* (not from a stored type string). A deal with both `design_status` and `permitting_status` changes appears in both department sections.
- **Cross-lead dedup for diff:** When computing status changes, deduplicate by `dealId` so a deal owned by two leads produces one status-change entry (not two). Lead grouping uses the evening query's `ownerId` to decide which lead's section a change appears under.

### Retention

Snapshots older than 30 days are cleaned up by the existing `audit-retention` cron or a new cleanup step in the EOD cron itself.

---

## File Structure

```
src/
├── lib/eod-summary/
│   ├── config.ts         # Milestone definitions, reexports from daily-focus/config
│   ├── snapshot.ts       # Save/load snapshot, diff logic
│   ├── milestones.ts     # Property history calls, milestone detection
│   ├── tasks.ts          # HubSpot task query
│   ├── html.ts           # Email HTML builder
│   └── send.ts           # Orchestration, idempotency, email dispatch
├── app/api/cron/eod-summary/
│   └── route.ts          # GET handler, CRON_SECRET auth, calls send.ts
```

### Changes to Existing Files

- **`src/app/api/cron/daily-focus/route.ts`**: After sending emails, call `saveEodSnapshot()` from `eod-summary/snapshot.ts`. This runs the broad snapshot queries (separate from the narrow daily-focus queries) and writes to `DealStatusSnapshot`. The snapshot step is wrapped in try/catch — failure does not block the daily focus emails from completing.
- **`prisma/schema.prisma`**: Add `DealStatusSnapshot` model.
- **`vercel.json`** (or Vercel dashboard): Add cron schedule for `/api/cron/eod-summary` at `0 23 * * 1-5` (23:00 UTC = 5 PM MDT / 4 PM MST, weekdays).
- **`vercel.json`**: Bump `maxDuration` for the daily-focus cron from 180s to 300s to accommodate the additional ~9 HubSpot searches + DB writes for the snapshot step.

**No changes to `daily-focus/queries.ts` or `daily-focus/send.ts`** — the snapshot uses its own broader query logic in `eod-summary/snapshot.ts`, independent of the daily-focus actionable-status queries.

---

## Cron Schedule

| Cron | UTC | Denver | Description |
|---|---|---|---|
| `0 13 * * 1-5` | 1:00 PM | 7:00 AM MDT | Morning focus (existing) + snapshot save |
| `0 23 * * 1-5` | 11:00 PM | 5:00 PM MDT | EOD summary |

**DST note:** During MST (Nov–Mar), 5 PM Denver = midnight UTC. The cron expression should be set to `0 0 * * 2-6` during MST or use a timezone-aware scheduler. Vercel cron uses UTC, so this will need seasonal adjustment or a fixed UTC time that's "close enough."

Recommended: Use `0 23 * * 1-5` (23:00 UTC). During MDT (Mar–Nov) this fires at 5 PM Denver. During MST (Nov–Mar) this fires at 4 PM Denver. Both are acceptable — the bulk of the workday is captured either way. Document the DST offset in a comment in the route file, same pattern as daily-focus.

---

## Idempotency

Key pattern: `eod-summary:YYYY-MM-DD` with scope `eod-summary`. Uses the same create-first + reclaim-on-failed pattern from `daily-focus/send.ts`:

1. Attempt `IdempotencyKey.create({ key, scope, status: "processing", expiresAt: +24h })`.
2. If key exists: attempt `updateMany({ where: { key, scope, status: "failed" }, data: { status: "processing" } })` to reclaim.
3. If reclaim succeeds: proceed (this is a retry of a previously failed run).
4. If reclaim fails (key is "processing" or "completed"): skip — already sent/in-progress.
5. On completion: mark `"completed"`. On any error that prevents email send: mark `"failed"` so the next cron invocation can retry.

**Partial failure:** If the snapshot loaded and diff ran but the email send failed, the key is marked `"failed"` so the next invocation retries. If the email sent but the key status update fails, that's best-effort (duplicate sends are acceptable since there's only one recipient).

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Morning snapshot missing | Skip diff sections, send only task completions with note: "No morning baseline — diff unavailable" |
| HubSpot query fails for a lead | Note in email, skip that lead's changes |
| Property history call fails | Show milestone without who/when detail |
| Task query fails | Note in email, skip tasks section |
| All queries fail | Send error-only email: "EOD summary failed — [errors]" |
| Email send fails (primary) | Resend fallback per `sendEmailMessage()` |

---

## Dry-Run Mode

Triggered via `?dryRun=true` query parameter on the cron route. Behavior:
- All emails sent to `zach@photonbrothers.com` (already the only recipient)
- Subject prefixed with `[DRY RUN]`
- Amber banner at top of email: "DRY RUN — This is a preview"
- Idempotency check skipped

---

## Out of Scope

- Individual lead emails (only manager rollup)
- Real-time notifications (this is a daily batch)
- Historical trending ("this week you completed X permits") — future enhancement
- Non-Design/P&I departments (ops, service, construction) — future enhancement
- Weekend emails
