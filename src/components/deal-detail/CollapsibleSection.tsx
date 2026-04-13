"use client";

import { useState, useCallback } from "react";

interface CollapsibleSectionProps {
  title: string;
  fieldCount: number;
  defaultOpen: boolean;
  sectionKey?: string;
  children: React.ReactNode;
}

const STORAGE_KEY = "deal-detail:sections";

function loadSavedState(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export default function CollapsibleSection({
  title,
  fieldCount,
  defaultOpen,
  sectionKey,
  children,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(() => {
    if (!sectionKey) return defaultOpen;
    const saved = loadSavedState();
    return saved[sectionKey] ?? defaultOpen;
  });

  // Persist to localStorage when toggled
  const toggle = useCallback(() => {
    setIsOpen((prev) => {
      const next = !prev;
      if (sectionKey) {
        try {
          const saved = loadSavedState();
          saved[sectionKey] = next;
          localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
        } catch {
          // localStorage full or unavailable — ignore
        }
      }
      return next;
    });
  }, [sectionKey]);

  return (
    <div className="mb-3">
      <button
        onClick={toggle}
        className="flex w-full items-center justify-between rounded-t-lg bg-surface-2 px-3 py-2 text-left transition-colors hover:bg-surface-2/80"
        style={!isOpen ? { borderRadius: "0.5rem" } : undefined}
      >
        <span className="text-xs font-semibold text-foreground">
          {isOpen ? "▼" : "▶"} {title}
        </span>
        <span className="text-[10px] text-muted">{fieldCount} fields</span>
      </button>
      {isOpen && (
        <div className="rounded-b-lg bg-surface-2/30 p-3">
          {children}
        </div>
      )}
    </div>
  );
}
