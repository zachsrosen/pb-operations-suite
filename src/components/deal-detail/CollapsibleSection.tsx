"use client";

import { useState } from "react";

interface CollapsibleSectionProps {
  title: string;
  fieldCount: number;
  defaultOpen: boolean;
  children: React.ReactNode;
}

export default function CollapsibleSection({
  title,
  fieldCount,
  defaultOpen,
  children,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="mb-3">
      <button
        onClick={() => setIsOpen(!isOpen)}
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
