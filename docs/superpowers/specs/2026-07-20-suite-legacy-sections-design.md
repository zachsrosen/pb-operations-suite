# Suite Legacy Sections (auto-dulled rarely-used pages)

**Date:** 2026-07-20
**Status:** Approved design, pending implementation plan
**Owner:** Zach

## Problem

A traffic analysis of the production ActivityLog (page_view events, data back to mid-February 2026) found that 119 of the app's 222 page routes have had zero views from anyone other than Zach in the last 60 days. Suite landing pages present all of their dashboards with equal visual weight, so the team cannot tell actively-maintained daily tools apart from abandoned or superseded experiments, and dead pages accumulate indefinitely.

Earlier iterations of this design (an admin-only Legacy suite, physical route moves under /legacy/*) were rejected in favor of a lighter approach: keep every page exactly where it is and let suite landing pages visually demote rarely-used pages automatically.

## Goals

- Suite landing pages automatically render rarely-used pages in a dulled, collapsed "Legacy" section at the bottom.
- Zero changes to routing, URLs, access control, or the pages themselves.
- Self-healing in both directions: a page viewed by the team pops back into its normal section on the next cache refresh; a page nobody uses demotes itself after 60 days.
- New tools awaiting team adoption are exempt so they are not buried at launch.

## Non-goals

- No pages are moved, deleted, or access-restricted. No redirects.
- No admin-only Legacy suite. That idea is dropped.
- No changes for pages that are not linked from any suite landing (prototypes, /guide, /handbook, /roadmap, etc.).
- No per-user or per-role customization of the legacy threshold.
- No changes to the /admin/page-traffic dashboard.

## Design

### 1. Staleness computation (src/lib/page-traffic.ts)

New exported helper:

```ts
getLegacyPaths(): Promise<Set<string>>
```

- Queries ActivityLog for the most recent `DASHBOARD_VIEWED` event per normalized page path (`entityType = 'page'`), considering only views by users who do NOT hold the ADMIN role at query time (join on User.roles; views with no matching user are counted as non-admin).
- A path is "legacy" when its most recent non-admin view is more than `LEGACY_THRESHOLD_DAYS = 60` days old, or it has no non-admin views at all.
- Excluding admin views (rather than one specific person) keeps the signal honest: an admin opening a page to test it is not team adoption. Today Zach is the only heavy admin user, so this matches the analysis that motivated the feature.
- Paths in `LEGACY_EXEMPT` (below) are never returned.
- Reuses the existing `normalizePath()` so query-string and dynamic-segment variants fold onto their route.

Exemption list, curated manually in the same module:

```ts
const LEGACY_EXEMPT: string[] = [
  "/dashboards/bottlenecks",      // live 2026-07-07, adoption pending
  "/dashboards/ops-scorecard",    // built for Matt 2026-07
  "/dashboards/scheduler-v2",     // behind feature flag
  "/dashboards/pe-photo-builder", // shipped, E2E validation pending
  "/dashboards/workflow-map",     // new
  "/dashboards/revenue-goals",    // $50M tracker, launch pending
];
```

When a tool on this list gains real traffic its exemption becomes moot and the entry can be pruned during normal maintenance. The list lives next to `getLegacyPaths()` with a comment explaining the pruning rule.

Accepted consequence of the manual list: any future new suite card ships with zero views and therefore lands in the Legacy section until either the team starts using it or it is added to `LEGACY_EXEMPT`. Adding a new suite card should include adding an exemption entry until adopted. A first-seen-date grace period is a possible future refinement, out of scope here.

### 2. Caching and failure mode

- Result is cached in the existing in-memory server cache (`lib/cache.ts`) under key `page-traffic:legacy-paths` with a 1 hour TTL. Suite landings therefore add at most one aggregate query per server instance per hour.
- Failing open: if the query throws, `getLegacyPaths()` returns an empty set and logs the error. Landing pages render exactly as they do today. The cache never stores a failure.

### 3. Rendering (src/components/SuitePageShell.tsx)

`SuitePageShell` is a server component (currently synchronous; this change makes it async, which is safe because all 11 importing suite pages are server components) that receives `cards: SuitePageCard[]` and already groups them into titled sections via each card's `section` field. Changes:

- `SuitePageShell` awaits `getLegacyPaths()` and partitions cards: a card is legacy when `normalizePath(card.href)` is in the set. Suite landing pages themselves and any `hardNavigate`/external hrefs are treated the same as ordinary cards; only membership in the set matters.
- Non-legacy cards render exactly as today, in their existing sections.
- Legacy cards are removed from their sections and rendered in a single trailing section titled "Legacy", implemented as a native `<details>` element (collapsed by default, no client JS) with a `<summary>` reading `Legacy - N rarely-used pages`.
- Inside, cards render with the same markup as regular cards at reduced emphasis: `opacity-60` with `hover:opacity-100`, keeping theme tokens and remaining fully clickable. The card markup is currently inline JSX inside the section map; the implementation extracts it into a small shared renderer (or renders the Legacy section through the same map) rather than duplicating it.
- If no cards are legacy, the section is not rendered.
- A section that loses all of its cards to the Legacy section is simply omitted (existing groupCards behavior handles empty sections by never creating them).

Because the partition happens inside `SuitePageShell`, all 11 suite landing pages that use it get the behavior with no per-suite edits. The Intelligence suite page does not use `SuitePageShell` and is deliberately excluded from this change; it can adopt the shell (or the helper) later if wanted.

Known overlap: the Testing suite already has a hand-authored section named "Legacy Dashboards". Its cards will mostly auto-demote into the new Legacy section anyway (they have no recent team traffic), which empties the hand-authored section; any that remain create a harmless "Legacy Dashboards" section above the auto "Legacy" one. No special handling.

### 4. Interaction with existing card fields

- `disabled` cards that are also legacy render in the Legacy section, still disabled.
- Cards with `section` set keep their tag/icon/description unchanged in the Legacy section.
- Card order within the Legacy section follows the original cards-array order.

## Edge cases

- **Cold cache burst:** concurrent first renders may each run the aggregate once; acceptable and consistent with how other `lib/cache.ts` consumers behave. The plan should confirm ActivityLog has an index usable by the `type + entityType + createdAt` aggregate, or accept the scan cost given the 1 hour cache.
- **Log retention:** ActivityLog currently retains well over 60 days (data back to mid-February). If retention were ever configured below 60 days, every page would look legacy; the helper guards by logging a warning and returning the empty set when the oldest retained page_view (over all page_view rows, regardless of viewer role) is younger than `LEGACY_THRESHOLD_DAYS`.
- **Brand-new deploys / empty log:** same guard applies (no data means fail open, nothing dulled).
- **User with no roles / deleted users:** views without a resolvable non-admin user still count as non-admin views (conservative: keeps pages visible).

## Testing

- Unit tests for the legacy partition logic: threshold boundary (59/60/61 days), exemption list, admin-only viewers, no-views case, retention guard, fail-open on query error.
- Unit test for `SuitePageShell` partitioning: legacy cards land in the trailing details section, non-legacy sections unchanged, section hidden when empty.
- Existing page-traffic tests must continue to pass; `getLegacyPaths()` is additive.

## Rollout

- Ships as a normal PR through GitHub (no migrations, no env vars, no flags).
- Verification: after deploy, the Operations suite should show a Legacy section containing (per current data) catalog, comms, construction, equipment-backlog, forecast-schedule, inspection-metrics, map, pipeline-tracker, product-requests-review, and survey-metrics, while scheduler, crew-schedule, and the other daily tools stay in their sections.
