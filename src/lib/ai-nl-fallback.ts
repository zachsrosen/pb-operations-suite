import type { ProjectFilterSpec } from "@/lib/ai";

const LOCATIONS = [
  "Westminster",
  "Centennial",
  "Colorado Springs",
  "San Luis Obispo",
  "Camarillo",
] as const;

type SortField = NonNullable<ProjectFilterSpec["sort_by"]>;
type SortDir = NonNullable<ProjectFilterSpec["sort_dir"]>;

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

function amountTokenToNumber(raw: string, suffix?: string): number | null {
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return null;
  if (!suffix) return numeric;
  const s = suffix.toLowerCase();
  if (s === "k") return numeric * 1_000;
  if (s === "m") return numeric * 1_000_000;
  return numeric;
}

function extractAmountByPattern(query: string, patterns: RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const match = query.match(pattern);
    if (!match) continue;
    const amount = amountTokenToNumber(match[1], match[2]);
    if (amount !== null) return amount;
  }
  return undefined;
}

function parseSort(query: string): { sort_by?: SortField; sort_dir?: SortDir } {
  const byAmount = /\b(amount|value|revenue)\b/.test(query);
  const byPriority = /\bpriority\b/.test(query);
  const byInstall = /\binstall\b/.test(query);
  const byInspection = /\binspection\b/.test(query);
  const byPto = /\bpto|permission to operate\b/.test(query);
  const byAge = /\b(days since close|age)\b/.test(query);

  let sort_by: SortField | undefined;
  if (byAmount) sort_by = "amount";
  else if (byPriority) sort_by = "priority_score";
  else if (byInstall) sort_by = "days_to_install";
  else if (byInspection) sort_by = "days_to_inspection";
  else if (byPto) sort_by = "days_to_pto";
  else if (byAge) sort_by = "days_since_close";

  let sort_dir: SortDir | undefined;
  if (/\b(desc|descending|highest|largest|biggest|max)\b/.test(query)) {
    sort_dir = "desc";
  } else if (/\b(asc|ascending|lowest|smallest|min|soonest)\b/.test(query)) {
    sort_dir = "asc";
  }

  return { sort_by, sort_dir };
}

function parseStages(query: string): string[] | undefined {
  const stageSet = new Set<string>();
  if (/\bsite survey|survey\b/.test(query)) stageSet.add("Site Survey");
  if (/\bdesign\b/.test(query)) stageSet.add("Design & Engineering");
  if (/\bpermitting|interconnection\b/.test(query)) stageSet.add("Permitting & Interconnection");
  if (/\brtb - blocked|blocked rtb\b/.test(query)) stageSet.add("RTB - Blocked");
  if (/\bconstruction|install(?:ation)?\b/.test(query)) stageSet.add("Construction");
  if (/\binspection\b/.test(query)) stageSet.add("Inspection");
  if (/\bpermission to operate|pto\b/.test(query)) stageSet.add("Permission To Operate");
  if (/\bclose ?out\b/.test(query)) stageSet.add("Close Out");
  return stageSet.size > 0 ? Array.from(stageSet) : undefined;
}

export function hasMeaningfulFilterSpec(spec: ProjectFilterSpec): boolean {
  return !!(
    spec.locations?.length ||
    spec.stages?.length ||
    spec.is_pe !== undefined ||
    spec.is_rtb !== undefined ||
    spec.is_overdue ||
    spec.max_days_to_install !== undefined ||
    spec.min_days_to_install !== undefined ||
    spec.min_amount !== undefined ||
    spec.max_amount !== undefined ||
    spec.min_priority_score !== undefined ||
    spec.sort_by ||
    spec.sort_dir
  );
}

export function buildHeuristicFilterSpec(rawQuery: string): ProjectFilterSpec {
  const query = normalizeQuery(rawQuery);

  const locations = LOCATIONS.filter((loc) => query.includes(loc.toLowerCase()));
  const stages = parseStages(query);
  const { sort_by, sort_dir } = parseSort(query);

  const isPeFalse = /\b(non[-\s]?pe|not pe|exclude pe|without pe)\b/.test(query);
  const isPeTrue = /\b(participate energy|pe)\b/.test(query) && !isPeFalse;

  const isRtbFalse = /\b(not rtb|exclude rtb|without rtb)\b/.test(query);
  const isRtbTrue = /\b(ready to build|rtb)\b/.test(query) && !isRtbFalse;

  const min_amount = extractAmountByPattern(query, [
    /\b(?:over|above|greater than|at least|min(?:imum)?|>=)\s*\$?(\d+(?:\.\d+)?)\s*([km])?\b/i,
    /\$\s*(\d+(?:\.\d+)?)\s*([km])?\s*(?:or more|\+)\b/i,
  ]);
  const max_amount = extractAmountByPattern(query, [
    /\b(?:under|below|less than|at most|max(?:imum)?|<=)\s*\$?(\d+(?:\.\d+)?)\s*([km])?\b/i,
    /\$\s*(\d+(?:\.\d+)?)\s*([km])?\s*(?:or less)\b/i,
  ]);

  const minPriorityMatch = query.match(/\bpriority(?: score)?\s*(?:>=|at least|min(?:imum)?)\s*(\d+)\b/i);
  const min_priority_score = minPriorityMatch ? Number(minPriorityMatch[1]) : undefined;

  const maxInstallMatch = query.match(/\b(?:install(?:ation)?\s*(?:in|within|by)|max days to install)\s*(\d+)\s*days?\b/i);
  const max_days_to_install = maxInstallMatch ? Number(maxInstallMatch[1]) : undefined;

  const minInstallMatch = query.match(/\b(?:min days to install|install(?:ation)?\s*(?:after|beyond))\s*(\d+)\s*days?\b/i);
  const min_days_to_install = minInstallMatch ? Number(minInstallMatch[1]) : undefined;

  const spec: ProjectFilterSpec = {
    interpreted_as: "",
  };

  if (locations.length > 0) spec.locations = locations;
  if (stages?.length) spec.stages = stages;
  if (isPeFalse) spec.is_pe = false;
  else if (isPeTrue) spec.is_pe = true;
  if (isRtbFalse) spec.is_rtb = false;
  else if (isRtbTrue) spec.is_rtb = true;
  if (/\b(overdue|past due|late)\b/.test(query)) spec.is_overdue = true;
  if (min_amount !== undefined) spec.min_amount = min_amount;
  if (max_amount !== undefined) spec.max_amount = max_amount;
  if (Number.isFinite(min_priority_score)) spec.min_priority_score = min_priority_score;
  if (Number.isFinite(max_days_to_install)) spec.max_days_to_install = max_days_to_install;
  if (Number.isFinite(min_days_to_install)) spec.min_days_to_install = min_days_to_install;
  if (sort_by) spec.sort_by = sort_by;
  if (sort_dir) spec.sort_dir = sort_dir;

  const parts: string[] = [];
  if (spec.is_pe === true) parts.push("PE projects");
  if (spec.is_pe === false) parts.push("non-PE projects");
  if (spec.is_rtb === true) parts.push("RTB projects");
  if (spec.is_rtb === false) parts.push("non-RTB projects");
  if (spec.is_overdue) parts.push("overdue milestones");
  if (spec.locations?.length) parts.push(`in ${spec.locations.join(", ")}`);
  if (spec.stages?.length) parts.push(`stage: ${spec.stages.join(", ")}`);
  if (spec.min_amount !== undefined) parts.push(`amount >= ${spec.min_amount}`);
  if (spec.max_amount !== undefined) parts.push(`amount <= ${spec.max_amount}`);
  if (spec.min_priority_score !== undefined) parts.push(`priority >= ${spec.min_priority_score}`);
  if (spec.max_days_to_install !== undefined) parts.push(`days_to_install <= ${spec.max_days_to_install}`);
  if (spec.min_days_to_install !== undefined) parts.push(`days_to_install >= ${spec.min_days_to_install}`);
  if (spec.sort_by) parts.push(`sort by ${spec.sort_by}${spec.sort_dir ? ` (${spec.sort_dir})` : ""}`);

  spec.interpreted_as = parts.length
    ? `Heuristic fallback: ${parts.join("; ")}.`
    : "Could not confidently parse query. Showing all projects.";

  return spec;
}
