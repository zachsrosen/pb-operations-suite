// src/__tests__/lib/sync-modal-logic.test.ts
// Tests for SyncModal intent manipulation logic (global toggle, reset auto decisions)

import type { ExternalSystem, FieldIntent } from "@/lib/catalog-sync-types";
import { EXTERNAL_SYSTEMS } from "@/lib/catalog-sync-types";

type IntentsMap = Record<ExternalSystem, Record<string, FieldIntent>>;

// ── Reproduce the exact logic from SyncModal ──

function handleGlobalToggle(intents: IntentsMap, newValue: boolean): IntentsMap {
  const updated = JSON.parse(JSON.stringify(intents));
  for (const system of EXTERNAL_SYSTEMS) {
    for (const intent of Object.values(updated[system] ?? {})) {
      // Only seed auto-managed fields; preserve manual per-field overrides
      if (intent.mode === "auto") {
        intent.updateInternalOnPull = newValue;
      }
    }
  }
  return updated;
}

function resetAutoDecisions(
  intents: IntentsMap,
  serverDefaults: IntentsMap,
): IntentsMap {
  const updated = JSON.parse(JSON.stringify(intents));
  for (const system of EXTERNAL_SYSTEMS) {
    for (const [field, intent] of Object.entries(updated[system] ?? {})) {
      // Only reset auto-managed (cascade-derived) fields back to server defaults;
      // preserve fields the user explicitly set (mode === "manual")
      if (intent.mode === "auto") {
        const serverDefault = serverDefaults[system]?.[field];
        if (serverDefault) {
          updated[system][field] = { ...serverDefault, mode: "auto" };
        }
      }
    }
  }
  return updated;
}

// ── Tests ──

describe("handleGlobalToggle", () => {
  it("only affects auto-managed fields, preserves manual overrides", () => {
    const intents: IntentsMap = {
      zoho: {
        rate: { direction: "pull", mode: "manual", updateInternalOnPull: true },
      },
      hubspot: {
        price: { direction: "push", mode: "auto", updateInternalOnPull: true },
        name: { direction: "push", mode: "auto", updateInternalOnPull: true },
      },
      zuper: {},
    };

    const result = handleGlobalToggle(intents, false);

    // Manual field should be untouched
    expect(result.zoho.rate.updateInternalOnPull).toBe(true);
    // Auto fields should be updated
    expect(result.hubspot.price.updateInternalOnPull).toBe(false);
    expect(result.hubspot.name.updateInternalOnPull).toBe(false);
  });

  it("toggles back preserving manual overrides", () => {
    const intents: IntentsMap = {
      zoho: {},
      hubspot: {
        price: { direction: "push", mode: "auto", updateInternalOnPull: false },
      },
      zuper: {
        sku: { direction: "pull", mode: "manual", updateInternalOnPull: false },
      },
    };

    const result = handleGlobalToggle(intents, true);

    // Auto field toggled on
    expect(result.hubspot.price.updateInternalOnPull).toBe(true);
    // Manual field preserved at false
    expect(result.zuper.sku.updateInternalOnPull).toBe(false);
  });
});

describe("resetAutoDecisions", () => {
  it("resets auto-managed fields to server defaults, preserves manual choices", () => {
    const serverDefaults: IntentsMap = {
      zoho: {
        rate: { direction: "push", mode: "manual", updateInternalOnPull: true },
      },
      hubspot: {
        price: { direction: "push", mode: "manual", updateInternalOnPull: true },
        name: { direction: "skip", mode: "auto", updateInternalOnPull: true },
      },
      zuper: {
        sku: { direction: "skip", mode: "auto", updateInternalOnPull: true },
      },
    };

    // User changed some fields; cascade changed others
    const currentIntents: IntentsMap = {
      zoho: {
        rate: { direction: "pull", mode: "manual", updateInternalOnPull: false },
      },
      hubspot: {
        price: { direction: "skip", mode: "manual", updateInternalOnPull: true },
        // This was changed by cascade (auto), not by user
        name: { direction: "push", mode: "auto", updateInternalOnPull: true },
      },
      zuper: {
        // This was changed by cascade (auto)
        sku: { direction: "push", mode: "auto", updateInternalOnPull: false },
      },
    };

    const result = resetAutoDecisions(currentIntents, serverDefaults);

    // Manual fields (user-set) should be unchanged
    expect(result.zoho.rate.direction).toBe("pull");
    expect(result.zoho.rate.mode).toBe("manual");
    expect(result.zoho.rate.updateInternalOnPull).toBe(false);

    expect(result.hubspot.price.direction).toBe("skip");
    expect(result.hubspot.price.mode).toBe("manual");

    // Auto fields (cascade-set) should be reset to server defaults
    expect(result.hubspot.name.direction).toBe("skip");
    expect(result.hubspot.name.mode).toBe("auto");

    expect(result.zuper.sku.direction).toBe("skip");
    expect(result.zuper.sku.mode).toBe("auto");
    expect(result.zuper.sku.updateInternalOnPull).toBe(true);
  });

  it("does not create new fields that weren't in the current intents", () => {
    const serverDefaults: IntentsMap = {
      zoho: { rate: { direction: "push", mode: "manual", updateInternalOnPull: true } },
      hubspot: { price: { direction: "push", mode: "manual", updateInternalOnPull: true } },
      zuper: {},
    };

    const currentIntents: IntentsMap = {
      zoho: {},
      hubspot: {},
      zuper: {},
    };

    const result = resetAutoDecisions(currentIntents, serverDefaults);
    expect(Object.keys(result.zoho)).toHaveLength(0);
    expect(Object.keys(result.hubspot)).toHaveLength(0);
  });
});
