/**
 * Derive a plain-English, new-hire-friendly process model for the Project
 * pipeline from a rendered FlowMapSnapshot.
 *
 * The Flowchart and List views show HubSpot WORKFLOW NAMES — a mechanic's view.
 * The Process view abstracts those away and shows the BUSINESS PROCESS: the
 * ordered sequence of real milestones (status changes) the work moves through,
 * stage by stage, end to end. A new hire reads it top-to-bottom and "gets" the
 * whole picture.
 *
 * Everything here is PURE so the ordering/parsing helpers can be unit-tested in
 * isolation (the full deriveProcess needs a real snapshot, which is hard to
 * fixture offline — the small helpers carry the logic).
 */

import type { FlowEntry, FlowMapSnapshot } from "@/lib/flow-map/types";
import { STAGE_SIGNALS } from "@/lib/flow-map/stage-signals";
import { flowFamily } from "./flowchart-layout";
import { cloneBaseName } from "./flow-map-utils";

/** The Project pipeline id — the spine of the whole installation process. */
export const PROJECT_PIPELINE_ID = "6900017";

/**
 * Project-pipeline stages that are NOT a forward step in the happy path:
 * holding pens, rejections, and blocks. Excluded from the process walkthrough
 * so a new hire sees only the road forward, not the detours.
 */
const TERMINAL_STAGE_IDS = new Set<string>([
  "20440344", // On-Hold
  "20461935", // Project Rejected - Needs Review
  "71052436", // RTB - Blocked
  "68229433", // Cancelled
]);

/**
 * The PRIMARY workflow families that carry a stage's happy-path spine, keyed by
 * stageId (Project pipeline). Restricting to these families is what keeps the
 * milestone list legible: a stage maps dozens of flows (transitions, bots,
 * D&R/service variants, date-stamps, sub-tracks), but only the named families
 * walk the main road. A stage not listed here accepts any happy-path family.
 *
 * Mirrors the flowFamily() classifier in flowchart-layout.ts.
 */
const STAGE_PRIMARY_FAMILIES: Record<string, string[]> = {
  "20461936": ["Site Survey Flow"], // Site Survey
  "20461937": ["Design Flow", "DA Flow"], // Design & Engineering
  "20461938": ["Permit Flow", "Interconnection Flow", "Utility Flow"], // Permitting & Interconnection
  "20440342": ["Construction Flow"], // Construction
  "22580872": ["Inspection Flow"], // Inspection
  "20461940": ["PTO Flow"], // Permission To Operate
};

export type Milestone = {
  /** Plain-English status the work moves into (the enum value, e.g. "DA Approved"). */
  label: string;
  /** Optional expand detail — the main task this step kicks off, if any. */
  detail?: string;
};

export type ProcessStage = {
  stageId: string;
  stageLabel: string;
  milestones: Milestone[];
  /** How many ON, mapped workflows automate this stage (for the expand caption). */
  workflowCount: number;
};

/**
 * Parse a leading numbered prefix like "01", "12a", "3b", "09b" from a flow
 * name into a sortable [num, suffix] tuple. Returns null when the name has no
 * numbered prefix — such flows are NOT part of the ordered happy-path spine.
 *
 * "04. Design Flow - DA Approved" → [4, ""]
 * "09b. Design Flow - Xcel Uploaded" → [9, "b"]
 * "Site Survey Flow - Complete" → null
 */
export function parseNumberPrefix(name: string): [number, string] | null {
  const m = /^\s*(\d{1,2})([a-z]?)\b/i.exec(name || "");
  if (!m) return null;
  return [parseInt(m[1], 10), (m[2] || "").toLowerCase()];
}

/**
 * Is this flow a happy-path forward step (vs a revision / rejection branch)?
 * Revisions and rejections are detours we deliberately hide in the Process view.
 */
export function isHappyPathFlow(name: string): boolean {
  if (flowFamily(name) === "Revisions") return false;
  if (/rejected|revision/i.test(name || "")) return false;
  return true;
}

/**
 * Collapse consecutive identical milestone labels. A stage often has several
 * flows that all land on the same status (e.g. two "08. … - Design Complete"
 * clones); we want one milestone, not a stutter.
 */
export function dedupeConsecutive(labels: string[]): string[] {
  const out: string[] = [];
  for (const l of labels) {
    if (out.length === 0 || out[out.length - 1] !== l) out.push(l);
  }
  return out;
}

/**
 * The status-value label a flow contributes as a milestone, if any.
 *
 * A flow earns a milestone when it SETS one of the stage's owning status
 * properties (from STAGE_SIGNALS.statusProps) to a static value. The milestone
 * text is that value — the plain enum key, which reads as a human status
 * ("Ready for Design", "DA Approved", "Design Complete"). Returns null when the
 * flow sets none of the owning statuses.
 */
export function milestoneLabelForFlow(
  flow: FlowEntry,
  statusProps: string[],
): string | null {
  const owned = new Set(statusProps);
  for (const s of flow.sets) {
    if (owned.has(s.property) && s.value.trim()) return s.value.trim();
  }
  return null;
}

/**
 * Build the ordered happy-path milestone list for one stage.
 *
 * Selection rule for a flow to contribute:
 *  - ON (isEnabled)
 *  - mapped to this stage (stageIds includes it)
 *  - has a numbered prefix (part of the authored ordered spine)
 *  - is happy-path (not a revision/rejection branch)
 *  - SETS one of the stage's owning status props
 *
 * Flows are ordered by their parsed number+suffix; each contributes its status
 * value as a milestone, with the main task it creates as the expand detail.
 * Consecutive duplicate labels collapse.
 */
export function deriveStageMilestones(
  snapshot: FlowMapSnapshot,
  stageId: string,
): { milestones: Milestone[]; workflowCount: number } {
  const signal = STAGE_SIGNALS[stageId];
  const statusProps = signal?.statusProps ?? [];
  const primaryFamilies = STAGE_PRIMARY_FAMILIES[stageId];

  const candidates: {
    num: number;
    familyRank: number;
    label: string;
    detail?: string;
  }[] = [];
  let workflowCount = 0;

  for (const flow of Object.values(snapshot.flows)) {
    if (!flow.isEnabled) continue;
    if (!flow.stageIds.includes(stageId)) continue;
    if (!isHappyPathFlow(flow.name)) continue;

    const base = cloneBaseName(flow.name);
    const family = flowFamily(base);

    // Restrict to the stage's primary families — the flows that walk the main
    // road. Without this, transitions, bots, date-stamps and D&R/service
    // variants flood the milestone list. Stages with no declared families
    // accept any happy-path family.
    if (primaryFamilies && !primaryFamilies.includes(family)) {
      continue;
    }

    // Count any ON, mapped, primary-family, happy-path flow as automating the
    // stage (before the narrower milestone filters below).
    workflowCount += 1;

    const prefix = parseNumberPrefix(base);
    if (!prefix) continue;

    // Skip alpha-suffixed sub-tracks (e.g. "08a", "09b") — these are parallel
    // side paths (New Construction, Xcel) layered onto a base step, not the
    // main spine. The unsuffixed numbered flows carry the happy path.
    if (prefix[1]) continue;

    const label = milestoneLabelForFlow(flow, statusProps);
    if (!label) continue;

    const detail = flow.createsTasks[0]
      ? `creates task: ${flow.createsTasks[0]}`
      : undefined;

    // Tiebreak within a shared number by the stage's family order (e.g. Design
    // Flow before DA Flow) so ordering is deterministic, not map-insertion order.
    const familyRank = primaryFamilies
      ? primaryFamilies.indexOf(family)
      : 0;

    candidates.push({ num: prefix[0], familyRank, label, detail });
  }

  candidates.sort((a, b) =>
    a.num !== b.num ? a.num - b.num : a.familyRank - b.familyRank,
  );

  // Dedupe consecutive identical labels, keeping the first occurrence's detail.
  const milestones: Milestone[] = [];
  for (const c of candidates) {
    const prev = milestones[milestones.length - 1];
    if (prev && prev.label === c.label) continue;
    milestones.push({ label: c.label, detail: c.detail });
  }

  return { milestones, workflowCount };
}

/**
 * Turn the snapshot into an ordered, plain-English process model for the
 * Project pipeline: the forward stages in pipeline order, each with its
 * happy-path milestone sequence.
 *
 * Stages that yield no derived milestones fall back to a single milestone equal
 * to the stage label, so the journey never has a gap.
 */
export function deriveProcess(snapshot: FlowMapSnapshot): ProcessStage[] {
  const pipeline = snapshot.pipelines.find((p) => p.id === PROJECT_PIPELINE_ID);
  if (!pipeline) return [];

  const stages = [...pipeline.stages]
    .filter((s) => !TERMINAL_STAGE_IDS.has(s.id))
    .sort((a, b) => a.order - b.order);

  return stages.map((stage) => {
    const { milestones, workflowCount } = deriveStageMilestones(
      snapshot,
      stage.id,
    );
    return {
      stageId: stage.id,
      stageLabel: stage.label,
      milestones:
        milestones.length > 0 ? milestones : [{ label: stage.label }],
      workflowCount,
    };
  });
}
