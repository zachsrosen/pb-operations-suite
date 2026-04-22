/**
 * Phase 1 deviation: the spec calls for creating HubSpot line items per
 * selected adder. But `createDealLineItem` requires `hubspotProductId`, and
 * adders are internal catalog items with no HubSpot product mirror. Until
 * an adders→HubSpot-products sync exists (candidate for Chunk 6), we write
 * the applied adder set to a deal-level property `pb_triage_adders` as a
 * JSON string. Rep + ops can see the applied adders on the deal; the triage
 * engine can read them back. Rollback = clear the property.
 */

import { Prisma } from "@/generated/prisma/client";
import type { TriageRun } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { updateDealProperty } from "@/lib/hubspot";

export type SubmitResult =
  | { ok: true; run: TriageRun }
  | { ok: false; error: string; status: number };

type SelectedAdder = {
  code: string;
  name?: string;
  qty?: number;
  unitPrice?: number;
  amount?: number;
  photosRequired?: boolean;
};

type TriagePhoto = {
  adderId?: string;
  code?: string;
  url?: string;
  storageKey?: string;
  pathname?: string;
};

/**
 * Submit a TriageRun: validate photo requirements, write applied-adder JSON
 * to the HubSpot deal property `pb_triage_adders`, and mark the run
 * submitted. Re-submits overwrite the property (idempotent by design — the
 * current `selectedAdders` array is authoritative).
 */
export async function submitTriageRun(id: string): Promise<SubmitResult> {
  const run = await prisma.triageRun.findUnique({ where: { id } });
  if (!run) return { ok: false, error: "not_found", status: 404 };

  if (!run.dealId) {
    return {
      ok: false,
      error: "cannot submit run without dealId",
      status: 400,
    };
  }

  const selected = normalizeSelected(run.selectedAdders);
  if (selected.length === 0) {
    return {
      ok: false,
      error: "no adders selected",
      status: 400,
    };
  }

  const photos = normalizePhotos(run.photos);
  const missingPhotos = selected.filter(
    (s) => s.photosRequired && !hasPhotoFor(photos, s.code)
  );
  if (missingPhotos.length > 0) {
    return {
      ok: false,
      error: `missing required photos for: ${missingPhotos
        .map((s) => s.code)
        .join(", ")}`,
      status: 400,
    };
  }

  const payload = selected.map((s) => ({
    code: s.code,
    name: s.name ?? s.code,
    qty: s.qty ?? 1,
    unitPrice: s.unitPrice ?? 0,
    amount: s.amount ?? 0,
  }));

  const ok = await updateDealProperty(run.dealId, {
    pb_triage_adders: JSON.stringify(payload),
    pb_triage_submitted_at: new Date().toISOString(),
  });

  if (!ok) {
    return {
      ok: false,
      error: "HubSpot property write failed",
      status: 502,
    };
  }

  // Repurpose `hubspotLineItemIds` as a property-snapshot for rollback /
  // audit. Phase 1 has no line items; this column holds the JSON payload
  // actually written to the deal property at submit time.
  const updated = await prisma.triageRun.update({
    where: { id },
    data: {
      submitted: true,
      submittedAt: new Date(),
      hubspotLineItemIds: payload as unknown as Prisma.InputJsonValue,
    },
  });

  return { ok: true, run: updated };
}

function normalizeSelected(raw: unknown): SelectedAdder[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
    .map((x) => ({
      code: String(x.code ?? ""),
      name: typeof x.name === "string" ? x.name : undefined,
      qty: typeof x.qty === "number" ? x.qty : undefined,
      unitPrice: typeof x.unitPrice === "number" ? x.unitPrice : undefined,
      amount: typeof x.amount === "number" ? x.amount : undefined,
      photosRequired: x.photosRequired === true,
    }))
    .filter((s) => s.code.length > 0);
}

function normalizePhotos(raw: unknown): TriagePhoto[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (x): x is TriagePhoto => typeof x === "object" && x !== null
  );
}

function hasPhotoFor(photos: TriagePhoto[], code: string): boolean {
  return photos.some((p) => p.code === code || p.adderId === code);
}
