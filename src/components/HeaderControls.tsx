"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";

// Paths where each control is intentionally suppressed. Keep these in sync with
// the per-widget guards in ChatWidget.tsx (HIDDEN_PATHS) and BugReportButton.tsx.
const CHAT_HIDDEN_PREFIXES = [
  "/dashboards/scheduler",
  "/dashboards/construction-scheduler",
  "/dashboards/site-survey-scheduler",
  "/dashboards/inspection-scheduler",
  "/dashboards/office-performance",
  "/estimator",
  "/portal",
];

const FEEDBACK_HIDDEN_PREFIXES = ["/dashboards/office-performance", "/estimator"];

/**
 * Compact chat + feedback launchers that live in the app header chrome instead
 * of floating over page content. Each button dispatches a window event that the
 * globally-mounted ChatWidget / BugReportButton listen for and open in place.
 */
export function HeaderControls({ buttonClassName }: { buttonClassName?: string } = {}) {
  const { status } = useSession();
  const pathname = usePathname();
  const [userRole, setUserRole] = useState<string | null>(null);

  const btnClass =
    buttonClassName ??
    "text-muted hover:text-foreground transition-colors p-1.5 rounded hover:bg-surface-2";

  // Mirror BugReportButton's gating: hide feedback for confirmed VIEWER users.
  useEffect(() => {
    if (status !== "authenticated") return;
    fetch("/api/user/me")
      .then((r) => r.json())
      .then((d) => setUserRole(d.user?.role || null))
      .catch(() => setUserRole(null));
  }, [status]);

  if (status !== "authenticated") return null;
  if (pathname === "/login") return null;

  const showChat = !CHAT_HIDDEN_PREFIXES.some((p) => pathname?.startsWith(p));
  const showFeedback =
    userRole !== "VIEWER" &&
    !FEEDBACK_HIDDEN_PREFIXES.some((p) => pathname?.startsWith(p));

  if (!showChat && !showFeedback) return null;

  return (
    <div className="flex items-center gap-1">
      {showChat && (
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("open-chat-widget"))}
          className={btnClass}
          title="Open PB Assistant"
          aria-label="Open chat assistant"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </button>
      )}
      {showFeedback && (
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("open-feedback-modal"))}
          className={btnClass}
          title="Send feedback — report a bug or request a feature"
          aria-label="Send feedback"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
          </svg>
        </button>
      )}
    </div>
  );
}
