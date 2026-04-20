"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface AdminDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  wide?: boolean;
  footer?: ReactNode;
}

export function AdminDetailDrawer({ open, onClose, title, children, wide, footer }: AdminDetailDrawerProps) {
  const titleId = useId();
  const drawerRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement;
    // Focus drawer first focusable on open (close button)
    const closeBtn = drawerRef.current?.querySelector<HTMLButtonElement>(
      "button[data-admin-drawer-close]",
    );
    closeBtn?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "Tab" && drawerRef.current) {
        const focusables = Array.from(
          drawerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
        ).filter((el) => !el.hasAttribute("disabled"));
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      (previouslyFocused.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      data-admin-drawer-overlay="true"
      onClick={onClose}
      className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
    >
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className={`absolute right-0 top-0 flex h-full flex-col border-l border-t-border/60 bg-surface shadow-2xl ${
          wide ? "w-[480px]" : "w-[384px]"
        }`}
      >
        <header className="flex items-start justify-between gap-3 border-b border-t-border/60 px-4 py-3">
          <div id={titleId} className="min-w-0 flex-1">
            {title}
          </div>
          <button
            type="button"
            data-admin-drawer-close
            onClick={onClose}
            aria-label="Close drawer"
            className="rounded p-1 text-muted hover:bg-surface-2 hover:text-foreground"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {footer && (
          <footer className="border-t border-t-border/60 px-4 py-3">{footer}</footer>
        )}
      </div>
    </div>
  );
}
