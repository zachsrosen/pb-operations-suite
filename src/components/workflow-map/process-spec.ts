/**
 * Curated happy-path process spec for the Project pipeline.
 *
 * This is the SOURCE OF TRUTH for the Process view — a hand-confirmed, ordered
 * walkthrough of how a sold project moves from won deal to project complete. It
 * is deliberately NOT auto-derived from the workflow snapshot: the prior
 * auto-derivation produced a jumbled, hard-to-read milestone list. A new hire
 * should be able to read these stages top-to-bottom and "get" the pipeline.
 *
 * Workflow names never appear here — this is the BUSINESS process, not the
 * automation plumbing. (The snapshot is used only for an optional "N workflows
 * automate this" count per stage in ProcessView.)
 */

export type ProcessStep = { id: string; label: string };

/** A horizontal lane of steps. `name` omitted = the stage is single-track. */
export type ProcessTrack = { name?: string; steps: ProcessStep[] };

export type ProcessStage = {
  key: string;
  label: string;
  tracks: ProcessTrack[];
  /** True when the multiple tracks run independently in parallel (no cross-links). */
  parallel?: boolean;
};

/** A connector arrow between two steps (step id → step id), drawn as an overlay. */
export type CrossLink = { from: string; to: string; label?: string };

export const PROCESS_STAGES: ProcessStage[] = [
  {
    key: "sale",
    label: "Sale",
    tracks: [{ steps: [{ id: "sale-won", label: "Deal signed & won" }] }],
  },
  {
    key: "survey",
    label: "Site Survey",
    tracks: [
      {
        steps: [
          { id: "survey-ready", label: "Ready to schedule" },
          { id: "survey-sched", label: "Survey scheduled" },
          { id: "survey-done", label: "Survey completed" },
        ],
      },
    ],
  },
  {
    key: "design",
    label: "Design & Engineering",
    tracks: [
      {
        name: "Design",
        steps: [
          { id: "d-ready", label: "Ready for design" },
          { id: "d-inprog", label: "Design in progress" },
          { id: "d-uploaded", label: "Design uploaded for review" },
          { id: "d-initrev", label: "Initial review complete" },
          { id: "d-finalrev", label: "Final design review" },
          { id: "d-stamped", label: "Plans stamped" },
          { id: "d-complete", label: "Design complete" },
        ],
      },
      {
        name: "Design Approval",
        steps: [
          { id: "da-sent", label: "DA sent to customer" },
          { id: "da-approved", label: "Customer approves DA" },
        ],
      },
    ],
  },
  {
    key: "permitting",
    label: "Permitting & Interconnection",
    parallel: true,
    tracks: [
      {
        name: "Permit (AHJ)",
        steps: [
          { id: "p-ready", label: "Ready for permitting" },
          { id: "p-submitted", label: "Permit submitted to AHJ" },
          { id: "p-issued", label: "Permit issued" },
        ],
      },
      {
        name: "Interconnection (Utility)",
        steps: [
          { id: "ic-submitted", label: "Utility application submitted" },
          { id: "ic-approved", label: "Utility approved" },
        ],
      },
    ],
  },
  {
    key: "rtb",
    label: "Ready to Build",
    tracks: [{ steps: [{ id: "rtb", label: "Cleared for construction" }] }],
  },
  {
    key: "construction",
    label: "Construction",
    tracks: [
      {
        steps: [
          { id: "c-sched", label: "Install scheduled" },
          { id: "c-done", label: "Install completed" },
        ],
      },
    ],
  },
  {
    key: "inspection",
    label: "Inspection",
    tracks: [
      {
        steps: [
          { id: "i-ready", label: "Ready for inspection" },
          { id: "i-sched", label: "Inspection scheduled" },
          { id: "i-passed", label: "Inspection passed" },
        ],
      },
    ],
  },
  {
    key: "pto",
    label: "Permission to Operate",
    tracks: [
      {
        steps: [
          { id: "pto-sub", label: "PTO submitted" },
          { id: "pto-granted", label: "PTO granted" },
        ],
      },
    ],
  },
  {
    key: "closeout",
    label: "Close Out",
    tracks: [
      {
        steps: [
          { id: "co-closed", label: "Closed out" },
          { id: "co-complete", label: "Project complete" },
        ],
      },
    ],
  },
];

/**
 * Design's two tracks INTERTWINE: after the initial design review the DA goes
 * out to the customer; once the customer approves, the final design review
 * proceeds. These two arrows are drawn as cross-lane connectors in the Design
 * stage.
 */
export const CROSS_LINKS: CrossLink[] = [
  { from: "d-initrev", to: "da-sent", label: "send DA" },
  { from: "da-approved", to: "d-finalrev", label: "approved" },
];

/**
 * Maps a process-stage `key` to the Project-pipeline stageId it corresponds to,
 * used only for the optional "N workflows automate this" count in ProcessView.
 * Keys without a confident stageId mapping are omitted (the count is skipped).
 */
export const STAGE_KEY_TO_STAGE_ID: Record<string, string> = {
  survey: "20461936",
  design: "20461937",
  permitting: "20461938",
  construction: "20440342",
  inspection: "22580872",
  pto: "20461940",
};

/** Flatten every step across all stages/tracks — handy for tests + lookups. */
export function allStepIds(): Set<string> {
  const ids = new Set<string>();
  for (const stage of PROCESS_STAGES) {
    for (const track of stage.tracks) {
      for (const step of track.steps) ids.add(step.id);
    }
  }
  return ids;
}
