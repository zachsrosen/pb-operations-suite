"use client";

import { useState } from "react";
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
  { skill: "engineering-review", label: "Engineering Review", roles: ["ADMIN", "OWNER", "MANAGER", "TECH_OPS", "OPERATIONS_MANAGER", "PROJECT_MANAGER"] },
  { skill: "sales-advisor", label: "Sales Check", roles: ["ADMIN", "OWNER", "MANAGER", "SALES"] },
];

export default function ReviewActions({ dealId, userRole }: ReviewActionsProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ReviewResult>>({});

  const visibleSkills = SKILL_CONFIG.filter((s) => s.roles.includes(userRole));

  async function runReview(skill: SkillName) {
    setLoading(skill);
    try {
      const res = await fetch("/api/reviews/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId, skill }),
      });
      const data = await res.json();
      setResults((prev) => ({ ...prev, [skill]: data }));
    } catch {
      setResults((prev) => ({
        ...prev,
        [skill]: { passed: false, errorCount: 1, warningCount: 0, findings: [{ check: "network-error", severity: "error", message: "Failed to run review" }], durationMs: 0 },
      }));
    } finally {
      setLoading(null);
    }
  }

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
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : result ? (
                result.passed ? "✓" : `✗ ${result.errorCount}`
              ) : null}
              {label}
            </button>
          );
        })}
      </div>

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
