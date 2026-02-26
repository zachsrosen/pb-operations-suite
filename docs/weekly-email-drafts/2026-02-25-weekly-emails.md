# Weekly Email Drafts for Wednesday, February 25, 2026

These drafts match the existing email senders in `src/lib/email.ts`:
- `sendWeeklyChangelogSimpleEmail`
- `sendOperationsOnlyUpdateEmail`
- `sendBacklogForecastingUpdateEmail`

Data note: backlog/forecast metrics below are based on `reports/weekly-operations-report.xlsx` (snapshot week of January 12, 2026). Refresh numbers before final send if newer exports exist.

## 1) Weekly Changelog (Simple)

Subject:
`PB Ops Weekly Update (Simple) - Week of February 23-27, 2026`

Payload draft:

```ts
{
  to: "team@photonbrothers.com",
  weekLabel: "Week of February 23-27, 2026",
  plainLanguageSummary:
    "This week focused on making the BOM-to-catalog path safer and faster, improving Google Drive imports, and making tentative scheduling respect real daily location capacity so schedules are more realistic.",
  whatChanged: [
    "Launched an approval-backed equipment catalog workflow with queueing, admin approve/reject controls, and push-request tracking.",
    "Added an unmatched-BOM 'Add to Systems' flow so users can submit catalog additions with cleaner metadata.",
    "Moved BOM history into a searchable drawer with faster snapshot selection and safer fetch behavior.",
    "Improved Drive folder import to accept full folder URLs and prefer signed-in user OAuth tokens before service-account fallback.",
    "Upgraded scheduler optimizer logic to reuse occupancy and honor per-location daily capacity to reduce overbooking."
  ],
  whyItMatters: [
    "Catalog quality improves without blocking field teams on manual one-off fixes.",
    "BOM workflows are faster for repeat work because history and imports are easier to access.",
    "Drive access is more reliable for user-scoped files and mixed permissions.",
    "Tentative schedule output now maps better to true install capacity by location."
  ],
  actionItems: [
    "Submit unmatched BOM rows through the new catalog push request flow instead of side-channel requests.",
    "Flag any schedule that still looks over-capacity by location and include deal ID + requested start date."
  ],
  updatesUrl: "https://www.pbtechops.com/updates"
}
```

## 2) Operations-Only Update

Subject:
`[Operations Only] Operations Weekly Coordination`

Payload draft:

```ts
{
  to: "ops@photonbrothers.com",
  title: "Operations Weekly Coordination",
  dateLabel: "Wednesday, February 25, 2026",
  focus:
    "Stabilize catalog approval throughput and close scheduling pressure in high-overdue locations while protecting near-term PE milestone work.",
  completed: [
    "Released catalog push-request approval workflow with queue visibility and admin resolution controls.",
    "Enabled full Google Drive folder URL import and user-token-first Drive listing behavior.",
    "Hardened BOM history interactions and snapshot retrieval to reduce stale-state issues.",
    "Shipped optimizer improvements to respect per-location daily capacity and avoid duplicate occupancy."
  ],
  nextUp: [
    "Set and publish SLA for catalog queue review/approval turnaround.",
    "Run location-level capacity tune pass (especially San Luis Obispo and Westminster) for next two scheduling windows.",
    "Audit top overdue inspection and PE-risk projects, then lock owner + due date in one shared list.",
    "Perform one pass of scheduler output QA and escalate any over-capacity suggestions."
  ],
  blockers: [
    "Inspection backlog remains high (121 projects, approx. $4.766M pipeline impact).",
    "PE milestone risk remains elevated (38 projects, approx. $1.517M at risk).",
    "Current workbook metrics are from the week of January 12 and should be refreshed before leadership distribution."
  ],
  owner: "PB Operations Team"
}
```

## 3) Backlog & Forecasting Update

Subject:
`Backlog + Forecasting - Weekly Backlog & Forecasting Digest`

Payload draft:

```ts
{
  to: "leadership@photonbrothers.com",
  title: "Weekly Backlog & Forecasting Digest",
  dateLabel: "Wednesday, February 25, 2026",
  backlogSummary:
    "Backlog remains heavy in inspection and PE milestones. Throughput improvements are in motion, but current risk concentration is still above target in several locations.",
  backlogMetrics: [
    "Total active projects: 478",
    "Ready-to-build projects: 26",
    "Inspection backlog: 121 projects (approx. $4.766M impacted)",
    "PE milestone risk: 38 projects (approx. $1.517M at risk)",
    "This-week install queue: 25 priority projects (approx. $771k scheduled value)"
  ],
  forecastWindow: "Forecast Window: Monday Mar 2 - Friday Mar 13, 2026",
  forecastSummary:
    "Short-term forecast should prioritize reducing overdue concentration in San Luis Obispo and Westminster while preserving PE-critical deadlines. Capacity-aware optimizer improvements should lower overbook suggestions, but queue pressure remains.",
  forecastPoints: [
    "Highest overdue install concentration: San Luis Obispo (115), Westminster (113), Centennial (67).",
    "Location project load remains highest in Westminster (149 total) and San Luis Obispo (121 total).",
    "PE concentration remains highest in San Luis Obispo (29), Camarillo (25), and Centennial (23).",
    "Inspection milestone statuses currently skew to OVERDUE/URGENT and require active daily burn-down."
  ],
  risks: [
    "If inspection burn-down does not improve, backlog age and revenue lock-up will continue to rise.",
    "PE compliance exposure remains sensitive to milestone slips on already-overdue projects.",
    "Forecast confidence is medium until workbook metrics are refreshed with current-week exports."
  ],
  actions: [
    "Refresh weekly operations workbook before send and update all numbers in this email.",
    "Publish 2-week location capacity plan with explicit daily install/inspection limits.",
    "Assign named owners to top 15 overdue inspection and PE-risk projects with next action dates.",
    "Re-run weekly forecast after capacity and owner updates to measure projected backlog reduction."
  ]
}
```
