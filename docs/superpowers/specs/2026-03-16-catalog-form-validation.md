# Catalog Form Validation & Feedback Improvements

## Problem

The product submission form (`/dashboards/submit-product`) has four UX gaps:

1. **No numeric validation** — `unitCost`, `sellPrice`, `length`, `width`, `weight`, and category spec number fields accept negative values and nonsensical input (e.g., -5 lbs, $-100). Server doesn't validate these either — bad values reach the DB.
2. **No inline field-level errors** — Validation errors only surface on the Review step (step 3). Users fill Basics and Details blind, then see a wall of "Missing" labels. Required fields on Basics/Details should show errors on blur.
3. **No photo upload client feedback** — The upload area says "up to 5MB" but doesn't validate before sending. Users get a generic "Upload failed" error after waiting for a large file to transfer. File type mismatches also only fail server-side.
4. **Vendor pair can be half-set** — The `SET_VENDOR` action always sets both `vendorName` and `zohoVendorId` together, and clearing `vendorName` via `SET_FIELD` already clears `zohoVendorId` (line 81-83 of `catalog-form-state.ts`). So the reducer invariant is sound. But the VendorPicker doesn't guard against the vendor list being stale — a user could have a `zohoVendorId` from a clone that no longer exists in the `VendorLookup` table. The `includeId` param on the GET handles this for display, but if the vendor was deleted from Zoho entirely, the form submits a dangling ID.

## Scope

4 changes, all client-side. No API changes, no schema changes, no new dependencies.

### 1. Numeric validation

**Where:** `validateCatalogForm()` in `src/lib/catalog-form-state.ts`, plus `FieldDef` in `src/lib/catalog-fields.ts`.

**What:**
- Add optional `min` and `max` to `FieldDef` for category spec fields. Apply per-field, not as a blanket default:
  - `min: 0` for fields that are physically non-negative: wattage, efficiency, voltage, current, capacity, power, wind/snow ratings, etc.
  - **No min** for `tempCoefficient` — module temperature coefficients are legitimately negative (typically -0.3 to -0.4 %/°C).
  - `max: 100` for percentage fields (`efficiency`, `roundTripEfficiency`) as a sanity check.
  - No min/max for fields where the domain isn't obvious — omitting is safer than guessing wrong.
- In `validateCatalogForm()`, add validation for the top-level numeric fields:
  - `unitCost`: if non-empty, must be >= 0
  - `sellPrice`: if non-empty, must be >= 0
  - `length`: if non-empty, must be > 0
  - `width`: if non-empty, must be > 0
  - `weight`: if non-empty, must be > 0
- In `validateRequiredSpecFields()`, add range checks for spec fields that have `min`/`max` defined.
- All these are non-blocking **warnings** for pricing (unit cost/sell price can be 0 for free items) and blocking **errors** for dimensions/weight (negative dimensions are always wrong).
- Existing sell-price-less-than-cost warning stays as-is.

**Behavior:** Validation runs on blur and on step transitions. Invalid fields get a red border and inline error text below the input.

### 2. Inline field-level errors

**Where:** `BasicsStep.tsx`, `DetailsStep.tsx`, `CategoryFields.tsx`.

**What:**
- Pass `ValidationError[]` down from the parent page to `BasicsStep` and `DetailsStep`. The parent already calls `validateCatalogForm(state)` — just thread the result.
- Each step filters errors to its own `section` ("basics" or "details") and shows a red border + small error message below the relevant input when that field has an error.
- Track a `Set<string>` of "touched" fields. A field becomes touched on `blur` or when the user clicks "Next" on that step. Only show errors for touched fields (prevents flashing errors on initial load).
- On "Next: Details →" click, mark all Basics fields as touched and show any errors. Same for "Next: Review →" on Details.
- The Review step continues to show the full error summary as today — this just adds early feedback.

**UI pattern:**
```
[Label] *
[input with red ring]
  ↳ "Brand is required"     ← small red text, appears on blur if empty
```

### 3. Photo upload client feedback

**Where:** `DetailsStep.tsx`, `handlePhotoUpload()`.

**What:**
- Before calling `fetch`, validate:
  - File size <= 5MB — show error: "File too large (X MB). Maximum is 5 MB."
  - File type in `['image/jpeg', 'image/png', 'image/webp', 'image/gif']` — show error: "Unsupported file type. Use JPEG, PNG, WebP, or GIF."
- Use the existing `photoError` state and error display — just set it before the upload starts.
- Clear the file input value on rejection so the user can re-select.

### 4. Vendor pair invariant

**Where:** `VendorPicker.tsx`, `validateCatalogForm()` in `catalog-form-state.ts`.

**What:**

The reducer invariant is already correct (SET_VENDOR always pairs name+id, SET_FIELD on vendorName clears id). No reducer changes needed.

The real failure mode is a **stale `zohoVendorId`**: a product cloned or imported with a vendor ID that no longer exists in the `VendorLookup` table (vendor was deleted from Zoho). The form would submit a dangling ID.

**Fix — validate the selected ID against the fetched list:**
- `VendorPicker` already fetches the vendor list on mount (with `includeId` to show inactive vendors). After the fetch completes, check whether the current `zohoVendorId` (from props) exists in the returned list.
- If `zohoVendorId` is set but NOT found in the fetched vendors: call `onChange("", "")` to clear the pair, move the stale `vendorName` to the hint slot, and show an amber info line: "Previously selected vendor is no longer available. Please re-select."
- This runs once on mount, not on every render — use a `useEffect` keyed to the vendor list load completing.

**Additional improvements:**
- Add a validation **warning** (non-blocking) in `validateCatalogForm()`: if `vendorName` is non-empty but `zohoVendorId` is empty, warn "Vendor selected without Zoho ID — product won't sync to Zoho Inventory."
- Make the hint visible as a persistent subtle amber line below the input when the dropdown is closed (currently only shows as placeholder text on focus).

## Files to modify

| File | Changes |
|---|---|
| `src/lib/catalog-fields.ts` | Add optional `min`/`max` to `FieldDef`, add per-field ranges (most `min: 0`, skip `tempCoefficient`, cap percentages at 100) |
| `src/lib/catalog-form-state.ts` | Add numeric range checks + vendor pair warning to `validateCatalogForm()` |
| `src/components/catalog/BasicsStep.tsx` | Accept errors prop, track touched fields, show inline errors |
| `src/components/catalog/DetailsStep.tsx` | Accept errors prop, track touched fields, show inline errors, add client-side photo validation |
| `src/components/catalog/CategoryFields.tsx` | Accept errors prop, show inline errors for spec fields |
| `src/components/catalog/VendorPicker.tsx` | Validate `zohoVendorId` against fetched list on mount, clear stale IDs to hint, show persistent hint line |

No new files.

## Out of scope

- Server-side numeric validation (good future backstop, separate PR)
- `isActive` toggle on creation form
- System IDs on creation form
- Unsaved-changes warning / autosave
- Edit page changes (different UX, separate effort)
- Free-entry brand fallback
