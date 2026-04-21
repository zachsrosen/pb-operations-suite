"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useToast } from "@/contexts/ToastContext";
import { usePathname } from "next/navigation";

type FeedbackType = "BUG" | "FEATURE_REQUEST";

/**
 * Floating feedback button + modal.
 * Supports bug reports and feature requests via a type toggle.
 * Visible to all authenticated non-VIEWER users.
 * Auto-captures the current page URL.
 */
export function BugReportButton() {
  const { data: session, status } = useSession();
  const { addToast } = useToast();
  const pathname = usePathname();

  const [open, setOpen] = useState(false);
  const [type, setType] = useState<FeedbackType>("BUG");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);

  // Fetch user role to check VIEWER status
  useEffect(() => {
    if (status !== "authenticated") return;
    fetch("/api/user/me")
      .then((r) => r.json())
      .then((d) => setUserRole(d.user?.role || null))
      .catch(() => setUserRole(null));
  }, [status]);

  // Don't render for unauthenticated or confirmed-VIEWER users.
  // If role fetch fails (no DB, network error), still show for authenticated users.
  if (status !== "authenticated") return null;
  if (userRole === "VIEWER") return null;

  // Don't render on login page
  if (pathname === "/login") return null;
  if (pathname?.startsWith("/dashboards/office-performance")) return null;

  const isFeature = type === "FEATURE_REQUEST";

  const handleSubmit = async () => {
    if (!title.trim() || !description.trim()) {
      addToast({ type: "warning", title: "Missing fields", message: "Please fill in both title and description." });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/bugs/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          title: title.trim(),
          description: description.trim(),
          pageUrl: window.location.href,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        addToast({
          type: "success",
          title: isFeature ? "Feature request submitted" : "Bug report submitted",
          message: "The tech team has been notified. Thank you!",
        });
        setTitle("");
        setDescription("");
        setType("BUG");
        setOpen(false);
      } else {
        addToast({
          type: "error",
          title: "Failed to submit",
          message: data.error || "Something went wrong.",
        });
      }
    } catch {
      addToast({
        type: "error",
        title: "Network error",
        message: "Could not reach the server. Please try again.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const accent = isFeature
    ? {
        iconBg: "bg-violet-500/15 border-violet-500/20",
        iconColor: "text-violet-400",
        focusBorder: "focus:border-violet-500/50",
        focusRing: "focus:ring-violet-500/20",
        cta: "bg-violet-600 hover:bg-violet-500 disabled:bg-violet-800",
      }
    : {
        iconBg: "bg-red-500/15 border-red-500/20",
        iconColor: "text-red-400",
        focusBorder: "focus:border-orange-500/50",
        focusRing: "focus:ring-orange-500/20",
        cta: "bg-orange-600 hover:bg-orange-500 disabled:bg-orange-800",
      };

  return (
    <>
      {/* Floating feedback button — bottom-left to avoid toast overlap */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 left-6 z-40 flex items-center gap-2 px-3.5 py-2 rounded-full bg-surface border border-t-border shadow-card hover:border-orange-500/40 hover:shadow-card-lg transition-all group cursor-pointer"
        title="Send feedback — report a bug or request a feature"
      >
        <svg className="w-4 h-4 text-orange-400 group-hover:text-orange-300 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        <span className="text-xs font-medium text-muted group-hover:text-foreground transition-colors">Send Feedback</span>
      </button>

      {/* Modal backdrop + form */}
      {open && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[1000] p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="bg-surface border border-t-border rounded-xl shadow-card-lg w-full max-w-lg overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-t-border">
              <div className="flex items-center gap-2.5">
                <div className={`w-8 h-8 rounded-lg border flex items-center justify-center ${accent.iconBg}`}>
                  {isFeature ? (
                    <svg className={`w-4 h-4 ${accent.iconColor}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  ) : (
                    <svg className={`w-4 h-4 ${accent.iconColor}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  )}
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    {isFeature ? "Request a Feature" : "Report a Bug"}
                  </h3>
                  <p className="text-[0.65rem] text-muted">
                    {isFeature
                      ? "Tell us what you'd like us to build or improve"
                      : "Describe the issue and we'll look into it"}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-muted hover:text-foreground transition-colors p-1"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Type toggle */}
            <div className="px-5 pt-4">
              <div className="inline-flex items-center rounded-lg border border-t-border bg-surface-2 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setType("BUG")}
                  className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                    !isFeature
                      ? "bg-surface text-foreground shadow-sm"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  Bug
                </button>
                <button
                  type="button"
                  onClick={() => setType("FEATURE_REQUEST")}
                  className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                    isFeature
                      ? "bg-surface text-foreground shadow-sm"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  Feature request
                </button>
              </div>
            </div>

            {/* Form */}
            <div className="p-5 pt-3 space-y-4">
              {/* Title */}
              <div>
                <label htmlFor="feedback-title" className="block text-xs font-medium text-muted mb-1.5">
                  Title <span className="text-red-400">*</span>
                </label>
                <input
                  id="feedback-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={
                    isFeature
                      ? "Short summary of the feature"
                      : "Brief summary of the issue"
                  }
                  maxLength={200}
                  className={`w-full px-3 py-2 text-sm bg-background border border-t-border rounded-lg text-foreground placeholder:text-muted/50 focus:outline-none ${accent.focusBorder} focus:ring-1 ${accent.focusRing} transition-colors`}
                  autoFocus
                />
              </div>

              {/* Description */}
              <div>
                <label htmlFor="feedback-description" className="block text-xs font-medium text-muted mb-1.5">
                  Description <span className="text-red-400">*</span>
                </label>
                <textarea
                  id="feedback-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={
                    isFeature
                      ? "What should it do? Who's it for? What problem does it solve?"
                      : "What happened? What did you expect to happen? Include any steps to reproduce."
                  }
                  rows={5}
                  maxLength={5000}
                  className={`w-full px-3 py-2 text-sm bg-background border border-t-border rounded-lg text-foreground placeholder:text-muted/50 focus:outline-none ${accent.focusBorder} focus:ring-1 ${accent.focusRing} transition-colors resize-none`}
                />
              </div>

              {/* Auto-captured page URL */}
              <div className="flex items-center gap-2 text-[0.65rem] text-muted">
                <svg className="w-3 h-3 text-muted/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.172 13.828a4 4 0 015.656 0l4-4a4 4 0 00-5.656-5.656l-1.102 1.101" />
                </svg>
                <span>Page URL will be automatically included</span>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-4 border-t border-t-border bg-surface-2">
              <p className="text-[0.6rem] text-muted/60">
                Submitted by {session?.user?.name || session?.user?.email}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setOpen(false)}
                  className="px-3.5 py-1.5 text-xs font-medium text-muted hover:text-foreground border border-t-border rounded-lg hover:bg-surface transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={submitting || !title.trim() || !description.trim()}
                  className={`px-4 py-1.5 text-xs font-semibold text-white rounded-lg transition-colors disabled:text-white/50 ${accent.cta}`}
                >
                  {submitting
                    ? "Submitting..."
                    : isFeature
                    ? "Submit Request"
                    : "Submit Report"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
