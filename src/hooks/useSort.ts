"use client";

import { useState, useCallback } from "react";

export type SortDir = "asc" | "desc";

export function useSort(defaultKey: string | null = null, defaultDir: SortDir = "asc") {
  const [sortKey, setSortKey] = useState<string | null>(defaultKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);

  const toggle = useCallback(
    (key: string) => {
      if (sortKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir(defaultDir);
      }
    },
    [sortKey, defaultDir],
  );

  return { sortKey, sortDir, toggle } as const;
}

export function sortRows<T>(rows: T[], key: string | null, dir: SortDir): T[] {
  if (!key) return rows;
  return [...rows].sort((a, b) => {
    const av = (a as Record<string, unknown>)[key];
    const bv = (b as Record<string, unknown>)[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number")
      return dir === "asc" ? av - bv : bv - av;
    if (typeof av === "boolean" && typeof bv === "boolean")
      return dir === "asc"
        ? av === bv ? 0 : av ? -1 : 1
        : av === bv ? 0 : av ? 1 : -1;
    return dir === "asc"
      ? String(av).localeCompare(String(bv))
      : String(bv).localeCompare(String(av));
  });
}
