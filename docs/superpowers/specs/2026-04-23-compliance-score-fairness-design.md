# Compliance Score Fairness — Design

**Date:** 2026-04-23
**Author:** Zach + Claude (brainstorming session)
**Driver:** California ops employees reporting demoralizing low personal compliance scores, specifically from multi-team Construction jobs where one team's delay penalizes everyone assigned.
**Scope:** Rewrite per-employee attribution on `/dashboards/office-performance/[location]` compliance scoring. No visibility/hiding changes.

## 1. Problem & goals

### Problem
Personal compliance scores on office-performance dashboards are computed per job using parent-level assignees. When a multi-team Construction job runs late because a later stage (electrical, battery) drags past `scheduled_end_time`, every tech assigned at the parent job level eats the same penalty — including techs whose work finished on schedule. California (SLO + Camarillo, small team, lots of mixed-team installs) is seeing this most acutely.

Separately, the existing status buckets have coverage gaps: real closures like "Return Visit Required" and "Loose Ends Remaining" give no on-time credit, and case/wording variants like "On My Way" vs "On Our Way" fall through entirely.

### Goals
1. **Fairness** — a tech is scored only on work they actually did (or was assigned to them), not on delays that happened on a different stage of the same job.
2. **Legibility** — formula stays inspectable; techs should be able to see exactly why they got the score they got.
3. **Visibility preserved** — per-employee public display stays. No hiding, no anonymization.
4. **Status coverage** — jobs that effectively closed, even with follow-ups, give on-time credit when closure happened before scheduled end.

### Non-goals
- Changing grade bands (A ≥90, B ≥80, C ≥70, D ≥60, F <60) — kept as-is.
- Any HR / performance-review integration.
- Changes to aggregate/location-level compliance computation.
- Multi-contributor-per-form detection (not possible with current Zuper API — documented below).

## 2. Attribution model

### 2.1 Core shift — attribute by service task, not parent job
Zuper Construction jobs contain **service tasks** — discrete work items like "PV Install - Colorado", "Electrical Install - Colorado", "Loose Ends", plus paperwork tasks like "JHA Form", "Xcel PTO", "Participate Energy Photos". Each task has its own `assigned_to[]`, `actual_end_time`, optional linked form submission, and own `service_task_status`.

**Each tech is scored per service task they own, not per parent job.**

### 2.2 Credit set per task
For each **work task** (non-paperwork) on a job:

1. **Credit set** = union of:
   - `service_task.assigned_to[]` (user_uids)
   - Linked form submission's root `created_by.user_uid` (if form exists)
2. If credit set is empty → fall back to parent job `assigned_to[]` (handles tasks that predate this feature or misconfigured jobs).
3. Within the credit set, apply **1/N** weight per tech.

**Rationale:** this is the broadest attribution Zuper's data supports without false positives. Techs who physically worked but are named nowhere in Zuper (rare) are unscored on that job — acceptable loss for fairness.

### 2.3 On-time timestamp — first populated
1. Form submission `created_at` (submission = paperwork-gated completion)
2. Task `actual_end_time`
3. Parent job completion time (from `job_status` history)

Compared to **parent job `scheduled_end_time + 24h grace`**.

Tasks have no scheduled times of their own; parent-job scheduled_end is the only anchor. This is still fair because per-tech `actual_end_time` is decoupled: PV crew's actual_end on day 1 is well below a day-3 scheduled_end regardless of what Electrical does on day 8.

### 2.4 Per-tech metrics
```
tech_onTime        = task_timestamp ≤ parent.scheduledEnd + 24h
tech_completed     = task.service_task_status ∈ COMPLETED_SET
tech_stuck         = parent.jobStatus is Stuck AND task status is not terminal
tech_neverStarted  = parent.jobStatus is Never-started AND task has no actual_start_time
```

### 2.5 Stuck and never-started
- **Stuck**: 1/N across all techs in the credit set (someone should have moved it forward).
- **Never-started**: 1/N across all techs in the credit set.

### 2.6 Formula — unchanged surface
```
onTimePercent     = onTimeCompletions / (onTimeCompletions + lateCompletions)
stuckRate         = stuckJobs / totalJobs
neverStartedRate  = neverStartedJobs / totalJobs
complianceScore   = max(0, onTimePercent - stuckRate*100 - neverStartedRate*100)
grade             = A ≥90, B ≥80, C ≥70, D ≥60, F <60
```

Same formula; inputs computed per-task instead of per-job.

### 2.7 Denominator behavior (fractional counts)
`totalJobs` becomes a fractional sum over 1/N credits. Dashboard displays:
- `Tasks: N.N` (fractional, with one decimal)
- `Jobs worked: M` (distinct parent jobs touched — informational)

Score math is all rates, so fractional totals don't break it.

## 3. Status buckets

### 3.1 Parent-job status buckets (existing `compliance-helpers.ts`)

Expanded from the enumeration in Section 8.1 below.

| Bucket | Treatment | Statuses |
|---|---|---|
| **Completed — full** | on-time if `timestamp ≤ scheduledEnd + 24h`; in `completedJobs` | Completed, Completed - AV, Construction Complete, Passed, Partial Pass |
| **Completed — Failed** | same on-time logic, shown as separate pass-rate column (not hidden) | Failed |
| **Completed — Follow-up** | same on-time logic, tagged with "w/ follow-up" badge on row | Return Visit Required, Loose Ends Remaining, Needs Revisit |
| **Stuck** | penalty if past `scheduledEnd` | Started, Started - AV, On Our Way, On My Way, On My Way - AV, In Progress |
| **Never-started** | penalty if past `scheduledStart` | New, Scheduled, Scheduled - AV, Ready To Schedule, Ready To Build, Ready For Inspection |
| **Excluded** | not counted at all | On Hold, Scheduling On-Hold, Ready To Forecast |

Bugs fixed in passing: "On My Way" (case variant, missed before), "Completed - AV" (Additional Visit variant, missed before).

### 3.2 Service task status buckets
TBD — requires enumeration in Section 8.2. Expected structure mirrors job-level buckets but at task granularity.

## 4. Known limitations

1. **Multi-contributor detection not possible.** Zuper's REST API does not expose per-photo uploader, per-field editor, audit log, activity feed, media endpoint, or shift/timesheet data at Photon's tenant. All 22 probed endpoints returned 404. Attribution is limited to `assigned_to[]` + form `created_by`.
2. **`service_task.assigned_to` may not include helpers** who physically worked a task. They're unscored on that job — accepted tradeoff for fairness.
3. **No task-level scheduled times.** Tasks have `scheduled_duration` only; anchor is parent job's `scheduled_end_time`.
4. **Tasks without linked forms** lose the form `created_at` signal; degrades gracefully to `actual_end_time`.
5. **Automation / dispatcher as `created_by` on notes** — "Integration Zuper" shows as the author on job notes. Notes are unusable for attribution. Form submissions' `created_by` is verified to be real techs.

## 5. UI changes

### 5.1 Per-employee row on `ComplianceBlock.tsx`
Existing columns stay (Grade, On-time, OOW, Jobs, Stuck, Avg days, Score).

Add:
- **Tasks column** — fractional task-weighted count ("3.5 tasks / 7 jobs"), replaces the current "Jobs" integer.
- **Pass rate column** — for inspector-role techs: `passed / (passed + failed)`.
- **Follow-up badge** — small indicator on the row when any of the tech's completions in the window were Return Visit / Loose Ends / Needs Revisit.

### 5.2 Score breakdown tooltip
Hovering the score reveals per-task contribution: which tasks gave credit, which gave penalty, at what weight. Techs can see exactly why their score is what it is.

### 5.3 Legend update
Update the explanatory text under "CREW PERFORMANCE":
> Score is computed per service task you were assigned to or submitted. If you worked a job but weren't assigned to a specific task in Zuper, it won't count.

### 5.4 Public display unchanged
No hiding, no anonymization, no private/manager-only view. Per goals.

## 6. Minimum-jobs threshold

Hide the **grade letter** (but not the numeric score) for techs with **fewer than 5 task credits** in the active window. Show "Low volume" badge in place of the letter. Prevents noise from single-bad-task-means-F outcomes on low-volume techs (surveyors, CA crew).

## 7. Rollout plan

Feature flag: `COMPLIANCE_V2_ENABLED` (default off).

1. **Week 1** — build behind the flag. Ship scoring code + UI changes gated.
2. **Week 1 end** — shadow comparison: compute both v1 (current) and v2 (new) scores for 30 days of historical data, save to a `ComplianceScoreShadow` debug table. Review diff — any tech whose grade shifts by >20 points gets eyeball review before flag flip.
3. **Week 2** — flip flag on for internal admin users only (impersonation-visible); then public TV after 48h of stable internal view.
4. **Week 3** — remove v1 code path after one week of stable v2 operation.

## 8. First-day verification scripts (enumerations)

### 8.1 Parent-job status enumeration (DONE 2026-04-23)
Last 90 days from `ZuperJobCache`:

```
Total jobs: 4,314
  846  New
  744  Completed
  693  Ready To Schedule
  472  Ready To Forecast      ← outdated, exclude
  412  Passed
  364  Construction Complete
  209  Scheduled
  139  SCHEDULED (caps variant)
  133  Ready For Inspection
   86  Failed
   61  Return Visit Required  ← was missed, now credited
   33  Completed - AV         ← was missed, now credited
   30  Ready To Build
   21  Started
   10  Ready to Build (case variant)
    8  Scheduling On-Hold     ← excluded from scoring
    7  Scheduled - AV         ← bucket as never-started
    7  On My Way              ← was missed, now Stuck
    6  On Our Way
    6  Loose Ends Remaining   ← was missed, now credited
    3  Started - AV           ← was missed, now Stuck
    3  On Hold                ← excluded from scoring
    2  Partial Pass
    2  On My Way - AV         ← was missed, now Stuck
    1  Needs Revisit          ← was missed, now credited
```

### 8.2 Service task title enumeration (TODO — first implementation task)
Script: `scripts/enumerate-service-task-titles.ts` — pull all distinct `service_task_title` values from live Zuper for last 90 days, group by parent `job_category`. Classify each into Work / Paperwork / Unknown. Human review before locking the `TASK_TITLE_CLASSIFICATION` constant.

Sample observed: PV Install - Colorado, Electrical Install - Colorado, Loose Ends, JHA Form, Xcel PTO, Participate Energy Photos. California variants expected but not yet enumerated.

### 8.3 Service task status enumeration (TODO — first implementation task)
Script: `scripts/enumerate-service-task-statuses.ts` — pull all distinct `service_task_status` values. Build task-level bucket table matching job-level structure.

### 8.4 Lucas Scarpellino sanity-check (TODO — before flag flip)
Analysis: compute Lucas's v1 vs v2 score over the last 90 days. Write results to `docs/superpowers/analyses/2026-04-XX-lucas-compliance-diff.md`. Expected direction: his score rises because jobs where he was parent-assigned but had no task credit no longer penalize him.

If his score *doesn't* improve, rollout blocked pending investigation.

## 9. Tests

Add to `src/__tests__/compliance-compute.test.ts`:

- **PV/Battery case**: 2 techs on a Construction job, one in PV task's credit set (completed day 1), one in Electrical task's credit set (completed day 8), parent `scheduledEnd` = day 3 → PV tech on-time, Electrical tech late.
- **Parent-only tech**: tech assigned at parent job but not in any service task credit set → not scored on that job at all.
- **Fractional math**: 3 techs in one task's credit set, one late completion → each gets 1/3 of the late hit.
- **Follow-up status**: Return Visit Required reached before `scheduledEnd` → on-time credit + "w/ follow-up" tag.
- **Failed status**: on-time Failed completion → credited as on-time; also counted in pass-rate denominator (pass rate = 0%).
- **Excluded status**: parent in "Ready To Forecast" → excluded from all denominators.
- **Case variants**: "SCHEDULED" and "Ready to Build" normalize to lowercase; "On My Way" classified as Stuck.
- **Low volume**: tech with 4 task credits → grade hidden, "Low volume" shown; 5 task credits → grade shown.

Fixtures: hand-crafted payloads under `src/__tests__/fixtures/compliance-v2/` covering each case.

Snapshot: `ComplianceBlock.tsx` render with new columns and badges.

## 10. Open items deferred to phase 2

- Multi-contributor detection via Zuper timesheet/shift feature (if Photon enables it).
- Per-photo uploader metadata (needs Zuper API extension or migration to a different field service platform).
- Team-level morale visualization on TV (team rollups only), if fair attribution alone doesn't resolve CA concerns.
