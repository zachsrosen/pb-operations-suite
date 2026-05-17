// src/lib/shop-health-utils.ts
// Pure utility functions for the Shop Health Dashboard.
// This file has NO server-side imports (no prisma, no hubspot, etc.)
// so it can be safely imported from 'use client' components.

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
