// Maps Project-pipeline stages to the workflow NAME prefixes and owning STATUS
// properties that scope a flow to that stage. Used by summarizeFlow to map flows
// to stages even when their enrollment uses a STATUS filter (e.g. "Design Status =
// Draft Complete") with `dealstage IS_NONE_OF [closed]` rather than a positive
// `dealstage IS_ANY_OF` inclusion. Without this, status-scoped flows never map to
// a stage and vanish from the per-stage view.
//
// Keyed by stageId (Project pipeline). namePatterns match against the flow's name;
// statusProps are the internal property names the flow reads/writes to own a stage.
export const STAGE_SIGNALS: Record<string, { namePatterns: RegExp[]; statusProps: string[] }> = {
  "20461936": { namePatterns: [/site survey flow/i], statusProps: ["site_survey_status"] },                                  // Site Survey
  "20461937": { namePatterns: [/design flow/i, /\bda flow\b/i], statusProps: ["design_status", "layout_status"] },           // Design & Engineering
  "20461938": { namePatterns: [/permit(ting)? flow/i, /interconnection flow/i, /utility flow/i], statusProps: ["permitting_status", "interconnection_status"] }, // Permitting & Interconnection
  "20440342": { namePatterns: [/construction flow/i], statusProps: ["install_status"] },                                     // Construction
  "22580872": { namePatterns: [/inspection flow/i], statusProps: ["final_inspection_status"] },                              // Inspection
  "20461940": { namePatterns: [/pto flow/i], statusProps: ["pto_status"] },                                                  // Permission To Operate
};
