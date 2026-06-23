"use client";

import type { FlowMapSnapshot } from "@/lib/flow-map/types";
import {
  PROCESS_STAGES,
  STAGE_KEY_TO_STAGE_ID,
  type ProcessStage,
  type ProcessStep,
} from "./process-spec";

/**
 * Process view — the legible, new-hire-friendly walkthrough of the whole
 * Project pipeline, rendered as a top-to-bottom stack of stages.
 *
 * The shape (stages, tracks, steps) comes entirely from the curated
 * `process-spec` — this is the confirmed business process, NOT auto-derived
 * from workflow data. Where the Flowchart and List views expose HubSpot
 * WORKFLOW NAMES (a mechanic's view), this view shows only the ordered
 * milestones a real project passes through.
 *
 * Layout:
 *  - Each stage is a section; a centered ↓ connector joins one stage to the next.
 *  - Single-track stages render their steps as a row of pills joined by →.
 *  - Multi-track stages render each track as a labeled horizontal lane.
 *  - The Design stage is special: two tracks START IN PARALLEL, then meet at an
 *    AND-gate ("initial review complete AND DA approved"); a single mainline
 *    flows out of the gate (DA Approved → Final design review), forks on
 *    "engineering stamps needed?", and both paths re-converge at "Design
 *    complete". This richer shape is driven by the optional gate/mainline/branch
 *    fields on the stage and rendered by <RichStage>.
 *  - Permitting's two lanes run as independent PARALLEL rows (no cross-links).
 *
 * The optional snapshot only powers a muted "N workflows automate this" caption
 * under a stage header.
 */
export default function ProcessView({
  snapshot,
}: {
  snapshot: FlowMapSnapshot;
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <p className="mb-8 text-sm leading-relaxed text-muted">
        How a sold project moves through the pipeline, milestone by milestone.
        Read it top to bottom: each stage flows left to right. Design &amp;
        Engineering runs two tracks in parallel that meet at an approval gate;
        Permitting &amp; Interconnection runs two independent lanes side by side.
      </p>

      <ol className="space-y-2">
        {PROCESS_STAGES.map((stage, i) => (
          <li key={stage.key}>
            {i > 0 && <StageConnector />}
            <StageSection stage={stage} snapshot={snapshot} />
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Centered vertical ↓ connector between two stage sections. */
function StageConnector() {
  return (
    <div className="flex justify-center py-2" aria-hidden>
      <span className="text-lg leading-none text-cyan-400/60">↓</span>
    </div>
  );
}

function workflowCountForStage(
  stage: ProcessStage,
  snapshot: FlowMapSnapshot,
): number {
  const stageId = STAGE_KEY_TO_STAGE_ID[stage.key];
  if (!stageId) return 0;
  let count = 0;
  for (const flow of Object.values(snapshot.flows)) {
    if (flow.isEnabled && flow.stageIds.includes(stageId)) count += 1;
  }
  return count;
}

function StageSection({
  stage,
  snapshot,
}: {
  stage: ProcessStage;
  snapshot: FlowMapSnapshot;
}) {
  const count = workflowCountForStage(stage, snapshot);
  const multiTrack = stage.tracks.length > 1;
  // The Design stage carries the richer parallel → gate → branch structure.
  const rich = Boolean(stage.gate);

  return (
    <section className="rounded-xl border border-t-border bg-surface px-5 py-4 shadow-card">
      <header className="mb-3">
        <h3 className="text-sm font-semibold text-foreground">{stage.label}</h3>
        {count > 0 && (
          <p className="mt-0.5 text-xs text-muted/70">
            {count} {count === 1 ? "workflow automates" : "workflows automate"}{" "}
            this stage
          </p>
        )}
      </header>

      {rich ? (
        <RichStage stage={stage} />
      ) : !multiTrack ? (
        <StepRow steps={stage.tracks[0].steps} />
      ) : (
        <ParallelTracks stage={stage} />
      )}
    </section>
  );
}

/**
 * A horizontal flow of step pills joined by → arrows. Wraps cleanly: pills are
 * compact, each wrapped row is left-aligned, and arrows sit only between
 * adjacent pills (no leading "→" on a wrapped row).
 */
function StepRow({ steps }: { steps: ProcessStep[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5">
      {steps.map((step, i) => (
        <div key={step.id} className="flex items-center gap-1">
          {i > 0 && <StepArrow />}
          <StepPill step={step} />
        </div>
      ))}
    </div>
  );
}

/** The → joiner between two adjacent pills. */
function StepArrow() {
  return (
    <span aria-hidden className="shrink-0 px-0.5 text-[11px] text-muted/50">
      →
    </span>
  );
}

/** A single clean step pill. */
function StepPill({
  step,
  tone = "default",
}: {
  step: ProcessStep;
  tone?: "default" | "accent";
}) {
  const toneCls =
    tone === "accent"
      ? "border-cyan-400/40 bg-cyan-400/10 text-foreground"
      : "border-t-border bg-surface-2 text-foreground";
  return (
    <div
      data-step-id={step.id}
      className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] leading-tight ${toneCls}`}
    >
      {step.label}
    </div>
  );
}

/** Left-hand track label for a labeled lane. */
function TrackLabel({ name }: { name: string }) {
  return (
    <div className="w-24 shrink-0 pr-2 pt-1 text-xs font-medium text-muted">
      {name}
    </div>
  );
}

/**
 * Parallel multi-track stage (Permitting): two independent labeled lanes,
 * stacked, no cross-links. Both conceptually start at the stage entry and run
 * to the stage exit.
 */
function ParallelTracks({ stage }: { stage: ProcessStage }) {
  return (
    <div className="space-y-3">
      {stage.tracks.map((track, i) => (
        <div key={track.name ?? i} className="flex items-start">
          {track.name && <TrackLabel name={track.name} />}
          <div className="min-w-0 flex-1">
            <StepRow steps={track.steps} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The Design & Engineering stage, rendered top → bottom:
 *   1. entryNote — both tracks start together.
 *   2. Two parallel lanes (Design, DA) under a shared "both start here" marker.
 *   3. The AND-gate chip the two lanes converge into.
 *   4. The mainline row flowing out of the gate.
 *   5. The "engineering stamps?" fork — two labeled mini-rows that re-converge.
 *   6. The converge pill (Design complete) + exitNote.
 *
 * No SVG measurement is needed: the structure reads top-to-bottom with simple
 * arrows and accent chips marking the join and merge points.
 */
function RichStage({ stage }: { stage: ProcessStage }) {
  const { entryNote, gate, mainline, branch, exitNote } = stage;

  return (
    <div className="space-y-4">
      {entryNote && (
        <p className="text-xs leading-relaxed text-muted/80">{entryNote}</p>
      )}

      {/* Two parallel lanes, sharing a left rail that marks "both start here". */}
      <div className="flex">
        <div
          className="mr-3 w-px shrink-0 self-stretch bg-cyan-400/30"
          aria-hidden
        />
        <div className="min-w-0 flex-1 space-y-3">
          {stage.tracks.map((track, i) => (
            <div key={track.name ?? i} className="flex items-start">
              {track.name && <TrackLabel name={track.name} />}
              <div className="min-w-0 flex-1">
                <StepRow steps={track.steps} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* AND-gate: both lanes must complete before the mainline proceeds. */}
      {gate && (
        <div className="flex flex-col items-center gap-1">
          <DownArrow />
          <div className="inline-flex items-center gap-2 rounded-lg border border-cyan-400/40 bg-cyan-400/10 px-3 py-1.5 text-[11px] font-medium text-foreground">
            <span className="text-cyan-400">✓</span>
            <span>{gate.label}</span>
          </div>
        </div>
      )}

      {/* Mainline: a single centered flow out of the gate. */}
      {mainline && mainline.length > 0 && (
        <div className="flex flex-col items-center gap-1">
          <DownArrow />
          <StepRowCentered steps={mainline} />
        </div>
      )}

      {/* Branch: the engineering-stamps fork; both paths re-converge. */}
      {branch && (
        <div className="flex flex-col items-center gap-2">
          <DownArrow />
          <div className="text-[11px] font-medium text-muted">
            {branch.prompt}
          </div>
          <div className="flex w-full flex-wrap items-start justify-center gap-x-6 gap-y-3">
            {branch.paths.map((path) => (
              <div
                key={path.label}
                className="flex flex-col items-center gap-1.5"
              >
                <div className="text-[10px] uppercase tracking-wide text-muted/70">
                  {path.label}
                </div>
                {path.steps.length > 0 ? (
                  <StepRow steps={path.steps} />
                ) : (
                  <div className="text-[11px] italic text-muted/60">
                    (pass through)
                  </div>
                )}
              </div>
            ))}
          </div>
          <DownArrow />
          <StepPill step={branch.converge} tone="accent" />
        </div>
      )}

      {exitNote && (
        <p className="text-center text-xs text-muted/80">{exitNote}</p>
      )}
    </div>
  );
}

/** Centered step row (for the mainline out of the gate). */
function StepRowCentered({ steps }: { steps: ProcessStep[] }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-1 gap-y-1.5">
      {steps.map((step, i) => (
        <div key={step.id} className="flex items-center gap-1">
          {i > 0 && <StepArrow />}
          <StepPill step={step} />
        </div>
      ))}
    </div>
  );
}

/** A small centered ↓ used inside the rich Design stage. */
function DownArrow() {
  return (
    <span aria-hidden className="text-sm leading-none text-cyan-400/50">
      ↓
    </span>
  );
}
