# Artemis Pricing Runbook

How to manage Photon Brothers pricing in **Artemis** (sales.artemis.solar): markets, base prices,
inverters, adders, discounts, financiers, and standing up a whole new market/team. Written so any of
this can be redone or extended at any time.

> **Context:** Artemis is **replacing OpenSolar**. OpenSolar was cost-plus (it computed COGS + labour
> + margin). Artemis is **retail-only** — you enter final marked-up prices, there is no cost layer.
> Any cost/margin visibility PB needs has to be built in Artemis or tracked elsewhere; OpenSolar will
> not be there to fall back on.

---

## 1. The mental model

### Teams and pricing profiles
- Artemis has **Teams**. Each team has **one pricing profile**.
- A rep picks a **Team** when creating a project; that team's profile drives the price. (Zip-code
  routing can auto-pick the team by project location once it's configured.)
- We use **one team = one markup scheme = one region**.

| Team | Pricing profile | Market(s) | Markup |
|---|---|---|---|
| Photon Brothers Direct | Photon Brothers Direct's Pricing | Colorado (CO) | **40%** |
| Photon Brothers Ventura | Photon Brothers Ventura Pricing | California (CA) — SLO / Camarillo | **36%** |
| Photon Brothers Bay Area | Photon Brothers Bay Area Pricing | California (CA) — Bay Area | **50%** |

> **Why separate profiles per markup?** Adders (roofs, MPU, inverters, etc.) are **shared across all
> markets within a single profile** — only the *base price per watt* is per-market. So two markup
> schemes cannot share one profile without the adders being wrong for one of them. Each markup scheme
> needs its own team + profile. (Not yet migrated: D&R 30%, Off-Grid 65%.)

IDs (handy for the API path in §7):

| | Team ID | Pricing profile ID |
|---|---|---|
| Direct (CO) | `34cfe4eb-7d00-455b-8baf-c01aeab2e06a` | `9b8c55f0-5e2f-4d67-824c-a00ac6e51a03` |
| Ventura | `fa75b3a6-3789-4d23-a2d7-3b12ff4c81a0` | `8eb816cc-7b7f-46c5-a146-15e5b1e54ecd` |
| Bay Area | `307ec22a-e913-483d-bbc6-3b27fbf3a982` | `4fe42ba1-22ff-4918-afad-c6ccb7eb2963` |

### The pricing math
Every retail number in Artemis is:

```
retail = (component cost + labour) × 1.05 (commission) × (1 + markup)
```

Markups: **CO/Base 40%, Ventura 36%, Bay Area 50%** (also D&R 30%, Off-Grid 65% if we add them).
Source of truth for costs is our OpenSolar cost model (documented in
`src/lib/pricing-calculator.ts` and the pricing memory) until OpenSolar is retired.

**House rule:** on the 2-decimal per-watt fields, **always round UP** (margin-protective), never down.

### What lives where (profile tabs)
Settings → Pricing → *[profile]* → tabs across the top:
- **Markets** — which states, base price per watt per state, and per-state financiers.
- **Panels / Batteries / Inverters** — equipment + per-unit or $/W adders.
- **Adders & Discounts** — Photon Brothers Adders, State Incentives, Battery/Other Equipment,
  Electrical Upgrades, Roof Types, Ground Mounts, Accessories & Services, Discounts.
- **System Size** — the hidden fixed per-project adder (soft-cost intercept).
- **PPW Curves / Automations / Bundles / Project Rules** — advanced.

### Draft → publish
- Every edit auto-saves to a **draft** (bottom bar shows "Draft — last updated …").
- Nothing reaches reps until you click **Apply Changes** and confirm:
  - **"Apply to future proposals only"** — safe default.
  - **"Apply to future and existing unsigned proposals"** — also updates open quotes.
- ⚠️ **Existing proposals are pinned to the pricing version they were created on.** Even "future and
  existing unsigned" does **not** re-price an already-created project in practice. **To verify a
  change, always create a NEW project** (see §8).

---

## 2. Change a base price (per market)

1. Settings → Pricing → *[profile]* → **Markets**.
2. Find the state row → click the **⋮** menu → **Edit state** (or click into the state).
3. Edit **Base Price** (top-right, "PPW"). Round **up** to 2 decimals.
4. Click out / Tab to commit → confirm the draft "last updated" time changes.
5. **Apply Changes** when ready.

Current bases: CO **$2.43**, Ventura CA **$2.36**, Bay CA **$2.60** (these are the *no-inverter*
baselines — see §4).

---

## 3. Add or enable a financier (e.g. Participate Energy)

Financiers/lenders are enabled **per state** on a profile.

1. Settings → Pricing → *[profile]* → **Markets** → open the state (**⋮ → Edit state**).
2. In the **Financiers** multi-select, check the financier (e.g. **"Participate Energy Pre-paid
   Lease"**). It appears as a chip.
3. **Apply Changes.**

Notes:
- **Participate Energy** is a `pre-paid-lease` lender that's already active at the installer level
  (Settings → Installer → Financiers, badge "Pre-paid Lease", "No configuration needed"). You only
  need to enable it per-state on each profile.
- Enabling it makes PE selectable and shows Gross vs **Net** cost on the payment card.
- **Do this on every profile that sells in that state.** PE is sold in **both CO and CA** — that's
  three markets across two-plus profiles (Direct-CO, Direct-CA/Ventura, Bay Area). It's easy to
  forget Bay Area is a *separate* profile.

---

## 4. Inverters

Base price is the **no-inverter** cost. Each inverter carries its own adder on top:

| Inverter | Adder | Why |
|---|---|---|
| Tesla Inverter (integrated / Powerwall 3) | **$0** | Bundled into the Powerwall price |
| Enphase IQ8 Microinverter | **+$/W** (CO $0.54, Ven $0.52, Bay $0.58) | Micros are a separate cost (~$160/panel) |
| Tesla Solar Inverter (standalone) | **Per Unit $** (CO $1,764, Ven $1,713.60, Bay $1,890) | Standalone string inverter, ~$1,200 cost |

> **Why this structure:** a flat base PPW can't tell inverter types apart. A Tesla PW3 system has a
> $0-cost integrated inverter; an Enphase system pays for micros. Keeping the base at the no-inverter
> baseline and adding the inverter's real cost as an adder makes every configuration price correctly.
> **A solar-only Tesla system with no standalone Tesla inverter prices to $0** — that's the bug that
> prompted adding the standalone "Tesla Solar Inverter."

### Add an inverter (UI)
1. Inverters tab → **Add Inverter**.
2. **Display Name**, **Manufacturer** (pick from catalog, e.g. Enphase / Tesla).
3. **Model** — select from the catalog; specs auto-fill.
4. Leave **Matching Batteries** empty for a general/solar-only inverter (e.g. Enphase micros); the
   Tesla integrated matches Powerwall 3.
5. Set **Adder**, **Enabled**, **Available in all states**, click **Add**.
6. On the inverter's list row, set the **Pricing** dropdown:
   - **"Adder (System Size) ($/Watt)"** for per-watt (micros).
   - **"Per Unit ($ per Unit)"** for a flat per-inverter cost (string inverters) — also scales
     correctly if a big system needs two.
7. **Apply Changes.**

> ⚠️ **The Add/Edit drawer often renders off-screen** and its form state **persists across
> navigation**. If it's misbehaving or reusing an old record, **hard-reload the page** (⌘R) and
> reopen. Add models **one at a time** — adding several in one session tends to overwrite each other.
> Click **Add** exactly once and verify (it can double-submit and create a duplicate; delete a
> duplicate via the row's **Edit → Delete** in the drawer footer — there's no delete on the row menu).

---

## 5. Adders, roofs, and discounts

Adders & Discounts tab. Each section has an **Add …** button; each row has a **⋮ → Edit …**.

### Calculation methods
When adding an adder you pick a **Calculation method**. The useful ones:

| Method | Meaning |
|---|---|
| **Fixed ($)** | Flat dollar amount (e.g. MPU $4,410) |
| **Per Unit ($ per Unit)** | Flat $ per quantity |
| **System Size (fixed) ($ per Watt)** | $/W × system size (roofs, story/pitch) |
| **By Solar Panel (fixed) ($ per Panel)** | Auto × panel count (module adder for itemization) |
| **Percent (%)** | % of final price before incentives (discounts — e.g. PE −30%) |

> **Every method is single-mode.** No adder can be *fixed + per-watt* at once. See Tile Clay below.

### Roof types (current, all four real OpenSolar types + Tile Clay)
Roof adder = OS roof cost × markup (no commission on roof). Method = **System Size (fixed) $/W**.

| Roof | CO | Ventura | Bay |
|---|---|---|---|
| Flat Membrane / Tile Concrete / Tar & Gravel / Flat Concrete | $0.49/W | $0.48/W | $0.53/W |
| **Tile Clay** (per-watt part) | $1.12/W | $1.09/W | $1.20/W |

> Metal Roof and Wood Shake were **invented by the old reverse-engineered model and are not in
> OpenSolar** — they were renamed into Tile Concrete / Tar & Gravel (you can't delete a roof from the
> row menu; rename via Edit, or delete inside the Edit drawer).

**Tile Clay = two adders** (fixed + per-watt can't be one row):
1. Roof row **"Tile Clay Roof"** — System Size (fixed), the **$/W** part.
2. Accessory **"Tile Clay Roof - Fixed"** — Fixed ($): **CO $4,900 / Ventura $4,760 / Bay $5,250**.
- ⚠️ A rep who picks Tile Clay and forgets the fixed companion **underprices by ~$5k**. Workaround:
  a **Bundle** ("Clay Tile Roof") holding both — but bundles may *replace* a rep's other adders
  (open question with Artemis, see §9). `FORMULA QTY` is a **read-only indicator**, not an editable
  formula — you can't author fixed+per-watt through it.

> ⚠️ **A newly added roof/adder defaults to `Fixed ($)`** — remember to switch its Pricing dropdown
> to **System Size (fixed)** or it saves as a flat dollar amount.

### Electrical / accessories (current)
| Item | CO | Ventura | Bay |
|---|---|---|---|
| Main Panel Upgrade | $4,410 | $4,284 | $4,725 |
| Tesla Wall Connector (Gen 3) | $882 | $856.80 | $945 |
| New Sub Panel | $2,000 | $2,000 | $2,000 (demo data — reconcile) |

### Story / pitch (dropdown adders)
"Roof - Number of Stories" and "Roof - Pitch" are **Select (dropdown)** adders — each option has its
own $/W. Edit them inside the adder's Edit drawer (or via API, §7).

| Option | CO | Ventura | Bay |
|---|---|---|---|
| 2 Stories | $0.07/W | $0.07/W | $0.075/W |
| 3+ Stories | $1.16/W | $1.13/W | $1.245/W |
| Steep pitch (34–44°) | $0.49/W | $0.48/W | $0.53/W |
| Very steep (>44°) | $0.70/W | $0.68/W | $0.75/W |

### Discounts — the Participate Energy 30% (lease)
PE is modeled as a **discount that turns the quote into the lease's net (70%)**:
1. Adders & Discounts → **Add Discounts**.
2. Name **"Participate Energy"**; **Calculation method = Percent (%)** ("of the final price before
   incentives"); **Percentage applies to = Global (full project total)**; **Discount amount = −30**.
3. Check **"Hide adder from proposal"**.
4. On the row, check **ALWAYS INCLUDED** (this sets `isDefault`).
5. **Apply Changes.**

> **Default-on + hidden is intentional:** PE is the default, and a salesperson *removes* it on a
> non-PE deal. This makes Net = 70% of the full replacement-system cost. (Note: the old
> `federal_incentive: 30%` ITC field is **stale** — the ITC is gone; PE's 30% is the mechanism now.
> Two 30% discounts must never both apply.)

### System Size adder (the fixed intercept)
A hidden per-project fixed $ that carries soft costs (lead-gen fixed, salary, PM, design, permit):
**CO $3,150 / Ventura $3,060 / Bay $3,375** (= $2,250 × markup). Set on the **System Size** tab (or
`basic_pricing.system_size_charges` via API).

---

## 6. Stand up a new market / team (the "Ventura split")

Use this whenever a region needs its **own markup** (couldn't just be a market on an existing
profile, because adders are profile-shared).

1. **Create the team:** Settings → **Teams** → **Add Team** → Name, Installer = Photon Brothers,
   Type = **Internal** → **Create**.
2. **Clone an existing profile into it** (fastest via API, §7; or Artemis support). Cloning copies
   markets, base prices, all adders, inverters, discounts, and even bundles from the source.
3. **Trim markets** to just the new region (Markets → remove the unwanted state; it warns "removes
   all associated pricing" — that's fine).
4. **Rewrite every adder to the new markup** (base stays per-state; scale all adders by
   `new_markup / old_markup`, or recompute from OS cost × 1.05 × new markup, rounding **up**). The
   API path (§7) does all of these in one write.
5. **Apply Changes** to publish; make sure the profile is **enabled**.
6. **Routing (ops):** assign reps to the team, set **zip-code routing** so the region's zips pick
   the new team, and **only then** remove that region from the old profile — removing it first would
   leave in-region projects on the old team with no pricing.

---

## 7. Fast path — edit pricing via the API

The Artemis app saves through **XMLHttpRequest** (not `fetch`). The write endpoint:

```
PUT  /api/proxy/pricing/{pricingId}/versions/latest
body: {"teamIds":["<teamId>"], "value": { …the full pricing value object… }}
```

Read the current value from `GET /api/proxy/pricing/{pricingId}/details?include[]=lastUpdatedPricingVersion`
(→ `.lastUpdatedPricingVersion.value`), mutate the fields you want, PUT it back, then **Apply
Changes** (or publish) to activate. This is how the 13 Ventura adder changes were made in **one**
write instead of 13 fragile UI edits.

**Clone a profile into another team** (external API — needs the `ARTEMIS_API_KEY`, header
`x-api-key`, in `.env`):

```
POST https://sales-api.artemis.solar/external/v1/teams/{targetTeamId}/pricings
body: {"strategy":"clone","sourceTeamId":"<source TEAM id>","name":"Photon Brothers X Pricing"}
```

Value-object field map (where things live inside `value`):
- `state_pricings.<ST>.basic_pricing.base_price_pw` — per-state base PPW.
- `state_pricings.<ST>.basic_pricing.allowed_financing_types` — enabled financiers per state.
- `inverters[]` — `.adder`, `.units` (`dollar_per_watt` or `quantity` = Per Unit), `.models[]`.
- `roof_types[]` / `electrical_upgrades[]` / `accesories_and_services[]` — `.adder`, `.calculations`,
  `.units`; dropdown adders have `.options[].adder`.
- `discounts[]` — `.adder`, `.calculations:"percent"`, `.isDefault`, `.hideFromProposal`.
- `basic_pricing.system_size_charges[0].adder` — the System Size fixed adder.

> The API path bypasses the flaky drawers entirely and is the recommended way to do bulk changes.
> After a PUT, do a fresh GET to confirm it persisted, then publish.

---

## 8. Verifying a change

Because existing proposals are pinned to old pricing, **verify on a fresh project**:

1. Projects → **New Project** → enter a CO/CA address → pick the right **Team** → step through
   (utility bill, customer). It auto-designs a system.
2. Read the price from the proposal, or via `GET /api/proxy/projects/{id}/pricing`
   (`grossCashPrice`, `totalCashPrice`, `perWattTotal`, `upgradeTotalDiscounts`).
3. Compare against the expected number. During migration, cross-check against OpenSolar for a few
   varied configs (ground mount, multi-battery, micro-only) — this is a **one-time migration check**,
   not an ongoing reconciliation (OpenSolar is being retired).

Reference check: a standard CO Tesla PW3 system (28× Hyundai 440 + 1 PW3 + MPU + flat membrane)
should be ~**$58,600** (residual vs OpenSolar's $58,583 is the deliberate base round-up, in PB's
favor).

---

## 9. Gotchas & pitfalls (learned the hard way)

- **Existing proposals are pinned** to their pricing version — verify on a NEW project (§8).
- **Add/Edit drawers render off-screen** and **persist form state across navigation** — hard-reload
  (⌘R) to reset; drive number/text fields with real keystrokes.
- **Adding multiple inverter models in one drawer session overwrites them** — do one model per entry,
  or add models one at a time with a save between.
- **Clicking "Add" can double-submit** → duplicate row. Verify after; delete via Edit-drawer footer.
- **New adders default to `Fixed ($)`** — switch to the intended method (e.g. System Size $/W).
- **Round UP** on 2-decimal per-watt fields (house rule).
- **`FORMULA QTY` is read-only** — can't author fixed+per-watt in one adder.
- **Bundles may *replace* a rep's equipment/adders** ("A rep selects a bundle … to replace its
  equipment and adders") — confirm additive-vs-destructive before pointing reps at the Tile Clay
  bundle.
- **A financier/adder change must be repeated on every profile** that sells in that region (three
  markets across the Direct + Ventura + Bay profiles).
- Two pre-existing base-config fields to review: `basic_pricing.dealer_fee_percentage: 0.34` (34%
  dealer fee?) and `basic_pricing.small_system_charges` (small-system $/W uplift not in the OS model).

---

## 10. Open questions for Artemis

1. **Can one adder be fixed + per-watt** (how is a "custom quantity formula" authored)? Would collapse
   Tile Clay into one row.
2. **Can an Automation Rule condition on a selected adder/roof material?** Today roof conditions are
   only geometry (Flat / Pitched / Ground Mount); a `Custom Property` ("Roof Material") might work.
3. **Is Bundle selection additive or destructive?** (Determines whether the Tile Clay bundle is safe.)
4. **Where does cost / margin visibility live** now that Artemis (retail-only) is replacing OpenSolar?
5. Per-inverter-architecture base pricing, 2-decimal rounding precision, dealer-fee confirmation.
