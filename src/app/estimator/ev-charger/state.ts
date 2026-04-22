"use client";

import type { AddressParts, Location } from "@/lib/estimator";

import type { SharedContact } from "../shared/SharedContactStep";
import { INITIAL_CONTACT } from "../shared/SharedContactStep";

export type EvChargerState = {
  addressInput: Partial<AddressParts>;
  normalizedAddress: AddressParts | null;
  location: Location | null;
  extraConduitFeet: number;
  contact: SharedContact;
};

export const INITIAL_STATE: EvChargerState = {
  addressInput: {},
  normalizedAddress: null,
  location: null,
  extraConduitFeet: 0,
  contact: INITIAL_CONTACT,
};

export type EvChargerAction =
  | { type: "reset" }
  | { type: "setAddressInput"; value: Partial<AddressParts> }
  | { type: "setValidatedAddress"; address: AddressParts; location: Location | null }
  | { type: "setExtraConduitFeet"; value: number }
  | { type: "setContact"; value: SharedContact }
  | { type: "hydrate"; value: EvChargerState };

export function reducer(state: EvChargerState, action: EvChargerAction): EvChargerState {
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
    case "setExtraConduitFeet":
      return { ...state, extraConduitFeet: action.value };
    case "setContact":
      return { ...state, contact: action.value };
    case "hydrate":
      return action.value;
    default:
      return state;
  }
}

const DRAFT_KEY = "pb:estimator:ev-charger:draft";

export function loadDraft(): EvChargerState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as EvChargerState;
  } catch {
    return null;
  }
}

export function saveDraft(state: EvChargerState): void {
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

export type EvChargerStep = "address" | "details" | "contact";
export const STEPS: EvChargerStep[] = ["address", "details", "contact"];
export function stepIndex(step: EvChargerStep): number {
  return STEPS.indexOf(step);
}
export function parseStep(param: string | null): EvChargerStep {
  if (param === "details" || param === "contact") return param;
  return "address";
}
