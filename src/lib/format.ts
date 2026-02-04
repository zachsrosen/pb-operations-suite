// Unified formatting utilities
// Replaces formatMoney (page.tsx), formatCurrency/formatCurrencyK (executive, mobile, sales),
// and various inline formatting scattered across the codebase

/**
 * Format a monetary value compactly: $1.2M, $450k, $500
 * Used for dashboard cards, stat displays, and stage bars.
 */
export function formatMoney(value: number): string {
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(0)}k`;
  }
  return `$${value.toFixed(0)}`;
}

/**
 * Format a monetary value with more precision: $1.23M, $450.0K, $500
 * Used for executive/leadership displays requiring more detail.
 */
export function formatCurrency(value: number): string {
  if (value >= 1_000_000) {
    return "$" + (value / 1_000_000).toFixed(2) + "M";
  }
  if (value >= 1_000) {
    return "$" + (value / 1_000).toFixed(1) + "K";
  }
  return "$" + value.toFixed(0);
}

/**
 * Format a monetary value adaptively: $1.2M for millions, $450K for thousands
 * Used for tables and detailed breakdowns.
 */
export function formatCurrencyCompact(value: number): string {
  if (value >= 1_000_000) {
    return "$" + (value / 1_000_000).toFixed(1) + "M";
  }
  return "$" + (value / 1_000).toFixed(0) + "K";
}

/**
 * Format a number with locale-aware separators: 1,234,567
 */
export function formatNumber(value: number): string {
  return value.toLocaleString();
}

/**
 * Format a date string to a localized short date: 1/29/2026
 */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString();
}

/**
 * Format a date as a relative description: "3 days ago", "in 5 days", "today"
 */
export function formatRelativeDate(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = date.getTime() - now.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "today";
  if (diffDays === 1) return "tomorrow";
  if (diffDays === -1) return "yesterday";
  if (diffDays > 0) return `in ${diffDays}d`;
  return `${Math.abs(diffDays)}d ago`;
}

/**
 * Format a percentage: 45.6% or 46%
 */
export function formatPercent(
  value: number,
  decimals: number = 0
): string {
  return `${value.toFixed(decimals)}%`;
}
