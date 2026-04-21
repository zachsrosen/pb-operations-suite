"use client";

import type {
  AddressParts,
  Considerations,
  Location,
  RoofType,
  ShadeBucket,
  Usage,
} from "@/lib/estimator";

export type UtilityOption = {
  id: string;
  displayName: string;
  avgBlendedRateUsdPerKwh: number;
};

export type WizardState = {
  addressInput: Partial<AddressParts>;
  normalizedAddress: AddressParts | null;
  inServiceArea: boolean | null;
  location: Location | null;
  utilities: UtilityOption[];
  utilityId: string | null;
  usage: Usage | null;
  roofType: RoofType | null;
  shade: ShadeBucket | null;
  heatPump: boolean | null;
  considerations: Considerations;
  contact: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    referredBy: string;
    notes: string;
  };
};

export const INITIAL_STATE: WizardState = {
  addressInput: {},
  normalizedAddress: null,
  inServiceArea: null,
  location: null,
  utilities: [],
  utilityId: null,
  usage: null,
  roofType: null,
  shade: null,
  heatPump: null,
  considerations: {
    planningEv: false,
    needsPanelUpgrade: false,
    planningHotTub: false,
    mayNeedNewRoof: false,
  },
  contact: {
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    referredBy: "",
    notes: "",
  },
};

export type WizardAction =
  | { type: "reset" }
  | { type: "setAddressInput"; value: Partial<AddressParts> }
  | {
      type: "setValidatedAddress";
      address: AddressParts;
      location: Location | null;
      inServiceArea: boolean;
      utilities: UtilityOption[];
    }
  | { type: "setUtility"; utilityId: string }
  | { type: "setUsage"; usage: Usage }
  | { type: "setRoofType"; value: RoofType }
  | { type: "setShade"; value: ShadeBucket }
  | { type: "setHeatPump"; value: boolean }
  | { type: "setConsiderations"; value: Considerations }
  | { type: "setContact"; value: WizardState["contact"] }
  | { type: "hydrate"; value: WizardState };

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "reset":
      return INITIAL_STATE;
    case "setAddressInput":
      return { ...state, addressInput: { ...state.addressInput, ...action.value } };
    case "setValidatedAddress": {
      // Preserve prior utility only if still present in new list.
      const utilityStillPresent =
        state.utilityId && action.utilities.some((u) => u.id === state.utilityId);
      return {
        ...state,
        normalizedAddress: action.address,
        inServiceArea: action.inServiceArea,
        location: action.location,
        utilities: action.utilities,
        utilityId: utilityStillPresent
          ? state.utilityId
          : action.utilities[0]?.id ?? null,
      };
    }
    case "setUtility":
      return { ...state, utilityId: action.utilityId };
    case "setUsage":
      return { ...state, usage: action.usage };
    case "setRoofType":
      return { ...state, roofType: action.value };
    case "setShade":
      return { ...state, shade: action.value };
    case "setHeatPump":
      return { ...state, heatPump: action.value };
    case "setConsiderations":
      return { ...state, considerations: action.value };
    case "setContact":
      return { ...state, contact: action.value };
    case "hydrate":
      return action.value;
    default:
      return state;
  }
}

export const DRAFT_KEY = "pb:estimator:draft";

export function loadDraft(): WizardState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WizardState;
    return parsed;
  } catch {
    return null;
  }
}

export function saveDraft(state: WizardState): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(state));
  } catch {
    // ignore quota errors
  }
}

export function clearDraft(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // ignore
  }
}

export type WizardStep = "address" | "roof" | "usage" | "contact";

export const STEPS: WizardStep[] = ["address", "roof", "usage", "contact"];

export function stepIndex(step: WizardStep): number {
  return STEPS.indexOf(step);
}

export function parseStep(param: string | null): WizardStep {
  if (param === "roof" || param === "usage" || param === "contact") return param;
  return "address";
}
