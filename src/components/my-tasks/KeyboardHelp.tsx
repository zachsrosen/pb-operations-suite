"use client";

import { useEffect, useRef } from "react";

interface KeyboardHelpProps {
  onClose: () => void;
}

const SHORTCUTS: Array<[string, string]> = [
  ["/", "Focus search"],
  ["n", "New task"],
  ["j / k", "Focus next / previous task"],
  ["c", "Mark focused task done"],
  ["x", "Toggle selection on focused task"],
  ["?", "Toggle this help"],
  ["Esc", "Close popovers / modals"],
];

export default function KeyboardHelp({ onClose }: KeyboardHelpProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        className="w-full max-w-sm rounded-lg border border-t-border bg-surface-elevated p-5 shadow-card-lg"
      >
        <h2 className="text-lg font-semibold text-foreground">Keyboard shortcuts</h2>
        <ul className="mt-4 space-y-2">
          {SHORTCUTS.map(([key, label]) => (
            <li key={key} className="flex items-center justify-between">
              <span className="text-sm text-muted">{label}</span>
              <kbd className="rounded border border-t-border bg-surface-2 px-2 py-0.5 font-mono text-xs text-foreground">
                {key}
              </kbd>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-muted">
          Shortcuts don&apos;t fire when an input, textarea, or select has focus.
        </p>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-t-border bg-surface px-3 py-1.5 text-sm text-foreground hover:bg-surface-2"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
