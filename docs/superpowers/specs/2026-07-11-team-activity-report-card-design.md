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

**REVERSED 2026-07-11 (Zach): PE submissions do NOT count toward Deals/day.**
Deals/day stays HubSpot-only; PE activity is visible separately (pe source
column, and the report card lists "<Name> submitted N PE documents this
period" for anyone with 10+ uploads). The section below is retained for
history; none of it is implemented.

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
  activity or edits" to "…activity, edits, or PE document submissions" (PE
  uploads count regardless of deal stage; the active/3-day-buffer screen
  applies to HubSpot touches only).
- Update the now-false doc comments in `metrics.ts`: `ActivityEvent.deals`
  ("set ONLY by the hubspot adapter"), `dealsTouched` ("hubspot touch"), and
  the inline source-gate comment in `computePersonDays`.
- Tests: replace the "only hubspot-source events feed the counts" case with
  the new rule (pe events with `deals` count; zuper `DEAL:`-keyed events
  without `deals` still don't).

## Part 2: Report card

**UX**: a "Report card" button on the team-activity dashboard next to the
existing export. Opening it fetches the PREVIOUS period of equal length
(same sources, same roster) via the existing `/api/admin/team-activity`
endpoint, builds the text client-side, and renders it in a `<pre>` panel with
a Copy button (reusing the drilldown's clipboard fallback). No new endpoint.

**API addition**: the route's response gains `roster: { email: string; name:
string; ptoWeekdays: number }[]` — the applied roster with each member's
weekday-PTO count from the PTO adapter's map. This exists because summaries
and personDays only contain people WITH tracked events; a fully-offline
person on PTO the whole period appears in neither, and the card must still
render them ("on PTO the full period"). The report card covers the main
roster table only; "Look up anyone" extras are excluded.

**New pure module** `src/lib/team-activity/report-card.ts`:

```ts
buildReportCard(current: ReportPeriod, previous: ReportPeriod | null): string
// ReportPeriod = { range: {from, to}; summaries: (PersonSummary & {name})[];
//                  personDays: (PersonDayMetric & {name})[];
//                  roster: {email, name, ptoWeekdays}[];
//                  sources: { ran: {source, events, warning?}[];
//                             skipped: {source, reason}[] } }
```

Pure, deterministic, Jest-tested. Output is plain text (no markdown tables,
no em dashes — enforced by a test) shaped for leadership:

1. **Header**: `Team Activity Report Card: <Mon D> - <Mon D> (vs <prior range>)`.
2. **Per-person lines**, sorted by current `avgDealsTouched` desc:
   `<Name>: <N> deals/day (<up from M | down from M | steady | new this period>), <H>h active/day, <PTO note>`.
   - Deltas compare `avgDealsTouched` (already PTO-adjusted). Rules, total:
     prior period null -> no parenthetical; person absent from prior
     summaries AND prior roster -> "new this period"; person absent from
     prior summaries but on prior roster -> treat prior value as 0;
     `|cur - prev| <= 0.10 * max(prev, 1)` -> "(steady)" (no number, avoids
     prior-vs-current ambiguity); otherwise "(up from M)" / "(down from M)"
     with M = prior value at 1 decimal ("up from 0" is valid).
   - PTO note: "no PTO", "N PTO day(s)", or "N of M weekdays on PTO" when
     N/M ≥ half (N from `roster[].ptoWeekdays`, M = weekdays in range).
     Roster members with no summary row and `ptoWeekdays >= all weekdays in
     range` render as `<Name>: on PTO the full period`; no summary row and
     partial/zero PTO render as `<Name>: no tracked activity this period`.
3. **Notes section** (auto-generated, only lines that apply):
   - Metric definition one-liner: "Deals/day counts distinct HubSpot deals a
     person worked that day (logged activity or edits) while the deal was in
     flight. PE submission work is listed separately below."
   - **PE submissions note**: for each person with 10+ pe-source events in
     the period: "<Name> submitted N PE documents this period (tracked
     separately from deals/day)." Sorted by count descending.
   - **Data-driven channel callouts** (this replaces any hardcoded role
     assumptions): suppressed entirely unless both `hubspot` and `pe` are
     among the ran sources (deselected sources would make every share 0%).
     Otherwise, for each person whose hubspot+pe share of tracked events
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
`useQuery` for the previous window. Both bounds are inclusive day strings, so
the equal-length prior window is: `periodDays = daysBetween(from, to) + 1`,
`prevTo = from - 1 day`, `prevFrom = from - periodDays` (a 14-day window gets
a 14-day prior window, not 13). It passes both `ApiResponse`s to `buildReportCard`,
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
