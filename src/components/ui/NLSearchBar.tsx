"use client";

/**
 * NLSearchBar
 *
 * Replaces the plain text search input in the Pipeline dashboard.
 * Users can type natural language queries like:
 *   "PE projects in Denver overdue for inspection"
 *   "RTB projects worth over 30k"
 *   "high priority Westminster projects"
 *
 * On submit (Enter or button click), sends ONLY the query string to
 * /api/ai/nl-query. The server returns a typed filter spec; this
 * component calls onFilterSpec() with it so the parent can apply it
 * client-side against the already-loaded projects array.
 *
 * Falls back gracefully to plain text search if AI fails or user
 * clears the input.
 */

import { useState, useRef, type KeyboardEvent } from "react";
import type { ProjectFilterSpec } from "@/lib/ai";

interface NLSearchBarProps {
  /** Called with the resolved filter spec when query is submitted */
  onFilterSpec: (spec: ProjectFilterSpec | null, rawQuery: string) => void;
  /** Current raw query value (controlled) */
  value: string;
  /** Called on every keystroke so parent can track the raw string */
  onChange: (value: string) => void;
  disabled?: boolean;
}

type State = "idle" | "loading" | "success" | "error";

export function NLSearchBar({ onFilterSpec, value, onChange, disabled }: NLSearchBarProps) {
  const [state, setState] = useState<State>("idle");
  const [interpretation, setInterpretation] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function submit() {
    const q = value.trim();
    if (!q) {
      onFilterSpec(null, "");
      setInterpretation("");
      setState("idle");
      return;
    }

    setState("loading");
    try {
      const res = await fetch("/api/ai/nl-query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const json = await res.json();
      const spec: ProjectFilterSpec = json.spec;

      setInterpretation(spec.interpreted_as || "");
      onFilterSpec(spec, q);
      setState("success");
    } catch (err) {
      console.error("[NLSearchBar]", err);
      setState("error");
      setInterpretation("AI unavailable — using text search.");
      // Fall back: pass null so parent falls back to text search
      onFilterSpec(null, q);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") submit();
    if (e.key === "Escape") {
      onChange("");
      onFilterSpec(null, "");
      setInterpretation("");
      setState("idle");
    }
  }

  function handleClear() {
    onChange("");
    onFilterSpec(null, "");
    setInterpretation("");
    setState("idle");
    inputRef.current?.focus();
  }

  const borderClass =
    state === "success"
      ? "border-orange-500"
      : state === "error"
        ? "border-red-500/50"
        : "border-t-border focus-within:border-orange-500";

  return (
    <div className="flex-1 min-w-[220px]">
      <div className={`flex items-center gap-1.5 bg-background border rounded-md transition-colors ${borderClass}`}>
        {/* Sparkle icon */}
        <span className="pl-2.5 text-muted text-xs select-none">✦</span>

        <input
          ref={inputRef}
          type="text"
          placeholder="Ask anything… (e.g. PE projects overdue in Westminster)"
          className="flex-1 bg-transparent text-foreground/80 text-xs py-2 pr-1 focus:outline-none placeholder:text-muted/50"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            if (!e.target.value) {
              onFilterSpec(null, "");
              setInterpretation("");
              setState("idle");
            }
          }}
          onKeyDown={handleKeyDown}
          disabled={disabled || state === "loading"}
        />

        {/* Clear button */}
        {value && state !== "loading" && (
          <button
            onClick={handleClear}
            className="px-1.5 text-muted hover:text-foreground text-xs cursor-pointer bg-transparent border-none"
            aria-label="Clear search"
          >
            ✕
          </button>
        )}

        {/* Submit / loading indicator */}
        <button
          onClick={submit}
          disabled={!value.trim() || state === "loading"}
          className="px-3 py-2 text-xs font-medium bg-orange-500 text-white rounded-r-md hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors border-none cursor-pointer"
        >
          {state === "loading" ? (
            <span className="inline-block w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            "Ask"
          )}
        </button>
      </div>

      {/* Interpretation feedback */}
      {interpretation && (
        <div
          className={`text-[0.6rem] mt-1 pl-1 ${
            state === "error" ? "text-red-400" : "text-muted"
          }`}
        >
          {state === "success" && "✓ "}
          {interpretation}
        </div>
      )}
    </div>
  );
}
