import { prisma } from "@/lib/db";

/**
 * Runtime feature gate for Scheduler v2 (UI route + API).
 *
 * Vercel's per-environment env-var space is full on prod, so the prod toggle
 * lives in a `SystemConfig` row (the established pattern in this codebase — see
 * enphase refresh token, eagleview stamp flag). The `SCHEDULER_V2_ENABLED` env
 * var is honored first as a local-dev / test fallback. Fail-closed.
 *
 * Toggle on/off in prod by upserting SystemConfig `scheduler_v2_enabled` =
 * "true"/"false" — takes effect at runtime, no redeploy needed.
 */
export const SCHEDULER_V2_FLAG_KEY = "scheduler_v2_enabled";

export async function isSchedulerV2Enabled(): Promise<boolean> {
  if (process.env.SCHEDULER_V2_ENABLED === "true") return true;
  try {
    const row = await prisma.systemConfig.findUnique({
      where: { key: SCHEDULER_V2_FLAG_KEY },
    });
    return row?.value === "true";
  } catch {
    return false;
  }
}
