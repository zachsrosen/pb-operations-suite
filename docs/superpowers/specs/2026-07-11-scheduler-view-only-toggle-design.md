# Master Schedule View-Only Toggle — Design

**Date:** 2026-07-11
**Status:** Draft
**Scope:** `/dashboards/scheduler` (Master Schedule) only

## Problem

The Master Schedule is edit-heavy: clicking an empty day opens the schedule modal, jobs can be dragged to reschedule, and the project detail panel exposes schedule / reschedule / confirm-tentative / remove actions. There is no way to browse the schedule without risk of accidentally mutating it — a real hazard when presenting the schedule in a meeting or scrolling on a projector.

## Goal

A **view-only toggle button** on the Master Schedule that anyone can flip to lock out all edit affordances while keeping the page fully browsable. This is a client-side convenience lock, not a permission.

## Non-Goals

- No server-side enforcement. API routes keep their existing auth; a user can toggle view-only off at any time.
- No role-based read-only. (If that's wanted later, a role check can pin this same state to `true`.)
- No changes to other scheduler pages (service-scheduler, etc.).

## Design

### State & persistence

A `viewOnly: boolean` state in the scheduler page, persisted to localStorage under the key `scheduler:viewOnly:master`, following the exact pattern of `useViewMode` in `src/components/scheduler/ViewModeToggle.tsx` (lazy init from localStorage, `storage` event listener for cross-tab sync, try/catch for private browsing).

Implemented as a `useViewOnly(storageKey)` hook exported from a new `src/components/scheduler/ViewOnlyToggle.tsx`, alongside the button component.

### Button UI

`<ViewOnlyToggle value={viewOnly} onChange={setViewOnly} />` rendered in the header toolbar next to the existing `<ViewModeToggle />` (scheduler page, ~line 4642).

- Inactive: eye icon + "View only" label in muted style, matching the Compact/Breakdown toggle's border/surface tokens.
- Active: accent-colored (blue) with a visible "View only" pill state so it's unmistakable the page is locked.
- Theme tokens only (`bg-surface`, `text-muted`, `border-t-border`), no hardcoded colors.

### What the toggle gates

All gates are `if (viewOnly) return;` guards or conditional rendering at the existing mutation entry points in `src/app/dashboards/scheduler/page.tsx`:

| Entry point | Location (approx.) | Behavior when view-only |
|---|---|---|
| `handleDayClick` (empty-day click → schedule modal / sub-job modal) | ~2449 | No-op |
| `handleWeekCellClick` (week-view crew cell click → schedule modal) | ~3485, wired ~5216 | No-op |
| `handleDrop` (drop onto a day → reschedule confirm / schedule modal) | ~3441 | No-op |
| `draggable` on sidebar project cards | ~4151 | `draggable={false}`, no `onDragStart` |
| `draggable` on calendar job chips | ~4833 | `draggable={false}`, no `onDragStart` |
| Schedule Optimizer panel (Generate / Apply as Tentative / Clear Optimization) | ~3785–3948 | Entire panel hidden, including the "Optimize" expander button (~3779) |
| Detail panel: tentative banner — Install Notes textarea (saves on blur via `handleSaveTentativeNotes`) + "Confirm & Sync to Zuper" / cancel-tentative buttons | ~6714–6757 | Banner **stays visible** but read-only: keep the "⏳ Tentative / Not yet synced" status; render the install notes as static text instead of the editable textarea (removes the `onBlur` PATCH); hide the Confirm & Cancel buttons |
| Detail panel: Reschedule section (date/days picker + button) | ~6759–6817 | Section hidden |
| Detail panel: "Remove from Schedule" | ~6834 | Hidden |

The Schedule Optimizer panel is hidden wholesale rather than per-button: "Apply as Tentative" bulk-PUTs tentative schedules and "Clear Optimization" bulk-DELETEs schedule records — exactly the accidental-mutation hazard this toggle exists to prevent — and a preview-only "Generate" with disabled Apply/Clear buttons would be confusing.

With those entry points gated, the schedule modal, sub-job schedule modal, and reschedule-confirm dialog are unreachable and need no independent gating: the reschedule-confirm dialog opens only from `handleDrop`, and the one-click reschedule path (`handleOneClickReschedule`) is reachable only via drop/detail-panel actions, all gated upstream.

### What stays live

- Filters, search, location/crew selectors
- Week/month navigation
- Compact/Breakdown view toggle
- Clicking a job still opens the detail panel — all read-only content (status, crew, tentative flag, install/tentative notes, sub-job breakdown) remains visible; only the mutating controls (buttons, editable fields) are hidden or made read-only

**Consistency rule:** sections that are *purely actions* (Reschedule picker, Remove, Optimizer) are hidden wholesale — they carry no standing information, and the current scheduled date is already shown elsewhere in the modal. Sections that also *display information* (the tentative banner) stay visible in read-only form. This keeps the invariant "no read-only information is lost in view-only mode."

## Error handling

localStorage access wrapped in try/catch (same as `useViewMode`); on failure the toggle simply doesn't persist and defaults to off (editable), which matches today's behavior.

## Testing

- Unit tests for `useViewOnly`: defaults to `false`, reads persisted value, writes on change, syncs on `storage` event. (No existing `useViewMode` tests to copy — write fresh, following the repo's Jest conventions.)
- Component test for `ViewOnlyToggle`: renders inactive/active states, fires `onChange`.
- Gating behavior on the 7k-line page component is verified manually (dev server): with view-only on — day click inert, drag disabled, detail panel opens with no action buttons; toggle off restores all actions.
