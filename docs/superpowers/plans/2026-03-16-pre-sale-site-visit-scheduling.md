# Pre-Sale Site Visit Scheduling Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make pre-sale site survey scheduling create Zuper jobs under the new "Pre-Sale Site Visit" category, with full parity to ops site surveys (calendar sync, email, HubSpot, tentative/confirm/cancel flows).

**Architecture:** Introduce `"pre-sale-survey"` as a survey-like schedule subtype that reuses all survey timing logic (slot-based windows, lead-time enforcement) but maps to its own Zuper job category (`Pre-Sale Site Visit`, UID `c53070e5-63fd-41bc-8803-f66ad842dbb5`). Every gate that currently accepts `survey | installation | inspection` gets updated to also accept `pre-sale-survey`, and every branch that says `=== "survey"` for timing/calendar/permission behavior also matches `pre-sale-survey`.

**Tech Stack:** Next.js API routes, TypeScript, Zuper REST API, HubSpot API, Google Calendar API

---

## Strategy: Survey-Like Subtype

Rather than creating an entirely new fourth schedule type with its own behavioral branches, `pre-sale-survey` piggybacks on `survey` behavior everywhere except category mapping. This minimizes the blast radius — we're adding one string to allowlists and one `||` to survey-specific branches, not building a new code path.

**Key principle:** Anywhere the code checks `scheduleType === "survey"`, we need `isSurveyLike(scheduleType)` instead. We'll add a tiny helper and use it everywhere.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/zuper.ts` | Modify | Add `PRE_SALE_SITE_VISIT` to category constants; update `createJobFromProject` type union, category/timing maps |
| `src/lib/scheduling-policy.ts` | Modify | Widen `SalesSurveyLeadTimeInput.scheduleType`; update lead-time check |
| `src/lib/role-permissions.ts` | Modify | Widen `canScheduleType` to accept `pre-sale-survey` (maps to `canScheduleSurveys`) |
| `src/lib/email.ts` | Modify | Widen `appointmentType` unions (L577, L873); add label to `APPOINTMENT_TYPE_LABELS` |
| `src/emails/SchedulingNotification.tsx` | Modify | Widen `appointmentType` prop union (L11) |
| `src/app/api/zuper/jobs/schedule/route.ts` | Modify | Widen `ScheduleType`; add `isSurveyLike()`; update all gates and `=== "survey"` checks in PUT/DELETE/helpers |
| `src/app/api/zuper/jobs/schedule/tentative/route.ts` | Modify | Add `pre-sale-survey` to type validation; update activity-type mapping |
| `src/app/api/zuper/jobs/schedule/confirm/route.ts` | Modify | Add `pre-sale-survey` to type validation, category config, normalize mapping; update all 12 `=== "survey"` checks |
| `src/app/api/zuper/jobs/route.ts` | Modify | Add `pre-sale-survey` to `VALID_SCHEDULE_TYPES` and type union |
| `src/app/api/deals/search/route.ts` | Modify | Add `system_size_kw`, `battery_count` to `SEARCH_PROPERTIES` and response |
| `src/app/dashboards/site-survey-scheduler/page.tsx` | Modify | Add `city`/`state` to `SurveyProject`; send `type: "pre-sale-survey"`; populate enriched data |

---

## Chunk 1: Backend Type System & Constants

### Task 1: Add Pre-Sale Site Visit category constants

**Files:**
- Modify: `src/lib/zuper.ts:197-226`

- [ ] **Step 1: Add category UID and name**

In `JOB_CATEGORY_UIDS` (line ~210), add:
```typescript
PRE_SALE_SITE_VISIT: "c53070e5-63fd-41bc-8803-f66ad842dbb5",
```

In `JOB_CATEGORIES` (line ~226), add:
```typescript
PRE_SALE_SITE_VISIT: "Pre-Sale Site Visit",
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/zuper.ts
git commit -m "feat(zuper): add Pre-Sale Site Visit category constants"
```

---

### Task 2: Update email type unions and labels

**Files:**
- Modify: `src/lib/email.ts:500-504,577,873`
- Modify: `src/emails/SchedulingNotification.tsx:11`

The email system has type unions that will reject `"pre-sale-survey"` at build time. Update all three.

- [ ] **Step 1: Add label to `APPOINTMENT_TYPE_LABELS`** (email.ts line ~500)

Change:
```typescript
const APPOINTMENT_TYPE_LABELS: Record<string, string> = {
  survey: "Site Survey",
  installation: "Installation",
  inspection: "Inspection",
};
```
To:
```typescript
const APPOINTMENT_TYPE_LABELS: Record<string, string> = {
  survey: "Site Survey",
  "pre-sale-survey": "Pre-Sale Site Visit",
  installation: "Installation",
  inspection: "Inspection",
};
```

- [ ] **Step 2: Widen `sendSchedulingNotification` appointmentType** (email.ts line ~577)

Change:
```typescript
appointmentType: "survey" | "installation" | "inspection";
```
To:
```typescript
appointmentType: "survey" | "pre-sale-survey" | "installation" | "inspection";
```

- [ ] **Step 3: Widen `sendCancellationNotification` appointmentType** (email.ts line ~873)

Change:
```typescript
appointmentType: "survey" | "installation" | "inspection";
```
To:
```typescript
appointmentType: "survey" | "pre-sale-survey" | "installation" | "inspection";
```

- [ ] **Step 4: Update `=== "survey"` check in email body** (email.ts line ~630)

Change:
```typescript
params.appointmentType === "survey" && params.dealOwnerName
```
To:
```typescript
(params.appointmentType === "survey" || params.appointmentType === "pre-sale-survey") && params.dealOwnerName
```

- [ ] **Step 5: Widen `SchedulingNotificationProps.appointmentType`** (SchedulingNotification.tsx line ~11)

Change:
```typescript
appointmentType: "survey" | "installation" | "inspection";
```
To:
```typescript
appointmentType: "survey" | "pre-sale-survey" | "installation" | "inspection";
```

- [ ] **Step 6: Update `=== "survey"` check in email component** (SchedulingNotification.tsx line ~49)

Change:
```typescript
appointmentType === "survey" && dealOwnerName
```
To:
```typescript
(appointmentType === "survey" || appointmentType === "pre-sale-survey") && dealOwnerName
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/email.ts src/emails/SchedulingNotification.tsx
git commit -m "feat(email): widen appointmentType for pre-sale-survey notifications"
```

---

### Task 3: Add `isSurveyLike` helper and update schedule route (PUT handler)

**Files:**
- Modify: `src/app/api/zuper/jobs/schedule/route.ts`

- [ ] **Step 1: Widen the ScheduleType union and add helper** (line ~33)

Change:
```typescript
type ScheduleType = "survey" | "installation" | "inspection";
```
To:
```typescript
type ScheduleType = "survey" | "pre-sale-survey" | "installation" | "inspection";

/** Returns true for schedule types that behave like surveys (slot timing, lead-time, calendar sync). */
function isSurveyLike(type: string): boolean {
  return type === "survey" || type === "pre-sale-survey";
}
```

- [ ] **Step 2: Update the validation allowlist** (line ~398)

Change:
```typescript
if (!scheduleType || !["survey", "installation", "inspection"].includes(scheduleType)) {
```
To:
```typescript
if (!scheduleType || !["survey", "pre-sale-survey", "installation", "inspection"].includes(scheduleType)) {
```

- [ ] **Step 3: Update `getCategoryNameForScheduleType`** (line ~254)

Add before the default return:
```typescript
if (type === "pre-sale-survey") return "Pre-Sale Site Visit";
```

- [ ] **Step 4: Update `getCategoryUidForScheduleType`** (line ~260)

Add before the default return:
```typescript
if (type === "pre-sale-survey") return JOB_CATEGORY_UIDS.PRE_SALE_SITE_VISIT;
```

- [ ] **Step 5: Update `categoryConfig` in the PUT handler** (line ~448)

Add entry:
```typescript
"pre-sale-survey": { name: "Pre-Sale Site Visit", uid: JOB_CATEGORY_UIDS.PRE_SALE_SITE_VISIT },
```

- [ ] **Step 6: Update `verifyHubSpotScheduleWrite`** (lines ~326, ~339, ~349)

Replace all `scheduleType === "survey"` with `isSurveyLike(scheduleType)`. Three locations:
- L326: verification fields selection
- L339: date value verification
- L349: site_surveyor verification

- [ ] **Step 7: Update PUT handler's reschedule branch — time window** (line ~732)

Change:
```typescript
else if (schedule.type === "survey" && schedule.startTime && schedule.endTime)
```
To:
```typescript
else if (isSurveyLike(schedule.type) && schedule.startTime && schedule.endTime)
```

- [ ] **Step 8: Update PUT handler's reschedule branch — previousSurveyor** (line ~787)

Change:
```typescript
if (schedule.type === "survey")
```
To:
```typescript
if (isSurveyLike(schedule.type))
```

This ensures survey reassignment notifications and calendar cleanup work for pre-sale surveys too.

- [ ] **Step 9: Update all remaining `=== "survey"` checks in PUT handler**

Replace every `schedule.type === "survey"` with `isSurveyLike(schedule.type)` at these lines:
- L871-872: Activity type ternary → `isSurveyLike(schedule.type) ? "SURVEY_SCHEDULED" : ...`
- L910: `cacheZuperJob` jobCategory ternary → `isSurveyLike(schedule.type) ? "Site Survey" : ...`
  **IMPORTANT:** Change to use `getCategoryNameForScheduleType(schedule.type)` instead of the hardcoded ternary, so pre-sale surveys cache as "Pre-Sale Site Visit"
- L926: HubSpot surveyor write → `isSurveyLike(schedule.type) && schedule.assignedUser`
- L1009: Activity type for create branch → `isSurveyLike(schedule.type) ? "SURVEY_SCHEDULED" : ...`
- L1043: `cacheZuperJob` jobCategory ternary (create branch) → same fix as L910, use `getCategoryNameForScheduleType(schedule.type)`
- L1059: HubSpot surveyor write (create branch) → `isSurveyLike(schedule.type) && schedule.assignedUser`

- [ ] **Step 10: Update `sendCrewNotification` helper function**

Replace `schedule.type === "survey"` with `isSurveyLike(schedule.type)` at these lines:
- L2095: dealOwnerName resolution
- L2112: Google Calendar event URL generation
- L2141: `appointmentType` cast — change to: `appointmentType: schedule.type as ScheduleType`
- L2162: Survey reassignment notification flow
- L2191: Google Calendar surveyor sync (personal + shared calendar)

- [ ] **Step 11: Commit**

```bash
git add src/app/api/zuper/jobs/schedule/route.ts
git commit -m "feat(schedule): add pre-sale-survey with isSurveyLike across PUT handler"
```

---

### Task 4: Update schedule route DELETE handler

**Files:**
- Modify: `src/app/api/zuper/jobs/schedule/route.ts` (DELETE handler, lines ~1224-1643)

- [ ] **Step 1: Update DELETE allowlist** (line ~1225)

Change:
```typescript
if (!["survey", "installation", "inspection"].includes(scheduleType)) {
```
To:
```typescript
if (!["survey", "pre-sale-survey", "installation", "inspection"].includes(scheduleType)) {
```

- [ ] **Step 2: Replace all `=== "survey"` in DELETE handler with `isSurveyLike()`**

Update these lines:
- L1374: HubSpot field clearing branch → `isSurveyLike(scheduleType)`
- L1407: HubSpot site_survey_status reset → `isSurveyLike(scheduleType)`
- L1473: verificationFields selection → `isSurveyLike(scheduleType)`
- L1479: verifiedFieldsCleared check → `isSurveyLike(scheduleType)`
- L1499: verifiedFieldsCleared check → `isSurveyLike(scheduleType)`
- L1510: verifiedStatus check → `isSurveyLike(scheduleType)`
- L1553: Activity type mapping → `isSurveyLike(scheduleType) ? "SURVEY_CANCELLED" : ...`
- L1643: Google Calendar deletion branch → `isSurveyLike(scheduleType)`

- [ ] **Step 3: Commit**

```bash
git add src/app/api/zuper/jobs/schedule/route.ts
git commit -m "feat(schedule): add pre-sale-survey support to DELETE handler"
```

---

### Task 5: Update `createJobFromProject` in zuper.ts

**Files:**
- Modify: `src/lib/zuper.ts:1549-1820`

- [ ] **Step 1: Widen the schedule type union** (line ~1563)

Change:
```typescript
type: "survey" | "installation" | "inspection";
```
To:
```typescript
type: "survey" | "pre-sale-survey" | "installation" | "inspection";
```

- [ ] **Step 2: Update `categoryUidMap` and `categoryNameMap`** (lines ~1594-1603)

Add entries to both maps:
```typescript
"pre-sale-survey": JOB_CATEGORY_UIDS.PRE_SALE_SITE_VISIT,
```
```typescript
"pre-sale-survey": JOB_CATEGORIES.PRE_SALE_SITE_VISIT,
```

- [ ] **Step 3: Update time-window logic** (line ~1686)

Change:
```typescript
} else if (schedule.type === "survey" && schedule.startTime && schedule.endTime) {
```
To:
```typescript
} else if ((schedule.type === "survey" || schedule.type === "pre-sale-survey") && schedule.startTime && schedule.endTime) {
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/zuper.ts
git commit -m "feat(zuper): support pre-sale-survey in createJobFromProject"
```

---

### Task 6: Update scheduling-policy.ts

**Files:**
- Modify: `src/lib/scheduling-policy.ts:4-70`

- [ ] **Step 1: Widen the type union** (line ~6)

Change:
```typescript
scheduleType: "survey" | "installation" | "inspection";
```
To:
```typescript
scheduleType: "survey" | "pre-sale-survey" | "installation" | "inspection";
```

- [ ] **Step 2: Update the lead-time check** (line ~70)

Change:
```typescript
if (role !== "SALES" || scheduleType !== "survey") return null;
```
To:
```typescript
if (role !== "SALES" || (scheduleType !== "survey" && scheduleType !== "pre-sale-survey")) return null;
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/scheduling-policy.ts
git commit -m "feat(policy): enforce lead-time for pre-sale-survey schedule type"
```

---

### Task 7: Update role-permissions.ts

**Files:**
- Modify: `src/lib/role-permissions.ts:775-789`

- [ ] **Step 1: Widen `canScheduleType` signature and add case**

Change:
```typescript
export function canScheduleType(role: UserRole, scheduleType: "survey" | "installation" | "inspection"): boolean {
```
To:
```typescript
export function canScheduleType(role: UserRole, scheduleType: "survey" | "pre-sale-survey" | "installation" | "inspection"): boolean {
```

Add `case "pre-sale-survey":` as a fall-through before `case "survey":`:
```typescript
case "survey":
case "pre-sale-survey":
  return permissions.canScheduleSurveys;
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/role-permissions.ts
git commit -m "feat(permissions): allow pre-sale-survey in canScheduleType"
```

---

## Chunk 2: Tentative, Confirm, and Generic Job Routes

### Task 8: Update tentative route

**Files:**
- Modify: `src/app/api/zuper/jobs/schedule/tentative/route.ts:30-133`

- [ ] **Step 1: Update type validation** (line ~30)

Change:
```typescript
const scheduleType = schedule?.type as "survey" | "installation" | "inspection";
if (!scheduleType || !["survey", "installation", "inspection"].includes(scheduleType)) {
```
To:
```typescript
const scheduleType = schedule?.type as "survey" | "pre-sale-survey" | "installation" | "inspection";
if (!scheduleType || !["survey", "pre-sale-survey", "installation", "inspection"].includes(scheduleType)) {
```

- [ ] **Step 2: Update activity type mapping** (line ~129)

Change:
```typescript
scheduleType === "survey"
  ? "SURVEY_SCHEDULED"
```
To:
```typescript
(scheduleType === "survey" || scheduleType === "pre-sale-survey")
  ? "SURVEY_SCHEDULED"
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/zuper/jobs/schedule/tentative/route.ts
git commit -m "feat(tentative): accept pre-sale-survey schedule type"
```

---

### Task 9: Update confirm route

**Files:**
- Modify: `src/app/api/zuper/jobs/schedule/confirm/route.ts`

This file has 12 `=== "survey"` checks. All need updating.

- [ ] **Step 1: Update type normalization and validation** (line ~285-291)

Change:
```typescript
) as "survey" | "installation" | "inspection";
if (!["survey", "installation", "inspection"].includes(scheduleType)) {
```
To:
```typescript
) as "survey" | "pre-sale-survey" | "installation" | "inspection";
if (!["survey", "pre-sale-survey", "installation", "inspection"].includes(scheduleType)) {
```

- [ ] **Step 2: Update category config** (line ~458)

Add entry:
```typescript
"pre-sale-survey": { name: "Pre-Sale Site Visit", uid: JOB_CATEGORY_UIDS.PRE_SALE_SITE_VISIT },
```

Also add import for `JOB_CATEGORY_UIDS.PRE_SALE_SITE_VISIT` if needed (it should already be imported with `JOB_CATEGORY_UIDS`).

- [ ] **Step 3: Update all 12 `=== "survey"` checks**

Replace `scheduleType === "survey"` with `(scheduleType === "survey" || scheduleType === "pre-sale-survey")` at each of these lines:
- L602: Time-window branch (slot-based timing for surveys)
- L724: `cacheZuperJob` jobCategory ternary — **use `getCategoryNameForScheduleType()` pattern** instead of hardcoded ternary, or add `"pre-sale-survey"` check
- L735: HubSpot surveyor property update
- L754: HubSpot surveyor property update (create branch)
- L771: verificationFields selection
- L781: dateValues verification
- L790: site_surveyor verification
- L887: Google Calendar personal event sync
- L971: Google Calendar shared event sync
- L1019: Survey reassignment notification
- L1047: Google Calendar cleanup for reassignment
- L1188: Activity type mapping ternary

- [ ] **Step 4: Update `appointmentType` cast** (line ~1002)

This line casts `scheduleType` to the email union. Ensure it uses the widened type:
```typescript
appointmentType: scheduleType as "survey" | "pre-sale-survey" | "installation" | "inspection",
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/zuper/jobs/schedule/confirm/route.ts
git commit -m "feat(confirm): accept pre-sale-survey with all 12 survey-like checks"
```

---

### Task 10: Update generic job creation route

**Files:**
- Modify: `src/app/api/zuper/jobs/route.ts:7-103`

- [ ] **Step 1: Update VALID_SCHEDULE_TYPES** (line ~7)

Change:
```typescript
const VALID_SCHEDULE_TYPES = ["survey", "installation", "inspection"] as const;
```
To:
```typescript
const VALID_SCHEDULE_TYPES = ["survey", "pre-sale-survey", "installation", "inspection"] as const;
```

- [ ] **Step 2: Update type union in `validateJobCreation`** (line ~25)

Change:
```typescript
type: "survey" | "installation" | "inspection";
```
To:
```typescript
type: "survey" | "pre-sale-survey" | "installation" | "inspection";
```

- [ ] **Step 3: Update the type cast** (line ~103)

Change:
```typescript
type: schedule.type as "survey" | "installation" | "inspection",
```
To:
```typescript
type: schedule.type as "survey" | "pre-sale-survey" | "installation" | "inspection",
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/zuper/jobs/route.ts
git commit -m "feat(zuper-jobs): accept pre-sale-survey in generic job creation"
```

---

## Chunk 3: Frontend Changes

### Task 11: Enrich pre-sale deal data from search API

**Files:**
- Modify: `src/app/api/deals/search/route.ts:39-180`
- Modify: `src/app/dashboards/site-survey-scheduler/page.tsx:43-75,376-393`

- [ ] **Step 1: Add system size and battery properties to search** (deals/search route, line ~39)

Add to `SEARCH_PROPERTIES`:
```typescript
"system_size_kw",
"battery_count",
```

- [ ] **Step 2: Include the new fields in the response** (deals/search route, line ~165)

Add to the returned deal object (after the `url` field):
```typescript
systemSizeKw: Number(props.system_size_kw) || 0,
batteryCount: Number(props.battery_count) || 0,
```

- [ ] **Step 3: Add `city` and `state` to `SurveyProject` interface** (page.tsx line ~43)

Add after the `address` field:
```typescript
city?: string;
state?: string;
```

- [ ] **Step 4: Use real data in the pre-sale deal mapping** (page.tsx line ~376)

Change:
```typescript
systemSize: 0,
batteries: 0,
```
To:
```typescript
systemSize: Number(d.systemSizeKw) || 0,
batteries: Number(d.batteryCount) || 0,
city: String(d.city || ""),
state: String(d.state || ""),
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/deals/search/route.ts src/app/dashboards/site-survey-scheduler/page.tsx
git commit -m "feat(pre-sale): enrich deal search with system size, battery count, city, state"
```

---

### Task 12: Send `pre-sale-survey` type and enriched data from frontend

**Files:**
- Modify: `src/app/dashboards/site-survey-scheduler/page.tsx:1188-1293`

- [ ] **Step 1: Update the confirmed (Zuper-synced) scheduling call** (line ~1196)

Change:
```typescript
type: "survey",
```
To:
```typescript
type: project.isPreSale ? "pre-sale-survey" : "survey",
```

- [ ] **Step 2: Update city/state in the confirmed call** (line ~1188)

Change:
```typescript
city: "",
state: "",
```
To:
```typescript
city: project.city || "",
state: project.state || "",
```

- [ ] **Step 3: Update the tentative scheduling call** (line ~1277)

Change:
```typescript
type: "survey",
```
To:
```typescript
type: project.isPreSale ? "pre-sale-survey" : "survey",
```

- [ ] **Step 4: Update city/state in the tentative call** (line ~1273)

Change:
```typescript
city: "",
state: "",
```
To:
```typescript
city: project.city || "",
state: project.state || "",
```

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboards/site-survey-scheduler/page.tsx
git commit -m "feat(scheduler): send pre-sale-survey type and enriched deal data"
```

---

## Chunk 4: Verification

### Task 13: Build check and type verification

- [ ] **Step 1: Run TypeScript compiler**

```bash
npx tsc --noEmit
```
Expected: No type errors. Common misses: `appointmentType` casts, `ScheduleType` assertions in confirm route.

- [ ] **Step 2: Run ESLint**

```bash
npm run lint
```
Expected: No new lint errors.

- [ ] **Step 3: Run tests**

```bash
npm run test
```
Expected: All existing tests pass.

- [ ] **Step 4: Search for any remaining `"survey" | "installation" | "inspection"` unions**

```bash
grep -rn '"survey" | "installation" | "inspection"' src/ --include='*.ts' --include='*.tsx'
```

Any result that doesn't include `"pre-sale-survey"` is a missed gate. Fix it. Known file to skip: `src/app/dashboards/scheduler/page.tsx` (master scheduler, doesn't handle pre-sale surveys).

- [ ] **Step 5: Search for remaining `=== "survey"` that should be survey-like**

```bash
grep -rn '=== "survey"' src/app/api/zuper/ src/lib/scheduling-policy.ts src/lib/zuper.ts src/lib/email.ts src/emails/ --include='*.ts' --include='*.tsx'
```

Review each match. If it controls behavior that pre-sale surveys should share (timing, calendar, HubSpot surveyor field, deal owner in email), update it to use `isSurveyLike()` or `|| === "pre-sale-survey"`.

- [ ] **Step 6: Final commit (if anything was fixed)**

```bash
git add -A
git commit -m "chore: fix any remaining type gates for pre-sale-survey"
```

---

## Complete Gate Inventory

### Type union gates (13 locations)

| Location | Line | Change |
|----------|------|--------|
| `schedule/route.ts` | L33 | `ScheduleType` definition |
| `schedule/route.ts` PUT | L398 | Validation allowlist |
| `schedule/route.ts` DELETE | L1225 | Validation allowlist |
| `schedule/route.ts` PUT | L2141 | `appointmentType` cast |
| `tentative/route.ts` | L30 | Type assertion + allowlist |
| `confirm/route.ts` | L290 | Type assertion + allowlist |
| `confirm/route.ts` | L1002 | `appointmentType` cast |
| `jobs/route.ts` | L7,25,103 | `VALID_SCHEDULE_TYPES`, type union, cast |
| `zuper.ts` | L1563 | `createJobFromProject` param |
| `scheduling-policy.ts` | L6 | `SalesSurveyLeadTimeInput` |
| `role-permissions.ts` | L775 | `canScheduleType` param |
| `email.ts` | L577,873 | `appointmentType` interfaces |
| `SchedulingNotification.tsx` | L11 | `appointmentType` prop |

### Category config maps (3 locations)

| Location | Line | Change |
|----------|------|--------|
| `schedule/route.ts` PUT | L448 | Add `"pre-sale-survey"` entry |
| `confirm/route.ts` | L458 | Add `"pre-sale-survey"` entry |
| `zuper.ts` | L1594-1603 | Add to `categoryUidMap` + `categoryNameMap` |

### Helper function maps (3 locations)

| Location | Line | Change |
|----------|------|--------|
| `schedule/route.ts` | L254 | `getCategoryNameForScheduleType` |
| `schedule/route.ts` | L260 | `getCategoryUidForScheduleType` |
| `email.ts` | L500 | `APPOINTMENT_TYPE_LABELS` |

### `=== "survey"` → `isSurveyLike()` replacements

**schedule/route.ts PUT handler (11 locations):**

| Line | Context |
|------|---------|
| L326 | `verifyHubSpotScheduleWrite` verification fields |
| L339 | `verifyHubSpotScheduleWrite` date values |
| L349 | `verifyHubSpotScheduleWrite` site_surveyor |
| L732 | Reschedule time-window (slot-based) |
| L787 | previousSurveyor capture |
| L871-872 | Activity type ternary (reschedule) |
| L910 | `cacheZuperJob` jobCategory (reschedule) |
| L926 | HubSpot surveyor write (reschedule) |
| L1009 | Activity type ternary (create) |
| L1043 | `cacheZuperJob` jobCategory (create) |
| L1059 | HubSpot surveyor write (create) |

**schedule/route.ts DELETE handler (8 locations):**

| Line | Context |
|------|---------|
| L1374 | HubSpot field clearing |
| L1407 | HubSpot site_survey_status reset |
| L1473 | verificationFields selection |
| L1479 | verifiedFieldsCleared check |
| L1499 | verifiedFieldsCleared check |
| L1510 | verifiedStatus check |
| L1553 | Activity type mapping |
| L1643 | Google Calendar deletion |

**schedule/route.ts sendCrewNotification (5 locations):**

| Line | Context |
|------|---------|
| L2095 | dealOwnerName resolution |
| L2112 | Google Calendar event URL |
| L2141 | appointmentType cast |
| L2162 | Survey reassignment notifications |
| L2191 | Google Calendar surveyor sync |

**confirm/route.ts (12 locations):**

| Line | Context |
|------|---------|
| L602 | Slot-based timing branch |
| L724 | cacheZuperJob jobCategory ternary |
| L735 | HubSpot surveyor update (reschedule) |
| L754 | HubSpot surveyor update (create) |
| L771 | verificationFields selection |
| L781 | dateValues verification |
| L790 | site_surveyor verification |
| L887 | Google Calendar personal event |
| L971 | Google Calendar shared event |
| L1019 | Survey reassignment notification |
| L1047 | Google Calendar reassignment cleanup |
| L1188 | Activity type ternary |

**Other files (4 locations):**

| File | Line | Context |
|------|------|---------|
| `scheduling-policy.ts` | L70 | Lead-time enforcement |
| `zuper.ts` | L1707 | Slot-based timing in createJobFromProject |
| `email.ts` | L630 | Deal owner in email body |
| `SchedulingNotification.tsx` | L49 | Deal owner in email component |

### Frontend gates (4 locations)

| Location | Line | Change |
|----------|------|--------|
| `page.tsx` | L1196 | Send `"pre-sale-survey"` type (confirmed) |
| `page.tsx` | L1277 | Send `"pre-sale-survey"` type (tentative) |
| `page.tsx` | L1188,1273 | Send city/state from deal |
| `deals/search/route.ts` | L39 | Add search properties |
