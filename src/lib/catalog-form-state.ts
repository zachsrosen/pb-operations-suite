import { getCategoryFields } from "./catalog-fields";

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
  | { type: "PREFILL_FROM_PRODUCT"; data: Partial<CatalogFormState>; source: "clone" | "datasheet" }
  | { type: "CLEAR_PREFILL_FIELD"; field: string }
  | { type: "RESET" };

export function catalogFormReducer(
  state: CatalogFormState,
  action: CatalogFormAction
): CatalogFormState {
  switch (action.type) {
    case "SET_FIELD":
      return { ...state, [action.field]: action.value };

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
