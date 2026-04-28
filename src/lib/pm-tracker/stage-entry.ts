/**
 * Pure helper for extracting the `hs_date_entered_<stageId>` timestamp from
 * a Deal's cached rawProperties JSON blob. No prisma import — safely
 * testable in isolation.
 */

export function getStageEnteredAt(
  rawProperties: unknown,
  stageId: string,
): Date | null {
  if (!rawProperties || typeof rawProperties !== "object" || Array.isArray(rawProperties)) {
    return null;
  }
  const props = rawProperties as Record<string, unknown>;
  const key = `hs_date_entered_${stageId}`;
  const raw = props[key];
  if (!raw) return null;
  const parsed = new Date(String(raw));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
