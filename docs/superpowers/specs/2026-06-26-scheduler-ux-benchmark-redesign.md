# Scheduler UX Benchmark & Redesign Recommendations

Date: 2026-06-26
Author: research synthesis (Claude) for product / engineering / design
Scope: the PB Ops Suite scheduling family — main scheduler plus the
construction / site-survey / inspection / service / roofing / D&R schedulers,
all sitting on top of Zuper field service.

---

## 0. Executive summary

We benchmarked 17 leading scheduling/calendar products across four categories
(consumer calendars, AI auto-planners, PM/resource tools, field-service
dispatch) and mapped the strongest patterns against our current tool.

Our scheduler is a capable, hand-rolled calendar with real strengths
(multi-stage overlays, forecast ghosts, a capacity heatmap, travel-time logic
for surveys). But it lags best-in-class dispatch tools on the things that make
scheduling *fast, clear, and hard to mess up*:

1. **No resource-row board.** We have a location-row week view, but no
   crew-as-rows × time-as-columns dispatch board — the single most important
   FSM pattern (Salesforce Field Service, ServiceTitan, Jobber, Housecall Pro
   all center on it).
2. **Conflicts are visible but never prevented or even warned at the point of
   action.** The capacity heatmap turns red but you can still overbook;
   double-booking a crew throws no flag. The industry default is "warn, don't
   block"; we don't even warn.
3. **Travel time exists (`lib/travel-time.ts`) but is wired only into the survey
   scheduler.** Construction/service dispatching is travel-blind.
4. **No saved views, no persistent filters, no map.** Filters reset on reload;
   "Westminster + Construction this week" must be rebuilt every session.
5. **Assignment is manual with no guidance.** No suggested-crew cue, no
   ETA/feasibility screen, no skill/crew-composition matching at assign-time.
6. **Mobile is read-only.** Dispatchers cannot schedule from a tablet/phone.
7. **No undo / change history.** A mis-schedule must be deleted and redone.

The highest-leverage moves, in order: (a) a true **crew-row dispatch board**
with inline travel blocks and multi-day spanning bars; (b) **graduated conflict
guardrails** (hard-block the impossible, soft-warn the risky); (c) an **inline
suggested-crew + ETA-feasibility cue at assign-time**; (d) **saved views +
persistent filters**; (e) a **map pane** scoped by the same filter as the board.

---

## 1. Benchmark comparison — strongest products and their best ideas

### 1.1 Field-service dispatch (most relevant — these solve our exact problem)

| Product | Core layout | Standout idea worth stealing | Where it fails |
|---|---|---|---|
| **Salesforce Field Service** | List ▸ Gantt (resource rows) ▸ Map (separate tab) | **Travel, breaks, absences rendered as inline Gantt blocks** so the day's *true* cost is legible; **true multi-day spanning bars**; filter-then-score scheduling (Work Rules eliminate, Service Objectives rank); custom palette colors Gantt + map *identically* | Brutal learning curve (#1 complaint); map siloed in a tab; in-day optimizer silently rearranges hand-tuned boards; everything config-driven and invisible |
| **ServiceTitan** | Daily/Weekly/Schedule boards + Map 2.0 + Holding Area | **Drag-time arrival-window reconciliation** ("move plan only / move + update customer window / pick window" + Remember preference); **plan-vs-actual drift lines on each block**; weekly cell shows job count + total hours; orientation toggle (techs as rows OR columns) | Surface fragmentation (7+ places to schedule); Dispatch Pro over-optimizes (reshuffles every 10 min → "lost control"); legacy board lag |
| **Jobber** | New Schedule: dual-axis day (by person / by time) + "any time" lane | **Two-tier conflict vocabulary: "Unavailable" (booked) vs "Unfeasible" (can't travel in time)**; reversible drag (drag back to unschedule); unscheduled panel sortable by **value/age/manual**; route optimization on traffic-aware drive times | Single-day only (no multi-day/Gantt); warnings not blocks; **drag-drop dead on tablet/mobile**; scaling cliff ~10–15 techs |
| **Housecall Pro** | Pure whiteboard: employees as columns, hours vertical | Pinned-leftmost **Unassigned column** where the eye lands; faithful zero-training whiteboard; best **linear field flow** (OMW → Start → photos → Finish) | No optimizer, no skills routing, no crews, no drag-resize, no collision guardrail; multi-day jobs fragment into disconnected tiles; readability dies with headcount |
| **FieldEdge** | Dispatch board + assignment dialog | **In-flow ETA/proximity screening inside the assign dialog** (hides techs who can't arrive in time); **gold-star suggested tech**; hard-block on skill mismatch with explanation | Smaller ecosystem; less depth elsewhere |
| **BuildOps / Skedulo / ServiceMax** | Resource Gantt + lifecycle rail | **"Tech Suggester" ranks by certs + proximity + site/customer familiarity** (BuildOps); **lifecycle pipeline rail** Queued → Pending → Dispatched (Skedulo); **dispatcher = exception-handler working the jeopardy list** (ServiceMax) | Enterprise weight; setup burden |
| **Zuper (our backend)** | Users / Scheduler / Map tabs | **Configurable color/icon rule engine** (up to 10 rules/entity) and **one territory filter scoping queue + board + map** — we already own these primitives | Non-intuitive UI; no optimizer-in-loop, no suggested-tech, no ETA screen, no documented conflict signaling; mobile sync delays |

### 1.2 Consumer / productivity calendars

- **Google Calendar** — direct manipulation (drag to create = height is duration;
  drag to move; drag edge to resize) with a **post-drag Undo snackbar**;
  mnemonic single-key view switching; "Find a Time" grid where a free slot is a
  vertical white column. **Cautionary failure:** external guests render *blank =
  free*, causing silent double-bookings → never show "unknown" as "available."
- **Outlook** — the **Scheduling Assistant free/busy grid** is the crown jewel:
  one row per attendee on a shared time axis, busy = colored block, a free slot
  = an empty column. **AutoPick** jumps to the next all-free slot; rooms/resources
  appear as rows in the *same* grid. Stores UTC, renders local → DST-safe.
- **Notion Calendar** — keyboard-first + command palette; **multi-time-zone
  columns** and "time travel"; **pasteable-availability-with-holds** for
  coordinating over text/email. Cautionary: its availability snippets *don't
  check existing events* → check first.
- **Calendly** — **the constraint machine**: buffers (= travel time), minimum
  notice, daily/weekly caps, rolling window, fixed increments — configured once,
  bad bookings become *structurally impossible* (poka-yoke). Team logic =
  **intersection (collective) vs distribution (round-robin)**. Only ever shows
  valid slots.

### 1.3 AI auto-planners

- **Motion** — continuous auto-scheduling; **hard-vs-soft deadline toggle** with
  an honest stated consequence; **capacity classification** (Over/At/Under) with
  expand-to-see-what's-eating-the-day; proactive "won't make deadline" warnings;
  **"Could not fit" parks visibly**. Cautionary: silent reshuffles with no
  changelog → "AI Calendar Anxiety" (rescheduled 11×/day).
- **Reclaim** — constraints as **policy with tolerance** (min/max + ideal time
  inside a hard window); booked-via-link meetings are *never* overbooked
  (external commitments are sacrosanct).
- **Clockwise** — the gold standard for *shared-calendar* re-optimization
  consent: **never auto-creates a conflict for anyone; freezes same-day; moves
  only internal items; notifies after the move** (volume dials down as trust
  grows). Travel time = an **auto-computed protected block**, not a warning.
- **Sunsama** — optional **daily planning ritual** + **auto-rollover of
  unfinished work**; planned-vs-actual calibration. Cautionary: the ritual's
  cost shouldn't scale with the user's worst day — keep it skippable.

### 1.4 PM / resource tools

- **Workload views** (Asana / Monday / ClickUp) — group by person, load bar
  green→red over capacity, **drag-to-rebalance in place (diagnosis surface = fix
  surface)**; **capacity-vs-availability toggle** (ClickUp). Universal failure:
  worthless without effort data → *derive load from data you already have*.
- **Dependency cascade as a policy** (Monday strict/flexible/none; Asana buffer
  policies; **Linear: auto-bump only downstream *unstarted* work, pin committed
  work**); **red connector the instant a prerequisite finishes after its
  dependent starts**. Ship cascade ON, scoped, with a **preview of what will
  move** (Asana off-by-default and ClickUp global-silent are both anti-examples).
- **One dataset, many lenses** + **saved views = saved questions** (Linear/Monday);
  **display-vs-filter split** (show a field without filtering rows away);
  **baseline "ghost" bar** for commitment drift (Monday).
- **Bulk actions**: keyboard multi-select + one verb surface (Linear) + a
  **"send notifications" opt-out** on bulk reassign (ClickUp/Monday).
- **Triage inbox** with single-key disposition + round-robin (Linear).

---

## 2. Prioritized UI improvements for our tool

### 2.1 Quick wins (days, mostly front-end, no schema change)

1. **Persistent filters + URL/localStorage state.** Stop resetting
   location/stage/type filters on reload. Encode in the URL so views are
   shareable/bookmarkable. *(Closes gap #4.)*
2. **Saved views.** Ship 4–5 named standing views: "Unscheduled this week,"
   "Over-capacity crews," "Overdue," "Today by crew," "My location." One click
   instead of rebuilding filters.
3. **Reserve color for status, encode resource by position.** Today event color
   mixes type + status. On the board, resource = row; use the color channel for
   board health (scheduled / en-route / working / done / late). Lean on Zuper's
   existing color-rule engine.
4. **Post-drag Undo snackbar** (Google). After any reschedule, show "Moved
   [job] to [date] — Undo." Cheap, removes fear from drag.
5. **"Could not fit / Needs attention" rail** (Motion). Promote the unscheduled
   sidebar into an explicit attention queue with **age and value sort** (Jobber)
   and a count badge.
6. **Two-tier conflict labels** (Jobber). When a drop would overlap an existing
   assignment, label it "Unavailable"; when travel can't bridge two jobs,
   "Unfeasible." Start as a soft toast even before hard prevention.
7. **Drag-time arrival-window prompt** (ServiceTitan). On reschedule of a
   customer-facing job, ask "update the customer window too?" with Remember.

### 2.2 Medium-effort improvements (a sprint or two)

8. **Crew-row dispatch board view** (SFS/ServiceTitan/Jobber) — the headline.
   Rows = crews (grouped by location), columns = days (and an intraday lane for
   day view). Drag a job between rows to reassign and between columns to
   reschedule — one gesture. Render an **orientation toggle**.
9. **Inline travel blocks across all schedulers** (SFS/Clockwise). Lift
   `lib/travel-time.ts` out of survey-only and render inter-job drive time as a
   *reserved block* on the crew's day, not just a survey warning. Make the
   scheduler unable to pack jobs tighter than travel allows (soft-warn first).
10. **Crew workload bars with drag-to-rebalance** (Asana/Monday/ClickUp). Per
    crew/day load bar green→red, **derived from job-type → standard crew-hours
    we already store** (not manual estimates). Add a **capacity-vs-availability
    toggle**.
11. **Suggested-crew cue at assign-time** (FieldEdge gold star / BuildOps Tech
    Suggester). In the schedule modal, rank eligible crews by location match +
    capacity + (later) skill/equipment + **site/customer familiarity** for
    repeat service. A recommendation, not an autopilot.
12. **ETA/feasibility screen in the assign dialog** (FieldEdge). Surface "can
    this crew reach the site in time given their prior job?" where the
    assignment is made.
13. **Map pane scoped by the same filter** (Zuper/SFS). Add a map view (we have
    geocoding already) that respects the one active location/type filter across
    queue + board + map.
14. **Bulk reschedule/reassign + notification opt-out** (Linear/ClickUp). "Move
    Rolando's week to Lenny": multi-select → one verb surface → apply, with a
    "notify crews?" toggle. (We have a real precedent: the Lenny-covering-Rolando
    reassignment touched ~6 hardcoded places.)

### 2.3 Larger redesign opportunities (multi-sprint / platform)

15. **True multi-day spanning bars** (SFS). Model a multi-day install as one
    continuous bar across the resource timeline, not fragmented per-day tiles.
    This is the thing Jobber/HCP/ServiceTitan all fail and that solar installs
    need most. Pairs with our **split PV/ESS crew** decision (a job can show two
    parallel crew bars).
16. **Graduated conflict guardrails** (FieldEdge + Skedulo). Hard-block the
    truly impossible (no license/cert, no crew, travel infeasible by a wide
    margin); soft-warn the merely risky (tight travel, over capacity, weekend).
    This is the core "harder to mess up" investment.
17. **Optimizer as an inline, scoped proposal** (Skedulo, *not* ServiceTitan
    Dispatch Pro). Select a cluster of unscheduled jobs → "Suggest schedule" →
    review a *diff* → accept/modify/decline. Human stays adjudicator. We already
    have `lib/schedule-optimizer.ts` as a CLI — surface it in-UI behind a
    proposal+diff gate.
18. **Change diff + history + undo** (the gap *no* product closed). After any
    (especially automated) change, show "here's what moved and why" with revert.
    In dispatch a bad move strands a crew/customer — this is non-negotiable.
19. **Dependency cascade for the install→inspection→PTO chain** (Linear/Monday).
    When an install slips, auto-bump only downstream *unstarted* milestones,
    pin committed ones, draw a **red connector** when a prerequisite would land
    after its dependent (e.g., permit not approved before install). Show a
    **preview of what will move** before committing.
20. **Mobile dispatch triage** (open opportunity — every competitor is weak
    here). At minimum: tap-to-open schedule modal, confirm a slot, reassign,
    and work the jeopardy list from a tablet. We already use SMS/push for crew
    notifications.
21. **Library-backed calendar engine.** Our hand-rolled grid repaints the DOM on
    every view change and degrades past ~100 events. Evaluate FullCalendar /
    a resource-timeline lib (or a virtualized custom grid) to get resource rows,
    drag-drop, and multi-day bars with good perf for free.

---

## 3. The main scheduler screen — detailed recommendation

### 3.1 Information hierarchy (top → bottom, left → right)

```
┌ Top bar ────────────────────────────────────────────────────────────────┐
│ [PB Scheduler]   ◀ Today ▶  [ Jun 24–30 ]   View: Day Week Board Map     │
│                                                                            │
│ Location ▾  Work type ▾  Crew ▾   Saved views ▾   🔍 search   ⌘K          │
│ At-risk: 3 overdue · 2 unfeasible · 5 unassigned   ← live attention strip │
└────────────────────────────────────────────────────────────────────────┘
┌ Left rail ─────────────┐ ┌ Main canvas: CREW-ROW BOARD ──────────────────┐
│ ATTENTION QUEUE        │ │         Mon24  Tue25  Wed26  Thu27  Fri28      │
│  ▸ Unassigned (5)      │ │ WESTY α  ▓PV──────▓  [drive] ▒ESS▒   ░░░       │
│    sort: age │ value   │ │ WESTY β  ░░░   ▓Survey  ▓Insp   ▓PV────────▓   │
│  ▸ Unfeasible (2)      │ │ CENT α   ▓PV──▓ ▓PV──▓ [over-cap ▔▔▔red]       │
│  ▸ Overdue (3)         │ │ COSP     ░░░   ▓Service ░░░    ▓PV──▓          │
│                        │ │ ── capacity bar per crew/day: green→red ──     │
│  [drag a card onto a   │ │                                                │
│   crew row to assign]  │ │ legend: ▓ scheduled ▒ en-route ░ open          │
└────────────────────────┘ └────────────────────────────────────────────────┘
```

- **Top bar**: brand + date nav + view switcher (Day / Week / **Board** / Map)
  with single-key shortcuts (`d w b m`, `t` today, `j/k` prev/next).
- **Filter row**: Location / Work type / Crew multi-selects, **Saved views**
  dropdown, search, and a `⌘K` command palette. Filters persist in the URL.
- **Live attention strip**: the one-line "what needs me right now" — counts of
  overdue / unfeasible / unassigned, each a click-to-filter chip. This is the
  "understand what needs attention without opening every record" requirement.
- **Left attention queue**: the unscheduled/at-risk rail (lifecycle grouping:
  Unassigned → Unfeasible → Overdue), sortable by age/value, drag source.
- **Main canvas**: the **crew-row board** (default view), with a per-crew/day
  capacity bar underneath each row.

### 3.2 Views

| View | Layout | Primary job |
|---|---|---|
| **Board** (new, default) | Crews as rows (grouped by location), days as columns; intraday lane in day mode; **multi-day spanning bars**; **inline travel blocks**; per-crew capacity bar | Dispatch: who's doing what, where's the slack, what's overbooked |
| **Week** (keep, improve) | Either crew-rows or location-rows (toggle); 5/7-day | Weekly load planning |
| **Day** | Crew rows × hours, travel + breaks inline | Tactical, day-of |
| **Month** (keep) | Calendar grid with overlays + forecast ghosts | Big-picture pipeline + forecast |
| **Map** (new) | Jobs + crew routes, scoped by the active filter, lasso-select → bulk assign | Spatial reasoning, routing, territory |
| **Gantt** (keep) | Project timeline, install→inspection→PTO chain with dependency cascade | Multi-step project sequencing |

All views are **lenses over one dataset**; editing in any writes back. Switching
views keeps the active filter and date range.

### 3.3 Filters, grouping, search

- **One filter scopes every pane** (board + queue + map), by location / work
  type / crew / stage. (Zuper/SFS pattern.)
- **Saved views = saved questions**, sharable via URL.
- **Display-vs-filter split** (Linear): let dispatchers *show* drive-time,
  warranty clock, or AHJ on cards without filtering rows away.
- **Grouping** into crew or location swimlanes on the board.
- **`⌘K` palette**: jump to date, find customer/PROJ, assign job, switch view.

### 3.4 Colors, status, at-a-glance load

- **Position encodes resource** (which crew = which row). Don't spend color on
  "who."
- **Color encodes status / health** via Zuper's rule engine:
  scheduled, en-route, working, done, **late (red ring + drift line)**,
  tentative (dashed), forecast (ghost/dashed), blocked (amber).
- **Capacity bar** under each crew/day: green ≤80%, yellow 81–100%, orange
  101–120%, red >120% — but make it the *fix* surface (drag to rebalance), not
  just a readout.
- **Plan-vs-actual drift line** on in-progress job blocks (ServiceTitan).
- **Keep the same palette on board and map** (SFS) so a job reads identically in
  both.

### 3.5 Controls

- Drag to move (column), drag to reassign (row), drag edge to resize duration.
- Post-drag **Undo snackbar**.
- Right-click / hover quick actions: reschedule, reassign, mark tentative,
  open in HubSpot/Zuper, text the crew (inline, ServiceTitan Activity Center).
- Multi-select (keyboard + marquee) → one verb surface for bulk ops, with a
  **notify? toggle**.

---

## 4. Proposed workflows for common actions

### 4.1 Assign unscheduled work
1. Dispatcher opens **Board**, scoped to a location (saved view "Unscheduled —
   Westminster").
2. Left queue shows unassigned jobs sorted by age/value.
3. Drag a job onto a crew/day cell. As it hovers, the cell shows a **live
   feasibility read**: capacity remaining, travel feasibility from the adjacent
   job, skill/equipment match.
4. Drop → schedule modal pre-fills the **suggested crew** (ranked) and a valid
   arrival window; dispatcher confirms.
5. Assignment **fires the crew notification automatically**; job moves to
   "scheduled" color; capacity bar updates live.

### 4.2 Move an appointment
1. Drag the job's bar to a new day/time (or new crew row).
2. If the move would **overlap** → "Unavailable" warning; if **travel can't
   bridge** the prior/next job → "Unfeasible" warning.
3. If it's customer-facing → **arrival-window reconciliation prompt** (keep
   plan / update customer window).
4. On commit → **Undo snackbar**; if downstream milestones depend on it,
   **preview the cascade** (which inspection/PTO dates shift) before applying.

### 4.3 Handle a conflict / overbooking
1. The capacity bar goes red and the attention strip increments "over-capacity."
2. Dispatcher opens the **Workload** lens (or expands the crew row) to see
   exactly what's eating the day.
3. **Drag the lowest-priority job to a green crew/day** — both bars recompute.
4. Hard conflicts (no cert, no crew) are **blocked with an explanation**; soft
   conflicts (tight travel) are **warned but allowed** with a one-click
   "schedule anyway."

### 4.4 Find available capacity
1. Flip the capacity bar to **availability mode** ("remaining open crew-days").
2. Or use **"Find a time"** (Outlook AutoPick analog): pick job + constraints
   (location, duration, crew skill) → system highlights the **empty columns**
   (free crew/day slots) that satisfy travel + capacity + skill.
3. Click a highlighted slot to schedule.

### 4.5 Respond to a schedule change (crew out, weather, slip)
1. "Rolando is out this week" → select his week on the board (marquee), **one
   verb surface → Reassign to Lenny**, with **notify crews** toggled on.
2. System re-checks feasibility per job; flags any that won't fit Lenny's
   capacity into the attention queue as "Could not fit" with reasons.
3. For an install slip, the **dependency cascade** previews downstream
   inspection/PTO shifts; dispatcher accepts → all related dates move, all
   affected parties notified once.

---

## 5. Wireframe-level descriptions

### 5.1 Crew-row board (default)
- Sticky left column: crew name + location dot + a small avatar/initials. Crews
  grouped under collapsible location headers (Westminster, Centennial, COSP,
  SLO, Camarillo).
- Columns: business days (weekend toggle), today highlighted with a vertical
  now-line in day mode.
- Cells contain **job bars**: rounded, status-colored, with customer name +
  PROJ + work-type icon; **multi-day jobs span columns** as one bar;
  **travel blocks** render as thin hatched segments between consecutive jobs.
- Under each crew row, a **2px capacity bar** per day (green→red).
- Drag targets glow on hover with a feasibility chip (capacity / travel / skill).
- Right edge: collapsible **detail panel** for the selected job (deal link,
  Zuper job, customer, history, quick actions).

### 5.2 Attention strip + queue
- Strip: `3 overdue · 2 unfeasible · 5 unassigned` — each a chip that filters
  the board.
- Queue: cards grouped Unassigned / Unfeasible / Overdue; each card shows
  customer, location, age, value; sort toggle (age | value); drag handle.

### 5.3 Schedule modal (assign / reschedule)
- Header: job + customer + work type.
- **Suggested crews** list (ranked, gold-star top pick) with capacity + ETA +
  skill badges; the chosen crew highlighted.
- Date + arrival window (only valid windows offered — Calendly poka-yoke).
- Travel feasibility line ("18 min from prior job — OK" / "42 min — tight").
- Installer notes; "notify crew" toggle; confirm/cancel.

### 5.4 Map view
- Left: same attention queue. Center: map with job pins (status-colored) and
  crew routes; lasso-select pins → bulk assign. Same filter as the board.

A live HTML wireframe of the board accompanies this doc in the chat thread.

---

## 6. What to copy, what to avoid, and why

### Copy
- **Resource-row board with inline travel/break blocks** (SFS) — makes the true
  cost of an assignment visible where you fix it.
- **Multi-day spanning bars** (SFS) — solar installs are multi-day; fragmented
  tiles lose the gestalt.
- **Two-tier conflict vocabulary** (Jobber) — "Unavailable" vs "Unfeasible"
  tells the dispatcher *what* is wrong.
- **Graduated guardrails** (FieldEdge + Skedulo) — block the impossible, warn
  the risky; safety shouldn't depend on perfect upstream config.
- **Suggested-crew + ETA at assign-time** (FieldEdge/BuildOps) — guidance
  without autopilot.
- **Constraint machine** (Calendly) — buffers-as-travel, min-notice, daily caps,
  rolling window; bad bookings become structurally impossible.
- **Drag + Undo snackbar** (Google) and **arrival-window reconciliation**
  (ServiceTitan) — fast and forgiving.
- **Saved views = saved questions** + **one filter across all panes**
  (Linear/Monday/Zuper) — attention management in one click.
- **Workload bars with drag-to-rebalance**, load **derived from data we already
  have** (Asana/Monday/ClickUp).
- **Clockwise's consent model** for any automation — never auto-create a
  conflict, freeze near go-time, treat the customer as an external party, notify
  after the move.
- **Change diff + undo** — the unmet need across the entire market.

### Avoid
- **Autonomous re-optimization that churns the board** (ServiceTitan Dispatch
  Pro, Motion) — caused "lost control" / "AI Calendar Anxiety." Keep the human
  as adjudicator of a *proposal + diff*.
- **"Blank = free"** (Google external guests) — never show unknown availability
  as available; show it as explicitly unknown.
- **Off-by-default or global-silent cascades** (Asana off; ClickUp global) — ship
  cascade ON, scoped, with a preview.
- **Surface fragmentation** (ServiceTitan's 7 places to schedule; ClickUp's
  3 overlapping time views) — one board with an orientation toggle, not many
  near-duplicate views.
- **One color channel doing who + where + status** (Jobber/HCP) — reserve color
  for status, encode resource by position.
- **Workload views that demand manual effort data** — they get abandoned; derive
  load automatically.
- **Mobile as an afterthought** — it's the universal competitor weakness; even a
  modest mobile triage view is a differentiator for field crews.
- **A daily ritual whose cost scales with the worst day** (Sunsama) — keep any
  morning "confirm the board" pass skippable and recoverable.

---

## 7. Suggested roadmap framing

- **Phase 1 (quick wins):** persistent filters + saved views, undo snackbar,
  attention strip + sortable queue, color-for-status, two-tier conflict toasts,
  arrival-window prompt.
- **Phase 2 (the board):** crew-row board view + orientation toggle, inline
  travel blocks everywhere, workload bars + drag-to-rebalance, suggested-crew +
  ETA at assign-time, map pane, bulk reassign + notify toggle.
- **Phase 3 (platform):** multi-day spanning bars, graduated guardrails, inline
  optimizer-as-proposal with diff, dependency cascade, change history + undo,
  mobile dispatch triage, calendar-engine evaluation.

Each phase is independently shippable and each item maps to a specific,
sourced best-practice above.
