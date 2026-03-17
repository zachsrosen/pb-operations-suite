# Catalog Form Validation & Feedback Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add numeric validation, inline field-level errors, photo upload client feedback, and stale vendor ID detection to the product submission form — all client-side, no API changes.

**Architecture:** Extend `FieldDef` with optional `min`/`max`, add numeric range checks + vendor warning to `validateCatalogForm()`, thread validation errors + touched-field tracking into `BasicsStep`/`DetailsStep`/`CategoryFields`, add client-side file size/type guards before photo upload, and validate `zohoVendorId` against the fetched vendor list on mount in `VendorPicker`.

**Tech Stack:** Next.js 16.1, React 19.2, TypeScript 5, Jest (unit tests)

**Spec:** `docs/superpowers/specs/2026-03-16-catalog-form-validation.md`

---

## File Structure

| File | Role | Changes |
|------|------|---------|
| `src/lib/catalog-fields.ts` | Field definitions | Add optional `min`/`max` to `FieldDef`, set per-field ranges |
| `src/lib/catalog-form-state.ts` | Validation logic | Add numeric range checks for top-level + spec fields, vendor pair warning |
| `src/components/catalog/BasicsStep.tsx` | Step 1 UI | Accept errors/touched props, show inline errors on blur + Next click |
| `src/components/catalog/DetailsStep.tsx` | Step 2 UI | Accept errors/touched props, show inline errors, add photo client validation |
| `src/components/catalog/CategoryFields.tsx` | Spec field renderer | Accept errors prop, show inline errors per spec field |
| `src/components/catalog/VendorPicker.tsx` | Vendor autocomplete | Validate zohoVendorId against fetched list, clear stale IDs, persistent hint |
| `src/app/dashboards/submit-product/page.tsx` | Wizard orchestrator | Thread validation errors down, manage touched-field state |
| `src/__tests__/lib/catalog-fields.test.ts` | Tests | Add tests for new min/max on FieldDef |
| `src/__tests__/lib/catalog-form-state.test.ts` | Tests | Add tests for numeric validation errors + vendor warning |

---

## Chunk 1: Numeric Validation (Tasks 1-2)

### Task 1: Add `min`/`max` to `FieldDef` and set per-field ranges

**Files:**
- Modify: `src/lib/catalog-fields.ts:2-16` (FieldDef interface)
- Modify: `src/lib/catalog-fields.ts:36-148` (category field definitions)
- Test: `src/__tests__/lib/catalog-fields.test.ts`

- [ ] **Step 1: Write the failing test for FieldDef min/max**

In `src/__tests__/lib/catalog-fields.test.ts`, add a new `describe` block at the end (before the closing `});` of the top-level describe):

```typescript
describe("FieldDef min/max ranges", () => {
  test("MODULE wattage has min: 0", () => {
    const fields = getCategoryFields("MODULE");
    const wattage = fields.find((f) => f.key === "wattage");
    expect(wattage?.min).toBe(0);
  });

  test("MODULE efficiency has min: 0 and max: 100", () => {
    const fields = getCategoryFields("MODULE");
    const efficiency = fields.find((f) => f.key === "efficiency");
    expect(efficiency?.min).toBe(0);
    expect(efficiency?.max).toBe(100);
  });

  test("MODULE tempCoefficient has NO min (legitimately negative)", () => {
    const fields = getCategoryFields("MODULE");
    const tempCoeff = fields.find((f) => f.key === "tempCoefficient");
    expect(tempCoeff?.min).toBeUndefined();
    expect(tempCoeff?.max).toBeUndefined();
  });

  test("BATTERY roundTripEfficiency has min: 0 and max: 100", () => {
    const fields = getCategoryFields("BATTERY");
    const rte = fields.find((f) => f.key === "roundTripEfficiency");
    expect(rte?.min).toBe(0);
    expect(rte?.max).toBe(100);
  });

  test("RACKING windRating has min: 0", () => {
    const fields = getCategoryFields("RACKING");
    const wind = fields.find((f) => f.key === "windRating");
    expect(wind?.min).toBe(0);
  });

  test("RACKING snowLoad has min: 0", () => {
    const fields = getCategoryFields("RACKING");
    const snow = fields.find((f) => f.key === "snowLoad");
    expect(snow?.min).toBe(0);
  });

  test("fields without explicit min/max have undefined", () => {
    const fields = getCategoryFields("MODULE");
    const cellType = fields.find((f) => f.key === "cellType");
    expect(cellType?.min).toBeUndefined();
    expect(cellType?.max).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/lib/catalog-fields.test.ts --testNamePattern="FieldDef min/max" -v`
Expected: FAIL — `wattage?.min` is `undefined`, not `0`

- [ ] **Step 3: Add `min`/`max` to `FieldDef` interface**

In `src/lib/catalog-fields.ts`, add two optional properties to `FieldDef` after line 12 (`zohoCustomField`):

```typescript
  /** Minimum allowed numeric value (inclusive). Only for type: "number". */
  min?: number;
  /** Maximum allowed numeric value (inclusive). Only for type: "number". */
  max?: number;
```

- [ ] **Step 4: Add per-field min/max to category definitions**

Apply these ranges to the field definitions in `CATEGORY_CONFIGS`. The principle: `min: 0` for physically non-negative quantities, `max: 100` for percentage fields, **no min/max** for `tempCoefficient` or fields where the domain isn't obvious.

**MODULE fields** — update the fields array starting at line 36:
```typescript
{ key: "wattage", label: "DC Size (Wattage)", type: "number", unit: "W", required: true, min: 0, hubspotProperty: "dc_size", tooltip: "Rated power output under STC (Standard Test Conditions)" },
{ key: "efficiency", label: "Efficiency", type: "number", unit: "%", min: 0, max: 100, tooltip: "Module conversion efficiency percentage" },
// cellType — unchanged (dropdown, no min/max)
{ key: "voc", label: "Voc (Open Circuit Voltage)", type: "number", unit: "V", min: 0, tooltip: "Voltage when no load is connected" },
{ key: "isc", label: "Isc (Short Circuit Current)", type: "number", unit: "A", min: 0, tooltip: "Current when output terminals are shorted" },
{ key: "vmp", label: "Vmp (Max Power Voltage)", type: "number", unit: "V", min: 0, tooltip: "Voltage at maximum power point" },
{ key: "imp", label: "Imp (Max Power Current)", type: "number", unit: "A", min: 0, tooltip: "Current at maximum power point" },
// tempCoefficient — NO min/max (legitimately negative: -0.3 to -0.4 %/°C)
```

**INVERTER fields** — starting at line 54:
```typescript
{ key: "acOutputKw", label: "AC Output Size", type: "number", unit: "kW", required: true, min: 0, hubspotProperty: "ac_size", tooltip: "Rated AC power output of the inverter" },
{ key: "maxDcInput", label: "Max DC Input", type: "number", unit: "kW", min: 0, tooltip: "Maximum DC input power the inverter can accept" },
// phase, nominalAcVoltage — unchanged (dropdowns)
{ key: "mpptChannels", label: "MPPT Channels", type: "number", min: 0, tooltip: "Number of independent maximum power point trackers" },
{ key: "maxInputVoltage", label: "Max Input Voltage", type: "number", unit: "V", min: 0, tooltip: "Maximum DC input voltage the inverter can handle" },
// inverterType — unchanged (dropdown)
```

**BATTERY fields** — starting at line 71:
```typescript
{ key: "capacityKwh", label: "Capacity", type: "number", unit: "kWh", required: true, min: 0, hubspotProperty: "size__kwh_", tooltip: "Total energy storage capacity of the battery" },
{ key: "energyStorageCapacity", label: "Energy Storage Capacity", type: "number", min: 0, hubspotProperty: "energy_storage_capacity", tooltip: "HubSpot-specific energy storage value" },
{ key: "usableCapacityKwh", label: "Usable Capacity", type: "number", unit: "kWh", min: 0, tooltip: "Actual usable energy after depth-of-discharge limits" },
{ key: "continuousPowerKw", label: "Continuous Power", type: "number", unit: "kW", min: 0, hubspotProperty: "capacity__kw_", tooltip: "Sustained power output the battery can deliver" },
{ key: "peakPowerKw", label: "Peak Power", type: "number", unit: "kW", min: 0, tooltip: "Maximum short-burst power output" },
// chemistry — unchanged (dropdown)
{ key: "roundTripEfficiency", label: "Round-Trip Efficiency", type: "number", unit: "%", min: 0, max: 100, tooltip: "Energy retained after a full charge/discharge cycle" },
{ key: "nominalVoltage", label: "Nominal Voltage", type: "number", unit: "V", min: 0, tooltip: "Average operating voltage of the battery system" },
```

**EV_CHARGER fields** — starting at line 97:
```typescript
{ key: "powerKw", label: "Charger Power", type: "number", unit: "kW", required: true, min: 0, hubspotProperty: "capacity__kw_", tooltip: "Maximum charging power output" },
// connectorType — unchanged (dropdown)
{ key: "amperage", label: "Amperage", type: "number", unit: "A", min: 0, tooltip: "Maximum current draw of the charger" },
{ key: "voltage", label: "Voltage", type: "number", unit: "V", min: 0, tooltip: "Operating voltage (240V typical for Level 2)" },
// level — unchanged (dropdown)
// smartFeatures — unchanged (toggle)
```

**RACKING fields** — starting at line 113:
```typescript
// mountType, material, tiltRange — unchanged (dropdowns/text)
{ key: "windRating", label: "Wind Rating", type: "number", unit: "mph", min: 0, tooltip: "Maximum wind speed the system is rated for" },
{ key: "snowLoad", label: "Snow Load", type: "number", unit: "psf", min: 0, tooltip: "Maximum snow load in pounds per square foot" },
// roofAttachment — unchanged (dropdown)
```

**ELECTRICAL_BOS fields** — starting at line 130:
```typescript
// componentType — unchanged (dropdown)
// gaugeSize — unchanged (text)
{ key: "voltageRating", label: "Voltage Rating", type: "number", unit: "V", min: 0, tooltip: "Maximum voltage the component is rated for" },
// material — unchanged (dropdown)
```

**MONITORING fields** — no number fields with obvious ranges, leave as-is.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest src/__tests__/lib/catalog-fields.test.ts --testNamePattern="FieldDef min/max" -v`
Expected: PASS — all 7 tests pass

- [ ] **Step 6: Commit**

```bash
git add src/lib/catalog-fields.ts src/__tests__/lib/catalog-fields.test.ts
git commit -m "feat(catalog): add min/max ranges to FieldDef for numeric validation"
```

---

### Task 2: Add numeric range validation to `validateCatalogForm()`

**Files:**
- Modify: `src/lib/catalog-form-state.ts:215-240` (validateRequiredSpecFields)
- Modify: `src/lib/catalog-form-state.ts:246-283` (validateCatalogForm)
- Test: `src/__tests__/lib/catalog-form-state.test.ts`

- [ ] **Step 1: Write the failing tests for numeric validation**

In `src/__tests__/lib/catalog-form-state.test.ts`, add inside the `validateCatalogForm` describe block (after the existing tests, before the closing `});`):

```typescript
  it("returns error for negative length", () => {
    const result = validateCatalogForm(makeState({
      category: "MODULE", brand: "Test", model: "T1", description: "Desc",
      specValues: { wattage: 400 },
      length: "-5",
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "length")).toBe(true);
  });

  it("returns error for negative width", () => {
    const result = validateCatalogForm(makeState({
      category: "MODULE", brand: "Test", model: "T1", description: "Desc",
      specValues: { wattage: 400 },
      width: "-2",
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "width")).toBe(true);
  });

  it("returns error for negative weight", () => {
    const result = validateCatalogForm(makeState({
      category: "MODULE", brand: "Test", model: "T1", description: "Desc",
      specValues: { wattage: 400 },
      weight: "-10",
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "weight")).toBe(true);
  });

  it("returns error for zero length (must be > 0)", () => {
    const result = validateCatalogForm(makeState({
      category: "MODULE", brand: "Test", model: "T1", description: "Desc",
      specValues: { wattage: 400 },
      length: "0",
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "length")).toBe(true);
  });

  it("accepts valid positive dimensions", () => {
    const result = validateCatalogForm(makeState({
      category: "MODULE", brand: "Test", model: "T1", description: "Desc",
      specValues: { wattage: 400 },
      length: "65.5", width: "39.1", weight: "44",
    }));
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("skips dimension validation when field is empty", () => {
    const result = validateCatalogForm(makeState({
      category: "MODULE", brand: "Test", model: "T1", description: "Desc",
      specValues: { wattage: 400 },
      length: "", width: "", weight: "",
    }));
    expect(result.valid).toBe(true);
  });

  it("returns warning for negative unitCost", () => {
    const result = validateCatalogForm(makeState({
      category: "MODULE", brand: "Test", model: "T1", description: "Desc",
      specValues: { wattage: 400 },
      unitCost: "-100",
    }));
    expect(result.valid).toBe(true); // warning, not error
    expect(result.warnings.some((w) => w.field === "unitCost")).toBe(true);
  });

  it("returns warning for negative sellPrice", () => {
    const result = validateCatalogForm(makeState({
      category: "MODULE", brand: "Test", model: "T1", description: "Desc",
      specValues: { wattage: 400 },
      sellPrice: "-50",
    }));
    expect(result.valid).toBe(true); // warning, not error
    expect(result.warnings.some((w) => w.field === "sellPrice")).toBe(true);
  });

  it("allows zero unitCost (free items)", () => {
    const result = validateCatalogForm(makeState({
      category: "MODULE", brand: "Test", model: "T1", description: "Desc",
      specValues: { wattage: 400 },
      unitCost: "0",
    }));
    expect(result.warnings.some((w) => w.field === "unitCost")).toBe(false);
  });
```

Also add a new describe block for spec field range validation:

```typescript
describe("validateRequiredSpecFields with min/max", () => {
  it("returns error for negative wattage (min: 0)", () => {
    const errors = validateRequiredSpecFields("MODULE", { wattage: -100 });
    expect(errors.some((e) => e.field === "spec.wattage" && e.message.includes("cannot be"))).toBe(true);
  });

  it("accepts zero wattage (min: 0 means >= 0)", () => {
    const errors = validateRequiredSpecFields("MODULE", { wattage: 0 });
    expect(errors).toEqual([]);
  });

  it("returns error for efficiency over 100 (max: 100)", () => {
    const errors = validateRequiredSpecFields("MODULE", { wattage: 400, efficiency: 105 });
    expect(errors.some((e) => e.field === "spec.efficiency" && e.message.includes("cannot exceed"))).toBe(true);
  });

  it("accepts efficiency at 100", () => {
    const errors = validateRequiredSpecFields("MODULE", { wattage: 400, efficiency: 100 });
    expect(errors.filter((e) => e.field === "spec.efficiency")).toEqual([]);
  });

  it("allows negative tempCoefficient (no min set)", () => {
    const errors = validateRequiredSpecFields("MODULE", { wattage: 400, tempCoefficient: -0.35 });
    expect(errors.filter((e) => e.field === "spec.tempCoefficient")).toEqual([]);
  });

  it("skips range check for empty/blank spec fields", () => {
    const errors = validateRequiredSpecFields("MODULE", { wattage: 400, efficiency: "" });
    expect(errors.filter((e) => e.field === "spec.efficiency")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/lib/catalog-form-state.test.ts --testNamePattern="negative|min/max" -v`
Expected: FAIL — no numeric validation exists yet

- [ ] **Step 3: Add range checks to `validateRequiredSpecFields()`**

In `src/lib/catalog-form-state.ts`, modify `validateRequiredSpecFields()` to add range checks after the existing required-field check. Replace the function body (lines 215-240) with:

```typescript
export function validateRequiredSpecFields(
  category: string,
  specValues: Record<string, unknown>
): ValidationError[] {
  const fields = getCategoryFields(category);
  const errors: ValidationError[] = [];

  for (const field of fields) {
    // Skip fields hidden by showWhen
    if (field.showWhen) {
      if (specValues[field.showWhen.field] !== field.showWhen.value) continue;
    }

    const value = specValues[field.key];

    // Required check
    if (field.required && isBlank(value)) {
      errors.push({
        field: `spec.${field.key}`,
        message: `${field.label} is required for ${getCategoryLabel(category)}`,
        section: "details",
      });
      continue; // don't range-check a missing required field
    }

    // Range checks (only for number fields with a numeric value)
    if (field.type === "number" && typeof value === "number" && Number.isFinite(value)) {
      if (field.min !== undefined && value < field.min) {
        errors.push({
          field: `spec.${field.key}`,
          message: `${field.label} cannot be less than ${field.min}`,
          section: "details",
        });
      }
      if (field.max !== undefined && value > field.max) {
        errors.push({
          field: `spec.${field.key}`,
          message: `${field.label} cannot exceed ${field.max}`,
          section: "details",
        });
      }
    }
  }

  return errors;
}
```

- [ ] **Step 4: Add numeric range checks for top-level fields to `validateCatalogForm()`**

In `src/lib/catalog-form-state.ts`, add the following checks inside `validateCatalogForm()` after the spec validation block (after line 267 `errors.push(...validateRequiredSpecFields(...))`), before the warnings section:

```typescript
  // Numeric range checks — dimensions/weight (blocking errors: must be > 0)
  if (state.length) {
    const v = parseFloat(state.length);
    if (Number.isFinite(v) && v <= 0) {
      errors.push({ field: "length", message: "Length must be greater than 0", section: "details" });
    }
  }
  if (state.width) {
    const v = parseFloat(state.width);
    if (Number.isFinite(v) && v <= 0) {
      errors.push({ field: "width", message: "Width must be greater than 0", section: "details" });
    }
  }
  if (state.weight) {
    const v = parseFloat(state.weight);
    if (Number.isFinite(v) && v <= 0) {
      errors.push({ field: "weight", message: "Weight must be greater than 0", section: "details" });
    }
  }

  // Numeric range checks — pricing (non-blocking warnings: 0 is OK for free items)
  if (state.unitCost) {
    const v = parseFloat(state.unitCost);
    if (Number.isFinite(v) && v < 0) {
      warnings.push({ field: "unitCost", message: "Unit cost is negative", section: "details" });
    }
  }
  if (state.sellPrice) {
    const v = parseFloat(state.sellPrice);
    if (Number.isFinite(v) && v < 0) {
      warnings.push({ field: "sellPrice", message: "Sell price is negative", section: "details" });
    }
  }
```

- [ ] **Step 5: Add vendor pair warning**

Still in `validateCatalogForm()`, add after the sell-price-less-than-cost warning (before `return`):

```typescript
  // Vendor pair warning: name set without Zoho ID
  if (state.vendorName && !state.zohoVendorId) {
    warnings.push({
      field: "vendorName",
      message: "Vendor selected without Zoho ID — product won't sync to Zoho Inventory",
      section: "details",
    });
  }
```

- [ ] **Step 6: Write vendor warning test**

In `src/__tests__/lib/catalog-form-state.test.ts`, add inside the `validateCatalogForm` describe block:

```typescript
  it("returns warning for vendorName without zohoVendorId", () => {
    const result = validateCatalogForm(makeState({
      category: "MODULE", brand: "Test", model: "T1", description: "Desc",
      specValues: { wattage: 400 },
      vendorName: "Rell Power",
      zohoVendorId: "",
    }));
    expect(result.valid).toBe(true); // warning, not error
    expect(result.warnings.some((w) => w.field === "vendorName")).toBe(true);
  });

  it("no vendor warning when both vendorName and zohoVendorId set", () => {
    const result = validateCatalogForm(makeState({
      category: "MODULE", brand: "Test", model: "T1", description: "Desc",
      specValues: { wattage: 400 },
      vendorName: "Rell Power",
      zohoVendorId: "v123",
    }));
    expect(result.warnings.some((w) => w.field === "vendorName")).toBe(false);
  });
```

- [ ] **Step 7: Run all form-state tests**

Run: `npx jest src/__tests__/lib/catalog-form-state.test.ts -v`
Expected: ALL PASS

- [ ] **Step 8: Commit**

```bash
git add src/lib/catalog-form-state.ts src/__tests__/lib/catalog-form-state.test.ts
git commit -m "feat(catalog): add numeric range validation and vendor pair warning"
```

---

## Chunk 2: Inline Field-Level Errors (Tasks 3-5)

### Task 3: Thread validation errors from parent page to step components

**Files:**
- Modify: `src/app/dashboards/submit-product/page.tsx:95-321`
- Modify: `src/components/catalog/BasicsStep.tsx:7-13` (props interface)
- Modify: `src/components/catalog/DetailsStep.tsx:9-14` (props interface)

This task wires up the plumbing: the parent page computes validation, manages touched fields, and passes them down. The step components accept the new props but don't render errors yet (that's Tasks 4-5).

- [ ] **Step 1: Add touched-field state and validation threading to the parent page**

In `src/app/dashboards/submit-product/page.tsx`, add these imports at line 19 (after existing imports):

```typescript
import type { ValidationError, ValidationWarning } from "@/lib/catalog-form-state";
```

Inside `CatalogWizard()`, after the `error`/`success` state declarations (after line 103), add:

```typescript
  const [touchedFields, setTouchedFields] = useState<Set<string>>(new Set());

  // Compute validation on every state change (cheap — pure function, no DOM)
  const validation = validateCatalogForm(state);

  const handleFieldBlur = useCallback((field: string) => {
    setTouchedFields((prev) => {
      const next = new Set(prev);
      next.add(field);
      return next;
    });
  }, []);

  const markSectionTouched = useCallback((section: "basics" | "details") => {
    setTouchedFields((prev) => {
      const next = new Set(prev);
      for (const err of validation.errors) {
        if (err.section === section) next.add(err.field);
      }
      for (const warn of validation.warnings) {
        if (warn.section === section) next.add(warn.field);
      }
      return next;
    });
  }, [validation]);
```

Update the `BasicsStep` render (around line 288) to pass the new props:

```tsx
<BasicsStep
  state={state}
  dispatch={dispatch}
  onCategoryChange={handleCategoryChange}
  errors={validation.errors}
  warnings={validation.warnings}
  touchedFields={touchedFields}
  onFieldBlur={handleFieldBlur}
  onNext={() => {
    markSectionTouched("basics");
    if (!validation.errors.some((e) => e.section === "basics")) {
      setCurrentStep("details");
    }
  }}
  onBack={() => {
    dispatch({ type: "RESET" });
    setTouchedFields(new Set());
    setCurrentStep("start");
  }}
/>
```

Update the `DetailsStep` render (around line 301) to pass the new props:

```tsx
<DetailsStep
  state={state}
  dispatch={dispatch}
  errors={validation.errors}
  warnings={validation.warnings}
  touchedFields={touchedFields}
  onFieldBlur={handleFieldBlur}
  onNext={() => {
    markSectionTouched("details");
    if (!validation.errors.some((e) => e.section === "details")) {
      setCurrentStep("review");
    }
  }}
  onBack={() => setCurrentStep("basics")}
/>
```

Also clear `touchedFields` in the clone and datasheet callbacks. In `handleClone` (around line 145), add `setTouchedFields(new Set());` after the existing dispatch calls:

```typescript
  const handleClone = useCallback((product: CloneResult) => {
    const normalized = normalizeCloneResult(product);
    dispatch({ type: "PREFILL_FROM_PRODUCT", data: normalized, source: "clone" });
    setTouchedFields(new Set());
    // ... rest of existing code (category defaults, setCurrentStep)
```

Same in `handleDatasheetExtracted` (around line 160):

```typescript
  const handleDatasheetExtracted = useCallback(
    (extracted: ExtractedProduct) => {
      dispatch({ type: "PREFILL_FROM_PRODUCT", data: extracted as Partial<CatalogFormState>, source: "datasheet" });
      setTouchedFields(new Set());
      // ... rest of existing code (category defaults, setCurrentStep)
```

- [ ] **Step 2: Update `BasicsStepProps` to accept validation props**

In `src/components/catalog/BasicsStep.tsx`, update the interface (lines 7-13):

```typescript
import type { ValidationError, ValidationWarning } from "@/lib/catalog-form-state";

interface BasicsStepProps {
  state: CatalogFormState;
  dispatch: React.Dispatch<CatalogFormAction>;
  onCategoryChange?: (category: string) => void;
  errors?: ValidationError[];
  warnings?: ValidationWarning[];
  touchedFields?: Set<string>;
  onFieldBlur?: (field: string) => void;
  onNext: () => void;
  onBack?: () => void;
}
```

Update the destructuring at line 27:

```typescript
export default function BasicsStep({ state, dispatch, onCategoryChange, errors, warnings, touchedFields, onFieldBlur, onNext, onBack }: BasicsStepProps) {
```

The component now accepts these props but doesn't use them yet. That's Task 4.

- [ ] **Step 3: Update `DetailsStepProps` to accept validation props**

In `src/components/catalog/DetailsStep.tsx`, update the interface (lines 9-14):

```typescript
import type { ValidationError, ValidationWarning } from "@/lib/catalog-form-state";

interface DetailsStepProps {
  state: CatalogFormState;
  dispatch: React.Dispatch<CatalogFormAction>;
  errors?: ValidationError[];
  warnings?: ValidationWarning[];
  touchedFields?: Set<string>;
  onFieldBlur?: (field: string) => void;
  onNext: () => void;
  onBack: () => void;
}
```

Update the destructuring at line 20:

```typescript
export default function DetailsStep({ state, dispatch, errors, warnings, touchedFields, onFieldBlur, onNext, onBack }: DetailsStepProps) {
```

- [ ] **Step 4: Verify the build compiles**

Run: `npx tsc --noEmit`
Expected: No type errors (new props are all optional, so existing call sites still compile)

- [ ] **Step 5: Run existing tests to ensure no regression**

Run: `npx jest src/__tests__/lib/catalog-form-state.test.ts src/__tests__/lib/catalog-fields.test.ts -v`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboards/submit-product/page.tsx src/components/catalog/BasicsStep.tsx src/components/catalog/DetailsStep.tsx
git commit -m "feat(catalog): thread validation errors + touched fields to step components"
```

---

### Task 4: Render inline errors in `BasicsStep`

**Files:**
- Modify: `src/components/catalog/BasicsStep.tsx`

- [ ] **Step 1: Add helper function for inline error rendering**

At the top of `BasicsStep` (inside the component function, after the existing state declarations), add:

```typescript
  // Filter errors/warnings to only those for touched fields
  const fieldError = (field: string): string | undefined => {
    if (!touchedFields?.has(field)) return undefined;
    return errors?.find((e) => e.field === field)?.message;
  };

  const inputErrorClass = (field: string): string =>
    fieldError(field) ? "ring-2 ring-red-500/50 border-red-500/50" : "";
```

- [ ] **Step 2: Add `onBlur` and error display to the Brand field**

Find the Brand `<div>` (around line 121). Wire up blur on the wrapping div using a `relatedTarget` check to avoid premature firing when focus moves within `BrandDropdown` (e.g., from input to dropdown option):

```tsx
<div
  className={isPrefilled("brand") ? "border-l-2 border-l-green-400 pl-3" : ""}
  onBlur={(e) => {
    // Only mark touched when focus leaves the entire container, not internal focus moves
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      onFieldBlur?.("brand");
    }
  }}
>
  <label className="block text-sm font-medium text-muted mb-1">
    Brand <span className="text-red-400">*</span>
  </label>
  <BrandDropdown
    value={state.brand}
    onChange={(v) => {
      dispatch({ type: "SET_FIELD", field: "brand", value: v });
      dispatch({ type: "CLEAR_PREFILL_FIELD", field: "brand" });
    }}
  />
  {fieldError("brand") && (
    <p className="mt-1 text-xs text-red-400">{fieldError("brand")}</p>
  )}
</div>
```

- [ ] **Step 3: Add `onBlur` and error display to Model field**

Find the Model `<div>` (around line 133). Add `onBlur={() => onFieldBlur?.("model")}` to the wrapping div. Add `className` with `inputErrorClass("model")` appended to the input's existing classes. Add error text after the input:

```tsx
<div
  className={isPrefilled("model") ? "border-l-2 border-l-green-400 pl-3" : ""}
  onBlur={() => onFieldBlur?.("model")}
>
  <label className="block text-sm font-medium text-muted mb-1">
    Model / Part # <span className="text-red-400">*</span>
  </label>
  <input
    type="text"
    value={state.model}
    onChange={(e) => {
      dispatch({ type: "SET_FIELD", field: "model", value: e.target.value });
      dispatch({ type: "CLEAR_PREFILL_FIELD", field: "model" });
    }}
    className={`w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 ${inputErrorClass("model")}`}
  />
  {fieldError("model") && (
    <p className="mt-1 text-xs text-red-400">{fieldError("model")}</p>
  )}
</div>
```

- [ ] **Step 4: Add `onBlur` and error display to Description field**

Same pattern for the Description `<div>` (around line 147). Add `onBlur` to the wrapping div, append `inputErrorClass("description")` to the textarea class, add error text below:

```tsx
<div
  className={`sm:col-span-2 ${isPrefilled("description") ? "border-l-2 border-l-green-400 pl-3" : ""}`}
  onBlur={() => onFieldBlur?.("description")}
>
  <label className="block text-sm font-medium text-muted mb-1">
    Description <span className="text-red-400">*</span>
  </label>
  <textarea
    value={state.description}
    onChange={(e) => {
      dispatch({ type: "SET_FIELD", field: "description", value: e.target.value });
      dispatch({ type: "CLEAR_PREFILL_FIELD", field: "description" });
    }}
    rows={3}
    className={`w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 ${inputErrorClass("description")}`}
  />
  {fieldError("description") && (
    <p className="mt-1 text-xs text-red-400">{fieldError("description")}</p>
  )}
</div>
```

- [ ] **Step 5: Remove `canProceed` guard from Next button**

The existing `canProceed` guard (line 87: `const canProceed = state.category && ...`) disables the Next button when required fields are empty, which prevents `onNext` from firing and blocks `markSectionTouched`. Since the parent now gates navigation via `onNext`, remove the disabled guard so clicking Next always triggers the touched-field marking and shows inline errors.

Find the Next button (around line 281-288) and change `disabled={!canProceed}` to remove the disabled prop entirely:

```tsx
<button
  type="button"
  onClick={onNext}
  className="px-6 py-2.5 text-sm font-semibold rounded-lg bg-cyan-600 text-white hover:bg-cyan-500 transition-colors"
>
  Next: Details →
</button>
```

Also remove the `canProceed` variable at line 87 (it's now unused).

**Note on category field:** The `category` field uses a button grid (not an input), so inline error rendering doesn't apply — the user must select a category before the Product Identity section even appears (line 117: `{state.category && (`). The parent's `onNext` gating covers this: clicking Next with no category shows the brand/model/description errors but category's error only surfaces on the Review step summary, which is acceptable since the entire form is gated behind category selection.

- [ ] **Step 6: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 7: Commit**

```bash
git add src/components/catalog/BasicsStep.tsx
git commit -m "feat(catalog): render inline validation errors in BasicsStep"
```

---

### Task 5: Render inline errors in `DetailsStep` and `CategoryFields`

**Files:**
- Modify: `src/components/catalog/DetailsStep.tsx`
- Modify: `src/components/catalog/CategoryFields.tsx:6-13` (props interface)

- [ ] **Step 1: Add error helpers to `DetailsStep`**

Inside the `DetailsStep` component function (after the existing `fieldClass` helper), add:

```typescript
  const fieldError = (field: string): string | undefined => {
    if (!touchedFields?.has(field)) return undefined;
    return errors?.find((e) => e.field === field)?.message;
  };

  const fieldWarning = (field: string): string | undefined => {
    if (!touchedFields?.has(field)) return undefined;
    return warnings?.find((w) => w.field === field)?.message;
  };

  const inputErrorClass = (field: string): string =>
    fieldError(field) ? "ring-2 ring-red-500/50 border-red-500/50" : "";

  const inputWarningClass = (field: string): string =>
    !fieldError(field) && fieldWarning(field) ? "ring-2 ring-amber-500/50 border-amber-500/50" : "";
```

- [ ] **Step 2: Add `onBlur` + error display to numeric inputs (unitCost, sellPrice, length, width, weight)**

For each numeric input field, add `onBlur={() => onFieldBlur?.(fieldName)}` to the wrapping `<div>`, append `${inputErrorClass(fieldName)} ${inputWarningClass(fieldName)}` to the input className, and add error/warning text below the input. Example for `unitCost` (around line 94):

```tsx
<div className={fieldClass("unitCost")} onBlur={() => onFieldBlur?.("unitCost")}>
  <label className="block text-sm font-medium text-muted mb-1">
    Unit Cost ($)
    <FieldTooltip text="Your cost to purchase this item from the vendor" />
  </label>
  <input
    type="number"
    step="any"
    value={state.unitCost}
    onChange={(e) => { dispatch({ type: "SET_FIELD", field: "unitCost", value: e.target.value }); dispatch({ type: "CLEAR_PREFILL_FIELD", field: "unitCost" }); }}
    className={`w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 ${inputErrorClass("unitCost")} ${inputWarningClass("unitCost")}`}
  />
  {fieldError("unitCost") && <p className="mt-1 text-xs text-red-400">{fieldError("unitCost")}</p>}
  {!fieldError("unitCost") && fieldWarning("unitCost") && <p className="mt-1 text-xs text-amber-400">{fieldWarning("unitCost")}</p>}
</div>
```

Apply the same pattern to: `sellPrice`, `length`, `width`, `weight`.

Also add to vendor: `onBlur={() => onFieldBlur?.("vendorName")}` on the vendor div, and show warning below VendorPicker:

```tsx
{fieldWarning("vendorName") && <p className="mt-1 text-xs text-amber-400">{fieldWarning("vendorName")}</p>}
```

- [ ] **Step 3: Pass errors to `CategoryFields`**

In `DetailsStep`, update the `CategoryFields` render (around line 78) to pass errors and onFieldBlur:

```tsx
<CategoryFields
  category={state.category}
  values={state.specValues}
  onChange={(key, value) => dispatch({ type: "SET_SPEC", key, value })}
  showTooltips={true}
  prefillFields={state.prefillFields}
  onClearPrefill={(key) => dispatch({ type: "CLEAR_PREFILL_FIELD", field: `spec.${key}` })}
  errors={errors}
  touchedFields={touchedFields}
  onFieldBlur={onFieldBlur}
/>
```

- [ ] **Step 4: Update `CategoryFields` to accept and render errors**

In `src/components/catalog/CategoryFields.tsx`, update the interface (lines 6-13):

```typescript
import type { ValidationError } from "@/lib/catalog-form-state";

interface CategoryFieldsProps {
  category: string;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  showTooltips?: boolean;
  prefillFields?: Set<string>;
  onClearPrefill?: (key: string) => void;
  errors?: ValidationError[];
  touchedFields?: Set<string>;
  onFieldBlur?: (field: string) => void;
}
```

Update the destructuring at line 135:

```typescript
export default function CategoryFields({
  category, values, onChange, showTooltips, prefillFields, onClearPrefill, errors, touchedFields, onFieldBlur,
}: CategoryFieldsProps) {
```

Add an error helper inside the component:

```typescript
  const fieldError = (key: string): string | undefined => {
    const field = `spec.${key}`;
    if (!touchedFields?.has(field)) return undefined;
    return errors?.find((e) => e.field === field)?.message;
  };
```

Update the field rendering loop (inside `fields.map`) to add `onBlur`, error ring, and error text. Wrap the `Renderer` and error message:

```tsx
{fields.map((field) => {
  const Renderer = FIELD_RENDERERS[field.type];
  const error = fieldError(field.key);
  return (
    <div
      key={field.key}
      className={
        prefillFields?.has(`spec.${field.key}`)
          ? "border-l-2 border-l-blue-400 pl-3"
          : ""
      }
      onBlur={() => onFieldBlur?.(`spec.${field.key}`)}
    >
      <label className="text-sm font-medium text-muted mb-1 block">
        {field.label}
        {field.required && (
          <span className="text-red-400 ml-0.5">*</span>
        )}
        {showTooltips && field.tooltip && (
          <FieldTooltip text={field.tooltip} />
        )}
      </label>
      <div className={error ? "ring-2 ring-red-500/50 rounded-lg" : ""}>
        <Renderer
          field={field}
          value={values[field.key]}
          onChange={(v) => {
            onChange(field.key, v);
            onClearPrefill?.(field.key);
          }}
        />
      </div>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
})}
```

- [ ] **Step 5: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 6: Run all tests**

Run: `npx jest src/__tests__/lib/catalog-form-state.test.ts src/__tests__/lib/catalog-fields.test.ts -v`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add src/components/catalog/DetailsStep.tsx src/components/catalog/CategoryFields.tsx
git commit -m "feat(catalog): render inline validation errors in DetailsStep and CategoryFields"
```

---

## Chunk 3: Photo Upload & Vendor Picker (Tasks 6-7)

### Task 6: Add client-side photo upload validation

**Files:**
- Modify: `src/components/catalog/DetailsStep.tsx:29-48` (handlePhotoUpload)

- [ ] **Step 1: Add client-side file validation before upload**

In `src/components/catalog/DetailsStep.tsx`, replace the `handlePhotoUpload` function (lines 29-48) with:

```typescript
  const PHOTO_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
  const PHOTO_ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

  async function handlePhotoUpload(file: File) {
    setPhotoError(null);

    // Client-side validation — reject before uploading
    if (!PHOTO_ALLOWED_TYPES.has(file.type)) {
      setPhotoError("Unsupported file type. Use JPEG, PNG, WebP, or GIF.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (file.size > PHOTO_MAX_BYTES) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      setPhotoError(`File too large (${sizeMb} MB). Maximum is 5 MB.`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setPhotoUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/catalog/upload-photo", { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error || "Upload failed");
      }
      const { url, fileName } = await res.json();
      dispatch({ type: "SET_FIELD", field: "photoUrl", value: url });
      dispatch({ type: "SET_FIELD", field: "photoFileName", value: fileName });
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setPhotoUploading(false);
    }
  }
```

- [ ] **Step 2: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/components/catalog/DetailsStep.tsx
git commit -m "feat(catalog): add client-side photo file size and type validation"
```

---

### Task 7: Validate stale `zohoVendorId` in `VendorPicker`

**Files:**
- Modify: `src/components/catalog/VendorPicker.tsx`

- [ ] **Step 1: Add stale vendor detection state and ref**

In `src/components/catalog/VendorPicker.tsx`, add after the existing state declarations (after line 31):

```typescript
  const [staleVendorHint, setStaleVendorHint] = useState<string | null>(null);
  const hasValidatedVendorRef = useRef(false);
```

- [ ] **Step 2: Add useEffect to validate zohoVendorId after vendor list loads**

After the existing initial fetch `useEffect` (after line 52), add a new effect:

```typescript
  // Validate zohoVendorId against fetched list — detect stale IDs from clones/imports.
  // Uses a ref guard to ensure this check runs exactly once (when vendors first load),
  // while keeping all deps in the array to satisfy exhaustive-deps.
  useEffect(() => {
    if (loading || fetchError || vendors.length === 0) return;
    if (hasValidatedVendorRef.current) return;
    hasValidatedVendorRef.current = true;

    if (!zohoVendorId) return;

    const found = vendors.some((v) => v.zohoVendorId === zohoVendorId);
    if (!found) {
      // Stale ID: vendor was deleted from Zoho since this product was created/cloned
      setStaleVendorHint(vendorName || "Unknown vendor");
      onChange("", "");
    }
  }, [vendors, loading, fetchError, zohoVendorId, vendorName, onChange]);
```

**Note:** The `hasValidatedVendorRef` guard ensures the check runs exactly once after the vendor list first loads, even though all dependencies are listed. This avoids the eslint-disable-line pattern and prevents stale closures on retry/refetch.

- [ ] **Step 3: Show persistent hint line for stale vendor**

Add the stale vendor warning below the input/display area. After the closing `)}` of the `{open && !vendorName && (...)}` dropdown block (after line 197), add:

```tsx
      {/* Stale vendor hint — shown when cloned/imported vendor no longer exists */}
      {staleVendorHint && !vendorName && (
        <p className="mt-1 text-xs text-amber-400">
          Previously selected vendor &ldquo;{staleVendorHint}&rdquo; is no longer available. Please re-select.
        </p>
      )}

      {/* Persistent hint line — show when dropdown is closed and hint exists */}
      {hint && !vendorName && !open && !staleVendorHint && (
        <p className="mt-1 text-xs text-amber-400/70">
          Suggested: {hint}
        </p>
      )}
```

- [ ] **Step 4: Clear stale hint when user selects a new vendor**

In the `select` function (around line 69), add a line to clear the stale hint:

```typescript
  function select(v: Vendor) {
    onChange(v.name, v.zohoVendorId);
    setQuery("");
    setOpen(false);
    setStaleVendorHint(null);
  }
```

- [ ] **Step 5: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 6: Run all tests**

Run: `npx jest -v`
Expected: ALL PASS (no regressions)

- [ ] **Step 7: Commit**

```bash
git add src/components/catalog/VendorPicker.tsx
git commit -m "feat(catalog): detect stale zohoVendorId and show re-select hint"
```

---

## Verification

After all tasks are complete, run the full test suite and type-check:

```bash
npx tsc --noEmit && npx jest -v
```

Then manually verify in the browser at `/dashboards/submit-product`:

1. **Numeric validation**: Enter `-5` for Length → blur → should show red error. Enter `105` for MODULE efficiency → should show error on Review.
2. **Inline errors**: Leave Brand empty, click Next → should show "Brand is required" inline. Fill it, blur → error disappears.
3. **Photo upload**: Select a `.txt` file → should show "Unsupported file type" immediately, no upload attempt. Select a 10MB image → should show "File too large (10.0 MB)".
4. **Vendor picker**: Clone a product, change its vendor ID to a fake value in dev tools → reload → should show amber "Previously selected vendor is no longer available" hint.
