import { prisma } from "@/lib/db";
import type { Adder, AdderWithOverrides, AdderRevision, AdderCategory } from "./types";
import {
  CreateAdderSchema,
  UpdateAdderSchema,
  type CreateAdderInput,
  type UpdateAdderInput,
} from "./zod-schemas";
import { isValidShop } from "./pricing";

type AuthCtx = { userId: string };

export async function createAdder(input: CreateAdderInput, auth: AuthCtx): Promise<Adder> {
  const data = CreateAdderSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const adder = await tx.adder.create({
      data: {
        ...data,
        basePrice: data.basePrice,
        baseCost: data.baseCost,
        marginTarget: data.marginTarget ?? undefined,
        createdBy: auth.userId,
        updatedBy: auth.userId,
        triggerLogic: data.triggerLogic ?? undefined,
        triageChoices: data.triageChoices ?? undefined,
      },
    });
    await tx.adderRevision.create({
      data: {
        adderId: adder.id,
        snapshot: adder as unknown as object,
        changedBy: auth.userId,
        changeNote: "created",
      },
    });
    return adder;
  });
}

export async function updateAdder(
  id: string,
  input: UpdateAdderInput,
  auth: AuthCtx
): Promise<Adder> {
  const parsed = UpdateAdderSchema.parse(input);
  const { changeNote, overrides, ...rest } = parsed;

  // Validate override shops BEFORE opening a transaction so we fail fast
  // with a clear error instead of rolling back a partial write.
  if (overrides) {
    for (const o of overrides) {
      if (!isValidShop(o.shop)) {
        throw new Error(`invalid shop: ${o.shop}`);
      }
    }
  }

  return prisma.$transaction(async (tx) => {
    const current = await tx.adder.findUniqueOrThrow({
      where: { id },
      include: { overrides: true },
    });
    await tx.adderRevision.create({
      data: {
        adderId: id,
        snapshot: current as unknown as object,
        changedBy: auth.userId,
        changeNote: changeNote ?? "updated",
      },
    });
    // Prisma rejects `null` for Json fields in update — it wants
    // `Prisma.JsonNull` or `undefined`. Phase 1 doesn't support clearing
    // Json fields to null (no UI affordance); treat null as no-op.
    const { triggerLogic, triageChoices, ...scalarRest } = rest;
    const updated = await tx.adder.update({
      where: { id },
      data: {
        ...scalarRest,
        updatedBy: auth.userId,
        ...(triggerLogic != null ? { triggerLogic } : {}),
        ...(triageChoices != null ? { triageChoices } : {}),
      },
    });
    if (overrides) {
      await tx.adderShopOverride.deleteMany({ where: { adderId: id } });
      if (overrides.length > 0) {
        await tx.adderShopOverride.createMany({
          data: overrides.map((o) => ({
            adderId: id,
            shop: o.shop,
            priceDelta: o.priceDelta,
            active: o.active,
          })),
        });
      }
    }
    return updated;
  });
}

export async function retireAdder(
  id: string,
  auth: AuthCtx & { reason?: string }
): Promise<Adder> {
  return updateAdder(
    id,
    { active: false, changeNote: auth.reason ?? "retired" },
    auth
  );
}

export async function listAdders(
  filters: {
    category?: AdderCategory;
    active?: boolean;
    shop?: string;
  } = {}
): Promise<AdderWithOverrides[]> {
  return prisma.adder.findMany({
    where: {
      category: filters.category,
      active: filters.active,
      ...(filters.shop
        ? { overrides: { some: { shop: filters.shop, active: true } } }
        : {}),
    },
    include: { overrides: true },
    orderBy: [{ category: "asc" }, { code: "asc" }],
  });
}

export async function getAdderById(id: string): Promise<AdderWithOverrides | null> {
  return prisma.adder.findUnique({
    where: { id },
    include: { overrides: true },
  });
}

export async function listRevisions(adderId: string): Promise<AdderRevision[]> {
  return prisma.adderRevision.findMany({
    where: { adderId },
    orderBy: { changedAt: "asc" },
  });
}
