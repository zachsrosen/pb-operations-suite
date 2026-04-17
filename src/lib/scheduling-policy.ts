import type { NextRequest } from "next/server";
import { normalizeRole, UserRole as UserRoleEnum, type UserRole } from "@/lib/role-permissions";

interface SalesSurveyLeadTimeInput {
  roles: UserRole[];
  scheduleType: "survey" | "pre-sale-survey" | "installation" | "inspection";
  scheduleDate: string;
  timezone?: string | null;
}

function parseRole(value: string | null | undefined): UserRole | null {
  if (!value) return null;
  if (Object.values(UserRoleEnum).includes(value as UserRole)) {
    return value as UserRole;
  }
  return null;
}

function formatDateInTimezone(date: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;

  if (!year || !month || !day) {
    return date.toISOString().slice(0, 10);
  }

  return `${year}-${month}-${day}`;
}

function addDays(dateYmd: string, days: number): string {
  const [year, month, day] = dateYmd.split("-").map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day + days));
  return utcDate.toISOString().slice(0, 10);
}

function parseRolesCookie(value: string | undefined): UserRole[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    const out: UserRole[] = [];
    for (const entry of parsed) {
      const role = parseRole(typeof entry === "string" ? entry : null);
      if (role) out.push(role);
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * Multi-role variant of `resolveEffectiveRoleFromRequest`. Reads the new
 * `pb_effective_roles` cookie (JSON array) and falls back to the legacy
 * single-role `pb_effective_role` cookie so mid-rollout sessions still resolve.
 *
 * Impersonation rules are preserved:
 *   - Only ADMINs can have their effective roles overridden by the cookie.
 *   - ADMIN/EXECUTIVE cookie values are ignored (never elevate via cookie).
 *   - A VIEWER cookie requires `pb_is_impersonating=1` to take effect.
 */
export function resolveEffectiveRolesFromRequest(
  request: NextRequest,
  actualRoles: UserRole[],
): UserRole[] {
  const normalizedActualRoles = actualRoles.map((r) => normalizeRole(r));
  const isActualAdmin = normalizedActualRoles.includes("ADMIN");

  const cookieRoles =
    parseRolesCookie(request.cookies.get("pb_effective_roles")?.value) ??
    (parseRole(request.cookies.get("pb_effective_role")?.value)
      ? [parseRole(request.cookies.get("pb_effective_role")?.value)!]
      : null);

  const isImpersonating = request.cookies.get("pb_is_impersonating")?.value === "1";

  if (!cookieRoles || cookieRoles.length === 0) return normalizedActualRoles;
  if (!isActualAdmin) return normalizedActualRoles;

  const normalizedCookieRoles = cookieRoles.map((r) => normalizeRole(r));

  // Never elevate to or stay at ADMIN/EXECUTIVE via cookie.
  if (normalizedCookieRoles.some((r) => r === "ADMIN" || r === "EXECUTIVE")) {
    return normalizedActualRoles;
  }
  // VIEWER-only cookie without the impersonation flag stays as actual.
  if (
    normalizedCookieRoles.every((r) => r === "VIEWER") &&
    !isImpersonating
  ) {
    return normalizedActualRoles;
  }

  return normalizedCookieRoles;
}

export function resolveEffectiveRoleFromRequest(request: NextRequest, actualRole: UserRole): UserRole {
  const resolved = resolveEffectiveRolesFromRequest(request, [actualRole]);
  return resolved[0] ?? normalizeRole(actualRole);
}

export function getSalesSurveyLeadTimeError({
  roles,
  scheduleType,
  scheduleDate,
  timezone,
}: SalesSurveyLeadTimeInput): string | null {
  // Multi-role: guard applies if ANY of the user's roles is SALES. A user with
  // roles [PROJECT_MANAGER, SALES] — PM first — still gets the lead-time rule.
  if (!roles.includes("SALES") || (scheduleType !== "survey" && scheduleType !== "pre-sale-survey")) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduleDate)) return null;

  const tz = timezone || "America/Denver";
  const today = formatDateInTimezone(new Date(), tz);
  const tomorrow = addDays(today, 1);

  if (scheduleDate === today || scheduleDate === tomorrow) {
    return "Sales users cannot schedule site surveys for today or tomorrow. Please choose a date at least 2 days out.";
  }

  return null;
}

/**
 * Per-office daily cap for scheduled site surveys.
 * When a date reaches this count at the given office, additional unbooked
 * slots are hidden from the site-survey-scheduler UI for that date.
 *
 * Keys must match the office display names used by the hardcoded crew list
 * in `src/app/api/zuper/availability/route.ts` (e.g. "DTC", "Westminster").
 * Offices missing from this map have no office-level cap — existing
 * per-crew `maxDailyJobs` behavior still applies.
 */
export const OFFICE_DAILY_SURVEY_CAPS: Record<string, number> = {
  DTC: 3,
  Westminster: 3,
};

/** Structural type for the day object the availability route builds. */
export interface DayForOfficeCap {
  availableSlots: unknown[];
  bookedSlots?: unknown[];
  hasAvailability: boolean;
  dayCapped?: boolean;
  capLimit?: number;
}

/**
 * Enforce per-office daily survey cap. Mutates `day` in place.
 * - Configured office at/over cap: clears availableSlots, sets dayCapped=true, capLimit=N
 * - Configured office under cap: sets dayCapped=false, capLimit=N
 * - Unconfigured office or undefined: returns early, no fields set
 */
export function applyOfficeDailyCap(
  day: DayForOfficeCap,
  office: string | undefined,
): void {
  if (!office) return;
  const cap = OFFICE_DAILY_SURVEY_CAPS[office];
  if (cap === undefined) return;

  day.capLimit = cap;
  const bookedCount = day.bookedSlots?.length ?? 0;

  if (bookedCount >= cap) {
    day.availableSlots = [];
    day.hasAvailability = false;
    day.dayCapped = true;
  } else {
    day.dayCapped = false;
  }
}
