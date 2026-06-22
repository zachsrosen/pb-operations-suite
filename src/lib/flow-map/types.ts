export type Condition = { property: string; label: string; operator: string; values: string[]; plain: string; technical: string };
export type ActionStep = { kind: string; plain: string; technical: string };

export type FlowEntry = {
  id: string;
  name: string;
  isEnabled: boolean;
  objectTypeId: string;
  enrollmentType: "LIST_BASED" | "EVENT_BASED" | "MANUAL" | "DATASET";
  stageIds: string[];
  trigger: string;            // PLAIN (default)
  triggerTechnical: string;
  actions: string[];          // PLAIN steps in execution order, incl. conditionals
  actionsTechnical: string[];
  sets: { property: string; label: string; value: string }[];
  reads: { property: string; label: string; value: string }[]; // non-stage status values
  cloneCount: number;
  revisionId: string;
  hubspotUrl: string;
};

export type Stage = { id: string; label: string; order: number };
export type Pipeline = { id: string; label: string; objectTypeId: string; stages: Stage[] };
export type ProgressionLink = { property: string; label: string; value: string; setBy: string[]; firesFlows: string[] };

export type FlowMapSnapshot = {
  generatedAt: string;
  portalId: string;
  pipelines: Pipeline[];
  stageLookup: Record<string, { pipelineId: string; pipelineLabel: string; stageLabel: string; order: number }>;
  flows: Record<string, FlowEntry>;
  links: ProgressionLink[];
};
