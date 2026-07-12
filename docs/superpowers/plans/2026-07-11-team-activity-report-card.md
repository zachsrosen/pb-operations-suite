# Team Activity Report Card + PE Deal Touches Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PE doc uploads count toward Deals/day, and the dashboard gains a copy-pasteable leadership "Report card" with prior-period deltas, PTO notes, and data-driven callouts.

**Architecture:** Per `docs/superpowers/specs/2026-07-11-team-activity-report-card-design.md` (the contract — read it first). Three units: (1) adapter/metrics change for PE touches, (2) pure `report-card.ts` text builder, (3) client wiring + API `roster` field.

**Tech Stack:** TypeScript, Jest, Next.js app router. No new endpoints, no schema changes.

**Worktree:** `.worktrees/team-activity-report-card`, branch `feat/team-activity-report-card` (off main at bb8c4027; prisma client generated; `.env` copied, gitignored).

---

## Chunk 1: PE deal touches (TDD)

### Task 1: metrics gate + tests

**Files:** `src/lib/team-activity/metrics.ts`, `src/__tests__/team-activity-metrics.test.ts`

- [ ] **Step 1: Update tests.** In `team-activity-metrics.test.ts`, REPLACE the test `"only hubspot-source events feed the counts even if deals is present"` with:

```ts
  it("pe events with a deals field count; zuper never sets deals so field noise stays out", () => {
    const days = computePersonDays([
      hsEv({ source: "pe", deals: [{ id: "7", active: true }], objectKey: "DEAL:7", kind: "uploaded Site Plan v2" }),
      hsEv({ source: "zuper", objectKey: "DEAL:9", kind: "job status" }), // no deals field
    ]);
    expect(days[0].dealsTouched).toBe(1);
    expect(days[0].dealsTouchedAll).toBe(1);
  });
```

Run: `npx jest team-activity-metrics -t "pe events" 2>&1 | tail -5` → FAIL (pe events currently excluded).

- [ ] **Step 2: Implement.** In `computePersonDays`, change `if (e.source !== "hubspot" || !e.deals) continue;` → `if (!e.deals) continue;`. Update the three stale doc comments per spec: `ActivityEvent.deals` (now "set by the hubspot and pe adapters; adapters that attribute deals are the gate — zuper never sets it"), `PersonDayMetric.dealsTouched` ("hubspot or PE touch"), and the inline comment above the gate.

- [ ] **Step 3:** `npx jest team-activity-metrics 2>&1 | tail -4` → all pass. Commit: `feat(team-activity): count deal-attributed events from any adapter (PE uploads)`.

### Task 2: peAdapter stamping

**Files:** `src/lib/team-activity/adapters.ts` (peAdapter, ~line 170)

- [ ] **Step 1:** In `peAdapter`'s event push, add `deals` when `dealId` exists:

```ts
      events.push({
        email,
        timestamp: r.uploadedAt,
        source: "pe",
        kind: `uploaded ${r.docName} v${r.version}`,
        objectKey: r.dealId ? `DEAL:${r.dealId}` : `pe:${r.peProjectId}`,
        deals: r.dealId ? [{ id: r.dealId, active: true }] : undefined,
      });
```

- [ ] **Step 2:** Dashboard footnote in `TeamActivityClient.tsx` (~line 700): change `counts distinct HubSpot deals with logged activity or edits that day` → `counts distinct deals a person worked that day (HubSpot activity or edits, or PE document submissions)`. Keep the rest of the sentence.
- [ ] **Step 3:** `npx tsc --noEmit` (team-activity files clean) + commit: `feat(team-activity): PE doc uploads attribute deals in peAdapter`.

## Chunk 2: report card module (TDD)

### Task 3: `src/lib/team-activity/report-card.ts` + tests

**Files:** Create `src/lib/team-activity/report-card.ts`, `src/__tests__/team-activity-report-card.test.ts`

The module is fully specified in the spec §Part 2 (types, header, per-person line
template, delta rules, PTO notes, channel callouts w/ ran-source suppression,
caveats, error cases). Implementation notes the spec leaves to the plan:

- Date formatting: `Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" })` over `range.from/to` ISO strings (they are day-precision; parse the `YYYY-MM-DD` prefix as UTC noon to avoid tz roll).
- Weekday count in range: reuse `isWeekday` from `./metrics` stepping day strings (UTC-noon stepping, same as adapters' `addAllDaySpan` approach).
- Numbers: deals/day and hours at 1 decimal, trailing `.0` stripped (`40` not `40.0`).
- Source labels for callouts: `pbops: "the PB Ops app"`, `zuper: "Zuper field jobs"`, `google: "Google Docs/Meet"`, `aircall: "phone calls"`, fallback raw key.
- Person ordering: summaries sorted by `avgDealsTouched` desc, then roster-only people (full-period PTO / no activity) at the bottom.
- Export a `SOURCE_PLAIN_LABEL` map only if needed internally; the public surface is exactly `buildReportCard` + the `ReportPeriod` type.

- [ ] **Step 1: Write the test file first** — fixtures built from minimal hand-rolled `ReportPeriod` objects (do NOT run adapters). Cases (one `it` each):
  1. header renders both ranges;
  2. up/down wording with prior value at 1 decimal;
  3. steady band: prev 20, cur 21.9 → "(steady)"; prev 20, cur 22.1 → "(up from 20)";
  4. prev 0, cur 3 → "(up from 0)"; both 0 → "(steady)";
  5. person in current only, absent from prior roster → "new this period";
  6. absent from prior summaries but on prior roster → treated as prior 0;
  7. `previous = null` → no parentheticals + caveat line "Prior-period comparison unavailable for this run.";
  8. PTO notes: 0 → "no PTO"; 2/10 → "2 PTO days"; 6/10 → "6 of 10 weekdays on PTO";
  9. roster member with no summary + ptoWeekdays == weekdays-in-range → "on PTO the full period"; with 0 PTO → "no tracked activity this period";
  10. channel callout fires at share <25% & events ≥50; suppressed when share 30% or events 40; suppressed entirely when `pe` missing from ran sources;
  11. skipped/warned source in either period → caveat line;
  12. empty current period → "No tracked activity in this range.";
  13. the full output of a rich fixture contains no "—" (em dash) and no "@" (no emails).

Run → FAIL (module missing).

- [ ] **Step 2: Implement `buildReportCard`** to make all 13 pass. Pure function, no I/O, no Date.now().
- [ ] **Step 3:** `npx jest team-activity-report-card 2>&1 | tail -4` → 13 pass. Commit: `feat(team-activity): buildReportCard pure text generator`.

## Chunk 3: API + client + verification

### Task 4: API `roster` field

**Files:** `src/app/api/admin/team-activity/route.ts`

- [ ] **Step 1:** After `ptoResult` is awaited, compute weekdays-per-member and add to the JSON response:

```ts
    roster: roster.map((m) => ({
      email: m.email.toLowerCase(),
      name: m.name,
      ptoWeekdays: [...(ptoResult.pto.get(m.email.toLowerCase()) ?? [])].filter(isWeekday).length,
    })),
```

(`isWeekday` imported from `@/lib/team-activity/metrics`; it's already exported.) This uses the APPLIED roster (default or `?emails=`), which is correct for both the main table and ad-hoc lookups.

- [ ] **Step 2:** `npx tsc --noEmit` clean → commit: `feat(team-activity): roster + ptoWeekdays in API response`.

### Task 5: client wiring

**Files:** `src/app/dashboards/admin/team-activity/TeamActivityClient.tsx`

- [ ] **Step 1:** Add `roster: { email: string; name: string; ptoWeekdays: number }[]` to `ApiResponse`. Add state `const [cardOpen, setCardOpen] = useState(false);`. Compute the prior window from `applied` per spec (inclusive-day math; use a `shiftDay(day, deltaDays)` helper stepping via UTC noon). Add a second `useQuery` keyed `["team-activity-prev", ...]`, `enabled: cardOpen && applied.sources.length > 0`, fetching the same URL shape with the prior window (no `emails=` — main roster only).
- [ ] **Step 2:** "Report card" button next to the Run button (same styling family, `bg-surface border` secondary look). On click toggles `cardOpen`. Panel below the source-status banner: while prev query loading → "Building report card (fetching prior period)…"; then `<pre className="bg-surface border border-t-border rounded-lg p-4 text-xs whitespace-pre-wrap">{text}</pre>` with a Copy button reusing the existing clipboard fallback pattern (extract the drilldown's copy logic into a small `copyText(text: string)` helper inside the file rather than duplicating).
- [ ] **Step 3:** `text = buildReportCard(toPeriod(data), prevData ? toPeriod(prevData) : null)` where `toPeriod` maps `ApiResponse` → `ReportPeriod` (field-for-field). Prev query error → pass `null` (the builder emits the caveat line).
- [ ] **Step 4:** `npx tsc --noEmit && npx eslint src/app/dashboards/admin/team-activity/ 2>&1 | tail -3` clean → commit: `feat(team-activity): Report card panel with copy`.

### Task 6: verification

- [ ] **Step 1:** Full metrics + report-card suites, tsc, lint on touched dirs — green.
- [ ] **Step 2: Live text check.** Temp script `scripts/_tmp-report-card.ts`: run the adapters for the default roster over the last 14 days AND the prior 14, feed `computePersonDays`/`rollupByPerson` + a hand-built roster w/ ptoWeekdays into `buildReportCard`, print the text. Eyeball: Wes shows a real deals/day number now (PE uploads); Alexis has a PTO note; no em dashes; callouts sensible. Delete the temp script.
- [ ] **Step 3:** Full `npx jest` failure-set diff against a pristine main baseline is NOT needed this time IF only the replaced test changed in existing suites — run `npx jest team-activity 2>&1 | tail -4` plus the two touched suites; the repo-wide baseline was established 2026-07-11 (~92 pre-existing failures, none in team-activity).
- [ ] **Step 4:** Push, PR against main linking the spec; note the PE metric change prominently (it shifts Deals/day for PE-heavy people).
