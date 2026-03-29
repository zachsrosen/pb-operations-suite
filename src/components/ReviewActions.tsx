"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { SkillName } from "@/lib/checks/types";

interface ReviewActionsProps {
  dealId: string;
  dealName?: string;
  userRole: string;
}

interface ReviewResult {
  passed: boolean;
  errorCount: number;
  warningCount: number;
  findings: Array<{ check: string; severity: string; message: string }>;
  durationMs: number;
  reviewId?: string;
}

interface FeedbackState {
  rating: "positive" | "negative" | null;
  notes: string;
  submitted: boolean;
  submitting: boolean;
}

const SKILL_CONFIG: Array<{ skill: SkillName; label: string; roles: string[] }> = [
  { skill: "design-review", label: "Design Review", roles: ["ADMIN", "EXECUTIVE", "MANAGER", "DESIGNER", "OPERATIONS_MANAGER", "PROJECT_MANAGER", "TECH_OPS"] },
];

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_DURATION_MS = 3 * 60 * 1000; // 3 minutes max before showing timeout

/** Timed progress steps shown during AI review (~15-45s). */
const PROGRESS_STEPS = [
  { after: 0, text: "Starting review…" },
  { after: 3, text: "Fetching AHJ & utility requirements…" },
  { after: 6, text: "Locating planset in Drive…" },
  { after: 10, text: "Downloading planset PDF…" },
  { after: 14, text: "Sending planset to Claude for analysis…" },
  { after: 22, text: "Claude is reviewing the planset…" },
  { after: 35, text: "Still analyzing — large plansets take longer…" },
  { after: 50, text: "Almost done…" },
];

function useProgressText(isActive: boolean): string {
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isActive) {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isActive]);

  // Find the latest step whose threshold has passed
  let text = PROGRESS_STEPS[0].text;
  for (const step of PROGRESS_STEPS) {
    if (elapsed >= step.after) text = step.text;
  }
  return text;
}

export default function ReviewActions({ dealId, dealName, userRole }: ReviewActionsProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ReviewResult>>({});
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, FeedbackState>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStartRef = useRef<number>(0);
  const progressText = useProgressText(loading !== null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => stopPolling, [stopPolling]);

  async function pollStatus(reviewId: string, skill: SkillName) {
    // Check for client-side poll timeout
    if (Date.now() - pollStartRef.current > MAX_POLL_DURATION_MS) {
      stopPolling();
      setLoading(null);
      setError("Review timed out — the background process may have crashed. Try again.");
      setResults((prev) => ({
        ...prev,
        [skill]: {
          passed: false,
          errorCount: 1,
          warningCount: 0,
          findings: [{ check: "timeout", severity: "error", message: "Review timed out after 3 minutes. Try running again." }],
          durationMs: 0,
        },
      }));
      return;
    }

    try {
      const res = await fetch(`/api/reviews/status/${reviewId}`);
      if (!res.ok) return; // Keep polling

      const data = await res.json();

      if (data.status === "completed") {
        stopPolling();
        setLoading(null);
        setResults((prev) => ({
          ...prev,
          [skill]: {
            passed: data.passed,
            errorCount: data.errorCount,
            warningCount: data.warningCount,
            findings: data.findings ?? [],
            durationMs: data.durationMs ?? 0,
            reviewId: reviewId,
          },
        }));
      } else if (data.status === "failed") {
        stopPolling();
        setLoading(null);
        setError(data.error || "Review failed");
        setResults((prev) => ({
          ...prev,
          [skill]: {
            passed: false,
            errorCount: 1,
            warningCount: 0,
            findings: [{ check: "review-failed", severity: "error", message: data.error || "Review failed" }],
            durationMs: 0,
          },
        }));
      }
      // status === "running" → keep polling
    } catch {
      // Network error — keep polling, don't crash
    }
  }

  async function runReview(skill: SkillName) {
    setLoading(skill);
    setError(null);
    try {
      const res = await fetch("/api/reviews/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId, skill }),
      });
      const data = await res.json();

      if (res.status === 409 && data.existingReviewId) {
        // Attach flow: review already running — poll existing run
        stopPolling();
        pollStartRef.current = Date.now();
        pollRef.current = setInterval(() => pollStatus(data.existingReviewId, skill), POLL_INTERVAL_MS);
        return;
      }

      if (!res.ok) {
        setLoading(null);
        setError(data.error || "Failed to start review");
        return;
      }

      // Started successfully — poll for completion
      const reviewId = data.id;
      stopPolling();
      pollStartRef.current = Date.now();
      pollRef.current = setInterval(() => pollStatus(reviewId, skill), POLL_INTERVAL_MS);
    } catch {
      setLoading(null);
      setResults((prev) => ({
        ...prev,
        [skill]: { passed: false, errorCount: 1, warningCount: 0, findings: [{ check: "network-error", severity: "error", message: "Failed to start review" }], durationMs: 0 },
      }));
    }
  }

  async function submitFeedback(skill: string, rating: "positive" | "negative") {
    const fb = feedback[skill] || { rating: null, notes: "", submitted: false, submitting: false };

    // If clicking the same rating again, toggle off
    if (fb.rating === rating && !fb.submitted) {
      setFeedback((prev) => ({ ...prev, [skill]: { ...fb, rating: null } }));
      return;
    }

    // Set rating (show notes field)
    if (!fb.submitted) {
      setFeedback((prev) => ({ ...prev, [skill]: { ...fb, rating, submitting: false } }));
      return;
    }
  }

  async function confirmFeedback(skill: string) {
    const fb = feedback[skill];
    if (!fb?.rating) return;

    setFeedback((prev) => ({ ...prev, [skill]: { ...fb, submitting: true } }));
    try {
      const result = results[skill];
      const res = await fetch("/api/reviews/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewId: result?.reviewId || null,
          rating: fb.rating,
          notes: fb.notes.trim() || null,
          dealId,
          dealName: dealName || null,
        }),
      });
      if (!res.ok) throw new Error(`Submit failed (${res.status})`);
      setFeedback((prev) => ({ ...prev, [skill]: { ...fb, submitted: true, submitting: false } }));
    } catch {
      setFeedback((prev) => ({ ...prev, [skill]: { ...fb, submitting: false } }));
    }
  }

  const effectiveUserRole = userRole === "OWNER" ? "EXECUTIVE" : userRole;
  const visibleSkills = SKILL_CONFIG.filter((s) => s.roles.includes(effectiveUserRole));
  if (visibleSkills.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {visibleSkills.map(({ skill, label }) => {
          const result = results[skill];
          return (
            <button
              key={skill}
              onClick={() => runReview(skill)}
              disabled={loading === skill}
              className={`relative inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                result?.passed === false
                  ? "bg-red-500/10 text-red-600 border border-red-500/30 hover:bg-red-500/20"
                  : result?.passed === true
                  ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/30 hover:bg-emerald-500/20"
                  : "bg-surface-2 text-foreground border border-t-border hover:bg-surface"
              } disabled:opacity-50`}
            >
              {loading === skill ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  <span className="text-xs text-muted">{progressText}</span>
                </>
              ) : result ? (
                result.passed ? "✓" : `✗ ${result.errorCount}`
              ) : null}
              {loading !== skill && label}
            </button>
          );
        })}
      </div>

      {error && (
        <p className="text-sm text-red-500">{error}</p>
      )}

      {Object.entries(results).map(([skill, result]) =>
        result.findings.length > 0 ? (
          <div key={skill} className="rounded-lg border border-t-border bg-surface-2 p-3 space-y-1">
            <p className="text-xs font-medium text-muted uppercase tracking-wide">
              {SKILL_CONFIG.find((s) => s.skill === skill)?.label} — {result.findings.length} finding{result.findings.length !== 1 ? "s" : ""} ({result.durationMs}ms)
            </p>
            {result.findings.map((f, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <span className={f.severity === "error" ? "text-red-500" : f.severity === "warning" ? "text-amber-500" : "text-blue-500"}>
                  {f.severity === "error" ? "●" : f.severity === "warning" ? "▲" : "ℹ"}
                </span>
                <span className="text-foreground">{f.message}</span>
              </div>
            ))}

            {/* Feedback UI */}
            {(() => {
              const fb = feedback[skill] || { rating: null, notes: "", submitted: false, submitting: false };
              return (
                <div className="mt-3 pt-3 border-t border-t-border">
                  {fb.submitted ? (
                    <p className="text-xs text-muted">
                      {fb.rating === "positive" ? "👍" : "👎"} Feedback submitted
                    </p>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted">Was this review helpful?</span>
                        <button
                          onClick={() => submitFeedback(skill, "positive")}
                          className={`px-2 py-1 rounded text-xs transition-colors ${
                            fb.rating === "positive"
                              ? "bg-emerald-500/20 text-emerald-500 border border-emerald-500/40"
                              : "bg-surface text-muted border border-t-border hover:text-foreground"
                          }`}
                        >
                          👍
                        </button>
                        <button
                          onClick={() => submitFeedback(skill, "negative")}
                          className={`px-2 py-1 rounded text-xs transition-colors ${
                            fb.rating === "negative"
                              ? "bg-red-500/20 text-red-500 border border-red-500/40"
                              : "bg-surface text-muted border border-t-border hover:text-foreground"
                          }`}
                        >
                          👎
                        </button>
                      </div>
                      {fb.rating && (
                        <div className="mt-2 space-y-2">
                          <textarea
                            value={fb.notes}
                            onChange={(e) =>
                              setFeedback((prev) => ({
                                ...prev,
                                [skill]: { ...fb, notes: e.target.value },
                              }))
                            }
                            rows={2}
                            placeholder={
                              fb.rating === "negative"
                                ? "What was wrong? (incorrect findings, missed issues, etc.)"
                                : "Any additional notes? (optional)"
                            }
                            className="w-full rounded-lg bg-surface border border-t-border text-sm text-foreground px-3 py-2 focus:outline-none focus:ring-1 focus:ring-orange-500 placeholder:text-muted resize-y"
                          />
                          <button
                            onClick={() => confirmFeedback(skill)}
                            disabled={fb.submitting}
                            className="px-3 py-1.5 rounded-lg bg-orange-600 text-white text-xs hover:bg-orange-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          >
                            {fb.submitting ? "Submitting…" : "Submit Feedback"}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })()}

            <a href={`/dashboards/reviews/${dealId}`} className="text-xs text-orange-500 hover:underline mt-2 inline-block">
              View full review history →
            </a>
          </div>
        ) : null
      )}
    </div>
  );
}
