"use client";

import { useEffect, useRef, useState } from "react";
import type { TaskQueue } from "@/lib/hubspot-tasks";

interface QueuePickerProps {
  currentQueueIds: string[];
  allQueues: TaskQueue[];
  onSave: (queueIds: string[]) => void;
  onClose: () => void;
}

export default function QueuePicker({
  currentQueueIds,
  allQueues,
  onSave,
  onClose,
}: QueuePickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set(currentQueueIds));

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

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const dirty =
    selected.size !== currentQueueIds.length ||
    [...selected].some((id) => !currentQueueIds.includes(id));

  return (
    <div
      ref={ref}
      className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-t-border bg-surface-elevated p-2 shadow-card-lg"
      role="dialog"
      aria-label="Change queues"
    >
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
        Queues
      </div>
      <div className="max-h-60 overflow-y-auto">
        {allQueues.length === 0 ? (
          <p className="p-2 text-xs text-muted">No queues configured.</p>
        ) : (
          allQueues.map((q) => (
            <label
              key={q.id}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-surface-2"
            >
              <input
                type="checkbox"
                checked={selected.has(q.id)}
                onChange={() => toggle(q.id)}
                className="h-3.5 w-3.5 cursor-pointer accent-blue-500"
              />
              <span className="text-foreground">{q.name}</span>
            </label>
          ))
        )}
      </div>
      <div className="mt-2 flex justify-end gap-1 border-t border-t-border pt-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-foreground"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!dirty}
          onClick={() => {
            onSave([...selected]);
            onClose();
          }}
          className="rounded bg-blue-500 px-2 py-1 text-xs font-semibold text-white hover:bg-blue-600 disabled:opacity-40"
        >
          Save
        </button>
      </div>
    </div>
  );
}
