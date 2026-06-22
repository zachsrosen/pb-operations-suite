import type { ProgressionLink } from "@/lib/flow-map/types";

type FlowInput = {
  name: string;
  isEnabled: boolean;
  sets: { property: string; value: string }[];
  reads: { property: string; value: string }[];
};

type PropLabels = { options: Record<string, Record<string, string>> };

// Strip a trailing " (#N)" clone suffix from a flow name.
const CLONE_RE = /\s*\(#\d+\)\s*$/;
function baseName(n: string): string {
  return n.replace(CLONE_RE, "").trim();
}

// status-ish properties only: enum/string props that drive flow (skip dates, ids, hs_ internals).
// Mirrors SKIP_PROP in data/hubspot-flows/build_progression.py.
function skipProp(p: string): boolean {
  return (
    [
      "hs_object_id",
      "hs_object_source",
      "hs_name",
      "hs_value",
      "hs_task_subject",
      "hs_task_status",
      "dealstage",
      "hs_pipeline_stage",
      "closedate",
    ].includes(p) ||
    p.endsWith("_date") ||
    p.endsWith("date") ||
    p.startsWith("hs_")
  );
}

export function buildProgression(flows: FlowInput[], propLabels: PropLabels): ProgressionLink[] {
  // (prop, rawValue) -> Set<flow base name>. The key uses a NUL delimiter so
  // values containing spaces (e.g. "Sent to Customer") don't collide or split wrong.
  const SEP = "\u0000";
  const setters = new Map<string, Set<string>>();
  const readers = new Map<string, Set<string>>();
  const parts = new Map<string, { prop: string; value: string }>();
  const key = (prop: string, value: string) => `${prop}${SEP}${value}`;

  function add(map: Map<string, Set<string>>, prop: string, value: string, flow: string) {
    if (skipProp(prop)) return;
    const k = key(prop, value);
    if (!parts.has(k)) parts.set(k, { prop, value });
    let s = map.get(k);
    if (!s) {
      s = new Set<string>();
      map.set(k, s);
    }
    s.add(flow);
  }

  for (const flow of flows) {
    if (!flow.isEnabled) continue;
    const nm = baseName(flow.name);
    for (const { property, value } of flow.sets || []) add(setters, property, String(value), nm);
    for (const { property, value } of flow.reads || []) add(readers, property, String(value), nm);
  }

  // A link exists for each (prop, rawValue) present in BOTH setters and readers.
  const links: ProgressionLink[] = [];
  for (const [k, setBy] of setters) {
    const firesFlows = readers.get(k);
    if (!firesFlows) continue;
    const { prop, value } = parts.get(k)!;
    links.push({
      property: prop,
      value,
      label: propLabels.options?.[prop]?.[value] ?? value,
      setBy: [...setBy].sort(),
      firesFlows: [...firesFlows].sort(),
    });
  }

  return links;
}
