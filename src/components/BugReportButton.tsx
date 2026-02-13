"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useToast } from "@/contexts/ToastContext";
import { usePathname } from "next/navigation";

/**
 * Floating bug report button + modal.
 * Visible to all authenticated non-VIEWER users.
 * Auto-captures the current page URL.
 */
export function BugReportButton() {
  const { data: session, status } = useSession();
  const { addToast } = useToast();
  const pathname = usePathname();

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);

  // Fetch user role to check VIEWER status
  useEffect(() => {
    if (status !== "authenticated") return;
    fetch("/api/user/me")
      .then((r) => r.json())
      .then((d) => setUserRole(d.role || null))
      .catch(() => setUserRole(null));
  }, [status]);

  // Don't render for unauthenticated or VIEWER users
  if (status !== "authenticated" || !userRole || userRole === "VIEWER") {
    return null;
  }

  // Don't render on login page
  if (pathname === "/login") return null;

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
          title: title.trim(),
          description: description.trim(),
          pageUrl: window.location.href,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        addToast({
          type: "success",
          title: "Bug report submitted",
          message: "The tech team has been notified. Thank you!",
        });
        setTitle("");
        setDescription("");
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

  return (
    <>
      {/* Floating bug report button — bottom-left to avoid toast overlap */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 left-6 z-40 flex items-center gap-2 px-3.5 py-2 rounded-full bg-surface border border-t-border shadow-card hover:border-orange-500/40 hover:shadow-card-lg transition-all group cursor-pointer"
        title="Report a bug"
      >
        <svg className="w-4 h-4 text-orange-400 group-hover:text-orange-300 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="text-xs font-medium text-muted group-hover:text-foreground transition-colors">Report Bug</span>
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
                <div className="w-8 h-8 rounded-lg bg-red-500/15 border border-red-500/20 flex items-center justify-center">
                  <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Report a Bug</h3>
                  <p className="text-[0.65rem] text-muted">Describe the issue and we&apos;ll look into it</p>
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

            {/* Form */}
            <div className="p-5 space-y-4">
              {/* Title */}
              <div>
                <label htmlFor="bug-title" className="block text-xs font-medium text-muted mb-1.5">
                  Title <span className="text-red-400">*</span>
                </label>
                <input
                  id="bug-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Brief summary of the issue"
                  maxLength={200}
                  className="w-full px-3 py-2 text-sm bg-background border border-t-border rounded-lg text-foreground placeholder:text-muted/50 focus:outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/20 transition-colors"
                  autoFocus
                />
              </div>

              {/* Description */}
              <div>
                <label htmlFor="bug-description" className="block text-xs font-medium text-muted mb-1.5">
                  Description <span className="text-red-400">*</span>
                </label>
                <textarea
                  id="bug-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What happened? What did you expect to happen? Include any steps to reproduce."
                  rows={5}
                  maxLength={5000}
                  className="w-full px-3 py-2 text-sm bg-background border border-t-border rounded-lg text-foreground placeholder:text-muted/50 focus:outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/20 transition-colors resize-none"
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
                Reported by {session?.user?.name || session?.user?.email}
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
                  className="px-4 py-1.5 text-xs font-semibold text-white bg-orange-600 hover:bg-orange-500 disabled:bg-orange-800 disabled:text-white/50 rounded-lg transition-colors"
                >
                  {submitting ? "Submitting..." : "Submit Report"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
