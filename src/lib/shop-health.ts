// src/lib/shop-health.ts
// Core data layer for the Weekly Shop Health Dashboard.
// Week utilities, health scoring, and the main getShopHealthData orchestrator.

import type {
  HealthStatus,
  HeroMetric,
  ShopHealthData,
  ShopHealthHeroes,
  ShopHealthGoals,
  PipelineSection,
  PreconstructionSection,
  SchedulingSection,
  OperationsSection,
  InspectionsSection,
  ShopHealthBottleneckEntry,
} from "./shop-health-types";

// ─── Week Utilities ──────────────────────────────────────────────────────────

/**
 * Returns the Monday (start of ISO week) for the given date.
 * weekStartsOn: Monday = 1.
 */
export function getWeekStart(date: Date = new Date()): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon, ...
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Returns the Sunday (end of ISO week) for the given date.
 */
export function getWeekEnd(date: Date = new Date()): Date {
  const monday = getWeekStart(date);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return sunday;
}

/**
 * Formats a date as 'yyyy-MM-dd' for URL params and cache keys.
 */
export function formatWeekParam(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Returns true if the given ISO date string falls within the Mon-Sun week
 * starting at `weekStart`.
 */
export function isInWeek(
  dateStr: string | null | undefined,
  weekStart: Date
): boolean {
  if (!dateStr) return false;
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return false;
    const weekEnd = getWeekEnd(weekStart);
    return date >= weekStart && date <= weekEnd;
  } catch {
    return false;
  }
}

/**
 * Returns true if the given ISO date string is 0..`days` calendar days in the
 * future (inclusive). Useful for "scheduled in the next N days" checks.
 */
export function isWithinDays(
  dateStr: string | null | undefined,
  days: number
): boolean {
  if (!dateStr) return false;
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return false;
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const target = new Date(date);
    target.setHours(0, 0, 0, 0);
    const diffMs = target.getTime() - now.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    return diffDays >= 0 && diffDays <= days;
  } catch {
    return false;
  }
}

/**
 * Returns the number of calendar days between two ISO date strings.
 * Returns NaN if either date is invalid.
 */
function daysBetween(a: string, b: string): number {
  const da = new Date(a);
  const db = new Date(b);
  if (isNaN(da.getTime()) || isNaN(db.getTime())) return NaN;
  const ms = db.getTime() - da.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

/**
 * Returns a new Date shifted back by `n` weeks.
 */
function subWeeks(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - n * 7);
  return d;
}
