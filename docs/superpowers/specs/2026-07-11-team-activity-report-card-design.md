# Team Activity: Report Card + PE Deal Touches — Design

**Date**: 2026-07-11
**Status**: Approved (Zach, 2026-07-11; PE amendment from "wes is not field ops, he should be higher")
**Builds on**: `2026-07-10-team-activity-deals-touched-design.md` (merged #1399) and the PTO calendar source (merged #1392).

## Problem

Zach wants a 2-week summary he can paste to leadership without reading the raw
tables himself: pre-interpreted plain language, PTO-adjusted, with trends and
honest caveats. Separately, the deals-touched metric restricts to
hubspot-source events, which zeroes out Wes Benscoter — he manages PE
milestone payments (92 of his last 93 tracked page-dwells are `/dashboards/pe`;
98 `PeDocVersion` uploads in 30 days). PE document uploads are deliberate,
per-deal work by a known person and must count.

## Part 1: PE uploads count toward deals-touched

- `peAdapter` (`src/lib/team-activity/adapters.ts`) stamps
  `deals: [{ id: dealId, active: true }]` on events that have a `dealId`.
  Rationale for unconditional `active: true`: uploading a milestone document
  IS live work on that deal at that moment; no HubSpot stage lookup is needed
  (the PE adapter is a pure DB adapter and should stay that way).
- `computePersonDays` drops its source gate: count events with a `deals`
  field regardless of source (`if (!e.deals) continue`). Zuper events never
  set `deals`, so field noise stays excluded — the gate is now "which
  adapters attribute deals", enforced at the adapter layer.
- Dashboard footnote + spec language change from "HubSpot deals with logged
  activity or edits" to "…activity, edits, or PE document submissions".
- Tests: replace the "only hubspot-source events feed the counts" case with
  the new rule (pe events with `deals` count; zuper `DEAL:`-keyed events
  without `deals` still don't).

## Part 2: Report card

**UX**: a "Report card" button on the team-activity dashboard next to the
existing export. Opening it fetches the PREVIOUS period of equal length
(same sources, same roster) via the existing `/api/admin/team-activity`
endpoint, builds the text client-side, and renders it in a `<pre>` panel with
a Copy button (reusing the drilldown's clipboard fallback). No new endpoint.

**New pure module** `src/lib/team-activity/report-card.ts`:

```ts
buildReportCard(current: ReportPeriod, previous: ReportPeriod | null): string
// ReportPeriod = { range: {from, to}; summaries: (PersonSummary & {name})[];
//                  personDays: (PersonDayMetric & {name})[];
//                  sources: { ran: {source, events, warning?}[];
//                             skipped: {source, reason}[] } }
```

Pure, deterministic, Jest-tested. Output is plain text (no markdown tables,
no em dashes — enforced by a test) shaped for leadership:

1. **Header**: `Team Activity Report Card: <Mon D> - <Mon D> (vs <prior range>)`.
2. **Per-person lines**, sorted by current `avgDealsTouched` desc:
   `<Name>: <N> deals/day (<up from M | down from M | steady at M | new this period>), <H>h active/day, <PTO note>`.
   - Deltas compare `avgDealsTouched` (already PTO-adjusted); "steady" when
     within ±10%. A person missing from the prior period gets "new this
     period"; prior period missing entirely (null) drops the parenthetical.
   - PTO note: "no PTO", "N PTO day(s)", or "N of M weekdays on PTO" when
     N/M ≥ half. People with zero activity AND full-period PTO render as
     `<Name>: on PTO the full period`.
3. **Notes section** (auto-generated, only lines that apply):
   - Metric definition one-liner: "Deals/day counts distinct deals a person
     worked that day (HubSpot activity or edits, or PE document submissions)
     while the deal was in flight."
   - **Data-driven channel callouts** (this replaces any hardcoded role
     assumptions): for each person whose hubspot+pe share of tracked events
     is under 25% but total events ≥ 50, emit
     "<Name>'s tracked work is mostly <source label>; deals/day understates
     them." Source labels in plain English ("the PB Ops app", "Zuper field
     jobs", "Google Docs/Meet", "phone calls").
   - PTO recap: "Averages exclude PTO days (from the HR PTO calendar)."
     listed once if anyone had PTO.
   - **Data caveats**: if either period had skipped sources or warnings,
     one line naming them ("HubSpot ran with partial data this period"), so
     partial numbers are never presented as complete.
4. No verdict labels, no emails, no jargon, no em dashes.

**Client wiring** (`TeamActivityClient.tsx`): "Report card" button beside the
range controls. On first open per (range, sources) it issues one extra
`useQuery` for the previous window (`prevFrom = from - periodLen`,
`prevTo = from - 1 day`), passes both `ApiResponse`s to `buildReportCard`,
and shows the panel (loading state while the prior fetch runs, error state
if it fails — the card still renders with `previous = null` and no deltas).
Copy button labels flip to "Copied!" like the drilldown's.

## Error handling

- Previous-period fetch failure → card renders without deltas plus a caveat
  line "Prior-period comparison unavailable for this run."
- Empty current period → single line "No tracked activity in this range."
- All text generation is total: unknown sources fall back to their raw key.

## Testing

Jest on `report-card.test.ts` fixtures: delta wording (up/down/steady/new),
PTO notes incl. full-period PTO, channel callouts (threshold boundaries),
caveat lines from skipped/warned sources, `previous = null`, empty period,
and the no-em-dash invariant. Metrics tests updated per Part 1.
Verification: CLI-driven `buildReportCard` run on live data for the default
roster; eyeball the text; tsc/lint/full metrics suite green.

## Out of scope

- Scheduling/auto-emailing the card (existing digest infra can host it later).
- CLI flag for the card; Zuper deal attribution; per-person trend charts.
