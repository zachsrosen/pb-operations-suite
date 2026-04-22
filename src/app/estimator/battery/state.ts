"use client";

import type { AddressParts, Location } from "@/lib/estimator";

import type { SharedContact } from "../shared/SharedContactStep";
import { INITIAL_CONTACT } from "../shared/SharedContactStep";

export type UtilityOption = { id: string; displayName: string; kwhRate: number };

export type BatteryState = {
  addressInput: Partial<AddressParts>;
  normalizedAddress: AddressParts | null;
  location: Location | null;
  utilities: UtilityOption[];
  utilityId: string | null;
  batteryCount: number;
  contact: SharedContact;
};

export const INITIAL_STATE: BatteryState = {
  addressInput: {},
  normalizedAddress: null,
  location: null,
  utilities: [],
  utilityId: null,
  batteryCount: 1,
  contact: INITIAL_CONTACT,
};

export type BatteryAction =
  | { type: "reset" }
  | { type: "setAddressInput"; value: Partial<AddressParts> }
  | {
      type: "setValidatedAddress";
      address: AddressParts;
      location: Location | null;
      utilities: UtilityOption[];
    }
  | { type: "setUtility"; utilityId: string }
  | { type: "setBatteryCount"; value: number }
  | { type: "setContact"; value: SharedContact }
  | { type: "hydrate"; value: BatteryState };

export function reducer(state: BatteryState, action: BatteryAction): BatteryState {
  switch (action.type) {
    case "reset":
      return INITIAL_STATE;
    case "setAddressInput":
      return { ...state, addressInput: { ...state.addressInput, ...action.value } };
    case "setValidatedAddress": {
      const utilityStillPresent =
        state.utilityId && action.utilities.some((u) => u.id === state.utilityId);
      return {
        ...state,
        normalizedAddress: action.address,
        location: action.location,
        utilities: action.utilities,
        utilityId: utilityStillPresent ? state.utilityId : action.utilities[0]?.id ?? null,
      };
    }
    case "setUtility":
      return { ...state, utilityId: action.utilityId };
    case "setBatteryCount":
      return { ...state, batteryCount: Math.max(1, Math.min(6, Math.floor(action.value))) };
    case "setContact":
      return { ...state, contact: action.value };
    case "hydrate":
      return action.value;
    default:
      return state;
  }
}

const DRAFT_KEY = "pb:estimator:battery:draft";

export function loadDraft(): BatteryState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as BatteryState;
  } catch {
    return null;
  }
}

export function saveDraft(state: BatteryState): void {
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

export type BatteryStep = "address" | "utility" | "count" | "contact";
export const STEPS: BatteryStep[] = ["address", "utility", "count", "contact"];
export function stepIndex(step: BatteryStep): number {
  return STEPS.indexOf(step);
}
export function parseStep(param: string | null): BatteryStep {
  if (param === "utility" || param === "count" || param === "contact") return param;
  return "address";
}
