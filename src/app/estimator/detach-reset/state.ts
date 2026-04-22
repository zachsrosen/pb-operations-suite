"use client";

import type { AddressParts } from "@/lib/estimator";

import type { SharedContact } from "../shared/SharedContactStep";
import { INITIAL_CONTACT } from "../shared/SharedContactStep";

export type DetachResetState = {
  fromAddressInput: Partial<AddressParts>;
  fromAddress: AddressParts | null;
  toAddressInput: Partial<AddressParts>;
  toAddress: AddressParts | null;
  currentSystemKwDc: number;
  message: string;
  contact: SharedContact;
};

export const INITIAL_STATE: DetachResetState = {
  fromAddressInput: {},
  fromAddress: null,
  toAddressInput: {},
  toAddress: null,
  currentSystemKwDc: 0,
  message: "",
  contact: INITIAL_CONTACT,
};

export type DetachResetAction =
  | { type: "reset" }
  | { type: "setFromAddressInput"; value: Partial<AddressParts> }
  | { type: "setFromAddress"; value: AddressParts }
  | { type: "setToAddressInput"; value: Partial<AddressParts> }
  | { type: "setToAddress"; value: AddressParts }
  | { type: "setCurrentSystemKwDc"; value: number }
  | { type: "setMessage"; value: string }
  | { type: "setContact"; value: SharedContact }
  | { type: "hydrate"; value: DetachResetState };

export function reducer(state: DetachResetState, action: DetachResetAction): DetachResetState {
  switch (action.type) {
    case "reset":
      return INITIAL_STATE;
    case "setFromAddressInput":
      return {
        ...state,
        fromAddressInput: { ...state.fromAddressInput, ...action.value },
      };
    case "setFromAddress":
      return { ...state, fromAddress: action.value };
    case "setToAddressInput":
      return { ...state, toAddressInput: { ...state.toAddressInput, ...action.value } };
    case "setToAddress":
      return { ...state, toAddress: action.value };
    case "setCurrentSystemKwDc":
      return { ...state, currentSystemKwDc: action.value };
    case "setMessage":
      return { ...state, message: action.value };
    case "setContact":
      return { ...state, contact: action.value };
    case "hydrate":
      return action.value;
    default:
      return state;
  }
}

const DRAFT_KEY = "pb:estimator:detach-reset:draft";

export function loadDraft(): DetachResetState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DetachResetState;
  } catch {
    return null;
  }
}

export function saveDraft(state: DetachResetState): void {
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

export type DetachResetStep = "from-address" | "to-address" | "existing" | "contact";
export const STEPS: DetachResetStep[] = ["from-address", "to-address", "existing", "contact"];
export function stepIndex(step: DetachResetStep): number {
  return STEPS.indexOf(step);
}
export function parseStep(param: string | null): DetachResetStep {
  if (param === "to-address" || param === "existing" || param === "contact") return param;
  return "from-address";
}
