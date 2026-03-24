"use client";

import type { SortDir } from "@/hooks/useSort";

export function SortHeader({
  label,
  sortKey,
  currentKey,
  currentDir,
  onSort,
  className = "",
  compact = false,
  title,
}: {
  label: string;
  sortKey: string;
  currentKey: string | null;
  currentDir: SortDir;
  onSort: (key: string) => void;
  className?: string;
  compact?: boolean;
  title?: string;
}) {
  const active = currentKey === sortKey;
  const base = compact
    ? "px-3 py-2 text-xs font-medium text-muted"
    : "px-4 py-3 font-semibold text-foreground";
  return (
    <th
      className={`${base} cursor-pointer select-none hover:text-foreground transition-colors ${className}`}
      onClick={() => onSort(sortKey)}
      title={title}
    >
      {label}{" "}
      <span className="ml-1 text-xs">
        {active ? (currentDir === "asc" ? "▲" : "▼") : "⇅"}
      </span>
    </th>
  );
}
