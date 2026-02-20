# Scheduler Sync Contract (Pre-Implementation Plan)

## Goal
Unify schedule truth across schedulers while preserving stage-specific UX.

## Scope
Schedulers:
- Master: `src/app/dashboards/scheduler/page.tsx`
- Site Survey: `src/app/dashboards/site-survey-scheduler/page.tsx`
- Construction: `src/app/dashboards/construction-scheduler/page.tsx`
- Inspection: `src/app/dashboards/inspection-scheduler/page.tsx`
- Service: `src/app/dashboards/service-scheduler/page.tsx`
- DNR: `src/app/dashboards/dnr-scheduler/page.tsx`

APIs:
- `src/app/api/zuper/jobs/schedule/route.ts`
- `src/app/api/zuper/jobs/schedule/tentative/route.ts`
- `src/app/api/zuper/jobs/schedule/confirm/route.ts`
- `src/app/api/zuper/jobs/lookup/route.ts`
- `src/app/api/zuper/jobs/by-category/route.ts`
- `src/app/api/zuper/schedule-records/route.ts`

---

## Current Differences (Why They Diverge)

### Intentional differences (keep)
1. Workflow-specific scheduling rules
- Site Survey enforces lead-time/day constraints.
- Construction is multi-day and crew-centric.
- Inspection has pass/fail/reinspection logic.
- DNR has category ordering (Detach -> Reset -> D&R Inspection).

2. Scheduler purpose
- Master = cross-stage portfolio calendar + revenue overlays.
- Service/DNR = Zuper-category operational views (not HubSpot stage schedulers).

### Accidental drift (standardize)
1. Scheduled/unscheduled predicates differ by page.
2. Tentative rehydrate precedence differs by page.
3. Zuper timestamp normalization is inconsistent between lookup endpoints.
4. Local/manual overlays are merged differently in each page.

---

## Shared Domain Contract

## Canonical entities

### `ScheduleKind`
- `survey`
- `installation`
- `inspection`
- `service` (read-only)
- `dnr` (read-only)

### `ScheduleState`
- `unscheduled`
- `tentative`
- `scheduled`
- `completed`

### `ScheduleTruth`
```ts
interface ScheduleTruth {
  projectId: string;
  kind: ScheduleKind;

  // source facts
  hubspotScheduleDate?: string | null;
  hubspotStatus?: string | null;

  zuperJobUid?: string | null;
  zuperJobStatus?: string | null;
  zuperScheduledStartUtc?: string | null;
  zuperScheduledEndUtc?: string | null;
  zuperAssignedUser?: string | null;

  tentativeRecordId?: string | null;
  tentativeDate?: string | null;
  tentativeStart?: string | null;
  tentativeEnd?: string | null;

  localOptimisticDate?: string | null;

  completedAt?: string | null;

  // derived
  state: ScheduleState;
  effectiveDate?: string | null;
  effectiveStartUtc?: string | null;
  effectiveEndUtc?: string | null;
  effectiveAssignedUser?: string | null;
  source: "zuper" | "tentative" | "hubspot" | "local" | "none";
}
```

## Precedence (single resolver)
Evaluate in this order:
1. `completed` if completion marker exists.
2. `scheduled` if Zuper has an active scheduled window.
3. `tentative` if active tentative record exists and (2) is false.
4. `scheduled` from HubSpot date only if status is NOT a ready-to-schedule status.
5. `unscheduled` otherwise.

Notes:
- Ready statuses must be mapped per kind (`survey`, `inspection`, `installation`) in one shared table.
- Zuper-confirmed always wins over stale tentative/hubspot/local values.

---

## Shared Write Contract

### Tentative save
- Persist one active tentative record per `projectId + kind`.
- Do NOT sync to Zuper.
- Do NOT send notification email/calendar.

### Confirm schedule (direct or tentative confirm)
- Use one shared service path:
1. Resolve target Zuper job.
2. Reschedule existing job (or explicit create behavior if enabled).
3. Persist schedule record as `scheduled`.
4. Cancel older tentative records for same `projectId + kind`.
5. Update HubSpot date/status + verification readback.
6. Send notification email.
7. For survey only, upsert Google calendar event.

### Unschedule
1. Unschedule in Zuper (if job resolvable).
2. Clear HubSpot date/status fields.
3. Cancel/remove active tentative record.
4. For survey, delete or clear corresponding Google calendar event (add explicit helper if missing).

---

## Scheduler-by-Scheduler Mapping

### Site Survey
Current:
- Hybrid merge with custom `hasActiveSchedule`/`isTentativeProject`.
- Uses Zuper + tentative records + HubSpot + local assignment fallback.

Target:
- Keep survey-specific UX/rules.
- Replace scheduled/tentative predicates with shared resolver.
- Use shared source precedence for sidebar + calendar + stats.

### Construction
Current:
- Hybrid merge; scheduled logic date/manual-centric.
- Tentative guard exists but predicate not identical to Site Survey.

Target:
- Keep multi-day install and crew UX.
- Use shared resolver for scheduled/unscheduled/stats/event inclusion.

### Inspection
Current:
- Similar to construction with inspection-specific overdue/reinspection logic.

Target:
- Keep pass/fail/reinspection behavior.
- Use shared resolver for base schedule state.

### Master
Current:
- Builds multi-stage events from HubSpot stage fields plus manual tentative overlays.
- Custom stage-category matching and fallback logic.

Target:
- Keep portfolio/revenue and multi-stage event rendering.
- Feed events from shared resolved state per kind to avoid stage drift.

### Service
Current:
- Read-only Zuper category view from `/api/zuper/jobs/by-category`.

Target:
- Keep read-only behavior.
- Standardize timestamp normalization in API mapper.

### DNR
Current:
- Read-only Zuper category view + custom category order.

Target:
- Keep ordering and read-only behavior.
- Standardize timestamp normalization in API mapper.

---

## Immediate Low-Risk Fixes (Phase 0)
1. Normalize schedule timestamps in `by-category` route:
- `scheduled_start_time || scheduled_start_time_dt`
- `scheduled_end_time || scheduled_end_time_dt`

2. Extract shared schedule-time normalizer used by both:
- `jobs/lookup`
- `jobs/by-category`

3. Add structured logging for resolver decisions:
- projectId
- kind
- chosen source
- ignored sources

---

## Proposed Rollout (No Big Bang)

### Phase 1: Shared read resolver
- Create `src/lib/scheduler-state.ts` with:
  - status maps per kind
  - resolver function
  - helper for effective date/assignee
- Wire Site Survey first, then Inspection, Construction, Master.

### Phase 2: Shared write service
- Extract common schedule confirmation pipeline used by:
  - `jobs/schedule`
  - `jobs/schedule/confirm`
- Keep endpoints, unify internals.

### Phase 3: Service/DNR normalization
- Apply normalized timestamp mapping.
- Optional: reuse common API DTO mapper.

---

## Test Matrix (Required Before Full Cutover)
1. Zuper scheduled + HubSpot ready status -> `scheduled`.
2. Tentative exists + Zuper scheduled exists -> `scheduled` (Zuper wins).
3. Tentative exists + no Zuper schedule -> `tentative`.
4. HubSpot date exists + ready status -> `unscheduled`.
5. Unschedule clears Zuper + HubSpot + tentative -> `unscheduled`.
6. Survey confirm sends email + calendar (when enabled).
7. Tentative save sends neither email nor calendar.

---

## Decision
- Keep UX differences by scheduler.
- Standardize schedule truth + precedence + sync pipeline.
- Do not keep the current page-by-page schedule-state divergence.
