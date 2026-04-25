/**
 * EagleView order idempotency helpers.
 *
 * Prevents duplicate orders when:
 *   - HubSpot workflow re-enrolls a deal
 *   - Manual button clicked twice
 *   - Survey date changes but address didn't
 *
 * Dedup key: (dealId, productCode, addressHash). If you order TDP for the same
 * deal at the same address twice, you get the same row back.
 */
import type { EagleViewOrder, PrismaClient } from "@/generated/prisma/client";
import type { EagleViewProduct } from "@/generated/prisma/enums";
import { addressHash, type AddressParts } from "@/lib/address-hash";

export interface ClaimOrderInput {
  dealId: string;
  productCode: EagleViewProduct;
  address: AddressParts;
  triggeredBy: string;
  surveyDate?: Date | null;
}

export interface ClaimOrderResult {
  /** True if a brand-new ORDERED row was inserted; false if an existing row was reused. */
  isNew: boolean;
  /** The order row — either freshly inserted, or the existing one. */
  order: EagleViewOrder;
  /** Convenience: the addressHash actually computed. */
  addressHash: string;
}

/**
 * Look up an existing order for (dealId, productCode, address). Returns null
 * if none exists.
 */
export async function findExistingOrder(
  prisma: Pick<PrismaClient, "eagleViewOrder">,
  dealId: string,
  productCode: EagleViewProduct,
  address: AddressParts,
): Promise<EagleViewOrder | null> {
  const hash = addressHash(address);
  return prisma.eagleViewOrder.findUnique({
    where: {
      dealId_productCode_addressHash: {
        dealId,
        productCode,
        addressHash: hash,
      },
    },
  });
}

/**
 * Claim an order slot atomically. If an existing row matches the dedup key,
 * return it untouched (regardless of status). Otherwise, insert a new ORDERED
 * row with placeholder reportId (caller MUST update with real reportId after
 * EagleView's PlaceOrder call succeeds).
 *
 * The placeholder reportId is `pending:<dealId>:<addressHash>` — recognizable
 * during debugging and unique per (dealId, addressHash). The unique index on
 * `reportId` is satisfied because no two claims share the same address-hash
 * within a single deal.
 *
 * Race-safe: uses Prisma upsert which is atomic at the DB level.
 */
export async function claimOrder(
  prisma: Pick<PrismaClient, "eagleViewOrder">,
  input: ClaimOrderInput,
): Promise<ClaimOrderResult> {
  const hash = addressHash(input.address);
  const placeholderReportId = `pending:${input.dealId}:${hash.slice(0, 16)}`;

  // Check first — gives us correct isNew bit without relying on prisma quirks.
  const existing = await prisma.eagleViewOrder.findUnique({
    where: {
      dealId_productCode_addressHash: {
        dealId: input.dealId,
        productCode: input.productCode,
        addressHash: hash,
      },
    },
  });
  if (existing) {
    return { isNew: false, order: existing, addressHash: hash };
  }

  // No row yet — create. Race-safe: P2002 on unique violation means another
  // request beat us; re-fetch and treat as not-new.
  try {
    const created = await prisma.eagleViewOrder.create({
      data: {
        dealId: input.dealId,
        productCode: input.productCode,
        addressHash: hash,
        reportId: placeholderReportId,
        status: "ORDERED",
        triggeredBy: input.triggeredBy,
        surveyDate: input.surveyDate ?? null,
      },
    });
    return { isNew: true, order: created, addressHash: hash };
  } catch (err: unknown) {
    if (isPrismaUniqueViolation(err)) {
      const winner = await prisma.eagleViewOrder.findUnique({
        where: {
          dealId_productCode_addressHash: {
            dealId: input.dealId,
            productCode: input.productCode,
            addressHash: hash,
          },
        },
      });
      if (winner) return { isNew: false, order: winner, addressHash: hash };
    }
    throw err;
  }
}

function isPrismaUniqueViolation(err: unknown): boolean {
  if (err == null || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" && code === "P2002";
}
