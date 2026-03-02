"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { SkillName } from "@/lib/checks/types";

interface ReviewActionsProps {
  dealId: string;
  userRole: string;
}

interface ReviewResult {
  passed: boolean;
  errorCount: number;
  warningCount: number;
  findings: Array<{ check: string; severity: string; message: string }>;
  durationMs: number;
}

const SKILL_CONFIG: Array<{ skill: SkillName; label: string; roles: string[] }> = [
  { skill: "design-review", label: "Design Review", roles: ["ADMIN", "OWNER", "MANAGER", "DESIGNER", "OPERATIONS_MANAGER", "PROJECT_MANAGER"] },
];

const POLL_INTERVAL_MS = 3000;

export default function ReviewActions({ dealId, userRole }: ReviewActionsProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ReviewResult>>({});
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => stopPolling, [stopPolling]);

  async function pollStatus(reviewId: string, skill: SkillName) {
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
      pollRef.current = setInterval(() => pollStatus(reviewId, skill), POLL_INTERVAL_MS);
    } catch {
      setLoading(null);
      setResults((prev) => ({
        ...prev,
        [skill]: { passed: false, errorCount: 1, warningCount: 0, findings: [{ check: "network-error", severity: "error", message: "Failed to start review" }], durationMs: 0 },
      }));
    }
  }

  const visibleSkills = SKILL_CONFIG.filter((s) => s.roles.includes(userRole));
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
                  <span className="text-xs text-muted">Reviewing planset…</span>
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
            <a href={`/dashboards/reviews/${dealId}`} className="text-xs text-orange-500 hover:underline mt-1 inline-block">
              View full review history →
            </a>
          </div>
        ) : null
      )}
    </div>
  );
}
