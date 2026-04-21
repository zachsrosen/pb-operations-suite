"use client";

import { useEffect, useRef, useState } from "react";

interface SnoozePopoverProps {
  currentDueAt: string | null;
  onSelect: (dueAt: string | null) => void;
  onClose: () => void;
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function setTimeOfDay(d: Date, hour: number): Date {
  const out = new Date(d);
  out.setHours(hour, 0, 0, 0);
  return out;
}

function nextMonday(): Date {
  const today = new Date();
  const dow = today.getDay(); // 0=Sun..6=Sat
  const daysAhead = ((1 - dow + 7) % 7) || 7;
  return setTimeOfDay(addDays(today, daysAhead), 9);
}

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function SnoozePopover({ currentDueAt, onSelect, onClose }: SnoozePopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const initial = currentDueAt ? new Date(currentDueAt) : new Date();
  const [custom, setCustom] = useState(toLocalInputValue(initial));

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

  const today = new Date();
  const presets: Array<{ label: string; iso: string | null }> = [
    { label: "Later today (5 PM)", iso: setTimeOfDay(today, 17).toISOString() },
    { label: "Tomorrow (9 AM)", iso: setTimeOfDay(addDays(today, 1), 9).toISOString() },
    { label: "Next Monday (9 AM)", iso: nextMonday().toISOString() },
    { label: "In 1 week", iso: setTimeOfDay(addDays(today, 7), 9).toISOString() },
    { label: "Clear due date", iso: null },
  ];

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-t-border bg-surface-elevated p-2 shadow-card-lg"
      role="dialog"
      aria-label="Snooze task"
    >
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
        Snooze to
      </div>
      <ul className="space-y-1">
        {presets.map((p) => (
          <li key={p.label}>
            <button
              type="button"
              onClick={() => {
                onSelect(p.iso);
                onClose();
              }}
              className="w-full rounded px-2 py-1.5 text-left text-xs text-foreground hover:bg-surface-2"
            >
              {p.label}
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 border-t border-t-border pt-2">
        <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
          Custom
        </label>
        <div className="mt-1 flex gap-1">
          <input
            type="datetime-local"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            className="flex-1 rounded border border-t-border bg-background px-2 py-1 text-xs text-foreground focus:border-blue-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => {
              if (custom) {
                onSelect(new Date(custom).toISOString());
                onClose();
              }
            }}
            className="rounded bg-blue-500 px-2 py-1 text-xs font-semibold text-white hover:bg-blue-600"
          >
            Set
          </button>
        </div>
      </div>
    </div>
  );
}
