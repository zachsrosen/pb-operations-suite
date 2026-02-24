import type { NextRequest } from "next/server";
import { normalizeRole, UserRole as UserRoleEnum, type UserRole } from "@/lib/role-permissions";

interface SalesSurveyLeadTimeInput {
  role: UserRole;
  scheduleType: "survey" | "installation" | "inspection";
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
  if (normalizedCookieRole === "ADMIN" || normalizedCookieRole === "OWNER") {
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
  if (role !== "SALES" || scheduleType !== "survey") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduleDate)) return null;

  const tz = timezone || "America/Denver";
  const today = formatDateInTimezone(new Date(), tz);
  const tomorrow = addDays(today, 1);

  if (scheduleDate === today || scheduleDate === tomorrow) {
    return "Sales users cannot schedule site surveys for today or tomorrow. Please choose a date at least 2 days out.";
  }

  return null;
}
