/* eslint-disable @typescript-eslint/no-explicit-any -- consumes loosely-typed HubSpot Automation v4 JSON; behavior is guarded by the 855-fixture test suite */
// Ported faithfully from data/hubspot-flows/build_sop_tables.py (the verified oracle).
// Produces the parse-able fields of a FlowEntry from one HubSpot Automation v4 flow detail.
// Plain output uses HubSpot property labels + enum option labels + stage labels and truncates
// for readability; technical output uses raw internal names / operators / values, untruncated.

type Op = { operator?: string; values?: any[]; value?: any; propertyParser?: string;
  timePoint?: any; lowerBoundTimePoint?: any; upperBoundTimePoint?: any; [k: string]: any };
type PropLabels = { labels: Record<string, string>; options: Record<string, Record<string, string>> };
type StageLookup = Record<string, [string, string, string, number]>;

const ACRO: Record<string, string> = {
  da: "DA", pto: "PTO", ahj: "AHJ", sms: "SMS", sla: "SLA", pe: "PE", rrf: "RRF", sld: "SLD",
  os: "OS", pv: "PV", ev: "EV", ic: "IC", rtb: "RTB", qc: "QC", bom: "BOM", so: "SO", sce: "SCE", id: "ID",
};
const cap = (w: string) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w);
function humanize(p: any): string {
  return String(p).replace(/_/g, " ").split(" ")
    .map((w) => ACRO[w.toLowerCase()] ?? cap(w)).join(" ");
}

const STAGE_PROPS = new Set(["dealstage", "hs_pipeline_stage", "hs_value"]);
const INCLUDE_OPS = new Set(["IS_ANY_OF", "IS_EQUAL_TO", "HAS_EVER_BEEN_ANY_OF", "HAS_EVER_BEEN_EQUAL_TO"]);

const NUM_SYM: Record<string, string> = {
  IS_GREATER_THAN: ">", IS_LESS_THAN: "<",
  IS_GREATER_THAN_OR_EQUAL_TO: "≥", IS_LESS_THAN_OR_EQUAL_TO: "≤",
};
export const KNOWN_OPERATORS: ReadonlySet<string> = new Set([
  "IS_ANY_OF", "IS_EQUAL_TO", "IS_EXACTLY", "HAS_EVER_BEEN_ANY_OF", "HAS_EVER_BEEN_EQUAL_TO",
  "IS_NONE_OF", "IS_NOT_EQUAL_TO", "HAS_NEVER_BEEN_ANY_OF", "IS_KNOWN", "IS_UNKNOWN",
  "CONTAINS", "CONTAINS_EXACTLY", "DOES_NOT_CONTAIN", "IS_BEFORE", "IS_AFTER", "IS_BETWEEN", "IS_NOT_BETWEEN",
  ...Object.keys(NUM_SYM),
]);
// Module-level coverage gate: fmt_filter records any operator not in KNOWN_OPERATORS here.
export const unhandledOperators = new Set<string>();

function collectFilters(node: any, out: [string, Op][]): void {
  if (Array.isArray(node)) {
    for (const v of node) collectFilters(v, out);
  } else if (node && typeof node === "object") {
    if (node.property && node.operation) out.push([node.property, node.operation]);
    for (const v of Object.values(node)) collectFilters(v, out);
  }
}

function makeCtx(propLabels: PropLabels, stageLookup: StageLookup) {
  const LB = propLabels.labels || {};
  const OPTS = propLabels.options || {};
  const plabel = (p: string) => LB[p] || humanize(p);
  const voption = (p: string, v: string) => (OPTS[p] || {})[v] ?? v;
  const stagelabel = (sid: string) => {
    const v = stageLookup[sid];
    return v ? v[2] : sid;
  };
  const inStageLookup = (v: any): boolean => String(v) in stageLookup;

  // timePoint formatter (Python tp)
  const tp = (p: any): string => {
    if (!p || typeof p !== "object") return "date";
    const idx = p.indexReference || {};
    if (idx.referenceType === "TODAY" || "offset" in p) {
      const days = (p.offset || {}).days;
      if (days === 0 || days === undefined || days === null) return "today";
      return `${Math.abs(days)}d ago`;
    }
    if (p.year) {
      const mm = String(p.month ?? 1).padStart(2, "0");
      const dd = String(p.day ?? 1).padStart(2, "0");
      return `${String(p.year).padStart(4, "0")}-${mm}-${dd}`;
    }
    return "date";
  };
  const daysAgo = (t: string) => (t.endsWith("d ago") ? t.slice(0, -5).trim() : null);

  // PLAIN filter renderer (Python fmt_filter). Records unhandled operators.
  function fmtFilter(prop: string, op: Op): string {
    const o = op.operator || "";
    if (!KNOWN_OPERATORS.has(o)) unhandledOperators.add(o);
    const L = plabel(prop);
    let vals: any[] = op.values || (op.value !== undefined && op.value !== null ? [op.value] : []);
    vals = vals.map((v) => (String(v) in stageLookup ? stagelabel(String(v)) : voption(prop, String(v))));
    let pretty = vals.map((v) => `“${v}”`).join(" or ");
    if (pretty.length > 40) pretty = pretty.slice(0, 38) + "…”";
    if (["IS_ANY_OF", "IS_EQUAL_TO", "IS_EXACTLY", "HAS_EVER_BEEN_ANY_OF", "HAS_EVER_BEEN_EQUAL_TO"].includes(o))
      return `${L} is ${pretty}`;
    if (["IS_NONE_OF", "IS_NOT_EQUAL_TO"].includes(o)) return `${L} is not ${pretty}`;
    if (o === "HAS_NEVER_BEEN_ANY_OF") return `${L} has never been ${pretty}`;
    if (o === "IS_KNOWN") return `${L} is filled in`;
    if (o === "IS_UNKNOWN") return `${L} is blank`;
    if (o in NUM_SYM) {
      const word = { ">": "is more than", "<": "is less than", "≥": "is at least", "≤": "is at most" }[NUM_SYM[o]];
      return `${L} ${word} ${vals.map((v) => String(v)).join(", ")}`;
    }
    if (["CONTAINS", "CONTAINS_EXACTLY"].includes(o)) return `${L} contains ${pretty}`;
    if (o === "DOES_NOT_CONTAIN") return `${L} does not contain ${pretty}`;
    if (["IS_BEFORE", "IS_AFTER"].includes(o)) {
      const t = tp(op.timePoint); const d = daysAgo(t);
      if (d) return o === "IS_BEFORE" ? `${L} was more than ${d} days ago` : `${L} is within the last ${d} days`;
      return o === "IS_BEFORE" ? `${L} is before ${t}` : `${L} is after ${t}`;
    }
    if (["IS_BETWEEN", "IS_NOT_BETWEEN"].includes(o)) {
      const updated = op.propertyParser === "UPDATED_AT";
      const lo = tp(op.lowerBoundTimePoint); const hi = tp(op.upperBoundTimePoint); const d = daysAgo(lo);
      if (updated && o === "IS_NOT_BETWEEN" && d) return `${L} hasn’t changed in ${d} days`;
      if (updated) return o === "IS_BETWEEN" ? `${L} was last updated between ${lo} and ${hi}` : `${L} was not updated in ${lo}–${hi}`;
      return o === "IS_BETWEEN" ? `${L} is between ${lo} and ${hi}` : `${L} is not between ${lo} and ${hi}`;
    }
    return `${L} ${o.toLowerCase().replace(/_/g, " ")} ${pretty}`.trim();
  }

  // TECHNICAL filter renderer: raw internal names / operators / values, untruncated.
  function fmtFilterTech(prop: string, op: Op): string {
    const o = op.operator || "";
    const vals: any[] = op.values || (op.value !== undefined && op.value !== null ? [op.value] : []);
    const raw = vals.map((v) => String(v)).join(", ");
    if (o === "IS_KNOWN") return `${prop} IS_KNOWN`;
    if (o === "IS_UNKNOWN") return `${prop} IS_UNKNOWN`;
    if (["IS_BEFORE", "IS_AFTER"].includes(o)) return `${prop} ${o} ${tp(op.timePoint)}`;
    if (["IS_BETWEEN", "IS_NOT_BETWEEN"].includes(o)) {
      const parser = op.propertyParser ? ` [${op.propertyParser}]` : "";
      return `${prop} ${o}${parser} ${tp(op.lowerBoundTimePoint)}..${tp(op.upperBoundTimePoint)}`;
    }
    return `${prop} ${o}${raw ? ` [${raw}]` : ""}`;
  }

  return { plabel, voption, stagelabel, inStageLookup, tp, fmtFilter, fmtFilterTech };
}

type Ctx = ReturnType<typeof makeCtx>;

function clip(s: any, n = 44): string {
  s = String(s).replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// --- trigger (plain + technical) ---------------------------------------------

function eventTrigger(enr: any, ctx: Ctx, tech: boolean): string {
  const phrases: string[] = [];
  for (const eb of enr.eventFilterBranches || []) {
    const filts: [string, Op][] = []; collectFilters(eb, filts);
    let propname: any = null; let newvals: any[] = []; const others: [string, Op][] = [];
    for (const [prop, op] of filts) {
      if (prop === "hs_name") propname = op.value;
      else if (prop === "hs_value") newvals = op.values || (op.value ? [op.value] : []);
      else others.push([prop, op]);
    }
    if (propname) {
      if (tech) {
        phrases.push(`${propname} -> [${newvals.map(String).join(", ")}]`);
      } else {
        const labs = newvals.map((v) => (ctx.inStageLookup(v) ? ctx.stagelabel(v) : ctx.voption(propname, v)));
        const shown = labs.slice(0, 3).join(" or ") + (labs.length > 3 ? ` (or ${labs.length - 3} more)` : "");
        phrases.push(shown ? `${ctx.plabel(propname)} changes to ${shown}` : `${ctx.plabel(propname)} changes`);
      }
    } else if (others.length) {
      const fmt = tech ? ctx.fmtFilterTech : ctx.fmtFilter;
      phrases.push(others.slice(0, tech ? others.length : 3).map(([p, o]) => fmt(p, o)).join(", and "));
    } else {
      phrases.push("a tracked HubSpot event fires");
    }
  }
  const uniq: string[] = [];
  for (const p of phrases) if (p && !uniq.includes(p)) uniq.push(p);
  if (!uniq.length) return "";
  return "When " + (tech ? uniq : uniq.slice(0, 2)).join(" ; ");
}

function reenrollTrigger(enr: any, ctx: Ctx, tech: boolean): string {
  const conds: string[] = [];
  const fmt = tech ? ctx.fmtFilterTech : ctx.fmtFilter;
  for (const rb of enr.reEnrollmentTriggersFilterBranches || []) {
    const filts: [string, Op][] = []; collectFilters(rb, filts);
    for (const [prop, op] of filts) {
      if (STAGE_PROPS.has(prop) || prop.startsWith("hs_object")) continue;
      const s = fmt(prop, op);
      if (!conds.includes(s)) conds.push(s);
    }
  }
  if (!conds.length) return "";
  return "On change: " + (tech ? conds : conds.slice(0, 3)).join(" + ");
}

function triggerSummary(d: any, ctx: Ctx, tech: boolean): string {
  const enr = d.enrollmentCriteria || {};
  const etype = enr.type;
  if (etype === "MANUAL") return "Manually enrolled (no automatic trigger)";
  if (etype === "DATASET") return "Dataset-driven enrollment";
  if (etype === "EVENT_BASED") {
    const et = eventTrigger(enr, ctx, tech);
    if (et) return et;
  }
  const lfb = enr.listFilterBranch || {};
  const branches = lfb.filterBranches || [lfb];
  const stageLabelsSet = new Set<string>();
  const condStrs: string[] = [];
  const fmt = tech ? ctx.fmtFilterTech : ctx.fmtFilter;
  for (const br of branches) {
    const filts: [string, Op][] = []; collectFilters(br, filts);
    const bymap = new Map<string, Op>();
    for (const [prop, op] of filts) if (!bymap.has(prop)) bymap.set(prop, op);
    // NOTE: Python builds {prop:op} which keeps the LAST occurrence; mirror that.
    bymap.clear();
    for (const [prop, op] of filts) bymap.set(prop, op);
    const others: string[] = [];
    const taskOp = bymap.get("hs_task_subject");
    const taskSubj = taskOp ? (taskOp.values || (taskOp.value ? [taskOp.value] : [])) : [];
    if (taskSubj.length) {
      if (tech) {
        others.push(`hs_task_subject = [${taskSubj.map(String).join(", ")}] & hs_task_status = COMPLETED`);
      } else {
        let subj = String(taskSubj[0]);
        subj = subj.length < 46 ? subj : subj.slice(0, 44) + "…";
        others.push(`the task “${subj}” is completed`);
      }
    }
    for (const [prop, op] of filts) {
      if (STAGE_PROPS.has(prop)) {
        for (const v of op.values || []) if (ctx.inStageLookup(v)) stageLabelsSet.add(ctx.stagelabel(v));
        continue;
      }
      if (["hs_object_id", "hs_object_source", "hs_task_subject", "hs_task_status"].includes(prop)) continue;
      others.push(fmt(prop, op));
    }
    for (const s of others) if (!condStrs.includes(s)) condStrs.push(s);
  }
  let trig = (tech ? condStrs : condStrs.slice(0, 3)).join(", and ");
  if (!tech && condStrs.length > 3) trig += `, plus ${condStrs.length - 3} more condition(s)`;
  let cctx = "";
  if (stageLabelsSet.size) {
    const labs = [...stageLabelsSet].sort();
    const stages = tech
      ? labs.join(" or ")
      : (labs.length <= 2 ? labs.join(" or ") : `${labs[0]} (or ${labs.length - 1} other stages)`);
    cctx = `while the deal is in ${stages}`;
  }
  if (trig && cctx) return `When ${trig}, ${cctx}.`;
  if (trig) return `When ${trig}.`;
  if (cctx) return `When the deal is in ${cctx.split("in ").slice(1).join("in ")}.`;
  const reT = reenrollTrigger(enr, ctx, tech);
  if (reT) return reT;
  return "Enrolled by another workflow (no criteria of its own).";
}

// --- actions (plain array + technical array) ---------------------------------

function oneAction(a: any, ctx: Ctx, tech: boolean): string | null {
  const t = a.actionTypeId; const fields = a.fields || {};
  if (t === "0-5") {
    const v = fields.value || {};
    const sv = (v && typeof v === "object") ? v.staticValue : v;
    const isTs = v && typeof v === "object" && v.type === "TIMESTAMP";
    const prop = fields.property_name || "?";
    if (tech) {
      if (isTs || sv === undefined || sv === null || sv === "") return `[0-5] stamp ${prop} = EXECUTION_TIME`;
      return `[0-5] set ${prop} = "${sv}"`;
    }
    const L = ctx.plabel(prop);
    if (isTs || sv === undefined || sv === null || sv === "") return `stamp ${L} with today’s date`;
    return `set ${L} to “${clip(ctx.voption(prop, String(sv)), 26)}”`;
  }
  if (t === "0-3") return tech ? `[0-3] create task "${fields.subject || ""}"` : `create task “${clip(fields.subject || "", 38)}”`;
  if (t === "0-1") {
    const body = `wait ${fields.delta || ""} ${String(fields.time_unit || "").toLowerCase()}`;
    return tech ? `[0-1] ${body}` : body;
  }
  if (t === "0-8") return tech ? `[0-8] internal alert "${fields.subject || ""}"` : `send internal alert “${clip(fields.subject || "", 30)}”`;
  if (t === "1-27489890") return tech ? "[1-27489890] call a webhook" : "call a webhook";
  if (t === "0-4") return tech ? "[0-4] send a marketing email" : "send a marketing email";
  if (t === "0-14") return tech ? "[0-14] create a record" : "create a record";
  if (t === "0-169425243") return tech ? "[0-169425243] add a note" : "add a note";
  if (t === "0-11") return tech ? "[0-11] assign the owner" : "assign the owner";
  if (t === "0-63189541") return tech ? "[0-63189541] link an association" : "link an association";
  if (t === "0-15") return tech ? "[0-15] enroll it in another workflow" : "enroll it in another workflow";
  return null;
}

function branchCondition(node: any, ctx: Ctx, tech: boolean): string {
  const filts: [string, Op][] = []; collectFilters(node, filts);
  const fmt = tech ? ctx.fmtFilterTech : ctx.fmtFilter;
  const parts = filts.filter(([p]) => !STAGE_PROPS.has(p)).slice(0, tech ? filts.length : 2).map(([p, o]) => fmt(p, o));
  return parts.length ? parts.join(" and ") : "criteria met";
}

// Walk the action graph from startActionId following connection.nextActionId.
// Renders LIST_BRANCH/STATIC_BRANCH as "if <cond> → <branch>; otherwise". Returns plain step array.
function actionSteps(d: any, ctx: Ctx, tech: boolean): string[] {
  const amap = new Map<string, any>();
  for (const a of d.actions || []) amap.set(a.actionId, a);
  const steps: string[] = [];
  const visited = new Set<string>();
  let cur = d.startActionId;
  let guard = 0;
  while (cur && amap.has(cur) && !visited.has(cur) && guard < 12) {
    visited.add(cur); guard += 1;
    const a = amap.get(cur);
    if (a.type === "LIST_BRANCH" || a.listBranches != null) {
      const lb = (a.listBranches || [{}])[0] || {};
      const cond = branchCondition(lb.filterBranch || {}, ctx, tech);
      const matched = (lb.connection || {}).nextActionId;
      const dflt = (a.defaultBranch || {}).nextActionId;
      const mtxt = !matched ? "stop" : (oneAction(amap.get(matched) || {}, ctx, tech) || "continue");
      steps.push(`if ${cond} → ${mtxt}; otherwise`);
      cur = dflt;
      continue;
    }
    const ph = oneAction(a, ctx, tech);
    if (ph) steps.push(ph);
    cur = (a.connection || {}).nextActionId;
  }
  // dedupe consecutive
  const out: string[] = [];
  for (const s of steps) if (!out.length || out[out.length - 1] !== s) out.push(s);
  if (!tech && out.length > 5) return out.slice(0, 5).concat([`…(+${out.length - 5} more)`]);
  return out;
}

// --- main --------------------------------------------------------------------

export function summarizeFlow(
  detail: any,
  propLabels: { labels: Record<string, string>; options: Record<string, Record<string, string>> },
  stageLookup: Record<string, [string, string, string, number]>,
) {
  const ctx = makeCtx(propLabels, stageLookup);
  const enr = detail.enrollmentCriteria || {};
  const enrollmentType = enr.type;

  // stageIds: enrollment INCLUSION filter on a stage prop whose value is in stageLookup.
  const stageIds: string[] = [];
  {
    const filts: [string, Op][] = []; collectFilters(enr, filts);
    for (const [prop, op] of filts) {
      if (STAGE_PROPS.has(prop) && INCLUDE_OPS.has(op.operator || "")) {
        for (const v of op.values || []) if (v in stageLookup && !stageIds.includes(v)) stageIds.push(v);
      }
    }
  }

  // reads: non-stage enrollment-inclusion (property,value) pairs (with label), EXCLUDING stage props.
  const reads: { property: string; label: string; value: string }[] = [];
  {
    const filts: [string, Op][] = []; collectFilters(enr, filts);
    for (const [prop, op] of filts) {
      if (STAGE_PROPS.has(prop)) continue;
      // Skip HubSpot plumbing props (object id/source, task association props) — same
      // exclusions the trigger renderer applies; reads should be real status values.
      if (["hs_object_id", "hs_object_source", "hs_task_subject", "hs_task_status"].includes(prop)) continue;
      if (!INCLUDE_OPS.has(op.operator || "")) continue;
      const label = ctx.plabel(prop);
      const vals = op.values || (op.value !== undefined && op.value !== null ? [op.value] : []);
      for (const v of vals) reads.push({ property: prop, label, value: String(v) });
    }
  }

  // sets: from 0-5 STATIC_VALUE actions (enum values resolved via option labels).
  const sets: { property: string; label: string; value: string }[] = [];
  for (const a of detail.actions || []) {
    if (a.actionTypeId !== "0-5") continue;
    const v = (a.fields || {}).value || {};
    if (!(v && typeof v === "object" && v.type === "STATIC_VALUE")) continue;
    const prop = (a.fields || {}).property_name;
    if (!prop) continue;
    const raw = String(v.staticValue ?? "");
    sets.push({ property: prop, label: ctx.plabel(prop), value: raw });
  }

  return {
    enrollmentType,
    stageIds,
    trigger: triggerSummary(detail, ctx, false),
    triggerTechnical: triggerSummary(detail, ctx, true),
    actions: actionSteps(detail, ctx, false),
    actionsTechnical: actionSteps(detail, ctx, true),
    sets,
    reads,
  };
}
