/**
 * PE document rework + attribution analytics (pure helpers, no I/O).
 *
 * Reconstructs the rework story from three inputs the route loads:
 *   - versions:    PeDocVersion rows (who uploaded each version, when)
 *   - actionItems: PeActionItem rows (PE reviewer rejections w/ notes + date)
 *   - reviews:     PeDocumentReview rows (each doc's CURRENT status)
 *
 * A "swap" is a cross-person replacement: version i was uploaded by A and the
 * next version by a different person B → "B replaced A's work". Each swap is
 * tagged rejection-driven (a PE rejection landed in A's window) or voluntary,
 * and carries an OUTCOME (what ultimately happened to that replacement).
 *
 * Attribution caveat for callers: uploads before 2026-06-12 have no uploadedBy
 * and collapse into UNKNOWN_UPLOADER; the PE API also appears to drop some
 * resolved rejections, so rejection-driven counts are a lower bound.
 */
import { UNKNOWN_UPLOADER } from "@/lib/pe-analytics";

export interface ReworkVersionInput {
  peProjectId: string;
  dealId: string | null;
  docName: string;
  version: number;
  uploadedBy: string | null;
  uploadedAt: Date | string;
}
export interface ReworkActionInput {
  peProjectId: string;
  docLabel: string;
  notes: string | null;
  actionDate: Date | string;
}
export interface ReworkReviewInput {
  dealId: string;
  docName: string;
  status: string;
}

export type SwapOutcome = "approved" | "rejected_again" | "under_review" | "superseded_again";

/** One person's role as a replacer (B): how much of others' work they redid. */
export interface ReplacerStat {
  uploader: string; // email or UNKNOWN_UPLOADER
  total: number; // cross-person swaps where this person uploaded the replacement
  rejected: number; // a PE rejection landed on the replaced version first
  voluntary: number; // no rejection — swapped in pre-review
  whose: { uploader: string; count: number }[]; // whose work they replaced
  outcomes: Record<SwapOutcome, number>; // result of those replacements
}
/** Directed edge "replacer ⟵ replaced". */
export interface SwapEdge {
  replacer: string;
  replaced: string;
  total: number;
  rejected: number;
  voluntary: number;
}
export interface SwapGraph {
  byReplacer: ReplacerStat[];
  edges: SwapEdge[];
  totalSwaps: number;
  rejectedSwaps: number;
  voluntarySwaps: number;
  selfRevisions: number;
}

export interface RejectionReason {
  code: string; // e.g. "H107"
  label: string; // e.g. "MISS-PHOTO-REQUIRED"
  count: number;
  sample: string; // trimmed note excerpt
}
export interface RejectionByDoc {
  docName: string;
  count: number;
}
export interface RejectionReasons {
  codes: RejectionReason[];
  byDoc: RejectionByDoc[];
  totalActionItems: number;
  withCode: number;
}

export interface ReworkWeek {
  weekStart: string; // ISO date (Monday)
  rejections: number; // PE rejection events that week
  resubmissions: number; // new versions uploaded after a prior version that week
}

export interface PeReworkPayload {
  swaps: SwapGraph;
  reasons: RejectionReasons;
  timeline: ReworkWeek[];
  generatedAt: string;
}

// ---------------------------------------------------------------------------
const norm = (e: string | null | undefined): string => e?.trim().toLowerCase() || UNKNOWN_UPLOADER;
const toDate = (d: Date | string): Date => (d instanceof Date ? d : new Date(d));
const fixDocLabel = (l: string): string =>
  l === "Conditional Waiver/Release on Final Payment" ? "Conditional Waiver — Final Payment" : l;

/** Monday-start ISO week key (UTC), matching the analytics tab's convention. */
export function weekStartMondayUTC(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = x.getUTCDay(); // 0=Sun
  const delta = dow === 0 ? -6 : 1 - dow;
  x.setUTCDate(x.getUTCDate() + delta);
  return x.toISOString().slice(0, 10);
}

function statusBucket(status: string | undefined): SwapOutcome {
  if (status === "APPROVED") return "approved";
  if (status === "ACTION_REQUIRED" || status === "REJECTED") return "rejected_again";
  return "under_review"; // UNDER_REVIEW / UPLOADED / unknown → still in flight
}

interface Grouped {
  docName: string;
  peProjectId: string;
  dealId: string | null;
  versions: ReworkVersionInput[]; // sorted oldest→newest
}

function groupVersions(versions: ReworkVersionInput[]): Grouped[] {
  const map = new Map<string, Grouped>();
  for (const v of versions) {
    const key = `${v.peProjectId}::${v.docName}`;
    let g = map.get(key);
    if (!g) {
      g = { docName: v.docName, peProjectId: v.peProjectId, dealId: v.dealId ?? null, versions: [] };
      map.set(key, g);
    }
    g.versions.push(v);
    if (!g.dealId && v.dealId) g.dealId = v.dealId;
  }
  for (const g of map.values()) {
    g.versions.sort((a, b) => a.version - b.version || +toDate(a.uploadedAt) - +toDate(b.uploadedAt));
  }
  return [...map.values()];
}

function rejectionsByKey(actionItems: ReworkActionInput[]): Map<string, Date[]> {
  const map = new Map<string, Date[]>();
  for (const a of actionItems) {
    const key = `${a.peProjectId}::${fixDocLabel(a.docLabel)}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(toDate(a.actionDate));
  }
  return map;
}

/** Who replaces whose work, split rejection-driven vs voluntary, with outcomes. */
export function buildSwapGraph(
  versions: ReworkVersionInput[],
  actionItems: ReworkActionInput[],
  reviews: ReworkReviewInput[],
): SwapGraph {
  const groups = groupVersions(versions);
  const rejByKey = rejectionsByKey(actionItems);
  const statusByKey = new Map<string, string>();
  for (const r of reviews) statusByKey.set(`${r.dealId}::${r.docName}`, r.status);

  const replacers = new Map<string, ReplacerStat & { _whose: Map<string, number> }>();
  const edges = new Map<string, SwapEdge>();
  let totalSwaps = 0, rejectedSwaps = 0, voluntarySwaps = 0, selfRevisions = 0;

  const getReplacer = (u: string) => {
    let s = replacers.get(u);
    if (!s) {
      s = { uploader: u, total: 0, rejected: 0, voluntary: 0, whose: [], _whose: new Map(),
        outcomes: { approved: 0, rejected_again: 0, under_review: 0, superseded_again: 0 } };
      replacers.set(u, s);
    }
    return s;
  };

  for (const g of groups) {
    if (g.versions.length < 2) continue;
    const rejs = rejByKey.get(`${g.peProjectId}::${fixDocLabel(g.docName)}`) ?? [];
    const currentStatus = g.dealId ? statusByKey.get(`${g.dealId}::${g.docName}`) : undefined;
    for (let i = 0; i < g.versions.length - 1; i++) {
      const A = norm(g.versions[i].uploadedBy);
      const B = norm(g.versions[i + 1].uploadedBy);
      if (A === B) { selfRevisions++; continue; }
      const start = toDate(g.versions[i].uploadedAt);
      const end = toDate(g.versions[i + 1].uploadedAt);
      const rejected = rejs.some((r) => r >= start && r < end);
      const isFinal = i + 1 === g.versions.length - 1;
      const outcome: SwapOutcome = isFinal ? statusBucket(currentStatus) : "superseded_again";

      const s = getReplacer(B);
      s.total++;
      s._whose.set(A, (s._whose.get(A) ?? 0) + 1);
      s.outcomes[outcome]++;
      if (rejected) { s.rejected++; rejectedSwaps++; } else { s.voluntary++; voluntarySwaps++; }
      totalSwaps++;

      const ek = `${B} ${A}`;
      let e = edges.get(ek);
      if (!e) { e = { replacer: B, replaced: A, total: 0, rejected: 0, voluntary: 0 }; edges.set(ek, e); }
      e.total++;
      if (rejected) e.rejected++; else e.voluntary++;
    }
  }

  const byReplacer = [...replacers.values()]
    .map((s) => {
      s.whose = [...s._whose.entries()].map(([uploader, count]) => ({ uploader, count })).sort((a, b) => b.count - a.count);
      const { _whose, ...rest } = s;
      void _whose;
      return rest;
    })
    .sort((a, b) => b.total - a.total);

  return {
    byReplacer,
    edges: [...edges.values()].sort((a, b) => b.total - a.total),
    totalSwaps, rejectedSwaps, voluntarySwaps, selfRevisions,
  };
}

// Matches "H107] MISS-PHOTO-REQUIRED" / "H048 INCOR-..." → code + label token.
const CODE_RE = /\b(H\d{3})\b[\]\s:.-]*([A-Z][A-Z0-9-]{3,})?/g;

/** Top rejection reason codes (parsed from note text) + rejections by doc type. */
export function buildRejectionReasons(actionItems: ReworkActionInput[]): RejectionReasons {
  const codes = new Map<string, RejectionReason>();
  const byDoc = new Map<string, number>();
  let withCode = 0;

  for (const a of actionItems) {
    const doc = fixDocLabel(a.docLabel);
    byDoc.set(doc, (byDoc.get(doc) ?? 0) + 1);
    const notes = a.notes ?? "";
    const seen = new Set<string>();
    for (const m of notes.matchAll(CODE_RE)) {
      const code = m[1];
      if (seen.has(code)) continue;
      seen.add(code);
      const label = m[2] ?? "";
      let cur = codes.get(code);
      if (!cur) {
        const idx = notes.indexOf(code);
        const sample = notes.slice(idx, idx + 90).replace(/\s+/g, " ").trim();
        cur = { code, label, count: 0, sample };
        codes.set(code, cur);
      }
      if (!cur.label && label) cur.label = label;
      cur.count++;
    }
    if (seen.size) withCode++;
  }

  return {
    codes: [...codes.values()].sort((a, b) => b.count - a.count),
    byDoc: [...byDoc.entries()].map(([docName, count]) => ({ docName, count })).sort((a, b) => b.count - a.count),
    totalActionItems: actionItems.length,
    withCode,
  };
}

/** Weekly rework trend: PE rejections and version resubmissions per Monday week. */
export function buildReworkTimeline(
  versions: ReworkVersionInput[],
  actionItems: ReworkActionInput[],
): ReworkWeek[] {
  const weeks = new Map<string, ReworkWeek>();
  const get = (w: string) => {
    let r = weeks.get(w);
    if (!r) { r = { weekStart: w, rejections: 0, resubmissions: 0 }; weeks.set(w, r); }
    return r;
  };
  for (const a of actionItems) get(weekStartMondayUTC(toDate(a.actionDate))).rejections++;
  // a resubmission = any version beyond v1 for a (project, doc)
  for (const g of groupVersions(versions)) {
    for (let i = 1; i < g.versions.length; i++) get(weekStartMondayUTC(toDate(g.versions[i].uploadedAt))).resubmissions++;
  }
  return [...weeks.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

export function buildPeReworkPayload(
  versions: ReworkVersionInput[],
  actionItems: ReworkActionInput[],
  reviews: ReworkReviewInput[],
  now: Date = new Date(),
): PeReworkPayload {
  return {
    swaps: buildSwapGraph(versions, actionItems, reviews),
    reasons: buildRejectionReasons(actionItems),
    timeline: buildReworkTimeline(versions, actionItems),
    generatedAt: now.toISOString(),
  };
}
