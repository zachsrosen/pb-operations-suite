import { getCategoryFields, getCategoryLabel } from "./catalog-fields";

export interface CatalogFormState {
  // Step 1: Basics (also includes SKU/vendor for duplicate lookup)
  category: string;
  brand: string;
  model: string;
  description: string;
  sku: string;
  vendorPartNumber: string;
  // Step 2: Details
  vendorName: string;
  zohoVendorId: string;
  vendorHint: string;   // UI-only hint from AI extract or legacy clone; not persisted to DB
  unitSpec: string;
  unitLabel: string;
  unitCost: string;
  sellPrice: string;
  hardToProcure: boolean;
  length: string;
  width: string;
  weight: string;
  specValues: Record<string, unknown>;
  // Photo
  photoUrl: string;
  photoFileName: string;
  // Step 3: Systems
  systems: Set<string>;
  // Prefill tracking
  prefillSource: "clone" | "datasheet" | null;
  prefillFields: Set<string>;
}

export const initialFormState: CatalogFormState = {
  category: "",
  brand: "",
  model: "",
  description: "",
  sku: "",
  vendorPartNumber: "",
  vendorName: "",
  zohoVendorId: "",
  vendorHint: "",
  unitSpec: "",
  unitLabel: "",
  unitCost: "",
  sellPrice: "",
  hardToProcure: false,
  length: "",
  width: "",
  weight: "",
  specValues: {},
  photoUrl: "",
  photoFileName: "",
  systems: new Set(["INTERNAL"]),
  prefillSource: null,
  prefillFields: new Set(),
};

// Fields that are cleared when cloning (must be unique per product)
const CLONE_CLEAR_FIELDS = ["sku", "vendorPartNumber"] as const;

export type CatalogFormAction =
  | { type: "SET_FIELD"; field: keyof CatalogFormState; value: unknown }
  | { type: "SET_CATEGORY"; category: string }
  | { type: "SET_SPEC"; key: string; value: unknown }
  | { type: "TOGGLE_SYSTEM"; system: string }
  | { type: "SET_VENDOR"; vendorName: string; zohoVendorId: string }
  | { type: "PREFILL_FROM_PRODUCT"; data: Partial<CatalogFormState>; source: "clone" | "datasheet" }
  | { type: "CLEAR_PREFILL_FIELD"; field: string }
  | { type: "RESET" };

export function catalogFormReducer(
  state: CatalogFormState,
  action: CatalogFormAction
): CatalogFormState {
  switch (action.type) {
    case "SET_FIELD": {
      const next = { ...state, [action.field]: action.value };
      // Defensive invariant: if vendorName is changed directly, clear zohoVendorId
      if (action.field === "vendorName") {
        next.zohoVendorId = "";
      }
      return next;
    }

    case "SET_VENDOR":
      return {
        ...state,
        vendorName: action.vendorName,
        zohoVendorId: action.zohoVendorId,
      };

    case "SET_CATEGORY":
      return { ...state, category: action.category, specValues: {} };

    case "SET_SPEC":
      return {
        ...state,
        specValues: { ...state.specValues, [action.key]: action.value },
      };

    case "TOGGLE_SYSTEM": {
      if (action.system === "INTERNAL") return state; // can't toggle off
      const next = new Set(state.systems);
      if (next.has(action.system)) next.delete(action.system);
      else next.add(action.system);
      return { ...state, systems: next };
    }

    case "PREFILL_FROM_PRODUCT": {
      // P1 fix: reset to initial state first so stale values from a
      // previous clone/import don't leak into the new product.
      const base = { ...initialFormState };
      const filledFields = new Set<string>();
      const updates: Partial<CatalogFormState> = {};
      // Determine valid spec keys for the target category so we only
      // count/store fields the form will actually display.
      const targetCategory = (action.data.category as string) || "";
      const validSpecKeys = targetCategory
        ? new Set(getCategoryFields(targetCategory).map((f) => f.key))
        : null; // null = accept all (no category known yet)
      for (const [key, value] of Object.entries(action.data)) {
        if (value !== undefined && value !== null && value !== "") {
          if (key === "specValues" && typeof value === "object" && value !== null) {
            // P2 fix: track individual spec keys as "spec.<key>" so the
            // Details step can highlight/clear per-field, not as one blob.
            // Filter to only category-relevant keys.
            const raw = value as Record<string, unknown>;
            const filtered: Record<string, unknown> = {};
            for (const [specKey, specVal] of Object.entries(raw)) {
              if (specVal === undefined || specVal === null || specVal === "") continue;
              if (validSpecKeys && !validSpecKeys.has(specKey)) continue;
              filtered[specKey] = specVal;
              filledFields.add(`spec.${specKey}`);
            }
            (updates as Record<string, unknown>).specValues = filtered;
          } else {
            (updates as Record<string, unknown>)[key] = value;
            filledFields.add(key);
          }
        }
      }
      // Legacy vendor handling: if vendorName present but zohoVendorId missing,
      // move vendorName to vendorHint so the picker shows it as a suggestion,
      // and clear vendorName so the user must re-select from the list.
      if (updates.vendorName && !updates.zohoVendorId) {
        (updates as Record<string, unknown>).vendorHint = updates.vendorName;
        delete (updates as Record<string, unknown>).vendorName;
        filledFields.delete("vendorName");
      }
      if (action.source === "clone") {
        for (const f of CLONE_CLEAR_FIELDS) {
          (updates as Record<string, unknown>)[f] = "";
          filledFields.delete(f);
        }
      }
      return {
        ...base,
        ...updates,
        prefillSource: action.source,
        prefillFields: filledFields,
      };
    }

    case "CLEAR_PREFILL_FIELD": {
      const next = new Set(state.prefillFields);
      next.delete(action.field);
      return { ...state, prefillFields: next };
    }

    case "RESET":
      return initialFormState;

    default:
      return state;
  }
}

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

  // Vendor pair warning: name set without Zoho ID
  if (state.vendorName && !state.zohoVendorId) {
    warnings.push({
      field: "vendorName",
      message: "Vendor selected without Zoho ID — product won't sync to Zoho Inventory",
      section: "details",
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}
