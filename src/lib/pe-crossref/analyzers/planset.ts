/**
 * PlansetAnalyzer — emits P10, P10B, P10C tasks for generic XX-Y model
 * placeholders found in the planset's electrical specs box / schematic.
 *
 * No second LLM call. Reuses the audit's vision work via
 * `context.latestAuditRun.plansetVisionResult`. The audit's classifier
 * already extracts:
 *   - `issues[]`  — list of human-readable issue strings (e.g. "Tesla
 *     Powerwall 3 model number shows 1707000-XX-Y on electrical line
 *     diagram (PV-5)")
 *   - `equipmentVisible[]` — list of equipment entries with optional
 *     [FLAGGED: ...] suffixes when a placeholder was detected
 *
 * We pattern-match these strings for the three PE-relevant placeholder
 * families and emit P10 / P10B / P10C tasks accordingly. Identity keyed
 * on the planset fileId so revising the planset (new file) auto-resolves
 * old tasks.
 */

import type { Analyzer, DetectedTask, CrossRefContext } from "@/lib/pe-crossref/types";

const VERSION = "v1";

// Family-specific regex matchers. Anchored on the Tesla part-number prefix.
const PW3_GENERIC_RE = /\b1707000-XX-Y\b/i;       // Powerwall 3 placeholder
const BS_GENERIC_RE = /\b1624171-XX-Y\b/i;        // Backup Switch placeholder
const EXP_GENERIC_RE = /\b1807000-XX-Y\b/i;       // PW3 Expansion Unit placeholder

// Best-effort PV page number extraction from issue strings like
//   "1707000-XX-Y on electrical line diagram (PV-5)" → 5
const PV_PAGE_RE = /\bPV-?(\d+)\b/i;

export const PlansetAnalyzer: Analyzer = {
  name: "PlansetAnalyzer",
  version: VERSION,

  async detectTasks(context: CrossRefContext): Promise<DetectedTask[]> {
    const tasks: DetectedTask[] = [];
    const planset = context.latestAuditRun?.plansetVisionResult;
    if (!planset) return tasks;

    // Scan issues + equipmentVisible together — the placeholder may surface
    // in either field (audit's classifier is non-deterministic about which).
    const sources = [...planset.issues, ...planset.equipmentVisible];
    const combined = sources.join(" || ");

    if (PW3_GENERIC_RE.test(combined)) {
      const page = extractPvPage(planset.issues) ?? extractPvPage(planset.equipmentVisible);
      tasks.push(makeTask({
        pCode: "P10",
        kind: "pw3-generic",
        title: "PLANSET PW3 GENERIC",
        message: page
          ? `Planset PV-${page} shows Tesla Powerwall 3 as 1707000-XX-Y (placeholder).`
          : "Planset shows Tesla Powerwall 3 as 1707000-XX-Y (placeholder).",
        action: page
          ? `Revise PW3 model to specific variant (e.g. 1707000-21-Y) on PV-${page} — specs box and schematic labels.`
          : "Revise PW3 model to specific variant (e.g. 1707000-21-Y) — specs box and schematic labels.",
        plansetFileId: planset.plansetFileId,
        plansetFileName: planset.plansetFileName,
        page,
        sourceSnippets: sources.filter((s) => PW3_GENERIC_RE.test(s)),
      }));
    }

    if (BS_GENERIC_RE.test(combined)) {
      const page = extractPvPage(planset.issues) ?? extractPvPage(planset.equipmentVisible);
      tasks.push(makeTask({
        pCode: "P10B",
        kind: "bs-generic",
        title: "PLANSET BS GENERIC",
        message: page
          ? `Planset PV-${page} shows Tesla Backup Switch as 1624171-XX-Y (placeholder).`
          : "Planset shows Tesla Backup Switch as 1624171-XX-Y (placeholder).",
        action: page
          ? `Revise BS model to 1624171-00-E on PV-${page} if PE requires.`
          : "Revise BS model to 1624171-00-E if PE requires.",
        plansetFileId: planset.plansetFileId,
        plansetFileName: planset.plansetFileName,
        page,
        sourceSnippets: sources.filter((s) => BS_GENERIC_RE.test(s)),
      }));
    }

    if (EXP_GENERIC_RE.test(combined)) {
      const page = extractPvPage(planset.issues) ?? extractPvPage(planset.equipmentVisible);
      tasks.push(makeTask({
        pCode: "P10C",
        kind: "exp-generic",
        title: "PLANSET EXP GENERIC",
        message: page
          ? `Planset PV-${page} shows Powerwall 3 Expansion Unit as 1807000-XX-Y (placeholder).`
          : "Planset shows Powerwall 3 Expansion Unit as 1807000-XX-Y (placeholder).",
        action: page
          ? `Revise Expansion Unit model to a specific variant on PV-${page} if PE requires.`
          : "Revise Expansion Unit model to a specific variant if PE requires.",
        plansetFileId: planset.plansetFileId,
        plansetFileName: planset.plansetFileName,
        page,
        sourceSnippets: sources.filter((s) => EXP_GENERIC_RE.test(s)),
      }));
    }

    return tasks;
  },
};

interface TaskInput {
  pCode: "P10" | "P10B" | "P10C";
  kind: "pw3-generic" | "bs-generic" | "exp-generic";
  title: string;
  message: string;
  action: string;
  plansetFileId: string;
  plansetFileName: string;
  page: number | null;
  sourceSnippets: string[];
}

function makeTask(input: TaskInput): DetectedTask {
  const pageSuffix = input.page != null ? `:p${input.page}` : "";
  return {
    pCode: input.pCode,
    identityKey: `${input.pCode}@${VERSION}:planset:${input.plansetFileId}:${input.kind}${pageSuffix}`,
    severity: "conditional",
    category: "planset",
    analyzer: "PlansetAnalyzer",
    title: input.title,
    message: input.message,
    action: input.action,
    evidence: {
      plansetFileId: input.plansetFileId,
      plansetFileName: input.plansetFileName,
      page: input.page,
      sourceSnippets: input.sourceSnippets,
    },
  };
}

function extractPvPage(strings: string[]): number | null {
  for (const s of strings) {
    const m = s.match(PV_PAGE_RE);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}
