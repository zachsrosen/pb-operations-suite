/**
 * OpenSolar API client — abstracted so real endpoints can be swapped in
 * after Pre-Phase Discovery completes (see
 * `docs/superpowers/followups/2026-04-22-opensolar-api-discovery.md`).
 *
 * Today: when `ADDER_SYNC_ENABLED=false` (default) every method returns a
 * synthetic success WITHOUT any network call. This lets the orchestrator
 * ship behind a kill switch and the test suite run deterministically.
 *
 * When the flag is flipped on, the stubs still do NOT call a real network —
 * they emit a warn-level log and return synthetic success. Replace the
 * `executeReal*` branches below with real fetch() calls once the Discovery
 * doc is filled in.
 */
import type { AdderWithOverrides } from "./types";

export type OpenSolarAdderPayload = {
  // Stable key we mirror from our DB. Used to resolve create-vs-update.
  externalId: string;
  code: string;
  name: string;
  category: string;
  unit: string;
  basePrice: number;
  baseCost: number;
  direction: "ADD" | "DISCOUNT";
  active: boolean;
  // Phase 1 treats shop overrides as embedded metadata. Once Discovery Q2
  // answers whether OpenSolar supports per-shop price on one record, this
  // may split into multiple payloads or stay embedded.
  shopOverrides: Array<{ shop: string; priceDelta: number; active: boolean }>;
};

export type OpenSolarPushResult = {
  ok: boolean;
  externalId: string;
  // The `openSolarId` we write back to our DB. For stubs this mirrors
  // `externalId`; for the real API it's whatever the remote returns.
  openSolarId: string;
  error?: string;
};

export type OpenSolarArchiveResult = {
  ok: boolean;
  externalId: string;
  error?: string;
};

export type OpenSolarListEntry = {
  openSolarId: string;
  externalId: string | null;
  active: boolean;
};

function isEnabled(): boolean {
  return process.env.ADDER_SYNC_ENABLED === "true";
}

/**
 * Convert a DB adder row into the external payload shape.
 * Exported so the orchestrator can diff by comparing prior `openSolarId`
 * plus payload hash (future enhancement).
 */
export function toPayload(adder: AdderWithOverrides): OpenSolarAdderPayload {
  return {
    externalId: adder.id,
    code: adder.code,
    name: adder.name,
    category: String(adder.category),
    unit: String(adder.unit),
    basePrice: Number(adder.basePrice),
    baseCost: Number(adder.baseCost),
    direction: adder.direction,
    active: adder.active,
    shopOverrides: (adder.overrides ?? [])
      .filter((o) => o.active)
      .map((o) => ({
        shop: o.shop,
        priceDelta: Number(o.priceDelta),
        active: o.active,
      })),
  };
}

/**
 * Push (create or update) an adder to OpenSolar.
 *
 * Stub behavior: when the kill switch is off, returns synthetic success
 * with `openSolarId === payload.externalId`. No network call.
 *
 * Real behavior (TODO after Discovery): POST /api/orgs/{orgId}/adders
 * (or PATCH if `openSolarId` is set).
 */
export async function pushAdder(
  payload: OpenSolarAdderPayload,
  currentOpenSolarId?: string | null,
): Promise<OpenSolarPushResult> {
  if (!isEnabled()) {
    // Kill switch off — no network, synthetic success, no write-back.
    return {
      ok: true,
      externalId: payload.externalId,
      openSolarId: currentOpenSolarId ?? payload.externalId,
    };
  }
  // Kill switch on, but real client not wired yet. Emit a warning so the
  // operator knows they're running against a stub and return success.
  // Replace this branch with a real fetch() once Discovery completes.
  // eslint-disable-next-line no-console
  console.warn(
    "[opensolar-client] pushAdder invoked with ADDER_SYNC_ENABLED=true but stub client is active. " +
      "Update src/lib/adders/opensolar-client.ts with the real endpoint.",
  );
  return {
    ok: true,
    externalId: payload.externalId,
    openSolarId: currentOpenSolarId ?? payload.externalId,
  };
}

/**
 * Archive (retire) an adder in OpenSolar. No-op in stub mode.
 *
 * Real behavior (TODO after Discovery): DELETE or PATCH {active:false}.
 */
export async function archiveAdder(
  payload: Pick<OpenSolarAdderPayload, "externalId">,
  currentOpenSolarId: string,
): Promise<OpenSolarArchiveResult> {
  if (!isEnabled()) {
    return { ok: true, externalId: payload.externalId };
  }
  // eslint-disable-next-line no-console
  console.warn(
    "[opensolar-client] archiveAdder invoked with ADDER_SYNC_ENABLED=true but stub client is active.",
  );
  void currentOpenSolarId; // real client will use this
  return { ok: true, externalId: payload.externalId };
}

/**
 * List adders currently in OpenSolar. Used for drift detection.
 *
 * Stub: returns empty list (treat as "nothing to reconcile").
 * Real behavior (TODO): GET /api/orgs/{orgId}/adders — paged.
 */
export async function listAdders(): Promise<OpenSolarListEntry[]> {
  if (!isEnabled()) {
    return [];
  }
  // eslint-disable-next-line no-console
  console.warn(
    "[opensolar-client] listAdders invoked with ADDER_SYNC_ENABLED=true but stub client is active.",
  );
  return [];
}
