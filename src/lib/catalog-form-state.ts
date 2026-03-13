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
      const filledFields = new Set<string>();
      const updates: Partial<CatalogFormState> = {};
      for (const [key, value] of Object.entries(action.data)) {
        if (value !== undefined && value !== null && value !== "") {
          (updates as Record<string, unknown>)[key] = value;
          filledFields.add(key);
        }
      }
      if (action.source === "clone") {
        for (const f of CLONE_CLEAR_FIELDS) {
          (updates as Record<string, unknown>)[f] = "";
          filledFields.delete(f);
        }
      }
      return {
        ...state,
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
