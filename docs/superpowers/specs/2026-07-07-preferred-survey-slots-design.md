# Preferred Survey Slots — Design

**Date:** 2026-07-07
**Status:** Approved by Zach (behavior), pending spec review
**Problem:** Sales schedules mountain surveys on separate days. Surveyors making the long drive (e.g., Westminster → Evergreen) want nearby surveys batched into one trip. Today the scheduler only shows negative travel signals (tight-travel warnings); there is no positive "this slot batches with an existing trip" signal.

## Summary

When a survey is being scheduled with a known customer address, the scheduler identifies already-booked surveys that are geographically batchable with the new one and surfaces them three ways: a banner, calendar day badges, and green-highlighted slot buttons. All three render automatically from the availability response — the slot highlights appear whenever a qualifying day is viewed and do not depend on the banner being clicked. The banner is only a navigation shortcut.

This is the positive inverse of the existing travel-warning system and reuses its infrastructure end to end: the `/api/zuper/availability` route already receives the full month, the `candidate_address`, and per-surveyor booked-slot lists; `src/lib/travel-time.ts` already provides cached geocoding and Google Distance Matrix drive times.

## Batching rule

Two addresses are "batchable" when the drive time between them is under a threshold that depends on how far the **new customer** is from the office:

| Office → new customer | Pairing threshold (customer ↔ existing survey) |
|---|---|
| ≤ 30 min | ≤ 15 drive-minutes |
| > 30 min | ≤ 30 drive-minutes |

Rationale (Zach): in-town jobs should only batch when they're practically neighbors; once the surveyor is making a mountain trip, anything within 30 minutes is the same outing.

- **Office** = the shop for the scheduler's `location` param, resolved against `OFFICES` in `src/lib/map-offices.ts` (lat/lng used directly; no geocoding needed). If the location doesn't match an office, or the office→customer drive time can't be computed, fall back to the **strict** (15-min) tier to avoid false positives.
- **Drive times** use the existing `getDriveTime()` (cached, directional). Direction: office→customer for the tier decision; customer→existing-survey for pairing.
- All three numbers are env-tunable (see Config).

An existing booked survey that passes the pairing test is called an **anchor**.

**Self-anchor exclusion:** when rescheduling an already-booked survey, the candidate's own booking would sit at ~0 drive-minutes and become a guaranteed false anchor. Booked entries are excluded as anchor candidates when they match the request's `candidate_project_id` (already sent by the scheduler, currently unused by the route beyond echoing) or, as a fallback, when their address normalizes equal to `candidateAddress` (requires exporting the currently-private `normalizeAddress` from travel-time). The address fallback is best-effort — formatting differences like "St" vs "Street" won't normalize equal, which is acceptable since the ID match covers the primary path.

**Location aliases:** the scheduler may pass alias location names (e.g., "Centennial" vs "DTC"). Office resolution uses `getOfficeByPbLocation()` from `map-offices.ts`, which already handles the DTC/Centennial alias (avoids extracting the route-local `getLocationMatches`); if no office resolves, the strict tier applies (safe default).

## Behavior

Given the availability response for the visible month with `candidate_address` set:

1. **Banner** (top of the scheduling panel): if any day in the fetched range has an anchor, show e.g. *"Survey near this customer on Thu Jul 17 — Jake, Evergreen, 12 min away. Jump to that day."* City is parsed from the anchor's `address` field; if parsing fails, omit the city clause (never show a raw full address in the banner). Clicking navigates the calendar to that day. Multiple anchor days: show the soonest, with a "+2 more days" affordance that expands the banner into a list of the remaining anchor days, each clickable.
2. **Day badges**: each anchor day gets a small green dot in the month calendar.
3. **Slot highlights** (render on the day view unconditionally):
   - **Tier 1 — "preferred"**: open slots belonging to the **same surveyor** as the anchor that are time-contiguous with it. Contiguity = the gap between slot end and anchor start (or anchor end and slot start) is **≤ 30 minutes**, since booked Zuper jobs aren't guaranteed to align to the hourly slot grid. Strong green treatment (ring/background) + tooltip: *"Batches with Jake's Evergreen survey (10–11am) — 12 min away"*.
   - **Tier 2 — "same trip day"**: the anchor surveyor's other open slots that day. Subtle green accent + tooltip.
   - Other surveyors' slots get nothing — a different surveyor driving out saves no trip.
4. **Precedence**: if a slot has both a `travelWarning` and a preferred classification (possible when it sits between a near anchor and a far job), the warning styling wins and the preferred tooltip content **is** appended to the warning tooltip (both facts are true and the scheduler should see both).

Visible to every scheduler user (sales and ops); no role gating.

## Architecture

### New module: `src/lib/preferred-slots.ts`

- `classifyPreferredSlots(params)` — orchestrator called from the availability route after `evaluateSlotsBatch`. Inputs: `availabilityByDate` (with `availableSlots` and `bookedSlots` per day), `candidateAddress`, `location`. Behavior:
  1. Resolve office for `location`; compute office→customer drive time once; pick the pairing threshold.
  2. Collect unique booked-survey addresses across the range; compute customer→address drive time **once per unique address** (memoized within the request, backed by the existing 1-hour `driveTimeCache`).
  3. Mark anchors; annotate slots and days (mutation in place, same pattern as `evaluateSlotsBatch`).
- `classifySlotsForDay(...)` — pure function containing the tier logic (same-surveyor matching via `user_uid` with normalized-name fallback, contiguity check, tiering). All unit tests target this.
- Same guardrails as travel-time: bounded concurrency, per-call and whole-batch timeouts, fail-open on any error (no highlight, never a blocked booking).

### API response additions (`GET /api/zuper/availability`)

- Per available slot: `preferredSlot?: { tier: "adjacent" | "same_day"; anchor: { projectName: string; startTime: string; endTime: string; driveMinutes: number; userName: string; address: string } }`. When multiple anchors qualify for one slot, the nearest by `driveMinutes` wins.
- Per day: `nearbyAnchors?: Array<{ projectName, userName, startTime, driveMinutes, address }>` — drives the day badge and its hover tooltip ("Jake in Evergreen, 10am").
- Top level: `nearbyDays?: string[]` (dates with anchors, drives the banner; banner detail comes from the corresponding day's `nearbyAnchors`).

Runs only when `type === "survey"` and `candidateAddress` is present — the same gate as travel warnings. No new endpoints; no extra Zuper API calls; no DB changes.

### UI (`src/app/dashboards/site-survey-scheduler/page.tsx`)

- Banner component above the calendar when `nearbyDays` is non-empty; clicking sets the selected date.
- Green dot on calendar day cells listed in `nearbyDays`.
- Slot button styling: tier 1 strong green, tier 2 subtle green, using theme tokens (`text-white` stays on colored buttons per convention). Tooltip content from `preferredSlot.anchor`.
- Confirmation panel: when a preferred slot is selected, echo the batching context (mirrors how the selected slot's travel warning is echoed today).

## Google API cost

Per month-view fetch with a candidate address: 1 office→customer lookup + 1 lookup per unique booked-survey address in the month (typically 10–50). Geocode cache (24 h) and drive-time cache (1 h) absorb repeat views; lookups run under the existing bounded-concurrency/timeout budget. No change to Zuper call volume.

## Config

| Env var | Default | Meaning |
|---|---|---|
| `PREFERRED_SLOTS_ENABLED` | `true` | Kill switch; also requires `GOOGLE_MAPS_API_KEY` (mirrors `TRAVEL_TIME_ENABLED`) |
| `PREFERRED_SLOT_OFFICE_TIER_MINUTES` | `30` | Office→customer boundary between strict and loose tiers |
| `PREFERRED_SLOT_PAIR_NEAR_MINUTES` | `15` | Pairing threshold when customer is near the office |
| `PREFERRED_SLOT_PAIR_FAR_MINUTES` | `30` | Pairing threshold when customer is far from the office |

New vars documented in `.env.example`. Vercel prod env must be synced before rollout.

## Error handling

- Missing/failed geocode for the customer or a booked survey → that pairing is skipped silently (fail-open, matching travel-time philosophy).
- Booked surveys without address or geo coordinates are ignored as anchor candidates.
- Distance Matrix failure or timeout → no highlights for that request; booking flow unaffected.
- Feature is annotation-only; it never filters or blocks slots.

## Testing

- Unit tests for `classifySlotsForDay` (pure): tier-1 contiguity before/after including the ≤30-min gap tolerance and a just-over-tolerance miss, tier-2 same-day, same-surveyor filtering (uid and name-fallback), threshold tier selection (near vs far vs unknown office), self-anchor exclusion (by `candidate_project_id` and by normalized-address fallback), anchors on multiple days, nearest-anchor-wins when multiple qualify, no-anchor case, missing-address fail-open, and coexistence with `travelWarning` (the classifier annotates `preferredSlot` regardless of an existing warning — precedence is resolved in the UI, not by suppression in the module).
- Route-level test: response includes `preferredSlot` / `nearbyDays` with mocked drive times; absent when `candidate_address` missing or feature disabled.
- Mock `getDriveTime`/`geocodeAddress` as the existing travel-time tests do.

## Out of scope

- Cross-day suggestions beyond the fetched month view.
- Highlighting for install/inspection/other job types (survey only for v1).
- Auto-assignment or slot filtering — this is a visual nudge, not a policy.
- Elevation/zone-based "mountain" definitions (drive-time proximity chosen instead).
