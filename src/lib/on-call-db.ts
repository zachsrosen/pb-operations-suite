import { prisma } from "./db";
import type { RotationMember } from "./on-call-rotation";

export async function listPools() {
  return prisma.onCallPool.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { members: true, assignments: true } } },
  });
}

export async function getPool(id: string) {
  return prisma.onCallPool.findUnique({
    where: { id },
    include: {
      members: {
        orderBy: { orderIndex: "asc" },
        include: { crewMember: true },
      },
    },
  });
}

export async function getPoolByName(name: string) {
  return prisma.onCallPool.findUnique({ where: { name } });
}

export async function getActiveMembersForRotation(poolId: string): Promise<RotationMember[]> {
  const members = await prisma.onCallPoolMember.findMany({
    where: { poolId },
    orderBy: { orderIndex: "asc" },
  });
  return members.map((m) => ({
    crewMemberId: m.crewMemberId,
    orderIndex: m.orderIndex,
    isActive: m.isActive,
  }));
}

export async function listAssignmentsInRange(
  poolId: string | null,
  from: string,
  to: string,
) {
  return prisma.onCallAssignment.findMany({
    where: {
      ...(poolId ? { poolId } : {}),
      date: { gte: from, lte: to },
    },
    include: { crewMember: true, originalCrewMember: true },
    orderBy: [{ poolId: "asc" }, { date: "asc" }],
  });
}

export async function getApprovedPtoByMember(poolId: string): Promise<Map<string, Set<string>>> {
  const pto = await prisma.onCallPtoRequest.findMany({
    where: { poolId, status: "approved" },
  });
  const out = new Map<string, Set<string>>();
  for (const p of pto) {
    const dates = out.get(p.crewMemberId) ?? new Set<string>();
    // Walk the date range (inclusive).
    let d = p.startDate;
    while (d <= p.endDate) {
      dates.add(d);
      // Inline addDays to avoid circular dep.
      const [y, mo, da] = d.split("-").map(Number);
      const next = new Date(Date.UTC(y, mo - 1, da + 1));
      d =
        `${next.getUTCFullYear()}-` +
        `${String(next.getUTCMonth() + 1).padStart(2, "0")}-` +
        `${String(next.getUTCDate()).padStart(2, "0")}`;
    }
    out.set(p.crewMemberId, dates);
  }
  return out;
}

export async function resolveElectricianByEmail(email: string) {
  if (!email) return null;
  return prisma.crewMember.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
  });
}
