"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface ShortcutEntry {
  keys: string[];
  label: string;
}

interface ShortcutGroup {
  title: string;
  shortcuts: ShortcutEntry[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Navigation",
    shortcuts: [
      { keys: ["g", "h"], label: "Go to Home" },
      { keys: ["g", "s"], label: "Go to Master Schedule" },
      { keys: ["g", "p"], label: "Go to Pipeline" },
      { keys: ["g", "r"], label: "Go to Revenue" },
      { keys: ["g", "c"], label: "Go to Command Center" },
      { keys: ["g", "a"], label: "Go to Alerts" },
      { keys: ["g", "i"], label: "Go to Inventory" },
      { keys: ["g", "e"], label: "Go to Executive Summary" },
    ],
  },
  {
    title: "Global",
    shortcuts: [
      { keys: ["Mod", "K"], label: "Open search" },
      { keys: ["?"], label: "Show keyboard shortcuts" },
      { keys: ["Esc"], label: "Close dialog / modal" },
    ],
  },
  {
    title: "Master Scheduler",
    shortcuts: [
      { keys: ["1"], label: "Month view" },
      { keys: ["2"], label: "Week view" },
      { keys: ["3"], label: "Gantt view" },
      { keys: ["Alt", "←"], label: "Previous period" },
      { keys: ["Alt", "→"], label: "Next period" },
      { keys: ["Mod", "E"], label: "Export CSV" },
    ],
  },
];

const NAV_MAP: Record<string, string> = {
  h: "/",
  s: "/dashboards/scheduler",
  p: "/dashboards/pipeline",
  r: "/dashboards/revenue",
  c: "/dashboards/command-center",
  a: "/dashboards/alerts",
  i: "/dashboards/inventory",
  e: "/dashboards/executive",
};

function useIsMac() {
  const [isMac] = useState(() => {
    if (typeof navigator === "undefined") return true;
    return /(Mac|iPhone|iPod|iPad)/i.test(navigator.userAgent);
  });
  return isMac;
}

function Kbd({ children }: { children: string }) {
  const isMac = useIsMac();
  const display = children === "Mod" ? (isMac ? "⌘" : "Ctrl") : children;
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-1.5 text-xs font-mono font-medium bg-surface-2 border border-t-border rounded text-foreground/80">
      {display}
    </kbd>
  );
}

export function KeyboardShortcutsDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const isOpenRef = useRef(false);
  const routerRef = useRef<ReturnType<typeof useRouter>>(null);
  const pendingPrefix = useRef<string | null>(null);
  const prefixTimer = useRef<NodeJS.Timeout | null>(null);

  const router = useRouter();
  // Keep refs in sync so the single event listener always reads current values
  isOpenRef.current = isOpen;
  routerRef.current = router;

  // Register a single event listener on mount — never re-registered.
  // Reads state via refs to avoid stale closures.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const inInput =
        target.tagName === "INPUT" ||
        target.tagName === "SELECT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      // Always allow Escape to close the dialog
      if (e.key === "Escape" && isOpenRef.current) {
        e.preventDefault();
        setIsOpen(false);
        return;
      }

      // Don't handle shortcuts when typing in inputs
      if (inInput) return;

      // Don't handle shortcuts when another overlay (e.g. GlobalSearch) is open
      if (document.querySelector("[data-global-search-open]")) return;

      // "?" to toggle shortcuts dialog (Shift+/ on US keyboards)
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setIsOpen((prev) => !prev);
        return;
      }

      // Skip navigation shortcuts when the dialog is open
      if (isOpenRef.current) return;

      // "g" prefix for navigation (two-key sequence: press g, then a letter)
      if (e.key === "g" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!pendingPrefix.current) {
          pendingPrefix.current = "g";
          if (prefixTimer.current) clearTimeout(prefixTimer.current);
          prefixTimer.current = setTimeout(() => {
            pendingPrefix.current = null;
          }, 1000);
          return;
        }
      }

      // Handle second key after "g" prefix
      if (pendingPrefix.current === "g") {
        pendingPrefix.current = null;
        if (prefixTimer.current) clearTimeout(prefixTimer.current);

        const dest = NAV_MAP[e.key];
        if (dest) {
          e.preventDefault();
          routerRef.current?.push(dest);
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (prefixTimer.current) clearTimeout(prefixTimer.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- stable via refs

  return (
    <>
      {/* Always-visible keyboard shortcut hint button */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center justify-center w-7 h-7 rounded-lg bg-surface border border-t-border shadow-card hover:border-orange-500/40 hover:shadow-card-lg transition-all text-muted hover:text-foreground cursor-pointer"
        title="Keyboard shortcuts (?)"
        aria-label="Show keyboard shortcuts"
      >
        <kbd className="text-xs font-mono font-medium leading-none">?</kbd>
      </button>

      {/* Dialog overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
          onClick={() => setIsOpen(false)}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

          {/* Dialog */}
          <div
            className="relative w-full max-w-lg bg-surface border border-t-border rounded-xl shadow-card-lg overflow-hidden animate-fadeIn"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Keyboard shortcuts"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-t-border">
              <h2 className="text-sm font-semibold text-foreground">
                Keyboard Shortcuts
              </h2>
              <button
                onClick={() => setIsOpen(false)}
                className="text-muted hover:text-foreground transition-colors"
                aria-label="Close"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Shortcuts list */}
            <div className="px-5 py-4 max-h-[60vh] overflow-y-auto space-y-5">
              {SHORTCUT_GROUPS.map((group) => (
                <div key={group.title}>
                  <h3 className="text-xs font-medium text-muted uppercase tracking-wider mb-2">
                    {group.title}
                  </h3>
                  <div className="space-y-1.5">
                    {group.shortcuts.map((shortcut) => (
                      <div
                        key={shortcut.label}
                        className="flex items-center justify-between py-1"
                      >
                        <span className="text-sm text-foreground/80">
                          {shortcut.label}
                        </span>
                        <div className="flex items-center gap-1">
                          {shortcut.keys.map((key, i) => (
                            <span key={i} className="flex items-center gap-1">
                              {i > 0 && (
                                <span className="text-muted/50 text-xs">then</span>
                              )}
                              <Kbd>{key}</Kbd>
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="border-t border-t-border px-5 py-3 text-xs text-muted/70">
              Press <Kbd>?</Kbd> to toggle this dialog
            </div>
          </div>
        </div>
      )}
    </>
  );
}
