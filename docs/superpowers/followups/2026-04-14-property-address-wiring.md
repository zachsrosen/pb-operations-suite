# Property address wiring — deferred sites

**Context:** Task 6.4 of the HubSpot Property object plan originally listed four
wiring targets for `<PropertyLink>`. Only one (the Deals detail panel) had
end-to-end structured `AddressParts` available, so we shipped that one and
deferred the other three. The plan explicitly forbids widening the link with a
string-parser fallback, so each deferred site is gated on widening the
upstream data contract.

Flag: `NEXT_PUBLIC_UI_PROPERTY_VIEWS_ENABLED`.

---

## 1. Service ticket detail

**Files:**
- `src/app/dashboards/service-tickets/page.tsx` (approximately lines 459 and 580 — the two places a ticket address renders in the detail view)

**Current state:** Renders `ticket.location: string | null`. That field is a
derived fallback string — the ticket API resolves it via
`ticket → deal → pb_location`, else `ticket → company → city/state`. By the
time it reaches the client it's a single collapsed label, not canonical
`{street, city, state, zip}`.

**Blocker:** No structured address parts are exposed on the ticket payload.
`PropertyLink` needs `AddressParts` to hash, and we cannot reliably parse
`"1234 Main St, Denver, CO 80202"` back into parts (ambiguous unit/suffix,
international address quirks, data-quality nulls).

**Fix path:**
- **Preferred (b):** Widen the tickets API response so the same fallback
  cascade that produces `location` also produces an `addressParts:
  AddressParts | null` field — whichever entity won the fallback hands up its
  structured parts. Ticket detail then renders `<PropertyLink>` when
  `addressParts` is non-null, else keeps the current string.
- **Alternative (a):** Resolve the ticket's associated deal client-side and
  pass that deal's structured parts in. Cheaper to ship but duplicates the
  fallback logic on the client and does nothing for tickets whose only
  address source is a company.

---

## 2. Construction scheduler card/detail

**Files:**
- `src/app/dashboards/construction-scheduler/page.tsx` around line 318 (card render)
- `src/app/dashboards/construction-scheduler/ConstructionProjectDetailPanel.tsx` around line 107 (detail render)

**Current state:** The source HubSpot data has `p.address`, `p.city`,
`p.state` structured, but they are joined into a single `address: string`
field during the project transform before reaching the scheduler. **`zip`
availability on the raw source is not confirmed by the initial survey — verify
before wiring.** If `postalCode` isn't pulled today it needs to be added to
the HubSpot property fetch list.

**Fix path:** Preserve `street/city/state/zip` through the
`ConstructionProject` transform. Replace `address: string` with either
`addressParts: AddressParts` (and a `displayAddress: string` helper for call
sites that just need the joined render) or keep the string alongside a new
parts field. Then swap the joined-string render for `<PropertyLink>` in both
the card and the detail panel.

---

## 3. Service scheduler card/detail

**Files:**
- `src/app/dashboards/service-scheduler/page.tsx` approximately lines 381 and 563

**Current state:** The scheduler renders `ZuperJob.address: string`, which is
already joined by the Zuper client/mapper. Zuper API exposes separate
`address`, `city`, `state` fields on the job record; **`zip` availability
needs verification** — the Zuper `customer_address` schema has a `zip_code`
field but the mapper may not be carrying it today.

**Fix path:** Widen the `ZuperJob` TypeScript shape and its mapper (see
`src/lib/zuper*`) to retain structured parts. Same shape as the construction
scheduler fix — keep a joined helper for existing call sites, expose
`AddressParts` for the linked render.

---

All three are blocked on the stricter `AddressParts` contract established in
Task 5.2 — do not paper over with string parsing.
