import { prisma } from "@/lib/db";

export type EquipmentDuplicate =
  | { source: "INTERNAL_PRODUCT" | "PENDING_PUSH"; id: string }
  | null;

export type AdderDuplicate =
  | { source: "ADDER" | "ADDER_REQUEST"; id: string }
  | null;

function norm(s: string): string {
  return s.trim().toLowerCase();
}

// Dedup covers the catalog we sell (InternalProduct) and open requests in the
// queue (PendingCatalogPush PENDING). CatalogProduct is a vendor-sync staging
// mirror and is intentionally not checked — it doesn't indicate we carry an item.
export async function findEquipmentDuplicate(
  brand: string,
  model: string,
): Promise<EquipmentDuplicate> {
  if (!prisma) return null;
  const b = norm(brand);
  const m = norm(model);
  const where = {
    brand: { equals: b, mode: "insensitive" as const },
    model: { equals: m, mode: "insensitive" as const },
  };

  const ip = await prisma.internalProduct.findFirst({ where, select: { id: true } });
  if (ip) return { source: "INTERNAL_PRODUCT", id: ip.id };

  const pp = await prisma.pendingCatalogPush.findFirst({
    where: { ...where, status: "PENDING" },
    select: { id: true },
  });
  if (pp) return { source: "PENDING_PUSH", id: pp.id };

  return null;
}

export async function findAdderDuplicate(name: string): Promise<AdderDuplicate> {
  if (!prisma) return null;
  const n = norm(name);
  const where = { name: { equals: n, mode: "insensitive" as const } };

  const a = await prisma.adder.findFirst({ where, select: { id: true } });
  if (a) return { source: "ADDER", id: a.id };

  const ar = await prisma.adderRequest.findFirst({
    where: { ...where, status: "PENDING" },
    select: { id: true },
  });
  if (ar) return { source: "ADDER_REQUEST", id: ar.id };

  return null;
}
