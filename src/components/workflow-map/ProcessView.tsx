"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { FlowMapSnapshot } from "@/lib/flow-map/types";
import {
  PROCESS_STAGES,
  CROSS_LINKS,
  STAGE_KEY_TO_STAGE_ID,
  type ProcessStage,
  type ProcessStep,
} from "./process-spec";

/**
 * Process view — the legible, new-hire-friendly walkthrough of the whole
 * Project pipeline, rendered as a top-to-bottom stack of VERTICAL SWIMLANES.
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
 *  - Design's two lanes INTERTWINE: cross-lane arrows (drawn as an SVG overlay)
 *    show the DA leaving after initial review and the final review resuming
 *    once the customer approves.
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
        Read it top to bottom: each stage flows left to right, and stages with
        two parallel tracks (Design &amp; Engineering, Permitting &amp;
        Interconnection) show both lanes side by side.
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
  // The Design stage is the only one with intertwining cross-links.
  const intertwined = !stage.parallel && multiTrack && CROSS_LINKS.length > 0;

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

      {!multiTrack ? (
        <StepRow steps={stage.tracks[0].steps} />
      ) : intertwined ? (
        <IntertwinedTracks stage={stage} />
      ) : (
        <ParallelTracks stage={stage} />
      )}
    </section>
  );
}

/** A horizontal row of step pills joined by → arrows. */
function StepRow({ steps }: { steps: ProcessStep[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-2">
      {steps.map((step, i) => (
        <div key={step.id} className="flex items-center gap-1">
          {i > 0 && (
            <span aria-hidden className="px-0.5 text-muted/50">
              →
            </span>
          )}
          <StepPill step={step} />
        </div>
      ))}
    </div>
  );
}

/** A single clean step pill. */
function StepPill({
  step,
  innerRef,
}: {
  step: ProcessStep;
  innerRef?: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div
      ref={innerRef}
      data-step-id={step.id}
      className="rounded-full border border-t-border bg-surface-2 px-3 py-1.5 text-xs text-foreground"
    >
      {step.label}
    </div>
  );
}

/** Left-hand track label for a labeled lane. */
function TrackLabel({ name }: { name: string }) {
  return (
    <div className="w-28 shrink-0 pr-2 pt-1.5 text-xs font-medium text-muted">
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
 * The Design stage. The "Design" lane sits on top; the "Design Approval" lane
 * sits below, positioned so its two steps fall under the gap between "Initial
 * review complete" and "Final design review". Two cross-lane arrows are drawn
 * as an SVG overlay:
 *   d-initrev → da-sent   (down into the DA lane: "send DA")
 *   da-approved → d-finalrev  (back up: "approved")
 *
 * Arrows are measured from the rendered DOM after layout, so they stay correct
 * across theme/zoom/wrap. If measurement isn't ready yet (first paint) the
 * overlay simply renders nothing — the lanes remain fully legible on their own.
 */
function IntertwinedTracks({ stage }: { stage: ProcessStage }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stepEls = useRef<Map<string, HTMLDivElement>>(new Map());
  const [paths, setPaths] = useState<CrossLinkPath[]>([]);

  const setStepEl = (id: string) => (el: HTMLDivElement | null) => {
    if (el) stepEls.current.set(id, el);
    else stepEls.current.delete(id);
  };

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function measure() {
      const c = containerRef.current;
      if (!c) return;
      const cb = c.getBoundingClientRect();
      const next: CrossLinkPath[] = [];
      for (const link of CROSS_LINKS) {
        const fromEl = stepEls.current.get(link.from);
        const toEl = stepEls.current.get(link.to);
        if (!fromEl || !toEl) continue;
        const fb = fromEl.getBoundingClientRect();
        const tb = toEl.getBoundingClientRect();
        // Connect the vertical centers, on the side facing the other lane.
        const fromBelow = fb.top < tb.top; // from-step is in the upper lane
        const x1 = fb.left + fb.width / 2 - cb.left;
        const y1 = (fromBelow ? fb.bottom : fb.top) - cb.top;
        const x2 = tb.left + tb.width / 2 - cb.left;
        const y2 = (fromBelow ? tb.top : tb.bottom) - cb.top;
        next.push({ key: `${link.from}-${link.to}`, x1, y1, x2, y2, label: link.label });
      }
      setPaths(next);
    }

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const designLane = stage.tracks.find((t) => t.name === "Design");
  const daLane = stage.tracks.find((t) => t.name === "Design Approval");

  return (
    <div ref={containerRef} className="relative">
      {/* SVG overlay for the two cross-lane arrows. */}
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
        aria-hidden
      >
        <defs>
          <marker
            id="process-arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" className="fill-cyan-400/70" />
          </marker>
        </defs>
        {paths.map((p) => {
          const midY = (p.y1 + p.y2) / 2;
          const d = `M ${p.x1} ${p.y1} C ${p.x1} ${midY}, ${p.x2} ${midY}, ${p.x2} ${p.y2}`;
          return (
            <g key={p.key}>
              <path
                d={d}
                fill="none"
                className="stroke-cyan-400/60"
                strokeWidth={1.5}
                markerEnd="url(#process-arrow)"
              />
              {p.label && (
                <text
                  x={(p.x1 + p.x2) / 2}
                  y={midY - 3}
                  textAnchor="middle"
                  className="fill-muted text-[10px]"
                >
                  {p.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div className="space-y-6">
        {/* Design lane (top). */}
        {designLane && (
          <div className="flex items-start">
            <TrackLabel name={designLane.name!} />
            <div className="min-w-0 flex-1">
              <StepRow2 steps={designLane.steps} setStepEl={setStepEl} />
            </div>
          </div>
        )}

        {/* Design Approval lane (below), indented so its steps sit roughly
            under the Initial-review → Final-review gap. */}
        {daLane && (
          <div className="flex items-start">
            <TrackLabel name={daLane.name!} />
            {/* Indent ~ width of the first three Design steps so the DA lane
                falls under the intertwine point. */}
            <div className="hidden shrink-0 sm:block sm:w-[18rem]" aria-hidden />
            <div className="min-w-0 flex-1">
              <StepRow2 steps={daLane.steps} setStepEl={setStepEl} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** StepRow variant that registers each pill element for arrow measurement. */
function StepRow2({
  steps,
  setStepEl,
}: {
  steps: ProcessStep[];
  setStepEl: (id: string) => (el: HTMLDivElement | null) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-2">
      {steps.map((step, i) => (
        <div key={step.id} className="flex items-center gap-1">
          {i > 0 && (
            <span aria-hidden className="px-0.5 text-muted/50">
              →
            </span>
          )}
          <StepPill step={step} innerRef={setStepEl(step.id)} />
        </div>
      ))}
    </div>
  );
}

type CrossLinkPath = {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label?: string;
};
