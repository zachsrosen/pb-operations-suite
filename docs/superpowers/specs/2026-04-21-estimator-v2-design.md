# Photon Brothers Estimator v2 — Design Spec

**Date:** 2026-04-21
**Status:** Draft
**Author:** Zach + Claude

## Problem

The current customer-facing solar estimator at `photonbrothers.com/learn/estimator` is a black-box iframe served from `/estimator-app/bootstrapper.js` (client-rendered, URL params `formId`, `loc`, `resultsToken`, `siteHandle`, `siteUrl`, `source` — appears to be a Craft CMS form widget). We have no access to its internals, cannot change its UX or math, and its only integration with our systems is whatever lead data it drops into HubSpot via an opaque form submission.

Meanwhile, the PB Ops Suite already has production-grade infrastructure that would make an in-house estimator dramatically better:

- **Property Object cache** with Google geocoding, AHJ, utility resolution, and webhook-driven contact→address sync.
- **Product Catalog** (`InternalProduct` with MODULE/INVERTER/BATTERY specs).
- **v12 solar engine** for real production simulation (layout-parser, physics, shade, clipping).
- **HubSpot** contact/deal/line-item creation primitives in `lib/hubspot.ts`.
- **Public-route pattern** (`/portal`) with middleware `ALWAYS_ALLOWED` + `PUBLIC_API_ROUTES` arrays.

Owning the estimator lets us: (1) fix the UX, (2) tie lead capture into the canonical Property + HubSpot pipeline the rest of our system uses, and (3) reuse the estimator engine internally for reps generating on-the-fly consult quotes.

## Solution

Build a new estimator as a native Next.js route in this repo with a pure-function engine. Ship in three phases — **this spec covers Phase 1 only.**

| Phase | Scope | Audience |
|-------|-------|----------|
| **1 (this spec)** | Shared engine + public **New Installation** flow. Swap the marketing iframe for our hosted app. | Customers |
| 2 (future spec) | Add EV Charger, Home Backup Battery, Detach & Reset, System Expansion flows. Same engine. | Customers |
| 3 (future spec) | Internal rep-facing surface at `/dashboards/estimator` with overrides (panel wattage, $/W, manual incentives, custom line items), pushes result into an existing HubSpot deal as a quote draft. | Sales / Ops |

Phase 1 covers ~70% of estimator traffic (New Installation is the dominant quote type) and proves the engine abstraction. Phases 2/3 become small follow-on specs once Phase 1 ships.

---

## Architecture

```
/estimator (public pages)                       /dashboards/estimator (Phase 3)
   └── React, step state machine, no auth            └── auth-gated, same engine
          │                                                │
          └───── shared engine: lib/estimator/ ────────────┘
                    ├─ sizing.ts        (kWh → kW → panel count)
                    ├─ production.ts    (state/shade → kWh/kW/yr factor)
                    ├─ pricing.ts       ($/W + add-ons − incentives → final)
                    ├─ financing.ts     (amortization)
                    ├─ service-area.ts  (zip → location)
                    ├─ incentives.ts    (apply incentive stack)
                    └─ types.ts         (EstimatorInput / EstimatorResult)
```

**Engine is pure functions, zero I/O.** All data loading (utility rates, incentives, service area, pricing tables) happens in the API route layer; the engine receives resolved values as part of its input. This is what makes Phase 3 (internal rep tool) a small lift — reps get the same engine with overrides injected at the boundary.

**Why not the v12 engine?** v12 is production-accurate and built for post-layout simulation (stringing, clipping, shade timeseries). It's too heavy for a <1s customer instant-quote. The estimator uses a deliberately simplified location-factor model (state × shade → kWh/kW/yr); v12 takes over after a real consult. The accuracy gap is documented in the results UI ("Estimate — not a final quote").

---

## Data Model

### New Prisma model

```prisma
model EstimatorRun {
  id              String    @id @default(cuid())
  token           String    @unique              // opaque URL-safe token for result link
  quoteType       String                         // "new_install" (Phase 1); future: "ev_charger", "battery", etc.
  inputSnapshot   Json                           // full EstimatorInput at submission time
  resultSnapshot  Json                           // full EstimatorResult at submission time
  contactSnapshot Json                           // {firstName, lastName, email, phone, referredBy, notes}
  address         String
  normalizedAddressHash String?                  // FK-ish pointer to HubSpotPropertyCache.addressHash
  location        String?                        // DTC | WESTY | COSP | CA | CAMARILLO | null (out-of-area)
  hubspotContactId String?
  hubspotDealId    String?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  ipHash          String?                        // SHA-256 of IP for rate-limiting + anti-abuse
  outOfArea       Boolean   @default(false)      // true = email-only waitlist lead, no deal
  @@index([email(fields: [contactSnapshot(path: "$.email")], operators: [jsonb_path_ops])])  // TODO: replace with extracted `email` column if index syntax unsupported
  @@index([createdAt])
  @@index([hubspotDealId])
}
```

(If Prisma's JSON path index syntax proves awkward, promote `email` to its own column; not a hill to die on.)

### Seed JSON (no new tables in v1)

Config that ships with the code. Admin UI is Phase 3.

- `src/lib/estimator/data/service-area.json` — `{ [zip: string]: { location: "DTC"|"WESTY"|"COSP"|"CA"|"CAMARILLO" } }`
- `src/lib/estimator/data/utilities.json` — `[{ id, name, displayName, states: string[], zips?: string[], avgBlendedRateUsdPerKwh: number }]`
- `src/lib/estimator/data/incentives.json` — `[{ id, scope: "federal"|"state"|"utility"|"local", match: { state?, zip?, utilityId? }, type: "percent"|"fixed"|"perWatt", value: number, cap?: number, label, disclosure? }]`
- `src/lib/estimator/data/pricing.json` — `{ basePricePerWatt: { [location]: number }, addOns: { evCharger: number, panelUpgrade: number }, financing: { defaultApr: 0.07, defaultTermMonths: 300 } }`
- `src/lib/estimator/data/production.json` — `{ [state]: { [shadeBucket: "light"|"moderate"|"heavy"]: kWhPerKwYear } }`

---

## Public Routes

Add to middleware arrays:

- `ALWAYS_ALLOWED` (page routes): `"/estimator"`
- `PUBLIC_API_ROUTES`: `"/api/estimator"`

| Method | Path | Purpose |
|---|---|---|
| GET | `/estimator` | Quote-type picker. Phase 1: auto-routes to `/estimator/new-install`. |
| GET | `/estimator/new-install` | Wizard. Step state in URL query (`?step=address`, `?step=usage`, etc.). |
| GET | `/estimator/results/[token]` | Shareable result page. Emailed link target. |
| GET | `/estimator/out-of-area` | End state for out-of-service-area leads. |
| POST | `/api/estimator/address-validate` | Geocode + service-area check. Returns `{ normalized, inServiceArea, location, utilities: [] }`. |
| GET | `/api/estimator/utilities?zip=` | Utility options for a given zip (filter of `utilities.json`). |
| POST | `/api/estimator/quote` | Run engine, return `EstimatorResult`. No persistence, no PII, no CRM write. Called interactively as the user toggles add-ons on the results screen. |
| POST | `/api/estimator/submit` | Persist `EstimatorRun`, create HubSpot contact + deal, email result link, return `{ token }`. |
| GET | `/api/estimator/result/[token]` | Fetch saved run for results page. |

---

## Engine Types

```ts
// lib/estimator/types.ts

export type QuoteType = "new_install";  // Phase 1 only

export type ShadeBucket = "light" | "moderate" | "heavy";
export type RoofType = "asphalt_shingle" | "tile" | "metal" | "flat_tpo" | "other";
export type Location = "DTC" | "WESTY" | "COSP" | "CA" | "CAMARILLO";

export interface EstimatorInput {
  quoteType: QuoteType;
  address: {
    street: string;
    city: string;
    state: string;
    zip: string;
    lat?: number;
    lng?: number;
    normalizedHash?: string;
  };
  location: Location;                       // resolved from zip
  utility: { id: string; avgBlendedRateUsdPerKwh: number };
  usage:
    | { kind: "bill"; avgMonthlyBillUsd: number }
    | { kind: "kwh"; avgMonthlyKwh: number };
  home: {
    roofType: RoofType;
    shade: ShadeBucket;
    heatPump: boolean;
  };
  considerations: {
    planningEv: boolean;
    needsPanelUpgrade: boolean;
    planningHotTub: boolean;
    mayNeedNewRoof: boolean;
  };
  addOns: {
    evCharger: boolean;
    panelUpgrade: boolean;
  };
  // Engine-internal: caller resolves these from JSON data files before calling.
  panelWattage: number;                     // e.g. 440 (from default InternalProduct)
  pricePerWatt: number;                     // from pricing.json[location]
  kWhPerKwYear: number;                     // from production.json[state][shade]
  incentives: IncentiveRecord[];            // pre-filtered to matching state/utility/zip
  addOnPricing: { evCharger: number; panelUpgrade: number };
  financing: { apr: number; termMonths: number };
}

export interface EstimatorResult {
  systemKwDc: number;
  panelCount: number;
  panelWattage: number;
  annualProductionKwh: number;
  annualConsumptionKwh: number;
  offsetPercent: number;
  pricing: {
    retailUsd: number;
    addOnsUsd: number;               // sum of enabled add-ons
    incentivesUsd: number;           // total stacked incentives
    finalUsd: number;
    monthlyPaymentUsd: number;
    breakdown: {
      baseSystemUsd: number;
      lineItems: Array<{ label: string; amountUsd: number }>;
      appliedIncentives: Array<{ id: string; label: string; amountUsd: number }>;
    };
  };
  assumptions: string[];              // human-readable disclosure strings
}

export interface IncentiveRecord {
  id: string;
  scope: "federal" | "state" | "utility" | "local";
  type: "percent" | "fixed" | "perWatt";
  value: number;
  cap?: number;
  label: string;
  disclosure?: string;
}
```

---

## Engine Math (v1)

```
// 1. Consumption
annualKwh = usage.kind === "bill"
  ? (avgMonthlyBillUsd * 12) / utility.avgBlendedRateUsdPerKwh
  : avgMonthlyKwh * 12

// 2. Adjust target for future loads
targetKwh = annualKwh * offsetTarget   // offsetTarget = 1.00 baseline
  + (considerations.planningEv ? 3500 : 0)       // ~12k miles/yr EV
  + (considerations.planningHotTub ? 2500 : 0)
  // heatPump is already reflected in their bill — no further adjustment
  // needsPanelUpgrade affects add-ons, not load

// 3. Size system
systemKwDcTarget = targetKwh / kWhPerKwYear
panelCount = ceil(systemKwDcTarget * 1000 / panelWattage)
finalKwDc = panelCount * panelWattage / 1000
annualProductionKwh = finalKwDc * kWhPerKwYear
offsetPercent = min(100, (annualProductionKwh / annualKwh) * 100)

// 4. Price
baseSystemUsd = finalKwDc * 1000 * pricePerWatt
addOnsUsd     = (addOns.evCharger    ? addOnPricing.evCharger    : 0)
              + (addOns.panelUpgrade ? addOnPricing.panelUpgrade : 0)
retailUsd     = baseSystemUsd + addOnsUsd

// 5. Apply incentive stack (order matters: federal ITC applies to post-state net)
//    For v1 we just sum them, documented as a simplification.
incentivesUsd = sum(incentives.map(applyIncentive))
  where applyIncentive(i) =
    i.type === "fixed"   ? i.value :
    i.type === "perWatt" ? i.value * finalKwDc * 1000 :
    i.type === "percent" ? min(retailUsd * i.value, i.cap ?? Infinity) : 0

finalUsd = max(0, retailUsd - incentivesUsd)

// 6. Monthly
monthlyPaymentUsd = amortize(finalUsd, financing.apr, financing.termMonths)
  where amortize(P, apr, n) = P * (apr/12) * (1 + apr/12)^n / ((1 + apr/12)^n - 1)
```

**Assumptions surfaced to user** (rendered under results):

- Homeowner of the address provided
- Single-family home, no more than 2 stories
- Roof is structurally sound for the expected system weight
- Utility rate held constant (no escalation modeling)
- Incentive eligibility based on address only — final eligibility confirmed during consult
- System size is an estimate — final design may vary after site survey

---

## Flow — New Installation

Single React page at `/estimator/new-install` with a step state machine driven by URL query (`?step=address` → `?step=roof` → …). URL-driven so back/forward buttons behave, refresh works, and we can deep-link to a step in support scenarios.

**Step 1 — Address.** Google Places autocomplete. "Enter manually" link opens manual fields (street/city/state/zip). On continue:
1. Call `POST /api/estimator/address-validate`.
2. If `inServiceArea: false` → redirect to `/estimator/out-of-area` (email-only capture → POST to `/api/estimator/submit` with `outOfArea: true`).
3. Else store resolved `{location, utilities}` in form state, advance.

**Step 2 — Roof confirm.** Google Maps Static API tile centered on `(lat, lng)` at zoom=19. Shows address below. "Yes, this is my home" → advance. "No, edit address" → step back to 1.

**Step 3 — Usage + home.**
- Utility provider — dropdown from `utilities` array returned by address-validate.
- Usage — tabs: "Enter average monthly bill" | "Enter monthly kWh" (we prefer kWh; bill is a fallback because most customers don't know their kWh).
- Roof type — 5 options with small icons.
- Shade — 3 options: Light (few obstructions) / Moderate (some trees or neighbors) / Heavy (significant shading).
- Heat pump — Yes/No.
- Considerations — 4 checkboxes (EV / panel upgrade / hot tub / new roof), each with a small "learn more" link.

**Utility fallback.** If user's utility isn't in the list, show "Don't see your provider?" link → contact form (name/email/phone/message, submit as `outOfArea: true` with a flag so ops can manually quote). Does not advance to results.

**Step 4 — Contact.** First name / Last name / Email / Phone / Referred by (optional) / Project notes (optional) / reCAPTCHA v3 (invisible badge). "See my estimate" triggers `POST /api/estimator/submit`.

**Step 5 — Results.** Redirects to `/estimator/results/[token]`. Shows:
- System size hero: `NN.N kW` with panel count, offset %, annual kWh, +/− panel count buttons (re-prices live via `/api/estimator/quote`).
- Price card: retail, incentives (itemized with disclosure tooltips), final, monthly payment.
- Add-ons card: toggle EV charger / panel upgrade (re-prices live).
- Assumptions + small print.
- CTA: "Schedule Consultation" — links to existing `/free-solar-estimate` page (not Calendly). Changeable later.

---

## HubSpot Integration on Submit

**Sequence** (executed in `/api/estimator/submit` after engine call succeeds):

1. **Upsert Contact** — dedupe by email. If existing, update with any new fields; else create with:
   - `firstname`, `lastname`, `email`, `phone`
   - `lifecyclestage: lead`
   - Address fields (triggers the existing Property webhook to build the `HubSpotPropertyCache` row if this address is new)
2. **Create Deal** — new deal in sales pipeline (env: `HUBSPOT_PIPELINE_SALES`), first stage (TBD: either use existing first stage or add new stage "Estimator Lead" — decide during implementation based on current pipeline stage config).
   - Associate to contact.
   - Set custom deal properties via `deal-property-map.ts` (additive, not destructive):
     - System size kW, panel count, annual production kWh, offset %
     - Retail USD, incentives USD, final USD, monthly payment USD
     - Booleans: `estimator_has_ev`, `estimator_has_panel_upgrade`, `estimator_considers_battery` (false in v1), `estimator_considers_new_roof`
     - `estimator_results_token` (the EstimatorRun.token, for ops to pull the full snapshot)
     - `source`: `"public_estimator_v2"` (tag for marketing attribution)
3. **Email result link** — reuse existing email provider (Google Workspace primary, Resend fallback via `lib/email.ts` pattern). New React Email template `EstimatorResultsEmail.tsx` with link to `/estimator/results/[token]`.
4. **Persist** `EstimatorRun` with all foreign IDs.

**Out-of-area path** — skip step 2 (no deal). Contact created with `lifecyclestage: marketingqualifiedlead` and a `waitlist_zip` custom property (new). Email template acknowledges.

**Idempotency** — use existing `IdempotencyKey` model keyed by `(email, normalizedAddressHash, date)` to prevent dupes from refresh/resubmit. Match the pattern in `portal/survey/*`.

---

## Security & Abuse Protection

- **reCAPTCHA v3** on `/api/estimator/submit` only. Score < 0.3 rejected; 0.3–0.5 queued for manual review (mark `EstimatorRun` with a flag; still persists). `/quote` left open for interactive add-on toggling (no PII, no CRM write).
- **Rate limits** via existing `RateLimit` Prisma model, keyed by IP:
  - `POST /api/estimator/submit` — 3 per hour
  - `POST /api/estimator/quote` — 30 per minute
  - `POST /api/estimator/address-validate` — 20 per minute
- **IP hashing** — store SHA-256(IP + env.IP_HASH_SALT) on `EstimatorRun.ipHash` for abuse investigation without retaining raw IPs.
- **No cookies, no session** on public routes. Client state is ephemeral (URL query + in-memory form state).
- **CORS** — endpoints only respond to same-origin; middleware handles.
- **Input validation** — zod schemas at every route boundary. Engine contract enforced by TypeScript + runtime validation on the API layer.
- **Audit log** — write an `ActivityLog` entry (new `ActivityType.ESTIMATOR_SUBMISSION`) for every submit.

---

## Swap-In Plan

Marketing site currently embeds the Craft CMS estimator iframe on `photonbrothers.com/learn/estimator`. Once Phase 1 is deployed to production:

1. Marketing team updates `/learn/estimator` iframe `src` from `/estimator-app?formId=…` to `https://app.photonbrothers.com/estimator` (or whatever our deployed URL is). No Next.js work on this repo side — it's a one-line change on their Craft CMS site.
2. Alternatively (cleaner) marketing redirects `/learn/estimator` → `app.photonbrothers.com/estimator` with a 301.
3. After two weeks of parallel analytics (old vs new conversion), sunset the `/estimator-app/bootstrapper.js` widget on their end.

Coordination item, not an engineering blocker for this spec.

---

## Testing Strategy

### Engine (lib/estimator/)
- Unit tests with fixtures for each pure function (`sizing`, `production`, `pricing`, `incentives`, `financing`).
- Snapshot tests for full `EstimatorResult` on representative inputs (Denver/asphalt/moderate-shade, coastal-CA/tile/light-shade, Springs/flat/heavy-shade, etc.).
- Edge cases: zero usage, zero incentives, incentive cap hits, 100% offset cap, single-panel minimum system.

### API routes
- Integration tests using the existing Jest setup:
  - `/quote` — happy path, invalid input, missing required field.
  - `/submit` — HubSpot mock, verify contact+deal creation, verify email send, verify `EstimatorRun` persisted with token.
  - `/submit` out-of-area — verify deal NOT created.
  - Rate limit enforcement.
  - reCAPTCHA failure returns 403.

### UI
- React Testing Library for step transitions.
- Manual QA checklist for Google Places autocomplete + Google Maps static tile (hard to unit test).

### Data files
- Schema validation test that loads each JSON file and asserts zod schema match. Catches drift.

---

## Out of Scope (explicit)

- **EagleView roof measurement** — engine accepts optional `measuredSqFt` hint for Phase 2+, not used in v1.
- **v12 production engine integration** — deliberately avoided for speed.
- **Admin UI for incentives / utilities / service area** — JSON config edits only in Phase 1; admin UI is Phase 3.
- **Real-time shade analysis** — dropdown bucket instead.
- **Inverter / stringing / battery-count selection** — v1 reports DC kW only. Battery sizing is its own Phase 2 quote type.
- **Multi-panel-option picker** — one default panel per location/product-catalog flag; no user-facing panel choice.
- **EV Charger / Battery / D&R / Expansion quote types** — Phase 2.
- **Internal rep-facing surface** — Phase 3.
- **Incentive stacking order / ITC-base math correctness** — v1 is additive-sum simplification, documented.
- **Utility rate escalation modeling** — out.
- **Loan provider selection / multiple financing options** — single APR/term in v1.
- **i18n / l10n** — English only.
- **Save-and-resume for partial wizards** — v1 persists only on submit.

---

## Rollout

- Behind feature flag `NEXT_PUBLIC_ESTIMATOR_V2_ENABLED`. Off in prod initially.
- Enable for staff IPs first, then gradual ramp via flag once HubSpot deal flow verified.
- Monitor: `ActivityLog` count per day, HubSpot deal creation rate, reCAPTCHA score distribution, rate-limit hits.
- Sentry breadcrumbs for every step transition and API call.
- Rollback = flag off.

## Open Questions (deferrable during implementation)

1. **Sales pipeline first stage** — use existing first stage or add "Estimator Lead" stage? Decide when wiring deal creation; doesn't affect architecture.
2. **Default panel wattage + pricePerWatt source** — read from `InternalProduct.defaultForEstimator` flag vs. hardcode in `pricing.json`? Lean toward flag on `InternalProduct` so catalog changes flow through; confirm during implementation.
3. **Waitlist-notify email template** — reuse `ProductUpdate.tsx` pattern or new template?
4. **Consultation CTA destination** — `/free-solar-estimate` today; revisit if Chili Piper / Calendly gets adopted.

These don't block the spec; they're implementation-time decisions.
