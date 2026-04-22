import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import type { TriageRun } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

export const CreateTriageRunSchema = z.object({
  dealId: z.string().optional().nullable(),
  prelimAddress: z.unknown().optional().nullable(),
  answers: z.unknown().optional(),
  notes: z.string().optional().nullable(),
});
export type CreateTriageRunInput = z.infer<typeof CreateTriageRunSchema>;

export const UpdateTriageRunSchema = z.object({
  answers: z.unknown().optional(),
  selectedAdders: z.unknown().optional(),
  recommendedAdders: z.unknown().optional(),
  photos: z.unknown().optional(),
  notes: z.string().optional().nullable(),
  dealId: z.string().optional().nullable(),
  prelimAddress: z.unknown().optional().nullable(),
});
export type UpdateTriageRunInput = z.infer<typeof UpdateTriageRunSchema>;

type AuthCtx = { userId: string };

/**
 * Create a new draft TriageRun. Fields default to empty JSON collections —
 * callers patch `answers`/`selectedAdders`/`photos` as the user progresses.
 */
export async function createTriageRun(
  input: CreateTriageRunInput,
  auth: AuthCtx
): Promise<TriageRun> {
  const data = CreateTriageRunSchema.parse(input);
  return prisma.triageRun.create({
    data: {
      runBy: auth.userId,
      dealId: data.dealId ?? undefined,
      prelimAddress: toPrismaJson(data.prelimAddress),
      answers: (data.answers as Prisma.InputJsonValue) ?? {},
      recommendedAdders: [] as unknown as Prisma.InputJsonValue,
      selectedAdders: [] as unknown as Prisma.InputJsonValue,
      notes: data.notes ?? undefined,
    },
  });
}

export async function getTriageRun(id: string): Promise<TriageRun | null> {
  return prisma.triageRun.findUnique({ where: { id } });
}

/**
 * Patch a TriageRun. Uses Prisma.JsonNull clearing is NOT supported in
 * Phase 1 — `null` inputs are treated as no-op (matches the catalog
 * convention in src/lib/adders/catalog.ts). Submitted runs cannot be
 * patched (submit is a terminal transition).
 */
export async function updateTriageRun(
  id: string,
  input: UpdateTriageRunInput
): Promise<TriageRun> {
  const parsed = UpdateTriageRunSchema.parse(input);
  const existing = await prisma.triageRun.findUniqueOrThrow({ where: { id } });
  if (existing.submitted) {
    throw new Error("cannot update submitted run");
  }
  const data: Prisma.TriageRunUpdateInput = {};
  if (parsed.answers !== undefined)
    data.answers = toPrismaJson(parsed.answers);
  if (parsed.recommendedAdders !== undefined)
    data.recommendedAdders = toPrismaJson(parsed.recommendedAdders);
  if (parsed.selectedAdders !== undefined)
    data.selectedAdders = toPrismaJson(parsed.selectedAdders);
  if (parsed.photos !== undefined)
    data.photos = toPrismaJson(parsed.photos);
  if (parsed.notes !== undefined && parsed.notes !== null)
    data.notes = parsed.notes;
  if (parsed.dealId !== undefined && parsed.dealId !== null)
    data.dealId = parsed.dealId;
  if (parsed.prelimAddress !== undefined)
    data.prelimAddress = toPrismaJson(parsed.prelimAddress);

  return prisma.triageRun.update({ where: { id }, data });
}

/**
 * True if the user may PATCH/submit this run. Either the original creator
 * or someone with elevated (ADMIN/OWNER) access.
 */
export function canEditTriageRun(
  run: Pick<TriageRun, "runBy">,
  userId: string,
  roles: string[]
): boolean {
  if (run.runBy === userId) return true;
  if (roles.includes("ADMIN") || roles.includes("OWNER")) return true;
  return false;
}

function toPrismaJson(v: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (v === null) return Prisma.JsonNull;
  return (v ?? Prisma.JsonNull) as Prisma.InputJsonValue | typeof Prisma.JsonNull;
}
