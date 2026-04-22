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
  id                    String    @id @default(cuid())
  token                 String    @unique              // opaque URL-safe token for result link
  quoteType             String                         // "new_install" (Phase 1); future: "ev_charger", "battery", etc.
  inputSnapshot         Json                           // full EstimatorInput at submission time
  resultSnapshot        Json                           // full EstimatorResult at submission time
  contactSnapshot       Json                           // {firstName, lastName, phone, referredBy, notes}
  firstName             String                         // promoted from contactSnapshot for querying
  lastName              String
  email                 String                         // promoted from contactSnapshot for indexing + dedup
  address               String
  normalizedAddressHash String?                        // soft pointer; NOT an FK. No relation declared. See race-condition note below.
  location              String?                        // DTC | WESTY | COSP | CA | CAMARILLO | null (out-of-area)
  hubspotContactId      String?
  hubspotDealId         String?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt
  expiresAt             DateTime                       // default now() + 90 days; used by cron for cleanup
  ipHash                String?                        // SHA-256 of IP for rate-limiting + anti-abuse
  outOfArea             Boolean   @default(false)      // true = email-only waitlist lead, no deal
  manualQuoteRequest    Boolean   @default(false)      // true = utility fallback, no engine run
  recaptchaScore        Float?                         // null if submission pre-recaptcha verified
  flaggedForReview      Boolean   @default(false)      // recaptcha 0.3–0.5 range

  @@index([email])
  @@index([createdAt])
  @@index([hubspotDealId])
  @@index([expiresAt])
  @@index([normalizedAddressHash])
}
```

**`normalizedAddressHash` is a soft pointer, not a foreign key.** Estimator submissions arrive synchronously but the corresponding `HubSpotPropertyCache` row is built asynchronously by the `onContactAddressChange` webhook — which may not fire until HubSpot processes the contact create (seconds to minutes). We compute the hash using the same `sha256(street+unit+city+state+zip)` algorithm exported from `property-sync.ts` at estimator-submit time, so the value is stable and the reconcile cron or the webhook will resolve it later without coordination. No FK constraint, no relation declared.

**Cleanup cron** — add a daily job under `/api/cron/estimator-cleanup` that deletes `EstimatorRun` rows where `expiresAt < now()`. Shareable-link TTL = 90 days, mirroring `PendingCatalogPush`.

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

**Utility fallback.** If user's utility isn't in the list, show "Don't see your provider?" link → contact form (name/email/phone/message). Submits to `/api/estimator/submit` with `kind: "manual_quote_request"` — **separate from out-of-area**. Creates a contact + deal in HubSpot with `estimator_source: "public_estimator_v2_manual"` and `dealstage` = first stage. No engine run, no results page — deal is a lead for ops to manually quote.

**Step 4 — Contact.** First name / Last name / Email / Phone / Referred by (optional) / Project notes (optional) / reCAPTCHA v3 (invisible badge). "See my estimate" triggers `POST /api/estimator/submit`.

**Step 5 — Results.** Redirects to `/estimator/results/[token]`. Shows:
- System size hero: `NN.N kW` with panel count, offset %, annual kWh, +/− panel count buttons (re-prices live via `/api/estimator/quote`).
- Price card: retail, incentives (itemized with disclosure tooltips), final, monthly payment.
- Add-ons card: toggle EV charger / panel upgrade (re-prices live).
- Assumptions + small print.
- CTA: "Schedule Consultation" — links to existing `/free-solar-estimate` page (not Calendly). Changeable later.

---

## Submit Sequence

`/api/estimator/submit` accepts three `kind` values — `quote`, `out_of_area`, `manual_quote_request` — with different handling. Order-of-operations is intentional: **local persistence comes before HubSpot writes** so we never lose a submission if HubSpot is down.

**Kind `quote` (in-area, happy path)** — engine already ran on client side via `/api/estimator/quote`; we re-run server-side to prevent tampering, then:

1. **Idempotency check** — hash key per the Idempotency section below. If hit, return the existing token. No further writes.
2. **Verify reCAPTCHA** — if score < 0.3, reject with 403. If 0.3–0.5, accept but set `flaggedForReview: true`.
3. **Re-run engine server-side** with inputs; compare to client result. If drift > 1%, log Sentry warning but continue with server result.
4. **Persist `EstimatorRun`** with `hubspotContactId=null`, `hubspotDealId=null`. Commit token. From here, the results page works even if HubSpot fails.
5. **Upsert HubSpot contact** — dedupe by email. Create/update with `firstname`, `lastname`, `email`, `phone`, address fields (triggers existing Property webhook). `lifecyclestage: lead`. Patch `EstimatorRun.hubspotContactId`.
6. **Create HubSpot deal** — pipeline `HUBSPOT_PIPELINE_SALES`, first stage. Associate to contact. Set the 14 `estimator_*` deal properties listed in the HubSpot Custom Properties section. Patch `EstimatorRun.hubspotDealId`.
7. **Email result link** — `EstimatorResultsEmail.tsx` with link to `/estimator/results/[token]`. Failure logs Sentry warning; does not fail submit.
8. **Activity log** — write `ActivityLog` with `ActivityType.ESTIMATOR_SUBMISSION`.
9. **Return** `{ token }`.

If steps 5–7 fail, the `EstimatorRun` already exists (step 4). A reconcile cron (`/api/cron/estimator-hubspot-reconcile`, daily) retries rows where `hubspotDealId IS NULL AND createdAt < now() - 15min AND outOfArea = false AND manualQuoteRequest = false`.

**Kind `out_of_area`** — skip engine re-run (no engine input in the first place). Skip step 6 (no deal). Contact created with `lifecyclestage: marketingqualifiedlead` and `waitlist_zip` property. Email template: waitlist acknowledgement. Activity type: `ESTIMATOR_OUT_OF_AREA`. `outOfArea: true` on the run.

**Kind `manual_quote_request`** (utility fallback) — skip engine. Create contact + deal (same as quote), but with `estimator_source: "public_estimator_v2_manual"`. Set deal stage first stage. No `estimator_*` numeric properties (engine never ran). Activity type: `ESTIMATOR_SUBMISSION` (with a distinguishing metadata field). Email template: "we'll reach out to quote your system manually." `manualQuoteRequest: true` on the run.

**Idempotency** — use existing `IdempotencyKey` model. Key shape:

- In-service-area submits: `estimator:v2:${sha256(email)}:${normalizedAddressHash}:${YYYY-MM-DD}`
- Out-of-area (no address hash): `estimator:v2:oos:${sha256(email)}:${zip}:${YYYY-MM-DD}`

Scoped by day so a customer resubmitting after a week creates a fresh run. Match the pattern in `portal/survey/*`.

---

## HubSpot Custom Properties (human action required)

These deal + contact properties must be created in HubSpot admin **before** `/api/estimator/submit` is enabled in production. They cannot be created programmatically with the access token we use.

**Deal properties** (pipeline: `HUBSPOT_PIPELINE_SALES`):

Slim 3-property set so it fits portals near their custom-property cap. Numeric detail is packed into `estimator_summary`; ops pulls the full snapshot via `estimator_results_token`.

| Property | Type | Group |
|---|---|---|
| `estimator_source` | Single-line text | Estimator |
| `estimator_results_token` | Single-line text | Estimator |
| `estimator_summary` | Multi-line text | Estimator |

**Contact properties** (for out-of-area waitlist leads):

| Property | Type | Group |
|---|---|---|
| `waitlist_zip` | Single-line text | Marketing |

Deal property mapping uses the existing `src/lib/deal-property-map.ts` (additive only — do not modify existing mappings).

**Pipeline first stage** — resolved decision: use existing first stage of `HUBSPOT_PIPELINE_SALES`. Do not add a new "Estimator Lead" stage in v1. If ops later needs to filter estimator-sourced deals, they use the `estimator_source` property.

---

## Environment Variables (human action required)

New env vars — must be added to `.env.example`, local `.env`, and Vercel prod env before rollout (per prior incident: sync Vercel prod env before new-integration rollout).

| Var | Context | Purpose |
|---|---|---|
| `NEXT_PUBLIC_ESTIMATOR_V2_ENABLED` | public | Feature flag for UI entry points |
| `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` | public | reCAPTCHA v3 client |
| `RECAPTCHA_SECRET_KEY` | server | reCAPTCHA v3 verify |
| `IP_HASH_SALT` | server | Salt for hashing IPs in `EstimatorRun.ipHash` |
| `NEXT_PUBLIC_GOOGLE_PLACES_API_KEY` | public | Address autocomplete (Step 1) — reuse existing key if one is already configured; verify before provisioning new |
| `GOOGLE_MAPS_STATIC_API_KEY` | server | Static satellite tile for roof confirm (Step 2) — server-side proxy endpoint so the key is not exposed client-side |

Verify whether existing Google keys already cover Places Autocomplete + Static Maps before creating new ones. The `lib/property-sync.ts` geocoding flow uses a Google key — check scope before reusing.

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

## Analytics

The "parallel analytics" language in the Swap-In Plan depends on having analytics wired. v1 instrumentation:

- **Server-side**: `ActivityLog` entries with `ActivityType.ESTIMATOR_SUBMISSION` (new enum value — requires Prisma migration) and `ActivityType.ESTIMATOR_OUT_OF_AREA` capture the conversion funnel on our side.
- **Client-side**: if the marketing site already has GA4 / PostHog, add matching page-view + step-transition events. If not, `ActivityLog` + Sentry breadcrumbs are sufficient for v1. Do not add a new analytics SDK just for this.

Funnel metrics queryable from `EstimatorRun` + `ActivityLog`: visitors → address entered → in-service-area → usage submitted → contact submitted → deal created → consultation scheduled.

---

## Default Panel Source (resolved)

The default panel used for sizing is resolved at API-layer boundary time, not hardcoded in `pricing.json`:

1. Query `InternalProduct` where `category = 'MODULE'` AND `defaultForEstimator = true`.
2. If exactly one found, use its `ModuleSpec.wattage`.
3. If zero or multiple found, fall back to a hardcoded `FALLBACK_PANEL_WATTAGE = 440` constant in `lib/estimator/constants.ts` and log a Sentry warning tagged `estimator:no_default_panel`.

**Schema change**: add `defaultForEstimator Boolean @default(false)` to `InternalProduct`. Migration lands with the estimator migration.

`pricePerWatt` stays in `pricing.json` — it's a location-based commercial number, not a catalog property.

---

## Prisma Migrations Summary (human action)

A single migration lands for Phase 1. Contents:

1. New model: `EstimatorRun` (all fields/indexes above)
2. New enum values on `ActivityType`: `ESTIMATOR_SUBMISSION`, `ESTIMATOR_OUT_OF_AREA`
3. Add `defaultForEstimator Boolean @default(false)` to `InternalProduct`

Per the "Prisma migration must land before code" memory: this migration must be applied to production **before** the Vercel deploy that contains the estimator code, because the client regen on build would otherwise query fields that don't exist.

---

## Open Questions (deferrable during implementation)

1. **Waitlist-notify email template** — reuse `ProductUpdate.tsx` pattern or new template?
2. **Consultation CTA destination** — `/free-solar-estimate` today; revisit if Chili Piper / Calendly gets adopted.

These don't block the spec; they're implementation-time decisions.
