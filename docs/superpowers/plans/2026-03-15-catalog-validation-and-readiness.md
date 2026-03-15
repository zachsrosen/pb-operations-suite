# Catalog Validation & Downstream Readiness Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add required spec field enforcement and per-system downstream readiness warnings to the product submission wizard.

**Architecture:** A shared `isBlank()` + `validateRequiredSpecFields()` core is called by both the client-side `validateCatalogForm()` wrapper and the server POST route. A new `catalog-readiness.ts` module computes per-system sync status using existing mapping functions. Both validation and readiness results are rendered in the ReviewStep UI.

**Tech Stack:** TypeScript, React 19, Next.js 16.1, Jest

**Spec:** `docs/superpowers/specs/2026-03-15-catalog-validation-and-readiness-design.md`

---

## File Structure

| File | Role | Action |
|------|------|--------|
| `src/lib/catalog-fields.ts` | Field config — add `required: true` to 4 FieldDefs | Modify |
| `src/lib/catalog-form-state.ts` | Shared validator — `isBlank()`, `validateRequiredSpecFields()`, `validateCatalogForm()` | Modify |
| `src/lib/catalog-readiness.ts` | Downstream sync readiness — `getDownstreamReadiness()` | Create |
| `src/components/catalog/ReviewStep.tsx` | Wire validation + readiness UI | Modify |
| `src/components/catalog/DetailsStep.tsx` | Conditional section header | Modify |
| `src/app/dashboards/submit-product/page.tsx` | Client-side validation gate in `handleSubmit` | Modify |
| `src/app/api/catalog/push-requests/route.ts` | Server-side validation | Modify |
| `src/__tests__/lib/catalog-form-state.test.ts` | Validator tests | Modify |
| `src/__tests__/lib/catalog-readiness.test.ts` | Readiness tests | Create |
| `src/__tests__/api/catalog-push-requests.test.ts` | Fix existing tests + add spec validation cases | Modify |

---

## Chunk 1: Validation Core + Tests

### Task 1: Mark required fields in catalog-fields.ts

**Files:**
- Modify: `src/lib/catalog-fields.ts:36` (MODULE wattage), `:54` (INVERTER acOutputKw), `:71` (BATTERY capacityKwh), `:98` (EV_CHARGER powerKw)

- [ ] **Step 1: Add `required: true` to four FieldDef entries**

In `src/lib/catalog-fields.ts`, add `required: true` to these four field objects:

```typescript
// Line 36 — MODULE → wattage
{ key: "wattage", label: "DC Size (Wattage)", type: "number", unit: "W", required: true, hubspotProperty: "dc_size", tooltip: "Rated power output under STC (Standard Test Conditions)" },

// Line 54 — INVERTER → acOutputKw
{ key: "acOutputKw", label: "AC Output Size", type: "number", unit: "kW", required: true, hubspotProperty: "ac_size", tooltip: "Rated AC power output of the inverter" },

// Line 71 — BATTERY → capacityKwh (BATTERY_EXPANSION inherits via shared reference on line 216)
{ key: "capacityKwh", label: "Capacity", type: "number", unit: "kWh", required: true, hubspotProperty: "size__kwh_", tooltip: "Total energy storage capacity of the battery" },

// Line 98 — EV_CHARGER → powerKw
{ key: "powerKw", label: "Charger Power", type: "number", unit: "kW", required: true, hubspotProperty: "capacity__kw_", tooltip: "Maximum charging power output" },
```

- [ ] **Step 2: Verify no TypeScript errors**

Run: `npx tsc --noEmit 2>&1 | grep catalog-fields || echo "No errors"`
Expected: "No errors"

- [ ] **Step 3: Commit**

```bash
git add src/lib/catalog-fields.ts
git commit -m "feat(catalog): mark wattage, acOutputKw, capacityKwh, powerKw as required spec fields"
```

---

### Task 2: Add isBlank() and validateRequiredSpecFields() to catalog-form-state.ts

**Files:**
- Modify: `src/lib/catalog-form-state.ts`
- Test: `src/__tests__/lib/catalog-form-state.test.ts`

- [ ] **Step 1: Write failing tests for isBlank and validateRequiredSpecFields**

First, update the import on line 1 of `src/__tests__/lib/catalog-form-state.test.ts` to include the new exports:

```typescript
// Line 1 — change from:
import { catalogFormReducer, initialFormState, type CatalogFormState } from "@/lib/catalog-form-state";

// to:
import { catalogFormReducer, initialFormState, isBlank, validateRequiredSpecFields, validateCatalogForm, type CatalogFormState } from "@/lib/catalog-form-state";
```

Then append the following test blocks at the end of the file (after the closing `});` of the existing `describe("catalogFormReducer", ...)`):

```typescript
describe("isBlank", () => {
  it("returns true for undefined, null, empty string, whitespace", () => {
    expect(isBlank(undefined)).toBe(true);
    expect(isBlank(null)).toBe(true);
    expect(isBlank("")).toBe(true);
    expect(isBlank("   ")).toBe(true);
    expect(isBlank("\t\n")).toBe(true);
  });

  it("returns false for 0, false, and non-empty strings", () => {
    expect(isBlank(0)).toBe(false);
    expect(isBlank(false)).toBe(false);
    expect(isBlank("hello")).toBe(false);
    expect(isBlank(42)).toBe(false);
  });
});

describe("validateRequiredSpecFields", () => {
  it("returns no errors for MODULE with wattage filled", () => {
    const errors = validateRequiredSpecFields("MODULE", { wattage: 400 });
    expect(errors).toEqual([]);
  });

  it("returns error for MODULE with wattage missing", () => {
    const errors = validateRequiredSpecFields("MODULE", {});
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("spec.wattage");
    expect(errors[0].section).toBe("details");
  });

  it("returns error for MODULE with wattage blank string", () => {
    const errors = validateRequiredSpecFields("MODULE", { wattage: "" });
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("spec.wattage");
  });

  it("passes for MODULE with wattage = 0 (zero is not blank)", () => {
    const errors = validateRequiredSpecFields("MODULE", { wattage: 0 });
    expect(errors).toEqual([]);
  });

  it("returns no errors for RACKING (no required fields)", () => {
    const errors = validateRequiredSpecFields("RACKING", {});
    expect(errors).toEqual([]);
  });

  it("returns no errors for blank/unknown category", () => {
    const errors = validateRequiredSpecFields("", {});
    expect(errors).toEqual([]);
    const errors2 = validateRequiredSpecFields("DOES_NOT_EXIST", {});
    expect(errors2).toEqual([]);
  });

  it("returns error for BATTERY capacityKwh missing", () => {
    const errors = validateRequiredSpecFields("BATTERY", {});
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("spec.capacityKwh");
  });

  it("returns error for BATTERY_EXPANSION capacityKwh missing (shared fields)", () => {
    const errors = validateRequiredSpecFields("BATTERY_EXPANSION", {});
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("spec.capacityKwh");
  });

  it("ignores non-spec keys like _photoUrl in metadata", () => {
    const errors = validateRequiredSpecFields("MODULE", { _photoUrl: "https://example.com/photo.jpg", wattage: 400 });
    expect(errors).toEqual([]);
  });

  it("skips required fields hidden by showWhen conditions", () => {
    // Mock getCategoryFields for this test to return a field with showWhen + required
    const getCategoryFields = jest.requireActual("@/lib/catalog-fields").getCategoryFields;
    const mockGetCategoryFields = jest.spyOn(
      require("@/lib/catalog-fields"), "getCategoryFields"
    ).mockImplementation((cat: string) => {
      if (cat === "TEST_SHOW_WHEN") {
        return [
          { key: "toggleField", label: "Toggle", type: "toggle" },
          { key: "conditionalField", label: "Conditional", type: "number", required: true, showWhen: { field: "toggleField", value: true } },
        ];
      }
      return getCategoryFields(cat);
    });

    // showWhen NOT met — conditionalField is required but hidden, so no error
    const errors1 = validateRequiredSpecFields("TEST_SHOW_WHEN", { toggleField: false });
    expect(errors1).toEqual([]);

    // showWhen IS met — conditionalField is visible and required, so error
    const errors2 = validateRequiredSpecFields("TEST_SHOW_WHEN", { toggleField: true });
    expect(errors2).toHaveLength(1);
    expect(errors2[0].field).toBe("spec.conditionalField");

    // showWhen IS met and field is filled — no error
    const errors3 = validateRequiredSpecFields("TEST_SHOW_WHEN", { toggleField: true, conditionalField: 42 });
    expect(errors3).toEqual([]);

    mockGetCategoryFields.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest catalog-form-state --verbose 2>&1 | tail -20`
Expected: FAIL — `isBlank` and `validateRequiredSpecFields` are not exported

- [ ] **Step 3: Implement isBlank and validateRequiredSpecFields**

Add to the end of `src/lib/catalog-form-state.ts`, before the closing (there is no closing — just append after the reducer):

```typescript
// ── Validation ──────────────────────────────────────────────────────────────

export interface ValidationError {
  field: string;
  message: string;
  section: "basics" | "details" | "review";
}

export interface ValidationWarning {
  field: string;
  message: string;
  section: "basics" | "details" | "review";
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

/**
 * Returns true for undefined, null, empty string, or whitespace-only string.
 * `0` and `false` are NOT blank — they are valid values.
 */
export function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  return false;
}

/**
 * Check required spec fields for a category. Returns errors for any required
 * FieldDef whose value in specValues is blank. Skips fields hidden by showWhen.
 * Iterates from FieldDef[] keys, so non-spec keys in specValues are ignored.
 */
export function validateRequiredSpecFields(
  category: string,
  specValues: Record<string, unknown>
): ValidationError[] {
  const fields = getCategoryFields(category);
  const errors: ValidationError[] = [];

  for (const field of fields) {
    if (!field.required) continue;

    // Skip fields hidden by showWhen
    if (field.showWhen) {
      if (specValues[field.showWhen.field] !== field.showWhen.value) continue;
    }

    if (isBlank(specValues[field.key])) {
      errors.push({
        field: `spec.${field.key}`,
        message: `${field.label} is required for ${getCategoryLabel(category)}`,
        section: "details",
      });
    }
  }

  return errors;
}
```

Note: this file already imports `getCategoryFields` on line 1. You also need to add `getCategoryLabel` to that import:

```typescript
// Line 1 — change from:
import { getCategoryFields } from "./catalog-fields";
// to:
import { getCategoryFields, getCategoryLabel } from "./catalog-fields";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest catalog-form-state --verbose 2>&1 | tail -30`
Expected: All `isBlank` and `validateRequiredSpecFields` tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/catalog-form-state.ts src/__tests__/lib/catalog-form-state.test.ts
git commit -m "feat(catalog): add isBlank() and validateRequiredSpecFields() shared validation core"
```

---

### Task 3: Add validateCatalogForm() client wrapper

**Files:**
- Modify: `src/lib/catalog-form-state.ts`
- Test: `src/__tests__/lib/catalog-form-state.test.ts`

- [ ] **Step 1: Write failing tests for validateCatalogForm**

Add to the end of `src/__tests__/lib/catalog-form-state.test.ts`:

```typescript
describe("validateCatalogForm", () => {
  function makeState(overrides: Partial<CatalogFormState> = {}): CatalogFormState {
    return { ...initialFormState, ...overrides };
  }

  it("returns valid for a complete MODULE submission", () => {
    const result = validateCatalogForm(makeState({
      category: "MODULE",
      brand: "Hanwha",
      model: "Q.PEAK 400",
      description: "400W Module",
      specValues: { wattage: 400 },
    }));
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("returns errors for missing top-level required fields", () => {
    const result = validateCatalogForm(makeState({
      category: "",
      brand: "",
      model: "",
      description: "",
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
    const fields = result.errors.map((e) => e.field);
    expect(fields).toContain("category");
    expect(fields).toContain("brand");
    expect(fields).toContain("model");
    expect(fields).toContain("description");
  });

  it("rejects whitespace-only top-level fields", () => {
    const result = validateCatalogForm(makeState({
      category: "MODULE",
      brand: "  ",
      model: "\t",
      description: "\n",
      specValues: { wattage: 400 },
    }));
    expect(result.valid).toBe(false);
    const fields = result.errors.map((e) => e.field);
    expect(fields).toContain("brand");
    expect(fields).toContain("model");
    expect(fields).toContain("description");
  });

  it("returns spec errors for MODULE missing wattage", () => {
    const result = validateCatalogForm(makeState({
      category: "MODULE",
      brand: "Hanwha",
      model: "Q.PEAK 400",
      description: "400W Module",
      specValues: {},
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "spec.wattage")).toBe(true);
  });

  it("returns valid for RACKING with no spec fields", () => {
    const result = validateCatalogForm(makeState({
      category: "RACKING",
      brand: "IronRidge",
      model: "XR100",
      description: "Roof mount",
    }));
    expect(result.valid).toBe(true);
  });

  it("returns warning (not error) for sell < cost", () => {
    const result = validateCatalogForm(makeState({
      category: "MODULE",
      brand: "Hanwha",
      model: "Q.PEAK 400",
      description: "400W Module",
      specValues: { wattage: 400 },
      unitCost: "200",
      sellPrice: "150",
    }));
    expect(result.valid).toBe(true); // warning, not error
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0].field).toBe("sellPrice");
  });

  it("blank category skips spec checks, returns only top-level error", () => {
    const result = validateCatalogForm(makeState({
      category: "",
      brand: "Test",
      model: "Test",
      description: "Test",
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].field).toBe("category");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest catalog-form-state --verbose 2>&1 | tail -20`
Expected: FAIL — `validateCatalogForm` is not exported

- [ ] **Step 3: Implement validateCatalogForm**

Append to `src/lib/catalog-form-state.ts`:

```typescript
/**
 * Full client-side validation of the catalog form.
 * Returns blocking errors and non-blocking warnings.
 */
export function validateCatalogForm(state: CatalogFormState): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Top-level required fields
  if (isBlank(state.category)) {
    errors.push({ field: "category", message: "Category is required", section: "basics" });
  }
  if (isBlank(state.brand)) {
    errors.push({ field: "brand", message: "Brand is required", section: "basics" });
  }
  if (isBlank(state.model)) {
    errors.push({ field: "model", message: "Model is required", section: "basics" });
  }
  if (isBlank(state.description)) {
    errors.push({ field: "description", message: "Description is required", section: "basics" });
  }

  // Spec required fields (only when category is known)
  if (!isBlank(state.category)) {
    errors.push(...validateRequiredSpecFields(state.category, state.specValues));
  }

  // Warnings (non-blocking)
  if (state.unitCost && state.sellPrice) {
    const cost = parseFloat(state.unitCost);
    const sell = parseFloat(state.sellPrice);
    if (Number.isFinite(cost) && Number.isFinite(sell) && sell < cost) {
      warnings.push({
        field: "sellPrice",
        message: "Sell price is lower than unit cost",
        section: "review",
      });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest catalog-form-state --verbose 2>&1 | tail -40`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/catalog-form-state.ts src/__tests__/lib/catalog-form-state.test.ts
git commit -m "feat(catalog): add validateCatalogForm() client validation wrapper"
```

---

## Chunk 2: Downstream Readiness + Tests

### Task 4: Create catalog-readiness.ts with tests

**Files:**
- Create: `src/lib/catalog-readiness.ts`
- Create: `src/__tests__/lib/catalog-readiness.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/lib/catalog-readiness.test.ts`:

```typescript
import { getDownstreamReadiness, type SystemReadiness } from "@/lib/catalog-readiness";

// Mock zoho-taxonomy so tests don't depend on live mapping data
jest.mock("@/lib/zoho-taxonomy", () => ({
  hasVerifiedZohoMapping: (cat: string) => cat === "MODULE" || cat === "INVERTER",
  getZohoGroupName: (cat: string) => {
    if (cat === "MODULE") return "Module";
    if (cat === "INVERTER") return "Inverter";
    return undefined;
  },
}));

function findSystem(results: SystemReadiness[], system: string) {
  return results.find((r) => r.system === system);
}

describe("getDownstreamReadiness", () => {
  const allSystems = new Set(["INTERNAL", "HUBSPOT", "ZUPER", "ZOHO"]);

  it("INTERNAL is always ready", () => {
    const results = getDownstreamReadiness({
      category: "MODULE",
      systems: new Set(["INTERNAL"]),
      specValues: {},
    });
    const internal = findSystem(results, "INTERNAL");
    expect(internal?.status).toBe("ready");
  });

  it("ZOHO returns ready for MODULE (confirmed mapping)", () => {
    const results = getDownstreamReadiness({
      category: "MODULE",
      systems: allSystems,
      specValues: { wattage: 400 },
    });
    const zoho = findSystem(results, "ZOHO");
    expect(zoho?.status).toBe("ready");
    expect(zoho?.details[0]).toContain("Module");
  });

  it("ZOHO returns limited for BATTERY (unresolved mapping)", () => {
    const results = getDownstreamReadiness({
      category: "BATTERY",
      systems: allSystems,
      specValues: { capacityKwh: 13.5 },
    });
    const zoho = findSystem(results, "ZOHO");
    expect(zoho?.status).toBe("limited");
    expect(zoho?.details[0]).toContain("No confirmed");
  });

  it("HUBSPOT returns ready when all filled fields have hubspotProperty", () => {
    // MODULE: wattage has hubspotProperty "dc_size" — only filled field
    const results = getDownstreamReadiness({
      category: "MODULE",
      systems: allSystems,
      specValues: { wattage: 400 },
    });
    const hubspot = findSystem(results, "HUBSPOT");
    expect(hubspot?.status).toBe("ready");
  });

  it("HUBSPOT returns partial when some filled fields lack hubspotProperty", () => {
    // MODULE: wattage (mapped) + efficiency (not mapped) both filled
    const results = getDownstreamReadiness({
      category: "MODULE",
      systems: allSystems,
      specValues: { wattage: 400, efficiency: 21.5 },
    });
    const hubspot = findSystem(results, "HUBSPOT");
    expect(hubspot?.status).toBe("partial");
    expect(hubspot?.details.join(" ")).toContain("won't sync");
  });

  it("ZUPER returns ready with spec string for MODULE with wattage", () => {
    const results = getDownstreamReadiness({
      category: "MODULE",
      systems: allSystems,
      specValues: { wattage: 400, cellType: "Mono PERC" },
    });
    const zuper = findSystem(results, "ZUPER");
    expect(zuper?.status).toBe("ready");
    expect(zuper?.details[0]).toContain("400W");
  });

  it("ZUPER returns limited for MODULE without wattage", () => {
    const results = getDownstreamReadiness({
      category: "MODULE",
      systems: allSystems,
      specValues: {},
    });
    const zuper = findSystem(results, "ZUPER");
    expect(zuper?.status).toBe("limited");
  });

  it("only evaluates toggled-on systems", () => {
    const results = getDownstreamReadiness({
      category: "MODULE",
      systems: new Set(["INTERNAL", "ZOHO"]),
      specValues: { wattage: 400 },
    });
    expect(results.map((r) => r.system)).toEqual(["INTERNAL", "ZOHO"]);
    expect(findSystem(results, "HUBSPOT")).toBeUndefined();
    expect(findSystem(results, "ZUPER")).toBeUndefined();
  });

  it("HUBSPOT returns limited for category with no hubspotProperty fields", () => {
    // RACKING has fields but none have hubspotProperty
    const results = getDownstreamReadiness({
      category: "RACKING",
      systems: allSystems,
      specValues: { mountType: "Roof" },
    });
    const hubspot = findSystem(results, "HUBSPOT");
    expect(hubspot?.status).toBe("limited");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest catalog-readiness --verbose 2>&1 | tail -10`
Expected: FAIL — module not found

- [ ] **Step 3: Implement catalog-readiness.ts**

Create `src/lib/catalog-readiness.ts`:

```typescript
// src/lib/catalog-readiness.ts
//
// Computes per-system downstream sync readiness for the Review step.
// Business/sync logic — separate from field config (catalog-fields.ts).

import { getCategoryFields, generateZuperSpecification } from "./catalog-fields";
import { hasVerifiedZohoMapping, getZohoGroupName } from "./zoho-taxonomy";
import { isBlank } from "./catalog-form-state";

export interface SystemReadiness {
  system: "INTERNAL" | "ZOHO" | "HUBSPOT" | "ZUPER";
  status: "ready" | "partial" | "limited";
  details: string[];
}

interface ReadinessInput {
  category: string;
  systems: Set<string>;
  specValues: Record<string, unknown>;
}

const SYSTEM_ORDER: SystemReadiness["system"][] = ["INTERNAL", "HUBSPOT", "ZOHO", "ZUPER"];

function evaluateInternal(): SystemReadiness {
  return {
    system: "INTERNAL",
    status: "ready",
    details: ["Will create/update EquipmentSku"],
  };
}

function evaluateZoho(category: string): SystemReadiness {
  if (hasVerifiedZohoMapping(category)) {
    const groupName = getZohoGroupName(category);
    return {
      system: "ZOHO",
      status: "ready",
      details: [`Zoho group: ${groupName}`],
    };
  }
  return {
    system: "ZOHO",
    status: "limited",
    details: ["No confirmed Zoho group mapping — item created without category group"],
  };
}

function evaluateHubspot(category: string, specValues: Record<string, unknown>): SystemReadiness {
  const fields = getCategoryFields(category);
  const filledMappedNames: string[] = [];
  const filledUnmappedNames: string[] = [];

  for (const field of fields) {
    if (isBlank(specValues[field.key])) continue;
    // Field is filled
    if (field.hubspotProperty) {
      filledMappedNames.push(field.hubspotProperty);
    } else {
      filledUnmappedNames.push(field.label);
    }
  }

  const totalMapped = fields.filter((f) => f.hubspotProperty).length;

  if (totalMapped === 0) {
    return {
      system: "HUBSPOT",
      status: "limited",
      details: ["No spec fields map to HubSpot properties"],
    };
  }

  if (filledUnmappedNames.length === 0) {
    return {
      system: "HUBSPOT",
      status: "ready",
      details: [
        filledMappedNames.length > 0
          ? `Will sync ${filledMappedNames.join(", ")}`
          : `${totalMapped} HubSpot-mapped field(s) available — none filled yet`,
      ],
    };
  }

  return {
    system: "HUBSPOT",
    status: "partial",
    details: [
      filledMappedNames.length > 0
        ? `Will sync ${filledMappedNames.join(", ")}`
        : "No HubSpot-mapped fields filled",
      `${filledUnmappedNames.length} filled field(s) won't sync to HubSpot (${filledUnmappedNames.join(", ")})`,
    ],
  };
}

function evaluateZuper(category: string, specValues: Record<string, unknown>): SystemReadiness {
  const specString = generateZuperSpecification(category, specValues);
  if (specString) {
    return {
      system: "ZUPER",
      status: "ready",
      details: [`Specification: "${specString}"`],
    };
  }
  return {
    system: "ZUPER",
    status: "limited",
    details: ["No specification summary will be generated"],
  };
}

/**
 * Compute downstream sync readiness for each selected system.
 * Returns results in canonical order, only for systems the user toggled on.
 */
export function getDownstreamReadiness(input: ReadinessInput): SystemReadiness[] {
  const results: SystemReadiness[] = [];

  for (const system of SYSTEM_ORDER) {
    if (!input.systems.has(system)) continue;

    switch (system) {
      case "INTERNAL":
        results.push(evaluateInternal());
        break;
      case "ZOHO":
        results.push(evaluateZoho(input.category));
        break;
      case "HUBSPOT":
        results.push(evaluateHubspot(input.category, input.specValues));
        break;
      case "ZUPER":
        results.push(evaluateZuper(input.category, input.specValues));
        break;
    }
  }

  return results;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest catalog-readiness --verbose 2>&1 | tail -20`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/catalog-readiness.ts src/__tests__/lib/catalog-readiness.test.ts
git commit -m "feat(catalog): add getDownstreamReadiness() per-system sync status"
```

---

## Chunk 3: UI Wiring

### Task 5: Update ReviewStep with validation + readiness UI

**Files:**
- Modify: `src/components/catalog/ReviewStep.tsx`

- [ ] **Step 1: Rewrite ReviewStep.tsx**

Replace the entire contents of `src/components/catalog/ReviewStep.tsx` with the following. Key changes:
- Import and call `validateCatalogForm()` on render
- Import and call `getDownstreamReadiness()` on render
- Show required-missing spec rows in red
- Show error summary above submit
- Show warning banner (sell < cost) from validator instead of ad-hoc
- Add "System Sync Preview" card
- Disable submit when `valid === false`

```tsx
"use client";
import { getCategoryLabel, getCategoryFields } from "@/lib/catalog-fields";
import { validateCatalogForm } from "@/lib/catalog-form-state";
import { getDownstreamReadiness } from "@/lib/catalog-readiness";
import type { CatalogFormState, CatalogFormAction } from "@/lib/catalog-form-state";

interface ReviewStepProps {
  state: CatalogFormState;
  dispatch: React.Dispatch<CatalogFormAction>;
  onBack: () => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
}

function Row({
  label,
  value,
  required,
  missing,
}: {
  label: string;
  value: string | null | undefined;
  required?: boolean;
  missing?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between py-1.5 border-b border-t-border/50 last:border-0">
      <span className={`text-sm ${missing ? "text-red-400 font-medium" : "text-muted"}`}>
        {label}
        {required && missing && <span className="ml-1 text-xs">(required)</span>}
      </span>
      <span
        className={`text-sm font-medium ${
          missing ? "text-red-400" : value ? "text-foreground" : "text-muted/50"
        }`}
      >
        {missing ? "Missing" : value || "—"}
      </span>
    </div>
  );
}

const SYSTEM_OPTIONS = ["HUBSPOT", "ZUPER", "ZOHO"] as const;

export default function ReviewStep({
  state,
  dispatch,
  onBack,
  onSubmit,
  submitting,
  error,
}: ReviewStepProps) {
  const { valid, errors, warnings } = validateCatalogForm(state);
  const specFields = getCategoryFields(state.category);
  const readiness = getDownstreamReadiness({
    category: state.category,
    systems: state.systems,
    specValues: state.specValues,
  });

  // Build a set of fields with errors for quick lookup
  const errorFields = new Set(errors.map((e) => e.field));

  // Non-inline errors for the error summary banner (basics errors show inline,
  // but also appear in the summary; spec errors show both inline and in summary)
  const summaryErrors = errors;

  return (
    <div className="space-y-6">
      {/* Product Summary */}
      <div className="bg-surface rounded-xl border border-t-border p-6 shadow-card">
        <h3 className="text-lg font-semibold text-foreground mb-4">Product Summary</h3>
        <Row label="Category" value={getCategoryLabel(state.category) || state.category} required missing={errorFields.has("category")} />
        <Row label="Brand" value={state.brand} required missing={errorFields.has("brand")} />
        <Row label="Model" value={state.model} required missing={errorFields.has("model")} />
        <Row label="Description" value={state.description} required missing={errorFields.has("description")} />
        <Row label="SKU" value={state.sku} />
        <Row label="Vendor" value={state.vendorName} />
        <Row label="Vendor Part #" value={state.vendorPartNumber} />
      </div>

      {/* Specs */}
      {specFields.length > 0 && (
        <div className="bg-surface rounded-xl border border-t-border p-6 shadow-card">
          <h3 className="text-lg font-semibold text-foreground mb-4">Specifications</h3>
          {specFields.map((f) => {
            const hasValue =
              state.specValues[f.key] !== undefined && state.specValues[f.key] !== "";
            const isMissing = errorFields.has(`spec.${f.key}`);
            return (
              <Row
                key={f.key}
                label={f.label}
                value={
                  hasValue
                    ? `${state.specValues[f.key]}${f.unit ? ` ${f.unit}` : ""}`
                    : undefined
                }
                required={f.required}
                missing={isMissing}
              />
            );
          })}
        </div>
      )}

      {/* Pricing & Physical */}
      <div className="bg-surface rounded-xl border border-t-border p-6 shadow-card">
        <h3 className="text-lg font-semibold text-foreground mb-4">Pricing & Physical</h3>
        <Row label="Unit Cost" value={state.unitCost ? `$${state.unitCost}` : undefined} />
        <Row label="Sell Price" value={state.sellPrice ? `$${state.sellPrice}` : undefined} />
        <Row
          label="Unit Spec"
          value={state.unitSpec ? `${state.unitSpec} ${state.unitLabel}` : undefined}
        />
        <Row
          label="Dimensions"
          value={
            state.length || state.width
              ? `${state.length || "—"} × ${state.width || "—"} in`
              : undefined
          }
        />
        <Row label="Weight" value={state.weight ? `${state.weight} lbs` : undefined} />
        <Row label="Hard to Procure" value={state.hardToProcure ? "Yes" : "No"} />
      </div>

      {/* Product Photo */}
      {state.photoUrl && (
        <div className="bg-surface rounded-xl border border-t-border p-6 shadow-card">
          <h3 className="text-lg font-semibold text-foreground mb-4">Product Photo</h3>
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-lg border border-t-border overflow-hidden bg-surface-2 flex-shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={state.photoUrl}
                alt="Product"
                className="w-full h-full object-contain"
              />
            </div>
            <span className="text-sm text-muted">{state.photoFileName || "Uploaded"}</span>
          </div>
        </div>
      )}

      {/* Warnings (non-blocking) */}
      {warnings.length > 0 && (
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3">
          {warnings.map((w, i) => (
            <p key={i} className="text-sm text-amber-400">
              ⚠ {w.message}
            </p>
          ))}
        </div>
      )}

      {/* Systems */}
      <div className="bg-surface rounded-xl border border-t-border p-6 shadow-card">
        <h3 className="text-lg font-semibold text-foreground mb-4">Push to Systems</h3>
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked disabled className="rounded" />
            Internal (always)
          </label>
          {SYSTEM_OPTIONS.map((sys) => (
            <label
              key={sys}
              className="flex items-center gap-2 text-sm text-foreground cursor-pointer"
            >
              <input
                type="checkbox"
                checked={state.systems.has(sys)}
                onChange={() => dispatch({ type: "TOGGLE_SYSTEM", system: sys })}
                className="rounded"
              />
              {sys.charAt(0) + sys.slice(1).toLowerCase()}
            </label>
          ))}
        </div>
      </div>

      {/* System Sync Preview */}
      {readiness.length > 0 && (
        <div className="bg-surface rounded-xl border border-t-border p-6 shadow-card">
          <h3 className="text-lg font-semibold text-foreground mb-4">System Sync Preview</h3>
          <div className="space-y-2">
            {readiness.map((r) => (
              <div key={r.system} className="flex items-start gap-2">
                <span
                  className={`text-sm mt-0.5 ${
                    r.status === "ready" ? "text-green-400" : "text-amber-400"
                  }`}
                >
                  {r.status === "ready" ? "✓" : "⚠"}
                </span>
                <div className="min-w-0">
                  <span className="text-sm font-medium text-foreground">
                    {r.system.charAt(0) + r.system.slice(1).toLowerCase()}
                  </span>
                  <span className="text-sm text-muted ml-2">
                    — {r.details[0]}
                  </span>
                  {r.details.length > 1 && (
                    <p className="text-xs text-muted mt-0.5">{r.details.slice(1).join(" · ")}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Validation Errors */}
      {summaryErrors.length > 0 && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3">
          <p className="text-sm font-medium text-red-400 mb-1">
            {summaryErrors.length} required field{summaryErrors.length > 1 ? "s" : ""} missing:
          </p>
          {summaryErrors.map((e, i) => (
            <p key={i} className="text-sm text-red-400">
              • {e.message}
            </p>
          ))}
        </div>
      )}

      {/* Server/submit error */}
      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-2 text-sm text-muted hover:text-foreground transition-colors"
        >
          ← Back to Details
        </button>
        <button
          type="button"
          disabled={submitting || !valid}
          onClick={onSubmit}
          className="px-8 py-3 text-sm font-semibold rounded-lg bg-cyan-600 text-white hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? "Submitting..." : !valid ? "Fix required fields" : "Submit for Approval"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify no TypeScript errors**

Run: `npx tsc --noEmit 2>&1 | grep -i "ReviewStep\|catalog-readiness\|catalog-form-state" || echo "No errors"`
Expected: "No errors"

- [ ] **Step 3: Commit**

```bash
git add src/components/catalog/ReviewStep.tsx
git commit -m "feat(catalog): wire validation errors + downstream readiness UI in ReviewStep"
```

---

### Task 6: Update DetailsStep conditional header

**Files:**
- Modify: `src/components/catalog/DetailsStep.tsx:64-72`

- [ ] **Step 1: Add import and conditional header logic**

In `src/components/catalog/DetailsStep.tsx`, add `getCategoryFields` to the imports (currently only has `CategoryFields` and `FieldTooltip` imported; `getCategoryFields` is not used yet):

```typescript
// Add at top of file, after existing imports:
import { getCategoryFields } from "@/lib/catalog-fields";
```

Then find the "Category Specs" section (around line 68-72) and replace the header:

```tsx
// Replace lines 70-72:
// FROM:
        <h3 className="text-lg font-semibold text-foreground mb-4">
          Category Specifications <OptionalBadge />
        </h3>

// TO:
        <h3 className="text-lg font-semibold text-foreground mb-4">
          Category Specifications
          {!getCategoryFields(state.category).some((f) => f.required) && <OptionalBadge />}
        </h3>
```

- [ ] **Step 2: Also update the intro text conditionally**

Replace the intro paragraph (line 64-66):

```tsx
// FROM:
      <p className="text-sm text-muted">
        These fields are optional — fill what you have, skip the rest.
      </p>

// TO:
      <p className="text-sm text-muted">
        {getCategoryFields(state.category).some((f) => f.required)
          ? "Fields marked with * are required. Fill in what you have for the rest."
          : "These fields are optional — fill what you have, skip the rest."}
      </p>
```

- [ ] **Step 3: Verify no TypeScript errors**

Run: `npx tsc --noEmit 2>&1 | grep DetailsStep || echo "No errors"`
Expected: "No errors"

- [ ] **Step 4: Commit**

```bash
git add src/components/catalog/DetailsStep.tsx
git commit -m "feat(catalog): conditional 'optional' badge on DetailsStep when required fields exist"
```

---

### Task 7: Add client-side validation gate in handleSubmit

**Files:**
- Modify: `src/app/dashboards/submit-product/page.tsx:179-225`

- [ ] **Step 1: Add import**

In `src/app/dashboards/submit-product/page.tsx`, add `validateCatalogForm` to the imports from `catalog-form-state`:

```typescript
// Line 12-16 — change from:
import {
  catalogFormReducer,
  initialFormState,
  type CatalogFormState,
} from "@/lib/catalog-form-state";

// to:
import {
  catalogFormReducer,
  initialFormState,
  validateCatalogForm,
  type CatalogFormState,
} from "@/lib/catalog-form-state";
```

- [ ] **Step 2: Add validation gate at the start of handleSubmit**

Find `async function handleSubmit()` (around line 179) and add validation at the start of the try block:

```typescript
  async function handleSubmit() {
    setError(null);
    setSubmitting(true);

    try {
      // Client-side validation gate — safety net against step navigation bypass
      const validation = validateCatalogForm(state);
      if (!validation.valid) {
        setError(
          `Missing required fields: ${validation.errors.map((e) => e.message).join("; ")}`
        );
        setSubmitting(false);
        return;
      }

      const payload = {
        // ... rest of existing code unchanged
```

- [ ] **Step 3: Verify no TypeScript errors**

Run: `npx tsc --noEmit 2>&1 | grep submit-product || echo "No errors"`
Expected: "No errors"

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboards/submit-product/page.tsx
git commit -m "feat(catalog): add client-side validation gate in handleSubmit"
```

---

## Chunk 4: Server-Side Validation

### Task 8: Add server-side validation in POST route

**Files:**
- Modify: `src/app/api/catalog/push-requests/route.ts:1-53`

- [ ] **Step 1: Add imports**

In `src/app/api/catalog/push-requests/route.ts`, add the new imports:

```typescript
// After line 5 (the existing FORM_CATEGORIES import), add:
import { isBlank, validateRequiredSpecFields } from "@/lib/catalog-form-state";
```

- [ ] **Step 2: Replace truthiness guards with isBlank + add spec validation**

Replace lines 37-53 (the existing validation block) with:

```typescript
  // Top-level required fields — use isBlank() so whitespace-only values are rejected
  const topLevelRequired = { brand, model, description, category } as Record<string, unknown>;
  const missingTopLevel = Object.entries(topLevelRequired)
    .filter(([, v]) => isBlank(v))
    .map(([k]) => k);
  if (missingTopLevel.length > 0) {
    return NextResponse.json(
      { error: `Required fields missing: ${missingTopLevel.join(", ")}` },
      { status: 400 }
    );
  }

  const normalizedCategory = String(category).trim();
  if (!VALID_CATEGORIES.has(normalizedCategory)) {
    return NextResponse.json({ error: `Invalid category: ${normalizedCategory}` }, { status: 400 });
  }

  // Required spec field validation
  const specMetadata = metadata && typeof metadata === "object"
    ? (metadata as Record<string, unknown>)
    : {};
  const specErrors = validateRequiredSpecFields(normalizedCategory, specMetadata);
  if (specErrors.length > 0) {
    return NextResponse.json(
      {
        error: `Required spec fields missing: ${specErrors.map((e) => e.message).join("; ")}`,
        missingFields: specErrors.map((e) => e.field),
      },
      { status: 400 }
    );
  }

  if (!Array.isArray(systems) || systems.length === 0) {
    return NextResponse.json({ error: "systems must be a non-empty array" }, { status: 400 });
  }
  if (!systems.every((s): s is string => typeof s === "string")) {
    return NextResponse.json({ error: "systems must be an array of strings" }, { status: 400 });
  }
  const invalidSystems = systems.filter((s) => !(VALID_SYSTEMS as readonly string[]).includes(s));
  if (invalidSystems.length > 0) {
    return NextResponse.json({ error: `Invalid systems: ${invalidSystems.join(", ")}` }, { status: 400 });
  }
```

- [ ] **Step 3: Verify no TypeScript errors**

Run: `npx tsc --noEmit 2>&1 | grep push-requests || echo "No errors"`
Expected: "No errors"

- [ ] **Step 4: Run all tests**

Run: `npx jest --verbose 2>&1 | tail -30`
Expected: All existing + new tests pass

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/catalog/push-requests/route.ts"
git commit -m "feat(catalog): add server-side isBlank + required spec field validation in POST route"
```

---

### Task 9: Update API tests for required spec validation

**Files:**
- Modify: `src/__tests__/api/catalog-push-requests.test.ts`

The server route now rejects BATTERY/INVERTER/MODULE/EV_CHARGER requests missing required spec fields. Several existing tests send these categories without metadata and expect `201`. They need to include the required spec field in their `metadata` payload. Additionally, new tests verify the 400 response for missing specs.

- [ ] **Step 1: Fix existing tests that will break**

In `src/__tests__/api/catalog-push-requests.test.ts`, update every test that submits a BATTERY, INVERTER, MODULE, or EV_CHARGER payload expecting `201` to include the required spec field in `metadata`:

```typescript
// Line 54-60 — "creates a push request with valid data" (BATTERY)
// Add metadata with capacityKwh:
const req = makeRequest({
  brand: "Tesla",
  model: "1707000-XX-Y",
  description: "Powerwall 3",
  category: "BATTERY",
  systems: ["INTERNAL", "ZOHO"],
  metadata: { capacityKwh: 13.5 },
});

// Line 72-77 — "passes correct fields to prisma create" (INVERTER)
// Add metadata with acOutputKw:
const req = makeRequest({
  brand: "  Enphase  ",
  model: "IQ8Plus",
  description: "Microinverter",
  category: "INVERTER",
  systems: ["INTERNAL"],
  metadata: { acOutputKw: 0.29 },
});

// Line 168-173 — "accepts all valid system names" (INVERTER)
// Add metadata with acOutputKw:
const req = makeRequest({
  brand: "SolarEdge",
  model: "SE7600H",
  description: "Inverter",
  category: "INVERTER",
  systems: ["INTERNAL", "ZOHO", "HUBSPOT", "ZUPER"],
  metadata: { acOutputKw: 7.6 },
});

// Line 184-194 — "preserves zero numeric values" (BATTERY)
// Add metadata with capacityKwh:
const req = makeRequest({
  brand: "Tesla",
  model: "Powerwall 3",
  description: "Battery",
  category: "BATTERY",
  systems: ["INTERNAL"],
  unitCost: 0,
  sellPrice: 0,
  length: 0,
  width: 0,
  weight: 0,
  metadata: { capacityKwh: 13.5 },
});
```

Note: Tests for RACKING, invalid categories, empty systems, etc. need no changes because RACKING has no required spec fields and the other tests fail before spec validation.

- [ ] **Step 2: Add new tests for required spec field rejection**

Append to the `describe("POST /api/catalog/push-requests")` block:

```typescript
  it("returns 400 when required spec field is missing for BATTERY", async () => {
    const req = makeRequest({
      brand: "Tesla",
      model: "Powerwall 3",
      description: "Battery",
      category: "BATTERY",
      systems: ["INTERNAL"],
      metadata: {},
    });
    const res = await postRequest(req);

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("capacityKwh");
    expect(data.missingFields).toContain("spec.capacityKwh");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 400 when required spec field is missing for MODULE", async () => {
    const req = makeRequest({
      brand: "Hanwha",
      model: "Q.PEAK 400",
      description: "Module",
      category: "MODULE",
      systems: ["INTERNAL"],
      metadata: { efficiency: 21.5 },
    });
    const res = await postRequest(req);

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("wattage");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("passes when required spec field is present in metadata", async () => {
    mockCreate.mockResolvedValue({ id: "push_5", status: "PENDING" });

    const req = makeRequest({
      brand: "Hanwha",
      model: "Q.PEAK 400",
      description: "400W Module",
      category: "MODULE",
      systems: ["INTERNAL"],
      metadata: { wattage: 400, efficiency: 21.5 },
    });
    const res = await postRequest(req);

    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("returns 400 for whitespace-only required fields", async () => {
    const req = makeRequest({
      brand: "  ",
      model: "Test",
      description: "Test",
      category: "MODULE",
      systems: ["INTERNAL"],
      metadata: { wattage: 400 },
    });
    const res = await postRequest(req);

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("brand");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("accepts RACKING without metadata (no required spec fields)", async () => {
    mockCreate.mockResolvedValue({ id: "push_6", status: "PENDING" });

    const req = makeRequest({
      brand: "IronRidge",
      model: "XR100",
      description: "Roof mount",
      category: "RACKING",
      systems: ["INTERNAL"],
    });
    const res = await postRequest(req);

    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 3: Run API tests to verify all pass**

Run: `npx jest catalog-push-requests --verbose 2>&1 | tail -30`
Expected: All existing (now-fixed) + new tests PASS

- [ ] **Step 4: Commit**

```bash
git add "src/__tests__/api/catalog-push-requests.test.ts"
git commit -m "test(catalog): update API tests for required spec field server validation"
```

---

### Task 10: Final verification and cleanup commit

- [ ] **Step 1: Run full test suite**

Run: `npx jest --verbose 2>&1 | tail -40`
Expected: All tests pass, no regressions

- [ ] **Step 2: Run TypeScript check**

Run: `npx tsc --noEmit 2>&1 | grep -c "error" || echo "0 errors"`
Expected: Only pre-existing Next.js/React type issues in node_modules, none in src/

- [ ] **Step 3: Run lint**

Run: `npm run lint 2>&1 | tail -10`
Expected: No new lint errors

- [ ] **Step 4: Manual smoke test (if dev server available)**

1. Go to `/dashboards/submit-product`
2. Select MODULE category
3. Fill brand, model, description but skip wattage
4. Go to Review — should see red "Missing" indicator on Wattage row
5. Submit button should say "Fix required fields" and be disabled
6. Fill wattage, go back to Review — error clears, submit enabled
7. Check System Sync Preview card shows correct per-system status

---
