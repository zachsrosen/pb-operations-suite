"use client";

import { useEffect, useRef } from "react";
import type { TaskStatus } from "@/lib/hubspot-tasks";

const STATUS_LABEL: Record<TaskStatus, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  WAITING: "Waiting",
  COMPLETED: "Completed",
  DEFERRED: "Deferred",
};

const EDITABLE: TaskStatus[] = ["NOT_STARTED", "IN_PROGRESS", "WAITING", "DEFERRED"];

interface StatusMenuProps {
  current: TaskStatus;
  onSelect: (status: TaskStatus) => void;
  onClose: () => void;
}

export default function StatusMenu({ current, onSelect, onClose }: StatusMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute left-0 top-full z-50 mt-1 w-40 rounded-lg border border-t-border bg-surface-elevated p-1 shadow-card-lg"
      role="menu"
      aria-label="Change status"
    >
      {EDITABLE.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => {
            onSelect(s);
            onClose();
          }}
          className={`block w-full rounded px-2 py-1.5 text-left text-xs ${
            s === current ? "bg-surface-2 text-foreground" : "text-foreground/80 hover:bg-surface-2"
          }`}
        >
          {STATUS_LABEL[s]}
          {s === current && <span className="ml-1 text-muted">·  current</span>}
        </button>
      ))}
    </div>
  );
}
