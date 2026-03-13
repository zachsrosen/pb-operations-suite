# Catalog New Product Form — Wizard Redesign

**Date:** 2026-03-13
**Status:** Approved
**Scope:** `/dashboards/catalog/new` form UX overhaul

## Problem

The current catalog new product form has 30+ fields on a single page. Three pain points:

1. **Too many fields at once** — overwhelming for all users, especially non-technical roles
2. **Unclear what to enter** — fields like Unit Spec, Unit Label, and category specs lack guidance
3. **Slow for common tasks** — no shortcuts for cloning variants or importing from datasheets

The form serves both ops (who know specs) and sales/PMs (who often only know brand + model + category). The current single-page layout forces everyone through the same 30-field experience.

## Design

### Wizard Structure

Replace the single-page form with a 4-step wizard and top progress bar:

```
[Start] → [Basics] → [Details] → [Review & Submit]
```

Navigation: Back/Next buttons at bottom. "Skip to Review" link on Step 2. Data persists in React state across steps (no page reloads).

### Step 0 — Start Mode

Three cards:

| Mode | Description |
|------|-------------|
| **Start from Scratch** | Blank wizard — current default behavior |
| **Clone Existing Product** | Search catalog, select a product, wizard opens pre-filled |
| **Import from Datasheet** | Upload PDF or paste text, AI extracts fields |

### Step 1 — Basics (required fields only)

- Category selection (16-button grid, unchanged)
- Brand (existing searchable dropdown with custom entry)
- Model / Part # (required text)
- Description (required textarea)
- Live duplicate check as brand+model are typed — shows inline match below model field

This step is the minimum viable submission. Sales/PMs can complete it in 30 seconds.

### Step 2 — Details (all optional)

- Header: "These fields are optional — fill what you have, skip the rest"
- Category-specific spec fields (dynamic, same field definitions as today)
- Pricing: Unit Cost, Sell Price
- Physical: Unit Spec, Unit Label, Dimensions (L/W), Weight
- Vendor: Vendor Name, Vendor Part #, SKU
- Hard to Procure toggle
- Every non-obvious field has a `?` tooltip with description + example

### Step 3 — Review & Submit

- Read-only summary card of all entered data (empty optionals shown as "—")
- System checkboxes: Internal (always on), HubSpot, Zuper, Zoho
- Sanity warnings (e.g., sell price < cost)
- "Submit for Approval" button

## Clone Existing Product

**Search:** Same search index as main catalog page (brand, model, description, vendor part).

**Results:** Compact cards showing category badge + brand + model + sync status.

**Pre-fill behavior:**
- All fields copied from source product
- SKU and vendor part # cleared (must be unique)
- Pre-filled fields get green left-border highlight + "Cloned" badge
- External IDs not copied — this creates a new product
- Approval status starts as PENDING

## Datasheet Import (AI-Assisted)

### Input

Two options side by side on the Start Mode screen:
- **Upload PDF** — drag-and-drop or file picker, `.pdf` only, max 10MB
- **Paste Specs** — textarea for copied text from websites or datasheets

### Processing

1. Content sent to `/api/catalog/extract-from-datasheet`
2. PDF converted to text server-side (pdf-parse or similar)
3. Claude API extracts structured fields via tool_use for reliable JSON output
4. Returns field values mapped to the form schema

### Auto-Fill Behavior

- Wizard jumps to Step 1 with extracted fields pre-populated
- Auto-filled fields get blue left-border highlight + "AI" badge
- Editing a field removes the highlight
- Fields Claude couldn't determine are left blank (no guessing)
- Confidence banner: "Extracted 12 of 18 fields from your datasheet. Please review."

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Bad/unreadable PDF | Error: "Couldn't extract product info. Try pasting specs as text." |
| Multi-product datasheet | Extract first product, note "Multiple products detected" |
| No matching category | Leave category unselected, user picks manually |

### Tech

- Claude API with Anthropic SDK (already in project)
- pdf-parse for PDF-to-text
- Structured output via `tool_use` for reliable JSON extraction

## UX Polish

### Field Help

- `?` icon next to every non-obvious field label
- Tooltip shows one-line description + example value
- Examples:
  - "Unit Spec" → "The numeric rating (e.g., 400 for a 400W module)"
  - "Hard to Procure" → "Flag if lead times exceed 4+ weeks"

### Required vs Optional

- Required fields: red asterisk
- Optional fields: "(optional)" in muted text
- Step 2 header reinforces that everything is optional

### Smart Defaults by Category

| Category | Unit Label | Default Systems |
|----------|-----------|----------------|
| MODULE | W | Internal + HubSpot + Zuper + Zoho |
| BATTERY | kWh | Internal + HubSpot + Zuper + Zoho |
| INVERTER | kW | Internal + HubSpot + Zuper + Zoho |
| EV_CHARGER | A | Internal + HubSpot + Zuper + Zoho |
| SERVICE | — | Internal + Zoho |
| ADDER_SERVICES | — | Internal + Zoho |
| Others | — | Internal + HubSpot + Zuper + Zoho |

### Validation

- Inline field validation (red border + message) replaces single bottom banner
- Step 1 duplicate check: "Similar product exists: [name] — did you mean to clone it?"
- Step 3 sanity checks: sell price < cost warning, empty description warning

### Responsive

- Wizard steps stack on mobile
- Progress bar becomes compact dots on small screens
- Touch-friendly category buttons with increased padding

## File Changes (Expected)

| File | Change |
|------|--------|
| `src/app/dashboards/catalog/new/page.tsx` | Rewrite as multi-step wizard |
| `src/components/catalog/WizardProgress.tsx` | New — progress bar component |
| `src/components/catalog/StartModeStep.tsx` | New — step 0 with 3 mode cards |
| `src/components/catalog/BasicsStep.tsx` | New — step 1 required fields |
| `src/components/catalog/DetailsStep.tsx` | New — step 2 optional fields |
| `src/components/catalog/ReviewStep.tsx` | New — step 3 summary + submit |
| `src/components/catalog/CloneSearch.tsx` | New — catalog search for cloning |
| `src/components/catalog/DatasheetImport.tsx` | New — PDF upload + paste UI |
| `src/app/api/catalog/extract-from-datasheet/route.ts` | New — AI extraction endpoint |
| `src/components/catalog/FieldTooltip.tsx` | New — help tooltip component |
| `src/lib/catalog-fields.ts` | Update — add tooltip text + default values per category |
| `src/components/catalog/CategoryFields.tsx` | Update — add tooltip integration |
| `src/components/catalog/BrandDropdown.tsx` | Minor — unchanged or small tweaks |
