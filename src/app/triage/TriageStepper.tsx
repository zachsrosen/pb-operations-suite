"use client";

import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  AdderCategory,
  TriageAnswerType,
} from "@/generated/prisma/enums";
import type { SerializedAdder } from "@/app/dashboards/adders/types";
import type { TriageDraft } from "./useOfflineDraft";

type Props = {
  runId: string;
  draft: TriageDraft;
  setDraft: (next: TriageDraft | ((prev: TriageDraft) => TriageDraft)) => void;
  onComplete: (adders: SerializedAdder[]) => void;
  onBackToLookup: () => void;
  dealName?: string | null;
};

type Choice = { label: string; value: string | number | boolean };

/**
 * Extract displayable choice list from triageChoices JSON. Accepts two shapes:
 * ["foo", "bar"] or [{ label, value }].
 */
function toChoices(raw: unknown): Choice[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c): Choice | null => {
      if (typeof c === "string") return { label: c, value: c };
      if (c && typeof c === "object") {
        const obj = c as Record<string, unknown>;
        const value = obj.value as string | number | boolean | undefined;
        const label = typeof obj.label === "string" ? obj.label : String(value);
        if (value === undefined) return null;
        return { label, value };
      }
      return null;
    })
    .filter((c): c is Choice => c !== null);
}

const CATEGORY_LABELS: Record<AdderCategory, string> = {
  ELECTRICAL: "Electrical",
  ROOFING: "Roofing",
  STRUCTURAL: "Structural",
  SITEWORK: "Sitework",
  LOGISTICS: "Logistics",
  DESIGN: "Design",
  PERMITTING: "Permitting",
  REMOVAL: "Removal",
  ORG: "Organization",
  MISC: "Misc",
};

export default function TriageStepper({
  runId,
  draft,
  setDraft,
  onComplete,
  onBackToLookup,
  dealName,
}: Props) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["adders", "active", "triage"],
    queryFn: async () => {
      const res = await fetch("/api/adders?active=true");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { adders: SerializedAdder[] };
      return body.adders ?? [];
    },
    staleTime: 60_000,
  });

  // Keep only adders that have a triage question — those are the ones a rep
  // can answer. autoApply adders (no question) are still evaluated by the
  // recommendation engine on review.
  const questions = useMemo<SerializedAdder[]>(() => {
    if (!data) return [];
    return data
      .filter((a) => a.active && !a.autoApply && a.triageQuestion)
      .sort((a, b) => {
        const catDiff = a.category.localeCompare(b.category);
        if (catDiff !== 0) return catDiff;
        return a.code.localeCompare(b.code);
      });
  }, [data]);

  const stepIndex = Math.min(
    Math.max(draft.stepIndex, 0),
    Math.max(questions.length - 1, 0)
  );
  const current = questions[stepIndex];

  // Debounced PATCH of answers to the server. Keeps the server copy in sync
  // without flooding on rapid edits. Clears on unmount.
  const patchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!runId) return;
    if (patchTimer.current) clearTimeout(patchTimer.current);
    patchTimer.current = setTimeout(() => {
      fetch(`/api/triage/runs/${runId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: draft.answers }),
      }).catch(() => null);
    }, 500);
    return () => {
      if (patchTimer.current) clearTimeout(patchTimer.current);
    };
  }, [draft.answers, runId]);

  function setAnswer(adderId: string, value: unknown) {
    setDraft((prev) => ({
      ...prev,
      answers: { ...prev.answers, [adderId]: value },
    }));
  }

  function skip() {
    if (!current) return;
    setAnswer(current.id, null);
    advance();
  }

  function advance() {
    if (stepIndex >= questions.length - 1) {
      onComplete(data ?? []);
      return;
    }
    setDraft((prev) => ({ ...prev, stepIndex: prev.stepIndex + 1 }));
  }

  function back() {
    if (stepIndex === 0) {
      onBackToLookup();
      return;
    }
    setDraft((prev) => ({ ...prev, stepIndex: Math.max(prev.stepIndex - 1, 0) }));
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-t-border border-t-orange-500" />
        <p className="text-sm text-muted">Loading questions…</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-4 text-center">
        <p className="text-sm text-red-500">Failed to load adders.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg bg-orange-500 px-4 py-2 text-sm text-white"
        >
          Retry
        </button>
      </div>
    );
  }

  if (questions.length === 0) {
    // No questions to ask — jump straight to review (autoApply + photoless
    // cases still produce recommendations).
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-4 text-center">
        <p className="text-sm text-muted">
          No triage questions configured. Reviewing auto-apply rules only…
        </p>
        <button
          type="button"
          onClick={() => onComplete(data ?? [])}
          className="rounded-lg bg-orange-500 px-4 py-2 text-sm text-white"
        >
          Continue to review
        </button>
      </div>
    );
  }

  const progressPct = ((stepIndex + 1) / questions.length) * 100;
  const category = current?.category as AdderCategory;
  const answer = current ? draft.answers[current.id] : undefined;

  return (
    <div className="flex min-h-screen flex-col">
      {/* Sticky header with progress */}
      <header className="sticky top-0 z-10 border-b border-t-border bg-surface/95 backdrop-blur">
        <div className="flex items-center justify-between px-4 py-3">
          <button
            type="button"
            onClick={back}
            className="text-sm font-medium text-muted hover:text-foreground"
          >
            ← Back
          </button>
          <div className="text-xs font-medium text-muted">
            {stepIndex + 1} of {questions.length}
          </div>
        </div>
        <div className="h-1 w-full bg-surface-2">
          <div
            className="h-full bg-orange-500 transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        {dealName && (
          <div className="truncate px-4 py-2 text-xs text-muted">
            {dealName}
          </div>
        )}
      </header>

      <main className="flex flex-1 flex-col gap-4 p-4">
        {current && (
          <>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-orange-500">
                {CATEGORY_LABELS[category] ?? category}
              </div>
              <h2 className="mt-2 text-xl font-semibold text-foreground">
                {current.triageQuestion}
              </h2>
              {current.photosRequired && (
                <p className="mt-2 text-xs text-muted">
                  📷 A photo will be required at review if this applies.
                </p>
              )}
            </div>

            <QuestionInput
              answerType={current.triageAnswerType}
              choices={toChoices(current.triageChoices)}
              value={answer}
              onChange={(v) => setAnswer(current.id, v)}
              unit={current.unit}
            />

            <div className="mt-auto flex flex-col gap-2 pt-4">
              <button
                type="button"
                onClick={advance}
                className="w-full rounded-lg bg-orange-500 px-4 py-3 text-base font-medium text-white transition-colors hover:bg-orange-600"
              >
                {stepIndex === questions.length - 1 ? "Review" : "Next"}
              </button>
              <button
                type="button"
                onClick={skip}
                className="w-full rounded-lg bg-surface-2 px-4 py-3 text-sm font-medium text-muted transition-colors hover:text-foreground"
              >
                Skip
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function QuestionInput({
  answerType,
  choices,
  value,
  onChange,
  unit,
}: {
  answerType: TriageAnswerType | null;
  choices: Choice[];
  value: unknown;
  onChange: (v: unknown) => void;
  unit: string;
}) {
  const type = answerType ?? (choices.length > 0 ? "CHOICE" : "BOOLEAN");

  if (type === "BOOLEAN") {
    return (
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => onChange(true)}
          className={`rounded-lg border-2 px-4 py-4 text-base font-semibold transition-colors ${
            value === true
              ? "border-orange-500 bg-orange-500/10 text-orange-500"
              : "border-t-border bg-surface text-foreground hover:border-orange-500/50"
          }`}
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => onChange(false)}
          className={`rounded-lg border-2 px-4 py-4 text-base font-semibold transition-colors ${
            value === false
              ? "border-orange-500 bg-orange-500/10 text-orange-500"
              : "border-t-border bg-surface text-foreground hover:border-orange-500/50"
          }`}
        >
          No
        </button>
      </div>
    );
  }

  if (type === "NUMERIC" || type === "MEASUREMENT") {
    return (
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wider text-muted">
          {unitLabel(unit)}
        </span>
        <input
          type="number"
          inputMode="decimal"
          value={typeof value === "number" ? value : value == null ? "" : String(value)}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") {
              onChange(null);
              return;
            }
            const n = Number(raw);
            onChange(Number.isFinite(n) ? n : null);
          }}
          className="rounded-lg border border-t-border bg-surface px-3 py-3 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-orange-500"
          placeholder="0"
        />
      </label>
    );
  }

  if (type === "CHOICE") {
    return (
      <div className="flex flex-col gap-2">
        {choices.map((c, i) => {
          const selected = value === c.value;
          return (
            <button
              key={`${String(c.value)}-${i}`}
              type="button"
              onClick={() => onChange(c.value)}
              className={`rounded-lg border-2 px-4 py-3 text-left text-base font-medium transition-colors ${
                selected
                  ? "border-orange-500 bg-orange-500/10 text-orange-500"
                  : "border-t-border bg-surface text-foreground hover:border-orange-500/50"
              }`}
            >
              {c.label}
            </button>
          );
        })}
      </div>
    );
  }

  // Fallback — shouldn't occur, but renders a text input to avoid crashing.
  return (
    <input
      type="text"
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-t-border bg-surface px-3 py-3 text-base text-foreground"
    />
  );
}

function unitLabel(unit: string): string {
  switch (unit) {
    case "PER_LINEAR_FT":
      return "Feet";
    case "PER_MODULE":
      return "Modules";
    case "PER_KW":
      return "kW";
    case "PER_HOUR":
      return "Hours";
    case "FLAT":
    case "TIERED":
    default:
      return "Quantity";
  }
}
