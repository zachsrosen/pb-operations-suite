/**
 * DB-backed toggle for EagleView → HubSpot forward stamping (pure logic).
 *
 * Why a DB toggle: Vercel's per-environment env-var size cap blocked adding
 * `EAGLEVIEW_HUBSPOT_STAMP_ENABLED` to production. The env var stays as a
 * local-dev / emergency override; the `SystemConfig` row is the production
 * switch. Forward stamping is on if EITHER is the exact string "true".
 *
 * This module is intentionally prisma-free so it stays unit-testable (importing
 * `@/lib/db` into a test drags in the generated Prisma client, which Jest can't
 * parse). The async DB read lives in `eagleview-pipeline-deps.ts`.
 *
 * Toggle in prod:
 *   prisma.systemConfig.upsert({
 *     where:  { key: EAGLEVIEW_STAMP_ENABLED_KEY },
 *     create: { key: EAGLEVIEW_STAMP_ENABLED_KEY, value: "true" },
 *     update: { value: "true" },
 *   });
 */

/** SystemConfig key for the DB-backed forward-stamping toggle. */
export const EAGLEVIEW_STAMP_ENABLED_KEY = "eagleview_hubspot_stamp_enabled";

/** Pure resolver: on if either the env override or the DB value is "true". */
export function resolveStampEnabled(
  envValue: string | undefined,
  dbValue: string | null | undefined,
): boolean {
  return envValue === "true" || dbValue === "true";
}
