// Curated stage → SOP-section map for the Project pipeline (Workflow Map spec §8).
// Ported from the SEC2STAGE table in data/hubspot-flows/build_worklist.py, but split into
// per-stage / revision / cross-cutting buckets to reflect how the SOP is actually authored.

// stageId -> SOP section ids whose tables document that stage's automation.
export const STAGE_TO_SOP: Record<string, string[]> = {
  "20461936": ["wf-survey"],
  "20461937": ["wf-design", "wf-da"], // Design & Engineering: main design + DA process
  "20461938": ["wf-permit", "wf-ic"],
  "20440342": ["wf-con"],
  "22580872": ["wf-insp"],
  "20461940": ["wf-pto"],
};

// Revision sections are design-owned but cross-stage (entered from many stages).
export const REVISION_SECTIONS = ["wf-rev-da", "wf-rev-permit", "wf-rev-ic", "wf-rev-ab"];

// Quality Flow is cross-cutting (90-day-stuck detection fires across stages).
export const CROSS_CUTTING_SECTIONS = ["wf-qr"];
