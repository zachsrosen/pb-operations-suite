"use client";

import { useState } from "react";
import type { FlowMapSnapshot } from "@/lib/flow-map/types";
import { deriveProcess, type ProcessStage } from "./process-derive";

/**
 * Process view — the legible, new-hire-friendly walkthrough of the whole
 * Project pipeline.
 *
 * Where the Flowchart and List views expose HubSpot WORKFLOW NAMES (a
 * mechanic's view), this view abstracts them away and shows the BUSINESS
 * PROCESS: the ordered sequence of real milestones (status changes) the work
 * moves through, stage by stage, from the won sale to project complete.
 *
 * Read it top-to-bottom and you "get" the pipeline. Each stage shows its
 * headline milestones by default and expands to the full milestone sequence
 * (with the task each step kicks off) plus a count of the workflows that
 * automate it.
 */
export default function ProcessView({
  snapshot,
}: {
  snapshot: FlowMapSnapshot;
}) {
  const stages = deriveProcess(snapshot);

  if (stages.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-t-border bg-surface p-6 text-sm text-muted shadow-card">
        No Project pipeline found in this snapshot.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <p className="mb-6 text-sm leading-relaxed text-muted">
        How a sold project moves through the pipeline, milestone by milestone.
        Each stage shows its main steps; expand a stage to see every status the
        work passes through and the tasks it kicks off.
      </p>

      <ol className="space-y-4">
        {/* Intro node — the journey starts when the sale is won. */}
        <li>
          <div className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
            <span className="text-base" aria-hidden>
              🏁
            </span>
            <div>
              <div className="text-sm font-semibold text-foreground">
                Sale won
              </div>
              <div className="text-xs text-muted">
                A deal closes and becomes a project — the pipeline begins.
              </div>
            </div>
          </div>
        </li>

        {stages.map((stage, i) => (
          <li key={stage.stageId}>
            <Connector />
            <StageBlock stage={stage} index={i + 1} />
          </li>
        ))}

        {/* End node. */}
        <li>
          <Connector />
          <div className="flex items-center gap-3 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3">
            <span className="text-base" aria-hidden>
              ✅
            </span>
            <div className="text-sm font-semibold text-foreground">
              Project complete
            </div>
          </div>
        </li>
      </ol>
    </div>
  );
}

/** Vertical "→ triggers" connector between blocks. */
function Connector() {
  return (
    <div className="flex items-center gap-2 pl-5 py-1 text-xs text-muted">
      <span aria-hidden className="leading-none">
        ↓
      </span>
      <span>triggers</span>
    </div>
  );
}

function StageBlock({
  stage,
  index,
}: {
  stage: ProcessStage;
  index: number;
}) {
  const [open, setOpen] = useState(false);
  const milestones = stage.milestones;

  // Collapsed headline: first + last milestone (or just the one if there's a
  // single step), so a closed stage still conveys where it starts and ends.
  const headline =
    milestones.length <= 1
      ? milestones.map((m) => m.label)
      : [milestones[0].label, milestones[milestones.length - 1].label];

  const expandable = milestones.length > 1 || milestones.some((m) => m.detail);

  return (
    <div className="rounded-xl border border-t-border bg-surface shadow-card">
      <button
        type="button"
        onClick={() => expandable && setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex w-full items-start gap-3 px-4 py-3 text-left ${
          expandable ? "cursor-pointer hover:bg-surface-2/50" : "cursor-default"
        } rounded-xl transition-colors`}
      >
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cyan-500/20 text-xs font-semibold text-cyan-400 tabular-nums">
          {index}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">
              {stage.stageLabel}
            </span>
          </div>

          {!open && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
              {headline.map((label, i) => (
                <span key={`${label}-${i}`} className="flex items-center gap-1.5">
                  {i > 0 && (
                    <span aria-hidden className="text-muted/50">
                      →
                    </span>
                  )}
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-foreground/80">
                    {label}
                  </span>
                </span>
              ))}
              {milestones.length > 2 && (
                <span className="text-muted/70">
                  ({milestones.length} steps)
                </span>
              )}
            </div>
          )}
        </div>

        {expandable && (
          <span
            aria-hidden
            className={`mt-1 shrink-0 text-muted transition-transform ${
              open ? "rotate-90" : ""
            }`}
          >
            ›
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-t-border px-4 pb-4 pt-3">
          <ol className="space-y-2.5">
            {milestones.map((m, i) => (
              <li key={`${m.label}-${i}`} className="flex gap-3">
                <div className="flex flex-col items-center pt-0.5">
                  <span className="h-2 w-2 rounded-full bg-cyan-400" />
                  {i < milestones.length - 1 && (
                    <span className="mt-1 w-px flex-1 bg-t-border" />
                  )}
                </div>
                <div className="min-w-0 flex-1 pb-1">
                  <div className="text-sm text-foreground">{m.label}</div>
                  {m.detail && (
                    <div className="mt-0.5 text-xs text-muted">{m.detail}</div>
                  )}
                </div>
              </li>
            ))}
          </ol>

          {stage.workflowCount > 0 && (
            <div className="mt-3 text-xs text-muted/70">
              {stage.workflowCount}{" "}
              {stage.workflowCount === 1 ? "workflow automates" : "workflows automate"}{" "}
              this stage
            </div>
          )}
        </div>
      )}
    </div>
  );
}
