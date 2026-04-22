"use client";

import type { AddressParts, Location } from "@/lib/estimator";

import type { SharedContact } from "../shared/SharedContactStep";
import { INITIAL_CONTACT } from "../shared/SharedContactStep";

export type SystemExpansionState = {
  addressInput: Partial<AddressParts>;
  normalizedAddress: AddressParts | null;
  location: Location | null;
  currentSystemKwDc: number;
  addedPanelCount: number;
  contact: SharedContact;
};

export const INITIAL_STATE: SystemExpansionState = {
  addressInput: {},
  normalizedAddress: null,
  location: null,
  currentSystemKwDc: 0,
  addedPanelCount: 1,
  contact: INITIAL_CONTACT,
};

export type SystemExpansionAction =
  | { type: "reset" }
  | { type: "setAddressInput"; value: Partial<AddressParts> }
  | { type: "setValidatedAddress"; address: AddressParts; location: Location | null }
  | { type: "setCurrentSystemKwDc"; value: number }
  | { type: "setAddedPanelCount"; value: number }
  | { type: "setContact"; value: SharedContact }
  | { type: "hydrate"; value: SystemExpansionState };

export function reducer(
  state: SystemExpansionState,
  action: SystemExpansionAction,
): SystemExpansionState {
  switch (action.type) {
    case "reset":
      return INITIAL_STATE;
    case "setAddressInput":
      return { ...state, addressInput: { ...state.addressInput, ...action.value } };
    case "setValidatedAddress":
      return {
        ...state,
        normalizedAddress: action.address,
        location: action.location,
      };
    case "setCurrentSystemKwDc":
      return { ...state, currentSystemKwDc: action.value };
    case "setAddedPanelCount":
      return { ...state, addedPanelCount: action.value };
    case "setContact":
      return { ...state, contact: action.value };
    case "hydrate":
      return action.value;
    default:
      return state;
  }
}

const DRAFT_KEY = "pb:estimator:system-expansion:draft";

export function loadDraft(): SystemExpansionState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SystemExpansionState;
  } catch {
    return null;
  }
}

export function saveDraft(state: SystemExpansionState): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(state));
  } catch {
    // ignore
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

export type SystemExpansionStep = "address" | "existing" | "added" | "contact";
export const STEPS: SystemExpansionStep[] = ["address", "existing", "added", "contact"];
export function stepIndex(step: SystemExpansionStep): number {
  return STEPS.indexOf(step);
}
export function parseStep(param: string | null): SystemExpansionStep {
  if (param === "existing" || param === "added" || param === "contact") return param;
  return "address";
}
