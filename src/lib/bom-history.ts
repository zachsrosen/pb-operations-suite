// src/lib/bom-history.ts

export interface BomSnapshot {
  id: string;
  dealId: string;
  dealName: string;
  version: number;
  sourceFile: string | null;
  savedBy: string | null;
  createdAt: string;
  customer: string | null;
  address: string | null;
  /** Raw value from API; may be a numeric string. Coerce before arithmetic. */
  systemSizeKwdc: number | string | null;
  /** Raw value from API; may be a numeric string. Coerce before arithmetic. */
  moduleCount: number | string | null;
  itemCount: number;
}

export function relativeTime(dateStr: string): string {
  const then = new Date(dateStr);
  if (isNaN(then.getTime())) return "Unknown";
  const now = Date.now();
  const diffMs = now - then.getTime();
  if (diffMs < 0) return then.toLocaleDateString(); // future date
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? "s" : ""} ago`;
  if (diffHr < 24) return `${diffHr} hour${diffHr !== 1 ? "s" : ""} ago`;
  if (diffDay === 1) return "yesterday";
  if (diffDay < 7) return `${diffDay} days ago`;
  return then.toLocaleDateString();
}

export function getDateGroup(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const nowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const itemDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((nowDate.getTime() - itemDate.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return "This Week";
  return "Older";
}

export const GROUP_ORDER = ["Today", "Yesterday", "This Week", "Older"] as const;
