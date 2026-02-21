"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import type { ProjectFilterSpec } from "@/lib/ai";

const PIPELINE_OPTIONS = [
  { id: "all", label: "All Pipeline" },
  { id: "pe", label: "PE Only" },
  { id: "rtb", label: "RTB Only" },
] as const;

const LOCATION_OPTIONS = ["San Diego", "Orange County", "Inland Empire", "Los Angeles", "Riverside"];

type State = "idle" | "loading" | "success" | "error";

interface AnomalyItem {
  project_id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  reason: string;
}

interface AnomalyResponse {
  anomalies: AnomalyItem[];
  summary: string;
  cached: boolean;
  error?: boolean;
}

function toSpecChips(spec: ProjectFilterSpec | null): string[] {
  if (!spec) return [];
  const chips: string[] = [];
  if (spec.is_pe) chips.push("PE only");
  if (spec.is_rtb) chips.push("RTB only");
  if (spec.locations?.length) chips.push(`Locations: ${spec.locations.join(", ")}`);
  if (spec.stages?.length) chips.push(`Stages: ${spec.stages.join(", ")}`);
  if (typeof spec.min_amount === "number") chips.push(`Min amount: $${spec.min_amount.toLocaleString()}`);
  if (typeof spec.max_amount === "number") chips.push(`Max amount: $${spec.max_amount.toLocaleString()}`);
  if (spec.is_overdue) chips.push("Overdue only");
  return chips;
}

export default function FilterToggles({ dark = true }: { dark?: boolean }) {
  const [pipeline, setPipeline] = useState<string>("all");
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);

  const [query, setQuery] = useState("");
  const [nlState, setNlState] = useState<State>("idle");
  const [nlInterpretation, setNlInterpretation] = useState("");
  const [nlSpec, setNlSpec] = useState<ProjectFilterSpec | null>(null);

  const [anomalyState, setAnomalyState] = useState<State>("idle");
  const [anomalyData, setAnomalyData] = useState<AnomalyResponse | null>(null);

  const summary = useMemo(() => {
    const pipelineLabel = PIPELINE_OPTIONS.find((option) => option.id === pipeline)?.label ?? "All Pipeline";
    const locationLabel = selectedLocations.length > 0 ? selectedLocations.join(", ") : "All locations";
    return `${pipelineLabel} | ${locationLabel}`;
  }, [pipeline, selectedLocations]);

  const aiContext = useMemo(() => {
    const pipelineLabel = PIPELINE_OPTIONS.find((option) => option.id === pipeline)?.label ?? "All Pipeline";
    const locationLabel = selectedLocations.length > 0 ? selectedLocations.join(", ") : "All locations";
    return `Current UI filters: pipeline=${pipelineLabel}; locations=${locationLabel}.`;
  }, [pipeline, selectedLocations]);

  const toggleLocation = (location: string) => {
    setSelectedLocations((prev) =>
      prev.includes(location) ? prev.filter((value) => value !== location) : [...prev, location]
    );
  };

  const clearLocations = () => setSelectedLocations([]);

  async function askAI() {
    const q = query.trim();
    if (!q) return;

    setNlState("loading");
    setNlSpec(null);

    try {
      const res = await fetch("/api/ai/nl-query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: `${q}\n\n${aiContext}` }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const json = await res.json();
      const spec: ProjectFilterSpec = json.spec;

      setNlInterpretation(spec.interpreted_as || "Parsed request.");
      setNlSpec(spec);
      setNlState("success");
    } catch (err) {
      console.error("[PrototypeAI/NL]", err);
      setNlInterpretation("AI parsing unavailable or restricted (ADMIN/OWNER only).");
      setNlSpec(null);
      setNlState("error");
    }
  }

  async function runAnomalyScan() {
    setAnomalyState("loading");

    try {
      const res = await fetch("/api/ai/anomalies", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: AnomalyResponse = await res.json();
      setAnomalyData(json);
      setAnomalyState("success");
    } catch (err) {
      console.error("[PrototypeAI/Anomaly]", err);
      setAnomalyData(null);
      setAnomalyState("error");
    }
  }

  function handleQueryKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") askAI();
  }

  const shellClass = dark
    ? "rounded-2xl border border-cyan-100/25 bg-slate-950/45 p-4"
    : "rounded-2xl border border-slate-900/15 bg-white/90 p-4";

  const labelClass = dark
    ? "text-xs uppercase tracking-[0.18em] text-cyan-100/80"
    : "text-xs uppercase tracking-[0.18em] text-slate-600";

  const inactiveChipClass = dark
    ? "border-white/20 bg-white/[0.03] text-slate-200 hover:border-cyan-200/45"
    : "border-slate-900/20 bg-slate-100 text-slate-700 hover:border-slate-900/35";

  const activeChipClass = dark
    ? "border-cyan-200/50 bg-cyan-300/[0.12] text-cyan-100"
    : "border-slate-900/40 bg-slate-900/8 text-slate-900";

  const summaryClass = dark ? "text-xs text-slate-300" : "text-xs text-slate-600";

  const inputClass = dark
    ? "bg-slate-900/70 border-white/20 text-slate-100 placeholder:text-slate-400"
    : "bg-white border-slate-900/20 text-slate-900 placeholder:text-slate-500";

  const cardClass = dark
    ? "rounded-xl border border-white/14 bg-white/[0.02] p-3"
    : "rounded-xl border border-slate-900/12 bg-slate-50 p-3";

  const specChips = toSpecChips(nlSpec);

  return (
    <section className={shellClass}>
      <p className={labelClass}>Pipeline Toggle</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {PIPELINE_OPTIONS.map((option) => {
          const isActive = option.id === pipeline;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setPipeline(option.id)}
              aria-pressed={isActive}
              className={`rounded-full border px-3 py-1.5 text-xs uppercase tracking-[0.15em] transition ${
                isActive ? activeChipClass : inactiveChipClass
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className={labelClass}>Location Toggle</p>
        {selectedLocations.length > 0 && (
          <button
            type="button"
            onClick={clearLocations}
            className={`text-xs underline transition ${dark ? "text-cyan-100/75 hover:text-cyan-100" : "text-slate-600 hover:text-slate-900"}`}
          >
            Clear locations
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {LOCATION_OPTIONS.map((location) => {
          const isActive = selectedLocations.includes(location);
          return (
            <button
              key={location}
              type="button"
              onClick={() => toggleLocation(location)}
              aria-pressed={isActive}
              className={`rounded-full border px-3 py-1.5 text-xs transition ${isActive ? activeChipClass : inactiveChipClass}`}
            >
              {location}
            </button>
          );
        })}
      </div>

      <p className={`mt-3 ${summaryClass}`}>Active filters: {summary}</p>

      <div className={`mt-5 border-t pt-4 ${dark ? "border-white/12" : "border-slate-900/12"}`}>
        <p className={labelClass}>Zach&apos;s Bot</p>

        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleQueryKeyDown}
            placeholder="Ask Zach's Bot what to focus on next"
            className={`w-full rounded-lg border px-3 py-2 text-sm outline-none transition focus:border-cyan-300 ${inputClass}`}
          />
          <button
            type="button"
            onClick={askAI}
            disabled={!query.trim() || nlState === "loading"}
            className="rounded-lg border border-cyan-200/40 bg-cyan-300/15 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-cyan-100 transition hover:bg-cyan-300/25 disabled:opacity-40"
          >
            {nlState === "loading" ? "Thinking" : "Ask AI"}
          </button>
          <button
            type="button"
            onClick={runAnomalyScan}
            disabled={anomalyState === "loading"}
            className={`rounded-lg border px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition ${
              dark
                ? "border-white/25 bg-white/[0.03] text-slate-200 hover:bg-white/[0.08]"
                : "border-slate-900/20 bg-slate-100 text-slate-800 hover:bg-slate-200"
            } disabled:opacity-40`}
          >
            {anomalyState === "loading" ? "Scanning" : "Run Scan"}
          </button>
        </div>

        {(nlInterpretation || nlState === "error") && (
          <p className={`mt-3 text-xs ${nlState === "error" ? "text-red-400" : dark ? "text-slate-300" : "text-slate-600"}`}>
            {nlInterpretation}
          </p>
        )}

        {specChips.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {specChips.map((chip) => (
              <span key={chip} className={cardClass}>
                {chip}
              </span>
            ))}
          </div>
        )}

        {anomalyState === "error" && (
          <p className="mt-3 text-xs text-red-400">Anomaly scan unavailable or restricted (ADMIN/OWNER only).</p>
        )}

        {anomalyState === "success" && anomalyData && (
          <div className="mt-3 space-y-2">
            <p className={dark ? "text-xs text-slate-300" : "text-xs text-slate-600"}>
              {anomalyData.summary || "AI scan completed."}
              {anomalyData.cached ? " (cached)" : ""}
            </p>
            {anomalyData.anomalies.slice(0, 3).map((anomaly) => (
              <div key={`${anomaly.project_id}-${anomaly.title}`} className={cardClass}>
                <p className="text-xs font-semibold uppercase tracking-[0.14em]">{anomaly.severity}</p>
                <p className="mt-1 text-sm font-medium">{anomaly.title}</p>
                <p className={`mt-1 text-xs ${dark ? "text-slate-300" : "text-slate-600"}`}>{anomaly.reason}</p>
              </div>
            ))}
            {anomalyData.anomalies.length === 0 && (
              <p className={dark ? "text-xs text-slate-300" : "text-xs text-slate-600"}>No non-obvious anomalies found.</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
