# Preferred Survey Slots — Implementation Plan

Derived from `docs/superpowers/specs/2026-07-07-preferred-survey-slots-design.md` (approved).
Feature: positive inverse of travel warnings — highlight survey slots that batch a trip.

## Task breakdown

1. **travel-time.ts** — export the two currently-private helpers the new module reuses:
   - `normalizeAddress(addr)` (self-anchor address fallback)
   - `timeToMinutes(time)` (contiguity math)

2. **src/lib/preferred-slots.ts** (new) — core logic:
   - `getPreferredSlotsConfig()` — env: `PREFERRED_SLOTS_ENABLED`, `PREFERRED_SLOT_OFFICE_TIER_MINUTES` (30), `PREFERRED_SLOT_PAIR_NEAR_MINUTES` (15), `PREFERRED_SLOT_PAIR_FAR_MINUTES` (30). `enabled` also requires travel-time `apiKey`.
   - Types: `PreferredSlotAnchor`, `PreferredSlotAnnotation`, `NearbyAnchor`, `DayAnchor`, `ClassifiableSlot`.
   - `classifySlotsForDay(slots, anchors, adjacencyMinutes=30)` — **pure**. Same-surveyor (uid → normalized-name fallback) matching; tier `"adjacent"` when contiguous (gap ≤ adjacency either side, via timeToMinutes), else `"same_day"`; nearest-by-driveMinutes wins on ties. Mutates slots in place with `preferredSlot`. TDD target.
   - `classifyPreferredSlots({ availabilityByDate, candidateAddress, candidateProjectId, location })` — async orchestrator. Resolve office → office→customer drive → pick threshold (strict fallback on unresolved/failed). Dedup unique booked addresses, customer→address drive once each (memoized, bounded concurrency, per-call+batch timeout, fail-open). Exclude self-anchors (by `candidate_project_id` or normalized-address fallback) and address-less/geo-less bookings. Build per-day anchors ≤ threshold, call `classifySlotsForDay`, set `day.nearbyAnchors`, collect `nearbyDays`. Returns `{ nearbyDays }`.

3. **api/zuper/availability/route.ts** — after the travel block (~1264), when `type==="survey"` && candidateAddress && config.enabled, call `classifyPreferredSlots`; add `nearbyDays` to the response JSON (slots/days mutated in place).

4. **UI — site-survey-scheduler/page.tsx**:
   - Extend `DayAvailability` type: slot `preferredSlot?`, day `nearbyAnchors?`; top-level `nearbyDays?` state.
   - Banner above calendar (after header ~2349) when `nearbyDays` non-empty; click → set date; "+N more" expand.
   - Green dot on calendar day cells (~2416 header row) for `nearbyDays`.
   - Slot button (~2648): tier1 strong green ring / tier2 subtle green; tooltip from `preferredSlot.anchor`; travel-warning styling wins, preferred tooltip appended.
   - Confirmation panel (~3061): echo batching context for a selected preferred slot.

5. **.env.example** — document the 4 new vars.

6. **Tests**: `src/__tests__/preferred-slots.test.ts` (pure fn — full spec test list) + route-level assertion that `preferredSlot`/`nearbyDays` appear with mocked drive times and are absent when disabled / no candidate address.

## Guardrails (match travel-time)
Fail-open everywhere; annotation-only (never filter/block slots); bounded concurrency; timeouts; no new endpoints, Zuper calls, or DB changes.
