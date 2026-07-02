// Team Activity dashboard flag — DB-backed (SystemConfig), not a Vercel env var,
// matching the project's other runtime toggles (scheduler_v2_enabled,
// eagleview_hubspot_stamp_enabled, ...). Server-only: imports prisma. Pages that
// gate on this must set `export const dynamic = "force-dynamic"` so the flag is
// read at request time rather than baked at build.

import { prisma } from "@/lib/db";

export const TEAM_ACTIVITY_FLAG_KEY = "team_activity_dashboard_enabled";
export const REPORTS_ADMIN_KEY = "google_reports_admin_email";

/** True when the SystemConfig row `team_activity_dashboard_enabled` is "true". */
export async function isTeamActivityEnabled(): Promise<boolean> {
  try {
    const row = await prisma.systemConfig.findUnique({ where: { key: TEAM_ACTIVITY_FLAG_KEY } });
    return row?.value === "true";
  } catch {
    return false;
  }
}

/**
 * Admin email to impersonate for the Google Admin SDK Reports API. Must be a
 * super-admin with the audit-reports privilege (zach@ does NOT have it;
 * caleb.rosen@ / patrick@ do). Env `GOOGLE_REPORTS_ADMIN_EMAIL` wins; else the
 * SystemConfig row `google_reports_admin_email`.
 */
export async function getReportsAdminEmail(): Promise<string | undefined> {
  if (process.env.GOOGLE_REPORTS_ADMIN_EMAIL) return process.env.GOOGLE_REPORTS_ADMIN_EMAIL;
  try {
    const row = await prisma.systemConfig.findUnique({ where: { key: REPORTS_ADMIN_KEY } });
    return row?.value || undefined;
  } catch {
    return undefined;
  }
}
