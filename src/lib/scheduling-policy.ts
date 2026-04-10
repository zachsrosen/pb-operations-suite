import type { NextRequest } from "next/server";
import { normalizeRole, UserRole as UserRoleEnum, type UserRole } from "@/lib/role-permissions";

interface SalesSurveyLeadTimeInput {
  role: UserRole;
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

export function resolveEffectiveRoleFromRequest(request: NextRequest, actualRole: UserRole): UserRole {
  const normalizedActualRole = normalizeRole(actualRole);
  const cookieRole = parseRole(request.cookies.get("pb_effective_role")?.value);
  const isImpersonating = request.cookies.get("pb_is_impersonating")?.value === "1";

  if (!cookieRole) return normalizedActualRole;
  if (normalizedActualRole !== "ADMIN") return normalizedActualRole;

  const normalizedCookieRole = normalizeRole(cookieRole);
  if (normalizedCookieRole === "ADMIN" || normalizedCookieRole === "EXECUTIVE") {
    return normalizedActualRole;
  }
  if (normalizedCookieRole === "VIEWER" && !isImpersonating) {
    return normalizedActualRole;
  }

  return normalizedCookieRole;
}

export function getSalesSurveyLeadTimeError({
  role,
  scheduleType,
  scheduleDate,
  timezone,
}: SalesSurveyLeadTimeInput): string | null {
  if (role !== "SALES" || (scheduleType !== "survey" && scheduleType !== "pre-sale-survey")) return null;
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
