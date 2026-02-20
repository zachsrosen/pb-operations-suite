"use client";

/**
 * AnomalyInsights
 *
 * Fetches AI-detected anomalies from /api/ai/anomalies and renders them
 * as a collapsible "AI Insights" section. Completely independent of the
 * existing rule-based alerts — additive only, never replaces them.
 *
 * States:
 * - idle: not yet triggered (user must click "Run AI Analysis")
 * - loading: spinner
 * - error: inline error, no crash
 * - success: list of anomalies + summary, or empty state
 */

import { useState } from "react";
import type { ExecProject } from "@/lib/executive-shared";

interface AnomalyItem {
  project_id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  reason: string;
  project?: ExecProject;
}

interface AnomalyResponse {
  anomalies: AnomalyItem[];
  summary: string;
  cached: boolean;
  error?: boolean;
}

const SEVERITY_STYLES: Record<AnomalyItem["severity"], { border: string; badge: string; icon: string }> = {
  critical: {
    border: "border-red-500",
    badge: "bg-red-500/20 text-red-400",
    icon: "⚠",
  },
  warning: {
    border: "border-yellow-500",
    badge: "bg-yellow-500/20 text-yellow-400",
    icon: "!",
  },
  info: {
    border: "border-blue-500",
    badge: "bg-blue-500/20 text-blue-400",
    icon: "i",
  },
};

export function AnomalyInsights() {
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [data, setData] = useState<AnomalyResponse | null>(null);
  const [isExpanded, setIsExpanded] = useState(true);

  async function runAnalysis() {
    setState("loading");
    try {
      const res = await fetch("/api/ai/anomalies", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      const json: AnomalyResponse = await res.json();
      setData(json);
      setState("success");
    } catch (err) {
      console.error("[AnomalyInsights]", err);
      setState("error");
    }
  }

  return (
    <div className="bg-surface border border-t-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-t-border">
        <div className="flex items-center gap-3">
          <span className="text-lg">✦</span>
          <div>
            <div className="font-semibold text-sm">AI Insights</div>
            <div className="text-[0.65rem] text-muted">
              Non-obvious patterns — powered by gpt-4o-mini
            </div>
          </div>
          {data?.cached && (
            <span className="text-[0.6rem] text-muted border border-t-border rounded px-2 py-0.5">
              cached
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {state === "success" && (
            <button
              onClick={() => setIsExpanded((v) => !v)}
              className="text-xs text-muted hover:text-foreground transition-colors"
            >
              {isExpanded ? "collapse" : "expand"}
            </button>
          )}
          {(state === "idle" || state === "error") && (
            <button
              onClick={runAnalysis}
              className="px-3 py-1.5 text-xs font-semibold rounded-md bg-orange-500 text-white hover:bg-orange-600 transition-colors cursor-pointer border-none"
            >
              Run AI Analysis
            </button>
          )}
          {state === "success" && (
            <button
              onClick={runAnalysis}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-t-border text-muted hover:text-foreground hover:border-orange-500 transition-colors cursor-pointer bg-transparent"
            >
              Refresh
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      {state === "idle" && (
        <div className="px-5 py-8 text-center text-muted text-sm">
          Click "Run AI Analysis" to detect non-obvious patterns in the pipeline.
        </div>
      )}

      {state === "loading" && (
        <div className="px-5 py-8 text-center text-muted text-sm">
          <div className="inline-block w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mb-3" />
          <div>Analyzing {`>`} 80 projects for anomalies…</div>
        </div>
      )}

      {state === "error" && (
        <div className="px-5 py-6 text-center">
          <div className="text-sm text-red-400 mb-2">Analysis failed. Check OPENAI_API_KEY or try again.</div>
          <button
            onClick={runAnalysis}
            className="px-3 py-1.5 text-xs bg-orange-500 text-white rounded-md border-none cursor-pointer hover:bg-orange-600"
          >
            Retry
          </button>
        </div>
      )}

      {state === "success" && data && isExpanded && (
        <div className="p-5 space-y-3">
          {/* Summary */}
          {data.summary && (
            <div className="text-xs text-muted italic border-l-2 border-orange-500/40 pl-3 py-1">
              {data.summary}
            </div>
          )}

          {/* Anomaly list */}
          {data.anomalies.length === 0 ? (
            <div className="text-center text-muted text-sm py-4">
              No non-obvious anomalies detected. Pipeline looks healthy.
            </div>
          ) : (
            data.anomalies.map((a, i) => {
              const style = SEVERITY_STYLES[a.severity];
              return (
                <div
                  key={i}
                  className={`bg-background border rounded-lg p-4 ${style.border}`}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`text-xs font-bold px-1.5 py-0.5 rounded ${style.badge} shrink-0 mt-0.5`}
                    >
                      {style.icon}
                    </span>
                    <div className="min-w-0">
                      <div className="font-semibold text-sm mb-1">{a.title}</div>
                      <div className="text-xs text-muted leading-relaxed">{a.reason}</div>
                      {a.project && (
                        <a
                          href={a.project.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[0.65rem] text-blue-500 hover:underline mt-2 inline-block"
                        >
                          View in HubSpot →
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
