"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { StatCard, MiniStat } from "@/components/ui/MetricCard";
import MetricsTrendPanel from "@/components/pe/MetricsTrendPanel";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import { queryKeys } from "@/lib/query-keys";
import { usePeAutoSync } from "@/hooks/usePeAutoSync";
import { rowsToCsv, rowsToText, cleanPeNote, parseDealName, type PeExportRow } from "@/lib/pe-doc-export";
import { PE_CONDITIONAL_DOC_NAMES } from "@/lib/pe-analytics";

// ---------------------------------------------------------------------------
// Types (mirrors pe-report API shape)
// ---------------------------------------------------------------------------

interface DocReviewFromHS {
  dealId: string;
  docName: string;
  status: string;
  notes: string | null;
  peComment: string | null;
}

interface PeDeal {
  dealId: string;
  dealName: string;
  pbLocation: string;
  dealStage: string;
  dealStageLabel: string;
  closeDate: string | null;
  systemType: "solar" | "battery" | "solar+battery";
  epcPrice: number | null;
  peM1Status: string | null;
  peM2Status: string | null;
  peInfoNeeded: string | null; // deal-level "PE info needed" reason (editable)
  hubspotUrl: string;
  pePortalUrl: string | null;
  peProjectId: string | null;
  driveUrl: string | null;
  docReviews: DocReviewFromHS[];
}

interface DocReview {
  dealId: string;
  docName: string;
  status: PeDocStatusValue;
  notes: string | null;
  // Full open PE reviewer comment (from PeActionItem), shown verbatim.
  peComment: string | null;
}

type PeDocStatusValue =
  | "NOT_UPLOADED"
  | "UPLOADED"
  | "UNDER_REVIEW"
  | "ACTION_REQUIRED"
  | "REJECTED"
  | "APPROVED"
  | "NOT_REQUIRED";

// ---------------------------------------------------------------------------
// PE document requirements (same as pe-report)
// ---------------------------------------------------------------------------

type DocTeam = "sales" | "design" | "operations" | "permit" | "interconnection" | "accounting" | "compliance";

interface DocRequirement {
  name: string;
  section: "onboarding" | "ic" | "pc";
  owner: "PB" | "Customer" | "PE";
  team: DocTeam;
  note?: string;
}

const PE_DOCUMENTS: DocRequirement[] = [
  { name: "Customer Agreement (PPA/ESA)", section: "onboarding", owner: "Customer", team: "sales", note: "Signed by customer" },
  { name: "Installation Order", section: "onboarding", owner: "PB", team: "sales" },
  { name: "State Disclosures", section: "onboarding", owner: "PB", team: "sales" },
  { name: "Utility Bill", section: "onboarding", owner: "Customer", team: "sales" },
  { name: "Signed Proposal", section: "ic", owner: "PB", team: "sales" },
  { name: "Design Plan", section: "ic", owner: "PB", team: "design", note: "Common blocker — ensure latest revision" },
  { name: "Photos per Policy", section: "ic", owner: "PB", team: "operations", note: "#1 rejection reason — follow PE photo guide" },
  { name: "Bill of Materials", section: "ic", owner: "PB", team: "operations", note: "Now its own PE upload (was bundled in Photos)" },
  { name: "Signed Final Permit", section: "ic", owner: "PB", team: "permit" },
  { name: "Access to Monitoring", section: "ic", owner: "PB", team: "operations", note: "Monitoring platform credentials" },
  { name: "Certificate of Acceptance", section: "ic", owner: "PB", team: "compliance" },
  { name: "Attestation of Customer Payment", section: "ic", owner: "PB", team: "compliance" },
  { name: "Conditional Progress Lien Waiver", section: "ic", owner: "PB", team: "accounting" },
  // Conditional: PE creates the slot only when a Change Order exists, so it reads
  // "Not Required" until one is uploaded. Required whenever a fix moves the Net
  // Amount Due (incentive removal, NAD/payment-schedule correction).
  { name: "Change Order", section: "ic", owner: "PB", team: "sales", note: "Required when the Net Amount Due changes" },
  { name: "Signed Interconnection Agreement", section: "pc", owner: "PB", team: "interconnection" },
  { name: "Conditional Waiver — Final Payment", section: "pc", owner: "PB", team: "accounting" },
  { name: "Permission to Operate (PTO)", section: "pc", owner: "PB", team: "interconnection" },
];

const TEAM_LABELS: Record<DocTeam, string> = {
  sales: "Sales",
  design: "Design",
  operations: "Operations",
  permit: "Permitting",
  interconnection: "Interconnection",
  accounting: "Accounting",
  compliance: "Compliance",
};

const TEAM_COLORS: Record<DocTeam, string> = {
  sales: "text-cyan-400",
  design: "text-purple-400",
  operations: "text-yellow-400",
  permit: "text-orange-400",
  interconnection: "text-blue-400",
  accounting: "text-emerald-400",
  compliance: "text-pink-400",
};

const TEAM_BG: Record<DocTeam, string> = {
  sales: "bg-cyan-500/10 border-cyan-500/30",
  design: "bg-purple-500/10 border-purple-500/30",
  operations: "bg-yellow-500/10 border-yellow-500/30",
  permit: "bg-orange-500/10 border-orange-500/30",
  interconnection: "bg-blue-500/10 border-blue-500/30",
  accounting: "bg-emerald-500/10 border-emerald-500/30",
  compliance: "bg-pink-500/10 border-pink-500/30",
};

const TEAM_DOT: Record<DocTeam, string> = {
  sales: "bg-cyan-400",
  design: "bg-purple-400",
  operations: "bg-yellow-400",
  permit: "bg-orange-400",
  interconnection: "bg-blue-400",
  accounting: "bg-emerald-400",
  compliance: "bg-pink-400",
};

// Ordered for display priority (teams with most actionable items first)
const TEAM_ORDER: DocTeam[] = ["sales", "design", "operations", "permit", "interconnection", "accounting", "compliance"];

const SECTION_LABELS: Record<string, string> = {
  onboarding: "Onboarding",
  ic: "Inspection Complete (M1)",
  pc: "Project Complete (M2)",
};

// Section-group keys for the Sections view (Nearly Complete / Not Uploaded / Action Required).
const SECTION_KEYS = ["nearlyComplete", "notUploaded", "actionRequired"] as const;

// ---------------------------------------------------------------------------
// Deal stage → PE milestone
// ---------------------------------------------------------------------------

type PeMilestone = "pre-construction" | "construction" | "inspection" | "pto" | "close-out" | "complete";

function dealStageToPeMilestone(stageLabel: string): PeMilestone {
  const s = stageLabel.toLowerCase();
  if (s.includes("complete")) return "complete";
  if (s.includes("close out")) return "close-out";
  if (s.includes("permission to operate") || s.includes("pto")) return "pto";
  if (s.includes("inspection")) return "inspection";
  if (s.includes("construction")) return "construction";
  return "pre-construction";
}

function milestoneLabel(m: PeMilestone): string {
  const map: Record<PeMilestone, string> = {
    "pre-construction": "Pre-Construction",
    construction: "Construction",
    inspection: "Inspection",
    pto: "PTO",
    "close-out": "Close Out",
    complete: "Complete",
  };
  return map[m];
}

function milestoneDocSections(m: PeMilestone): ("onboarding" | "ic" | "pc")[] {
  switch (m) {
    case "pre-construction":
    case "construction":
      return ["onboarding"];
    // PTO (HubSpot) = PE "Inspection Complete" (M1): owes onboarding + IC docs
    // only. The M2 / Project-Complete docs (Interconnection Agreement, PTO,
    // Final-Payment Waiver) aren't due until the deal reaches Close Out, so they
    // must not count or render as outstanding while the deal is still at PTO.
    case "inspection":
    case "pto":
      return ["onboarding", "ic"];
    case "close-out":
    case "complete":
      return ["onboarding", "ic", "pc"];
  }
}

// ---------------------------------------------------------------------------
// Doc status helpers
// ---------------------------------------------------------------------------

const DOC_STATUS_COLORS: Record<PeDocStatusValue, string> = {
  NOT_UPLOADED: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  // UPLOADED is merged into UNDER_REVIEW ("In Review") — same blue styling.
  UPLOADED: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  UNDER_REVIEW: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  ACTION_REQUIRED: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  REJECTED: "bg-red-500/20 text-red-400 border-red-500/30",
  APPROVED: "bg-green-500/20 text-green-400 border-green-500/30",
  // Not requested by PE on this project (e.g. BOM bundled in Photos) — neutral,
  // counts as complete.
  NOT_REQUIRED: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
};

const DOC_STATUS_LABELS: Record<PeDocStatusValue, string> = {
  NOT_UPLOADED: "Not Uploaded",
  UPLOADED: "In Review",
  UNDER_REVIEW: "In Review",
  ACTION_REQUIRED: "Action Required",
  REJECTED: "Rejected",
  APPROVED: "Approved",
  NOT_REQUIRED: "Not Required",
};

// Synthetic doc name for CSV-imported overall status
const CSV_SUMMARY_DOC_NAME = "Portal Summary (CSV)";

type ActionCategory = "needs-upload" | "action-required" | "rejected" | "waiting-on-pe" | "approved" | "no-data";

interface DealDocSummary {
  deal: PeDeal;
  milestone: PeMilestone;
  sections: ("onboarding" | "ic" | "pc")[];
  totalDocs: number;
  approved: number;
  rejected: number;
  actionRequired: number;
  underReview: number;
  notUploaded: number;
  waived: number; // not-uploaded but moot — PE already approved/paid that milestone
  notRequired: number; // PE didn't include the slot (conditional doc) — counts complete
  noData: number;
  category: ActionCategory;
  csvOnly: boolean;
  csvStatus: PeDocStatusValue | null;
  csvNotes: string | null;
}

// A not-uploaded doc is "waived" (moot) once PE has already approved or paid the
// milestone it belongs to — PE didn't need it, so it shouldn't read as actionable.
// Rejections (ACTION_REQUIRED/REJECTED) are NEVER waived — a late rejection on a
// closed deal stays live.
const PE_MILESTONE_DONE = new Set(["approved", "paid"]);
function isDocWaived(doc: DocRequirement, deal: PeDeal): boolean {
  const status = (doc.section === "pc" ? deal.peM2Status : deal.peM1Status) ?? "";
  return PE_MILESTONE_DONE.has(status.toLowerCase());
}

// A conditional doc (e.g. Bill of Materials) is only owed by a deal when PE
// includes its slot — i.e. a synced doc row exists. PE adds the BOM slot only
// to projects it wants one for, so it must not read as missing on the rest.
function dealOwesDoc(doc: DocRequirement, dealId: string, docMap: Map<string, DocReview>): boolean {
  return !PE_CONDITIONAL_DOC_NAMES.has(doc.name) || docMap.has(`${dealId}:${doc.name}`);
}

function computeDealDocSummary(
  deal: PeDeal,
  docMap: Map<string, DocReview>,
): DealDocSummary {
  const milestone = dealStageToPeMilestone(deal.dealStageLabel);
  const sections = milestoneDocSections(milestone);
  const docs = PE_DOCUMENTS.filter((d) => sections.includes(d.section) && dealOwesDoc(d, deal.dealId, docMap));

  let approved = 0, rejected = 0, actionRequired = 0, underReview = 0, notUploaded = 0, waived = 0, notRequired = 0, noData = 0;
  for (const doc of docs) {
    const review = docMap.get(`${deal.dealId}:${doc.name}`);
    if (!review) { noData++; continue; }
    switch (review.status) {
      case "APPROVED": approved++; break;
      case "REJECTED": rejected++; break;
      case "ACTION_REQUIRED": actionRequired++; break;
      case "UNDER_REVIEW": underReview++; break;
      case "NOT_UPLOADED": if (isDocWaived(doc, deal)) waived++; else notUploaded++; break;
      case "UPLOADED": underReview++; break;
      case "NOT_REQUIRED": notRequired++; break; // PE didn't ask for it here — counts complete
    }
  }

  const csvRow = docMap.get(`${deal.dealId}:${CSV_SUMMARY_DOC_NAME}`);
  const csvOnly = noData === docs.length && !!csvRow;

  let category: ActionCategory;
  if (csvOnly && csvRow) {
    if (csvRow.status === "APPROVED") category = "approved";
    else if (csvRow.status === "ACTION_REQUIRED" || csvRow.status === "REJECTED") category = "action-required";
    else category = "waiting-on-pe";
  } else if (noData === docs.length) {
    category = "no-data";
  } else if (rejected > 0) {
    category = "rejected";
  } else if (actionRequired > 0) {
    category = "action-required";
  } else if (notUploaded > 0) {
    category = "needs-upload";
  } else if (approved + waived + notRequired === docs.length) {
    category = "approved";
  } else {
    category = "waiting-on-pe";
  }

  return {
    deal, milestone, sections,
    totalDocs: docs.length,
    approved, rejected, actionRequired, underReview, notUploaded, waived, notRequired, noData,
    category,
    csvOnly,
    csvStatus: csvRow?.status ?? null,
    csvNotes: csvRow?.notes ?? null,
  };
}

// ---------------------------------------------------------------------------
// Email-style actionable sections (mirrors the pe-doc-digest cron):
//   Nearly Complete / Not Uploaded / Action Required
// ---------------------------------------------------------------------------

const TOTAL_DOCS_PER_DEAL = 15;
// For PTO-stage deals these two aren't expected yet, so they're excluded from
// the Not Uploaded list (matches the digest's PTO_SKIP_DOCS).
const PTO_SKIP_DOCS = new Set<string>([
  "Signed Interconnection Agreement",
  "Permission to Operate (PTO)",
]);

type DocWithReview = { doc: DocRequirement; review: DocReview | undefined };

function getDealActionLists(
  s: DealDocSummary,
  docMap: Map<string, DocReview>,
): { blocking: DocWithReview[]; missing: DocWithReview[]; issues: DocWithReview[] } {
  const docs = PE_DOCUMENTS.filter((d) => s.sections.includes(d.section) && dealOwesDoc(d, s.deal.dealId, docMap));
  const withReviews: DocWithReview[] = docs.map((doc) => ({
    doc,
    review: docMap.get(`${s.deal.dealId}:${doc.name}`),
  }));
  const isPto = s.milestone === "pto";
  return {
    blocking: withReviews.filter(
      ({ doc, review }) =>
        (review?.status === "NOT_UPLOADED" && !isDocWaived(doc, s.deal)) || review?.status === "ACTION_REQUIRED",
    ),
    missing: withReviews.filter(
      ({ doc, review }) =>
        review?.status === "NOT_UPLOADED" && !isDocWaived(doc, s.deal) && !(isPto && PTO_SKIP_DOCS.has(doc.name)),
    ),
    issues: withReviews.filter(
      ({ review }) => review?.status === "ACTION_REQUIRED" || review?.status === "REJECTED",
    ),
  };
}

const CATEGORY_COLORS: Record<ActionCategory, string> = {
  "needs-upload": "border-yellow-500/40 bg-yellow-500/5",
  "action-required": "border-orange-500/40 bg-orange-500/5",
  "rejected": "border-red-500/40 bg-red-500/5",
  "waiting-on-pe": "border-blue-500/40 bg-blue-500/5",
  "approved": "border-green-500/40 bg-green-500/5",
  "no-data": "border-zinc-500/30 bg-zinc-500/5",
};

const CATEGORY_PRIORITY: Record<ActionCategory, number> = {
  "needs-upload": 0,
  "rejected": 1,
  "action-required": 2,
  "waiting-on-pe": 3,
  "no-data": 4,
  "approved": 5,
};

// ---------------------------------------------------------------------------
// Export — turn outstanding docs into shareable CSV / text
// ---------------------------------------------------------------------------

// Map a doc's review status to the same category dimension the screen filter
// uses, so exports can honor an active category filter at the doc level.
function docStatusCategory(status: string | undefined): ActionCategory {
  switch (status) {
    case "ACTION_REQUIRED": return "action-required";
    case "REJECTED": return "rejected";
    case "UNDER_REVIEW":
    case "UPLOADED": return "waiting-on-pe";
    case "APPROVED": return "approved";
    default: return "needs-upload"; // NOT_UPLOADED or no review
  }
}
function docPassesCategoryFilter(status: string | undefined, categoryFilter: string[]): boolean {
  return categoryFilter.length === 0 || categoryFilter.includes(docStatusCategory(status));
}

function docsToExportRows(s: DealDocSummary, docs: DocWithReview[]): PeExportRow[] {
  return docs.map(({ doc, review }) => ({
    proj: parseDealName(s.deal.dealName).proj,
    deal: s.deal.dealName,
    location: s.deal.pbLocation,
    stage: s.deal.dealStageLabel,
    team: TEAM_LABELS[doc.team],
    doc: doc.name,
    status: review ? DOC_STATUS_LABELS[review.status] : "Not Uploaded",
    reason: review?.peComment?.trim() || (review ? cleanPeNote(review.notes) : ""),
    hubspotUrl: s.deal.hubspotUrl,
    portalUrl: s.deal.pePortalUrl ?? "",
    driveUrl: s.deal.driveUrl ?? "",
  }));
}

// All still-outstanding docs for a deal (used by the List view export).
// Honors the active category filter so the export matches what's on screen.
function dealOutstandingRows(s: DealDocSummary, docMap: Map<string, DocReview>, categoryFilter: string[] = []): PeExportRow[] {
  const { blocking, issues } = getDealActionLists(s, docMap);
  const seen = new Set<string>();
  const merged: DocWithReview[] = [];
  for (const d of [...issues, ...blocking]) {
    if (seen.has(d.doc.name)) continue;
    seen.add(d.doc.name);
    if (!docPassesCategoryFilter(d.review?.status, categoryFilter)) continue;
    merged.push(d);
  }
  return docsToExportRows(s, merged);
}

function ExportButtons({ rows, title, filename }: { rows: PeExportRow[]; title: string; filename: string }) {
  const [done, setDone] = useState<null | "copy" | "csv">(null);
  if (rows.length === 0) return null;

  const flash = (which: "copy" | "csv") => {
    setDone(which);
    setTimeout(() => setDone(null), 1500);
  };
  const copy = async () => {
    const text = rowsToText(rows, title);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch { /* no-op */ }
      document.body.removeChild(ta);
    }
    flash("copy");
  };
  const csv = () => {
    const blob = new Blob([rowsToCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    flash("csv");
  };

  const cls =
    "text-[10px] px-1.5 py-0.5 rounded border border-t-border text-muted hover:text-foreground hover:bg-surface-2 transition-colors";
  return (
    <div className="flex items-center gap-1 ml-auto" onClick={(e) => e.stopPropagation()}>
      <button type="button" onClick={copy} className={cls} title="Copy as text — paste into email / chat / a task">
        {done === "copy" ? "Copied ✓" : "Copy"}
      </button>
      <button type="button" onClick={csv} className={cls} title="Download CSV">
        {done === "csv" ? "Saved ✓" : "CSV"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// M1/M2 status badge helpers
// ---------------------------------------------------------------------------

function m1m2Color(status: string | null): string {
  if (!status) return "bg-zinc-500/20 text-zinc-400 border-zinc-500/30";
  const s = status.toLowerCase();
  if (s === "paid") return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
  if (s === "approved") return "bg-green-500/20 text-green-400 border-green-500/30";
  // Internally rejected (our court, pre-PE) — distinct from a real PE rejection.
  if (s === "internally rejected") return "bg-purple-500/20 text-purple-300 border-purple-500/30";
  if (s.includes("rejected")) return "bg-red-500/20 text-red-400 border-red-500/30";
  if (s.includes("ready to resubmit")) return "bg-orange-500/20 text-orange-400 border-orange-500/30";
  if (s === "submitted" || s === "resubmitted" || s.includes("onboarding submitted") || s.includes("onboarding resubmitted"))
    return "bg-blue-500/20 text-blue-400 border-blue-500/30";
  if (s.includes("ready for onboarding")) return "bg-cyan-500/20 text-cyan-400 border-cyan-500/30";
  if (s === "waiting on information") return "bg-yellow-500/20 text-yellow-300 border-yellow-500/30";
  if (s === "ready to submit") return "bg-yellow-500/20 text-yellow-300 border-yellow-500/30";
  return "bg-zinc-500/20 text-zinc-400 border-zinc-500/30";
}

function m1m2Short(status: string | null): string {
  if (!status) return "—";
  // Shorten long onboarding labels
  if (status === "Ready for Onboarding") return "Onb. Ready";
  if (status === "Onboarding Submitted") return "Onb. Submitted";
  if (status === "Onboarding Rejected") return "Onb. Rejected";
  if (status === "Onboarding Ready to Resubmit") return "Onb. Resubmit";
  if (status === "Onboarding Resubmitted") return "Onb. Resubmitted";
  if (status === "Waiting on Information") return "Waiting Info";
  if (status === "Internally Rejected") return "Int. Rejected";
  if (status === "Ready to Resubmit") return "Resubmit";
  if (status === "Ready to Submit") return "Ready";
  return status;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ProgressRing({ approved, total, size = 36 }: { approved: number; total: number; size?: number }) {
  const pct = total > 0 ? approved / total : 0;
  const r = (size - 4) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct);
  return (
    <svg width={size} height={size} className="flex-shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={3}
        className="text-surface-2" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={3}
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
        className={pct === 1 ? "text-green-500" : pct > 0.5 ? "text-emerald-500" : "text-orange-400"}
        transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="central"
        className="fill-foreground text-[9px] font-semibold">
        {total > 0 ? `${Math.round(pct * 100)}` : "—"}
      </text>
    </svg>
  );
}

function MilestoneBadge({ milestone }: { milestone: PeMilestone }) {
  const colors: Record<PeMilestone, string> = {
    "pre-construction": "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
    construction: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
    inspection: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    pto: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    "close-out": "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    complete: "bg-green-500/20 text-green-400 border-green-500/30",
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${colors[milestone]}`}>
      {milestoneLabel(milestone)}
    </span>
  );
}

// Editable deal-level "PE Info Needed" reason (writes pe_info_needed). Always
// shown on the Documents-tab deal rows so it can be set regardless of milestone
// status. Distinct from the per-doc blocker note.
function InfoNeededInline({ dealId, value }: { dealId: string; value: string | null }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  const commit = useCallback(async () => {
    setEditing(false);
    const next = draft.trim();
    if (next === (value ?? "").trim()) return;
    qc.setQueryData<{ deals: PeDeal[]; lastUpdated: string }>(queryKeys.peDeals.list(), (old) =>
      old
        ? { ...old, deals: old.deals.map((d) => (d.dealId === dealId ? { ...d, peInfoNeeded: next || null } : d)) }
        : old,
    );
    try {
      await fetch("/api/accounting/pe-deals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId, field: "pe_info_needed", value: next }),
      });
    } catch {
      qc.invalidateQueries({ queryKey: queryKeys.peDeals.list() });
    }
  }, [draft, value, qc, dealId]);

  if (editing) {
    return (
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Escape") { setDraft(value ?? ""); setEditing(false); } }}
        onClick={(e) => e.stopPropagation()}
        rows={2}
        maxLength={2000}
        placeholder="PE info needed — what are we waiting on, and from whom?"
        className="w-full text-[10px] rounded border border-amber-500/40 bg-surface-2 px-1.5 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500/50 resize-none"
      />
    );
  }

  const has = !!(value && value.trim());
  return (
    <button
      onClick={(e) => { e.stopPropagation(); setDraft(value ?? ""); setEditing(true); }}
      title={has ? `PE info needed: ${value}` : "Add PE info needed"}
      className={`w-full text-left text-[10px] rounded px-1.5 py-0.5 flex items-center gap-1 transition-colors ${
        has
          ? "bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
          : "text-muted/40 hover:text-foreground"
      }`}
    >
      <span className="w-3 h-3 flex-shrink-0 inline-flex items-center justify-center rounded-full border border-current text-[7px] font-semibold">i</span>
      <span className="truncate">{has ? value : "PE info needed"}</span>
    </button>
  );
}

function DocLine({ doc, review }: { doc: DocRequirement; review: DocReview | undefined }) {
  const status = review?.status ?? null;
  const label = status ? DOC_STATUS_LABELS[status] : null;
  const isApproved = status === "APPROVED";
  // Prefer the full open PE reviewer comment (PeActionItem); fall back to the
  // cleaned email/portal note when there's no open action item.
  const peNote = review?.peComment?.trim() || cleanPeNote(review?.notes);

  return (
    <div className="grid grid-cols-12 gap-x-3 gap-y-1 items-center py-1.5">
      <div className="col-span-12 sm:col-span-5 flex items-center gap-1.5 min-w-0">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
          status === "APPROVED" ? "bg-green-500" :
          status === "REJECTED" ? "bg-red-500" :
          status === "ACTION_REQUIRED" ? "bg-orange-500" :
          status === "UNDER_REVIEW" || status === "UPLOADED" ? "bg-blue-500" :
          status === "NOT_UPLOADED" ? "bg-zinc-500" :
          "bg-zinc-700"
        }`} />
        <span className={`text-xs truncate ${isApproved ? "text-muted line-through" : "text-foreground"}`}>{doc.name}</span>
        <span className="text-[9px] text-muted/50 flex-shrink-0">{doc.owner}</span>
      </div>
      <div className="col-span-4 sm:col-span-2 flex items-center">
        {label ? (
          <span className={`text-[10px] rounded border px-1.5 py-0.5 whitespace-nowrap ${DOC_STATUS_COLORS[status!]}`}>{label}</span>
        ) : (
          <span className="text-[10px] text-muted/40">No data</span>
        )}
      </div>
      <div className="col-span-8 sm:col-span-5 min-w-0">
        {peNote ? (
          <span className="text-[10px] text-orange-400/80 line-clamp-2" title={peNote}>PE: {peNote}</span>
        ) : doc.note && !isApproved ? (
          <span className="text-[10px] text-muted/50 line-clamp-2">{doc.note}</span>
        ) : null}
      </div>
    </div>
  );
}

// Shared external-link cluster (HubSpot + PE Portal + Drive)
function DealLinks({ deal, iconClass }: { deal: PeDeal; iconClass: string }) {
  return (
    <div className="flex items-center gap-1">
      <a href={deal.hubspotUrl} target="_blank" rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="text-orange-400/60 hover:text-orange-400 transition-colors" title="HubSpot">
        <svg className={iconClass} viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
        </svg>
      </a>
      {deal.pePortalUrl && (
        <a href={deal.pePortalUrl} target="_blank" rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-emerald-500/60 hover:text-emerald-400 transition-colors"
          title={`PE Portal${deal.peProjectId ? ` — ${deal.peProjectId}` : ""}`}>
          <svg className={iconClass} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
          </svg>
        </a>
      )}
      {deal.driveUrl && (
        <a href={deal.driveUrl} target="_blank" rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-blue-400/60 hover:text-blue-400 transition-colors" title="Google Drive">
          <svg className={iconClass} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
          </svg>
        </a>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// By-Document view: per doc type, how many deals are Missing it vs have an
// Open Rejection on it. Missing excludes moot/waived docs. Each count drills
// into the deals. Built from the milestone-scoped (and filtered) summaries.
// ---------------------------------------------------------------------------
interface DocBreakdownRow { doc: DocRequirement; missing: PeDeal[]; openRej: PeDeal[]; }

function ByDocumentView({ rows }: { rows: DocBreakdownRow[] }) {
  const [drill, setDrill] = useState<{ doc: string; kind: "missing" | "rej" } | null>(null);
  if (rows.length === 0) {
    return <div className="text-center py-12 text-muted">Every owed document is uploaded — nothing missing or rejected.</div>;
  }
  const max = Math.max(...rows.map((r) => Math.max(r.missing.length, r.openRej.length)), 1);
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-[14rem_1fr_1fr] gap-3 px-4 pb-1 text-[10px] uppercase tracking-wide text-muted">
        <span>Document</span>
        <span className="text-yellow-400/80">Missing</span>
        <span className="text-orange-400/80">Open rejections</span>
      </div>
      {rows.map((r) => {
        const open = drill?.doc === r.doc.name ? drill : null;
        const list = open ? (open.kind === "missing" ? r.missing : r.openRej) : [];
        const toggle = (kind: "missing" | "rej", n: number) => {
          if (n === 0) return;
          setDrill((c) => (c && c.doc === r.doc.name && c.kind === kind ? null : { doc: r.doc.name, kind }));
        };
        const seg = (n: number, kind: "missing" | "rej", barCls: string, textCls: string, label: string) => (
          <button type="button" onClick={() => toggle(kind, n)} disabled={n === 0}
            className={`flex items-center gap-2 ${n > 0 ? "cursor-pointer" : "cursor-default opacity-50"}`}>
            <div className="flex-1 h-3.5 rounded bg-surface-2 overflow-hidden min-w-[3rem]">
              <div className={`h-full ${barCls} ${open?.kind === kind ? "ring-1 ring-inset ring-white/30" : ""}`} style={{ width: `${(n / max) * 100}%` }} />
            </div>
            <span className={`text-xs tabular-nums w-16 text-right ${n > 0 ? `${textCls} hover:underline` : "text-muted/50"}`}>{n} {label}</span>
          </button>
        );
        return (
          <div key={r.doc.name} className="rounded-lg border border-border/40 bg-surface/30 px-4 py-2.5">
            <div className="grid grid-cols-[14rem_1fr_1fr] gap-3 items-center">
              <span className="text-sm text-foreground truncate" title={r.doc.name}>{r.doc.name}</span>
              {seg(r.missing.length, "missing", "bg-yellow-500/60", "text-yellow-400", "missing")}
              {seg(r.openRej.length, "rej", "bg-orange-500/70", "text-orange-400", "open")}
            </div>
            {open && (
              <div className={`mt-2 ml-1 rounded-lg border p-2 space-y-1.5 max-h-64 overflow-y-auto ${open.kind === "missing" ? "border-yellow-500/30 bg-yellow-500/5" : "border-orange-500/30 bg-orange-500/5"}`}>
                {list.map((deal) => (
                  <div key={deal.dealId} className="flex items-center gap-2 flex-wrap text-[11px] border-b border-t-border/30 pb-1 last:border-0 last:pb-0">
                    <span className="text-foreground font-medium truncate max-w-[18rem]" title={deal.dealName}>{deal.dealName.split("|").slice(0, 2).join("|").trim()}</span>
                    <span className="text-[10px] text-muted">{deal.pbLocation}</span>
                    <DealLinks deal={deal} iconClass="w-3.5 h-3.5" />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DealCard({ summary, docMap, expanded, onToggle }: {
  summary: DealDocSummary;
  docMap: Map<string, DocReview>;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { deal, milestone, sections, category, csvOnly, csvStatus, csvNotes } = summary;

  // Count actionable items (items Layla needs to address)
  const actionCount = summary.rejected + summary.actionRequired + summary.notUploaded;

  return (
    <div className={`rounded-lg border transition-colors ${CATEGORY_COLORS[category]}`}>
      {/* Header — always visible */}
      <button
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-surface/30 transition-colors"
        onClick={onToggle}
      >
        <ProgressRing approved={summary.approved} total={summary.totalDocs} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground truncate">{deal.dealName}</span>
            <MilestoneBadge milestone={milestone} />
            {actionCount > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30 font-medium">
                {actionCount} to do
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[11px] text-muted">{deal.pbLocation}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${m1m2Color(deal.peM1Status)}`}
              title={`M1: ${deal.peM1Status || "Not started"}`}>
              M1: {m1m2Short(deal.peM1Status)}
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${m1m2Color(deal.peM2Status)}`}
              title={`M2: ${deal.peM2Status || "Not started"}`}>
              M2: {m1m2Short(deal.peM2Status)}
            </span>
            {csvOnly && (
              <span className="text-[10px] text-purple-400/60">CSV only</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* External links */}
          <DealLinks deal={deal} iconClass="w-3.5 h-3.5" />
          {/* Chevron */}
          <svg className={`w-4 h-4 text-muted transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </div>
      </button>

      {/* Deal-level PE Info Needed — always editable inline. */}
      <div className="px-4 py-0.5 border-t border-border/20">
        <InfoNeededInline dealId={deal.dealId} value={deal.peInfoNeeded} />
      </div>

      {/* Expanded doc checklist */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-border/30">
          {csvOnly && csvStatus && (
            <div className="mt-3 p-2 rounded-lg bg-surface-2 text-xs">
              <span className="font-medium text-foreground">Portal Status (CSV): </span>
              <span className={`inline-block rounded border px-1.5 py-0.5 ${DOC_STATUS_COLORS[csvStatus]}`}>
                {DOC_STATUS_LABELS[csvStatus]}
              </span>
              {csvNotes && <span className="ml-2 text-muted">{csvNotes}</span>}
            </div>
          )}
          {!csvOnly && sections.map((sec) => {
            const docs = PE_DOCUMENTS.filter((d) => d.section === sec && dealOwesDoc(d, deal.dealId, docMap));
            const sectionApproved = docs.filter((d) => docMap.get(`${deal.dealId}:${d.name}`)?.status === "APPROVED").length;
            return (
              <div key={sec} className="mt-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-foreground">{SECTION_LABELS[sec]}</span>
                  <span className="text-[10px] text-muted">
                    {sectionApproved}/{docs.length} approved
                  </span>
                </div>
                <div className="divide-y divide-border/20">
                  {docs.map((doc) => (
                    <DocLine key={doc.name} doc={doc} review={docMap.get(`${deal.dealId}:${doc.name}`)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Team view — compact deal row showing only that team's docs
// ---------------------------------------------------------------------------

// Within a team's list, group deals by their most-severe outstanding status.
// PE treats a rejected doc as "Action Required", so there's no separate Rejected
// bucket — REJECTED folds into the Action Required group.
type DealStatusBucket = "action" | "notUploaded";
const TEAM_STATUS_GROUPS: { key: DealStatusBucket; label: string; dot: string; text: string }[] = [
  { key: "action", label: "Action Required", dot: "bg-orange-500", text: "text-orange-400" },
  { key: "notUploaded", label: "Not Uploaded", dot: "bg-zinc-500", text: "text-zinc-400" },
];
// Active-chip styling per bucket (matches the doc-status badge palette).
const BUCKET_ACTIVE_CLASS: Record<DealStatusBucket, string> = {
  action: "bg-orange-500/20 text-orange-400 border-orange-500/40",
  notUploaded: "bg-zinc-500/20 text-zinc-300 border-zinc-500/40",
};
function dealStatusBucket(teamDocs: { doc: DocRequirement; review: DocReview | undefined }[]): DealStatusBucket {
  if (teamDocs.some(({ review }) => review?.status === "ACTION_REQUIRED" || review?.status === "REJECTED")) return "action";
  return "notUploaded"; // remaining actionable docs are not-uploaded (waived ones are excluded upstream)
}

function TeamDealRow({ summary, team, teamActionCount, teamDocs }: {
  summary: DealDocSummary;
  team: DocTeam;
  teamActionCount: number;
  teamDocs: { doc: DocRequirement; review: DocReview | undefined }[];
}) {
  const { deal } = summary;

  // Outstanding docs for this team — always shown inline (no per-deal expand).
  // Action Required / Not Uploaded; REJECTED is treated as Action Required;
  // waived not-uploaded excluded.
  const outstanding = teamDocs.filter(({ doc, review }) => {
    const s = review?.status;
    if (s === "ACTION_REQUIRED" || s === "REJECTED") return true;
    if (s === "NOT_UPLOADED") return !isDocWaived(doc, deal);
    return false;
  });

  return (
    <div className={`rounded-lg border transition-colors ${
      teamActionCount > 0 ? TEAM_BG[team] : "border-border/30 bg-surface/30"
    }`}>
      <div className="w-full flex items-center gap-3 px-3 py-2">
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="text-xs font-medium text-foreground truncate">{deal.dealName}</span>
          {deal.peProjectId && <span className="text-[10px] text-muted/50 flex-shrink-0">{deal.peProjectId}</span>}
          <MilestoneBadge milestone={summary.milestone} />
          {teamActionCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30 font-medium flex-shrink-0">
              {teamActionCount} to do
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Quick doc status dots — at-a-glance incl. approved/in-review */}
          {teamDocs.map(({ doc, review }) => {
            const status = review?.status;
            return (
              <span
                key={doc.name}
                className={`w-2 h-2 rounded-full ${
                  status === "APPROVED" ? "bg-green-500" :
                  status === "REJECTED" || status === "ACTION_REQUIRED" ? "bg-orange-500" :
                  status === "UNDER_REVIEW" || status === "UPLOADED" ? "bg-blue-500" :
                  status === "NOT_UPLOADED" ? "bg-zinc-500" : "bg-zinc-700"
                }`}
                title={`${doc.name}: ${status ? DOC_STATUS_LABELS[status] : "No data"}`}
              />
            );
          })}
          <div className="ml-1">
            <DealLinks deal={deal} iconClass="w-3 h-3" />
          </div>
        </div>
      </div>
      {/* Deal-level PE Info Needed — always editable inline. */}
      <div className="px-3 py-0.5 border-t border-border/10">
        <InfoNeededInline dealId={deal.dealId} value={deal.peInfoNeeded} />
      </div>
      {/* All outstanding docs, always inline (no expand). */}
      {outstanding.length > 0 && (
        <div className="px-3 pb-2 border-t border-border/10">
          <div className="divide-y divide-border/20">
            {outstanding.map(({ doc, review }) => (
              <DocLine key={doc.name} doc={doc} review={review} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section view — email-style row showing only the docs relevant to a section
// (Nearly Complete / Not Uploaded / Action Required)
// ---------------------------------------------------------------------------

function SectionDealRow({ summary, docs, badgeLabel, badgeClass, expanded, onToggle }: {
  summary: DealDocSummary;
  docs: DocWithReview[];
  badgeLabel: string;
  badgeClass: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { deal, milestone } = summary;

  return (
    <div className="rounded-lg border border-border/40 bg-surface/30 transition-colors">
      <button
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-surface/40 transition-colors"
        onClick={onToggle}
      >
        <ProgressRing approved={summary.approved} total={summary.totalDocs} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground truncate">{deal.dealName}</span>
            <MilestoneBadge milestone={milestone} />
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${badgeClass}`}>
              {badgeLabel}
            </span>
          </div>
          <span className="text-[11px] text-muted">{deal.pbLocation}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <DealLinks deal={deal} iconClass="w-3.5 h-3.5" />
          <svg className={`w-4 h-4 text-muted transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </div>
      </button>
      {/* Deal-level PE Info Needed — always editable inline. */}
      <div className="px-4 py-0.5 border-t border-border/20">
        <InfoNeededInline dealId={deal.dealId} value={deal.peInfoNeeded} />
      </div>
      {expanded && (
        <div className="px-4 pb-3 border-t border-border/30">
          <div className="divide-y divide-border/20 mt-1">
            {docs.map(({ doc, review }) => (
              <DocLine key={doc.name} doc={doc} review={review} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

/** A collapsible section group (Nearly Complete / Not Uploaded / Action Required).
 *  Header is the click target; the export buttons sit outside it. */
function CollapsibleSection({ dotClass, title, sub, count, exportRows, exportTitle, exportFilename, collapsed, onToggle, children }: {
  dotClass: string;
  title: string;
  sub: string;
  count: number;
  exportRows: PeExportRow[];
  exportTitle: string;
  exportFilename: string;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <button
          className="flex items-center gap-2 flex-1 min-w-0 text-left hover:opacity-80 transition-opacity"
          onClick={onToggle}
        >
          <span className={`w-2.5 h-2.5 rounded-full ${dotClass}`} />
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <span className="text-xs text-muted">({count})</span>
          <span className="text-[10px] text-muted/60">{sub}</span>
          <svg className={`w-3.5 h-3.5 text-muted transition-transform ${collapsed ? "" : "rotate-180"}`}
            fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
        <ExportButtons rows={exportRows} title={exportTitle} filename={exportFilename} />
      </div>
      {!collapsed && children}
    </div>
  );
}

export default function DocsTab({ tabsSlot }: { tabsSlot?: React.ReactNode }) {
  const { data, isLoading } = useQuery<{ deals: PeDeal[]; lastUpdated: string }>({
    queryKey: queryKeys.peDeals.list(),
    queryFn: () => fetch("/api/accounting/pe-deals").then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  // On visit, kick a throttled incremental PE sync and refresh if it pulled changes.
  usePeAutoSync([queryKeys.peDeals.list()]);

  // Build docMap from the API's docReviews (sourced from peDocumentReview DB)
  const docMap = useMemo(() => {
    const m = new Map<string, DocReview>();
    for (const deal of data?.deals ?? []) {
      for (const dr of deal.docReviews ?? []) {
        const status = dr.status as PeDocStatusValue;
        m.set(`${dr.dealId}:${dr.docName}`, {
          dealId: dr.dealId,
          docName: dr.docName,
          status,
          notes: dr.notes,
          peComment: dr.peComment,
        });
      }
    }
    return m;
  }, [data]);

  // Compute summaries — only deals at milestone stages (PTO+)
  const MILESTONE_STAGES = new Set<PeMilestone>(["pto", "close-out", "complete"]);
  const summaries = useMemo(() => {
    if (!data?.deals) return [];
    return data.deals
      .map((deal) => computeDealDocSummary(deal, docMap))
      .filter((s) => MILESTONE_STAGES.has(s.milestone));
  }, [data, docMap]);

  // Filters
  const [search, setSearch] = useState("");
  const [locFilter, setLocFilter] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [milestoneFilter, setMilestoneFilter] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<"sections" | "list" | "by-team" | "by-document">("sections");
  // Team groups (By-Team view) start collapsed too.
  const [collapsedTeams, setCollapsedTeams] = useState<Set<DocTeam>>(new Set(TEAM_ORDER));
  // Deal rows are collapsed by default; this Set holds the ones the user opened.
  const [expandedDeals, setExpandedDeals] = useState<Set<string>>(new Set());
  // Section groups (Nearly Complete / Not Uploaded / Action Required) start collapsed.
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    new Set(["nearlyComplete", "notUploaded", "actionRequired"]),
  );
  // By-Team bucket filter (empty = show all buckets). Chips at the top of the
  // By-Team view scope it to Rejected / Action Required / Not Uploaded.
  const [bucketFilter, setBucketFilter] = useState<Set<DealStatusBucket>>(new Set());
  // Per-(team, bucket) collapse state, keyed `${team}:${bucketKey}`. Default
  // expanded — a key present here means that bucket section is collapsed.
  const [collapsedTeamBuckets, setCollapsedTeamBuckets] = useState<Set<string>>(new Set());

  const toggleTeam = useCallback((team: DocTeam) => {
    setCollapsedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(team)) next.delete(team);
      else next.add(team);
      return next;
    });
  }, []);

  const toggleSection = useCallback((key: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleDeal = useCallback((id: string) => {
    setExpandedDeals((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleBucketFilter = useCallback((key: DealStatusBucket) => {
    setBucketFilter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleTeamBucket = useCallback((teamBucketKey: string) => {
    setCollapsedTeamBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(teamBucketKey)) next.delete(teamBucketKey);
      else next.add(teamBucketKey);
      return next;
    });
  }, []);

  const filterOptions = useMemo(() => {
    const locations = [...new Set(summaries.map((s) => s.deal.pbLocation).filter(Boolean))].sort();
    return { locations };
  }, [summaries]);

  // Search + location + milestone filters (shared by sections and category views)
  const baseFiltered = useMemo(() => {
    return summaries.filter((s) => {
      if (search) {
        const q = search.toLowerCase();
        if (
          !s.deal.dealName.toLowerCase().includes(q) &&
          !s.deal.pbLocation.toLowerCase().includes(q) &&
          !(s.deal.peProjectId?.toLowerCase().includes(q))
        ) return false;
      }
      if (locFilter.length > 0 && !locFilter.includes(s.deal.pbLocation)) return false;
      if (milestoneFilter.length > 0 && !milestoneFilter.includes(s.milestone)) return false;
      return true;
    });
  }, [summaries, search, locFilter, milestoneFilter]);

  // Category filter only applies to the category-based List/By-Team views
  const filtered = useMemo(() => {
    if (categoryFilter.length === 0) return baseFiltered;
    return baseFiltered.filter((s) => categoryFilter.includes(s.category));
  }, [baseFiltered, categoryFilter]);

  // Email-style actionable sections (mirrors the pe-doc-digest cron)
  const emailSections = useMemo(() => {
    const nearlyComplete: { summary: DealDocSummary; docs: DocWithReview[] }[] = [];
    const notUploaded: { summary: DealDocSummary; docs: DocWithReview[] }[] = [];
    const actionRequired: { summary: DealDocSummary; docs: DocWithReview[] }[] = [];

    for (const s of baseFiltered) {
      const { blocking, missing, issues } = getDealActionLists(s, docMap);

      // Nearly Complete: 1–3 blocking docs and almost the full doc set present
      if (blocking.length >= 1 && blocking.length <= 3 && s.totalDocs >= TOTAL_DOCS_PER_DEAL - 3) {
        nearlyComplete.push({ summary: s, docs: blocking });
      }
      if (missing.length > 0) notUploaded.push({ summary: s, docs: missing });
      if (issues.length > 0) actionRequired.push({ summary: s, docs: issues });
    }

    // Nearly Complete: most-approved first (closest to done)
    nearlyComplete.sort((a, b) =>
      b.summary.approved - a.summary.approved ||
      a.summary.deal.dealName.localeCompare(b.summary.deal.dealName));
    // Not Uploaded: most missing docs first
    notUploaded.sort((a, b) =>
      b.docs.length - a.docs.length ||
      a.summary.deal.dealName.localeCompare(b.summary.deal.dealName));
    // Action Required: most issues first
    actionRequired.sort((a, b) =>
      b.docs.length - a.docs.length ||
      a.summary.deal.dealName.localeCompare(b.summary.deal.dealName));

    return { nearlyComplete, notUploaded, actionRequired };
  }, [baseFiltered, docMap]);

  // Sort: category priority, then by "to do" count (least first), then deal name
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const catDiff = CATEGORY_PRIORITY[a.category] - CATEGORY_PRIORITY[b.category];
      if (catDiff !== 0) return catDiff;
      // Within same category, sort by action count ascending (least to do first)
      const aTodo = a.rejected + a.actionRequired + a.notUploaded;
      const bTodo = b.rejected + b.actionRequired + b.notUploaded;
      if (aTodo !== bTodo) return aTodo - bTodo;
      return a.deal.dealName.localeCompare(b.deal.dealName);
    });
  }, [filtered]);

  // By-document breakdown: per doc type, deals Missing it (excl. moot) vs with
  // an Open Rejection. Built from the filtered, milestone-scoped summaries.
  const byDocument = useMemo<DocBreakdownRow[]>(() => {
    const map = new Map<string, DocBreakdownRow>();
    for (const d of PE_DOCUMENTS) map.set(d.name, { doc: d, missing: [], openRej: [] });
    for (const s of filtered) {
      for (const doc of PE_DOCUMENTS) {
        if (!s.sections.includes(doc.section)) continue; // deal doesn't owe this doc yet
        if (!dealOwesDoc(doc, s.deal.dealId, docMap)) continue; // conditional doc PE didn't include
        const status = docMap.get(`${s.deal.dealId}:${doc.name}`)?.status ?? "NOT_UPLOADED";
        const e = map.get(doc.name)!;
        if (status === "NOT_UPLOADED") { if (!isDocWaived(doc, s.deal)) e.missing.push(s.deal); }
        else if (status === "ACTION_REQUIRED" || status === "REJECTED") e.openRej.push(s.deal);
      }
    }
    return [...map.values()]
      .filter((e) => e.missing.length + e.openRej.length > 0)
      .sort((a, b) => (b.missing.length + b.openRej.length) - (a.missing.length + a.openRej.length));
  }, [filtered, docMap]);

  // Group by team — for each team, find deals with outstanding docs owned by that team
  const teamGrouped = useMemo(() => {
    return TEAM_ORDER.map((team) => {
      const teamDocs = PE_DOCUMENTS.filter((d) => d.team === team);
      const dealsWithIssues: { summary: DealDocSummary; teamActionCount: number; teamDocs: { doc: DocRequirement; review: DocReview | undefined }[] }[] = [];

      for (const s of sorted) {
        const relevantDocs = teamDocs.filter((d) => s.sections.includes(d.section) && dealOwesDoc(d, s.deal.dealId, docMap));
        if (relevantDocs.length === 0) continue;

        let teamActionCount = 0;
        const docsWithReviews: { doc: DocRequirement; review: DocReview | undefined }[] = [];

        for (const doc of relevantDocs) {
          const review = docMap.get(`${s.deal.dealId}:${doc.name}`);
          const status = review?.status;
          const waived = status === "NOT_UPLOADED" && isDocWaived(doc, s.deal);
          if (status && status !== "APPROVED" && status !== "UNDER_REVIEW" && status !== "UPLOADED" && status !== "NOT_REQUIRED" && !waived) {
            teamActionCount++;
          }
          docsWithReviews.push({ doc, review });
        }

        // Only show deals where this team actually has something to do
        if (teamActionCount === 0) continue;

        dealsWithIssues.push({ summary: s, teamActionCount, teamDocs: docsWithReviews });
      }

      // Sort: deals with action items first, then by action count desc
      dealsWithIssues.sort((a, b) => {
        if (a.teamActionCount !== b.teamActionCount) return b.teamActionCount - a.teamActionCount;
        return a.summary.deal.dealName.localeCompare(b.summary.deal.dealName);
      });

      const totalActionable = dealsWithIssues.reduce((sum, d) => sum + d.teamActionCount, 0);
      const totalApproved = dealsWithIssues.reduce((sum, d) => {
        return sum + d.teamDocs.filter((td) => td.review?.status === "APPROVED").length;
      }, 0);
      const totalDocs = dealsWithIssues.reduce((sum, d) => sum + d.teamDocs.length, 0);

      return { team, dealsWithIssues, totalActionable, totalApproved, totalDocs };
    }).filter((g) => g.dealsWithIssues.length > 0);
  }, [sorted, docMap]);

  // Deal counts per status bucket across all teams — drives the chip labels.
  const bucketCounts = useMemo(() => {
    const c: Record<DealStatusBucket, { deals: number; docs: number }> = {
      action: { deals: 0, docs: 0 },
      notUploaded: { deals: 0, docs: 0 },
    };
    for (const g of teamGrouped) {
      for (const d of g.dealsWithIssues) {
        // deals = one By-Team worklist row, bucketed by its most-severe status.
        c[dealStatusBucket(d.teamDocs)].deals++;
        // docs = outstanding docs counted by their OWN status (so the totals
        // match the doc-level stat cards — an Action Required row can still hold
        // not-uploaded docs).
        for (const { doc, review } of d.teamDocs) {
          const st = review?.status;
          if (st === "ACTION_REQUIRED" || st === "REJECTED") c.action.docs++;
          else if (st === "NOT_UPLOADED" && !isDocWaived(doc, d.summary.deal)) c.notUploaded.docs++;
        }
      }
    }
    return c;
  }, [teamGrouped]);

  // Apply the bucket-chip filter: per team, keep only the selected (and
  // non-empty) status buckets; drop teams left with nothing to show.
  const byTeamVisible = useMemo(() => {
    return teamGrouped
      .map((g) => {
        const buckets = TEAM_STATUS_GROUPS.filter(
          (b) => bucketFilter.size === 0 || bucketFilter.has(b.key),
        )
          .map((b) => ({
            bucket: b,
            items: g.dealsWithIssues.filter(
              ({ teamDocs }) => dealStatusBucket(teamDocs) === b.key,
            ),
          }))
          .filter((x) => x.items.length > 0);
        return { ...g, buckets };
      })
      .filter((g) => g.buckets.length > 0);
  }, [teamGrouped, bucketFilter]);

  // Aggregate stats
  const stats = useMemo(() => {
    const total = summaries.length;
    const totalDocs = summaries.reduce((s, d) => s + d.totalDocs, 0);
    const totalApproved = summaries.reduce((s, d) => s + d.approved, 0);
    const totalRejected = summaries.reduce((s, d) => s + d.rejected, 0);
    const totalActionReq = summaries.reduce((s, d) => s + d.actionRequired, 0);
    const totalNotUploaded = summaries.reduce((s, d) => s + d.notUploaded, 0);
    const totalUnderReview = summaries.reduce((s, d) => s + d.underReview, 0);
    const allApprovedDeals = summaries.filter((s) => s.category === "approved").length;
    const actionableDeals = summaries.filter((s) =>
      s.category === "rejected" || s.category === "action-required" || s.category === "needs-upload"
    ).length;
    const totalDecided = totalApproved + totalRejected + totalActionReq;
    return {
      total, totalDocs, totalApproved, totalRejected, totalActionReq,
      totalNotUploaded, totalUnderReview, totalDecided, allApprovedDeals, actionableDeals,
    };
  }, [summaries]);

  // Record today's card numbers once per visit (the endpoint dedupes per day)
  // so "what were these N days ago" becomes an exact lookup. Posts the exact
  // computed stats, so the history always matches the cards.
  const snapshotPosted = useRef(false);
  useEffect(() => {
    if (snapshotPosted.current || isLoading || !data || stats.total === 0) return;
    snapshotPosted.current = true;
    fetch("/api/accounting/pe-metrics-snapshot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: new Date().toISOString().slice(0, 10),
        peDeals: stats.total,
        actionable: stats.actionableDeals,
        inReview: stats.totalUnderReview,
        allDocsApproved: stats.allApprovedDeals,
        approvalRate: stats.totalDecided > 0 ? Math.round((stats.totalApproved / stats.totalDecided) * 100) : null,
        approved: stats.totalApproved,
        notUploaded: stats.totalNotUploaded,
        actionRequired: stats.totalActionReq + stats.totalRejected,
      }),
    }).catch(() => {});
  }, [isLoading, data, stats]);

  const hasFilters = search || locFilter.length > 0 || categoryFilter.length > 0 || milestoneFilter.length > 0;

  const clearFilters = useCallback(() => {
    setSearch("");
    setLocFilter([]);
    setCategoryFilter([]);
    setMilestoneFilter([]);
    setBucketFilter(new Set());
  }, []);

  // Deal IDs visible in the active view, for the Expand/Collapse-all control.
  const visibleDealIds = useMemo(() => {
    if (viewMode === "sections") {
      return [
        ...emailSections.nearlyComplete,
        ...emailSections.notUploaded,
        ...emailSections.actionRequired,
      ].map(({ summary }) => summary.deal.dealId);
    }
    if (viewMode === "list") return sorted.map((s) => s.deal.dealId);
    return [];
  }, [viewMode, emailSections, sorted]);

  // The toggle opens/closes whatever the active view groups by: sections view →
  // the three groups; by-team view → the team groups; list view → the deal rows.
  const teamKeys = useMemo(() => byTeamVisible.map((g) => g.team), [byTeamVisible]);
  const allExpanded = viewMode === "sections"
    ? SECTION_KEYS.every((k) => !collapsedSections.has(k))
    : viewMode === "by-team"
      ? teamKeys.length > 0 && teamKeys.every((t) => !collapsedTeams.has(t))
      : visibleDealIds.length > 0 && visibleDealIds.every((id) => expandedDeals.has(id));
  const toggleAll = useCallback(() => {
    if (viewMode === "sections") {
      setCollapsedSections(allExpanded ? new Set(SECTION_KEYS) : new Set());
    } else if (viewMode === "by-team") {
      setCollapsedTeams(allExpanded ? new Set(teamKeys) : new Set());
    } else {
      setExpandedDeals(allExpanded ? new Set() : new Set(visibleDealIds));
    }
  }, [viewMode, allExpanded, visibleDealIds, teamKeys]);

  return (
    <DashboardShell title="PE Document Tracker" accentColor="emerald" lastUpdated={data?.lastUpdated} fullWidth>
      {tabsSlot}
      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <StatCard label="PE Deals" value={isLoading ? null : stats.total} color="emerald" />
        <StatCard
          label="Actionable"
          value={isLoading ? null : stats.actionableDeals}
          subtitle="Deals needing PB action"
          color={stats.actionableDeals > 0 ? "orange" : "green"}
        />
        <StatCard
          label="In Review"
          value={isLoading ? null : stats.totalUnderReview}
          subtitle="Waiting on PE"
          color="blue"
        />
        <StatCard
          label="All Docs Approved"
          value={isLoading ? null : stats.allApprovedDeals}
          subtitle={stats.total > 0 ? `${Math.round((stats.allApprovedDeals / stats.total) * 100)}% of deals` : undefined}
          color="green"
        />
        <StatCard
          label="Approval Rate"
          value={isLoading ? null : stats.totalDecided > 0 ? `${Math.round((stats.totalApproved / stats.totalDecided) * 100)}%` : "—"}
          subtitle={`${stats.totalApproved} of ${stats.totalDecided} decided`}
          color="emerald"
        />
      </div>

      {/* Doc status breakdown */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-6">
        <MiniStat label="Approved" value={stats.totalApproved} />
        <MiniStat label="In Review" value={stats.totalUnderReview} />
        <MiniStat label="Not Uploaded" value={stats.totalNotUploaded} />
        {/* PE has no separate "Rejected" doc status — it's Action Required. */}
        <MiniStat label="Action Required" value={stats.totalActionReq + stats.totalRejected} />
      </div>

      {/* Daily snapshot history — "what were these numbers N days ago" */}
      <MetricsTrendPanel />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          type="text"
          placeholder="Search deals..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-1.5 rounded-lg bg-surface-2 border border-border text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-emerald-500/50 w-48"
        />
        <MultiSelectFilter
          label="Location"
          options={filterOptions.locations.map((l) => ({ value: l, label: l }))}
          selected={locFilter}
          onChange={setLocFilter}
        />
        <MultiSelectFilter
          label="Status"
          options={[
            { value: "action-required", label: "Action Required" },
            { value: "needs-upload", label: "Needs Upload" },
            { value: "waiting-on-pe", label: "Waiting on PE" },
            { value: "approved", label: "All Approved" },
            { value: "no-data", label: "No Data" },
          ]}
          selected={categoryFilter}
          onChange={setCategoryFilter}
        />
        <MultiSelectFilter
          label="Milestone"
          options={[
            { value: "pto", label: "PTO" },
            { value: "close-out", label: "Close Out" },
            { value: "complete", label: "Complete" },
          ]}
          selected={milestoneFilter}
          onChange={setMilestoneFilter}
        />
        {hasFilters && (
          <button onClick={clearFilters} className="text-xs text-muted hover:text-foreground transition-colors">
            Clear filters
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1 bg-surface-2 rounded-lg p-0.5 border border-border">
            {(["sections", "list", "by-team", "by-document"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-2.5 py-1 rounded text-xs transition-colors ${
                  viewMode === mode ? "bg-emerald-500/20 text-emerald-400" : "text-muted hover:text-foreground"
                }`}
              >
                {mode === "sections" ? "Sections" : mode === "list" ? "List" : mode === "by-team" ? "By Team" : "By Document"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Results count */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="text-xs text-muted">
          {viewMode === "sections" ? (
            `${emailSections.nearlyComplete.length} nearly complete · ${emailSections.notUploaded.length} not uploaded · ${emailSections.actionRequired.length} need action`
          ) : filtered.length === summaries.length ? (
            `${summaries.length} deals`
          ) : (
            `${filtered.length} of ${summaries.length} deals`
          )}
        </div>
        {(viewMode === "by-team" ? teamKeys.length > 0 : visibleDealIds.length > 0) && (
          <button
            onClick={toggleAll}
            className="text-xs text-muted hover:text-foreground transition-colors whitespace-nowrap"
          >
            {allExpanded ? "Collapse all" : "Expand all"}
          </button>
        )}
      </div>

      {/* Deal cards */}
      {isLoading && (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 rounded-lg bg-surface-2 animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && viewMode === "sections" && (
        <div className="space-y-5">
          {/* Nearly Complete */}
          <CollapsibleSection
            dotClass="bg-emerald-400"
            title="Nearly Complete"
            sub="1–3 docs from done"
            count={emailSections.nearlyComplete.length}
            exportRows={emailSections.nearlyComplete.flatMap(({ summary, docs }) => docsToExportRows(summary, docs))}
            exportTitle="PE — Nearly Complete"
            exportFilename="pe-nearly-complete.csv"
            collapsed={collapsedSections.has("nearlyComplete")}
            onToggle={() => toggleSection("nearlyComplete")}
          >
            {emailSections.nearlyComplete.length === 0 ? (
              <div className="text-xs text-muted/60 px-1 py-2">No deals nearly complete.</div>
            ) : (
              <div className="space-y-1.5">
                {emailSections.nearlyComplete.map(({ summary: s, docs }) => (
                  <SectionDealRow
                    key={s.deal.dealId}
                    summary={s}
                    docs={docs}
                    badgeLabel={`${docs.length} to finish`}
                    badgeClass="bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                    expanded={expandedDeals.has(s.deal.dealId)}
                    onToggle={() => toggleDeal(s.deal.dealId)}
                  />
                ))}
              </div>
            )}
          </CollapsibleSection>

          {/* Not Uploaded */}
          <CollapsibleSection
            dotClass="bg-yellow-400"
            title="Not Uploaded"
            sub="PB needs to upload"
            count={emailSections.notUploaded.length}
            exportRows={emailSections.notUploaded.flatMap(({ summary, docs }) => docsToExportRows(summary, docs))}
            exportTitle="PE — Not Uploaded"
            exportFilename="pe-not-uploaded.csv"
            collapsed={collapsedSections.has("notUploaded")}
            onToggle={() => toggleSection("notUploaded")}
          >
            {emailSections.notUploaded.length === 0 ? (
              <div className="text-xs text-muted/60 px-1 py-2">Nothing missing uploads.</div>
            ) : (
              <div className="space-y-1.5">
                {emailSections.notUploaded.map(({ summary: s, docs }) => (
                  <SectionDealRow
                    key={s.deal.dealId}
                    summary={s}
                    docs={docs}
                    badgeLabel={`${docs.length} missing`}
                    badgeClass="bg-yellow-500/20 text-yellow-300 border-yellow-500/30"
                    expanded={expandedDeals.has(s.deal.dealId)}
                    onToggle={() => toggleDeal(s.deal.dealId)}
                  />
                ))}
              </div>
            )}
          </CollapsibleSection>

          {/* Action Required */}
          <CollapsibleSection
            dotClass="bg-orange-400"
            title="Action Required"
            sub="Rejections & fixes"
            count={emailSections.actionRequired.length}
            exportRows={emailSections.actionRequired.flatMap(({ summary, docs }) => docsToExportRows(summary, docs))}
            exportTitle="PE — Action Required"
            exportFilename="pe-action-required.csv"
            collapsed={collapsedSections.has("actionRequired")}
            onToggle={() => toggleSection("actionRequired")}
          >
            {emailSections.actionRequired.length === 0 ? (
              <div className="text-xs text-muted/60 px-1 py-2">No rejections or action items.</div>
            ) : (
              <div className="space-y-1.5">
                {emailSections.actionRequired.map(({ summary: s, docs }) => (
                  <SectionDealRow
                    key={s.deal.dealId}
                    summary={s}
                    docs={docs}
                    badgeLabel={docs.length === 1 ? "1 rejection" : `${docs.length} rejections`}
                    badgeClass="bg-orange-500/20 text-orange-400 border-orange-500/30"
                    expanded={expandedDeals.has(s.deal.dealId)}
                    onToggle={() => toggleDeal(s.deal.dealId)}
                  />
                ))}
              </div>
            )}
          </CollapsibleSection>
        </div>
      )}

      {!isLoading && viewMode === "list" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-muted">{sorted.length} deal{sorted.length === 1 ? "" : "s"}</span>
            <ExportButtons
              rows={sorted.flatMap((s) => dealOutstandingRows(s, docMap, categoryFilter))}
              title="PE — Document Worklist"
              filename="pe-worklist.csv"
            />
          </div>
          {sorted.map((s) => (
            <DealCard
              key={s.deal.dealId}
              summary={s}
              docMap={docMap}
              expanded={expandedDeals.has(s.deal.dealId)}
              onToggle={() => toggleDeal(s.deal.dealId)}
            />
          ))}
        </div>
      )}

      {!isLoading && viewMode === "by-team" && (
        <>
          {/* Bucket filter chips — scope every team group to these statuses */}
          <div className="flex flex-wrap items-center gap-1.5 mb-4">
            <span className="text-[11px] text-muted mr-0.5">Show:</span>
            {TEAM_STATUS_GROUPS.map((g) => {
              const active = bucketFilter.has(g.key);
              const count = bucketCounts[g.key];
              return (
                <button
                  key={g.key}
                  onClick={() => toggleBucketFilter(g.key)}
                  disabled={count.deals === 0}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    active ? BUCKET_ACTIVE_CLASS[g.key] : "border-border text-muted hover:text-foreground hover:border-foreground/30"
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${g.dot}`} />
                  {g.label}
                  <span className="opacity-60">{count.deals} deals · {count.docs} docs</span>
                </button>
              );
            })}
            {bucketFilter.size > 0 && (
              <button
                onClick={() => setBucketFilter(new Set())}
                className="text-[11px] text-muted hover:text-foreground transition-colors ml-1"
              >
                Show all
              </button>
            )}
          </div>

          <div className="space-y-6">
            {byTeamVisible.map(({ team, dealsWithIssues, totalApproved, totalDocs, buckets }) => {
              const collapsed = collapsedTeams.has(team);
              // "to do" reflects only the buckets currently visible after filtering.
              const visibleActionable = buckets.reduce(
                (sum, { items }) => sum + items.reduce((s, it) => s + it.teamActionCount, 0),
                0,
              );
              const visibleDealCount = buckets.reduce((sum, { items }) => sum + items.length, 0);
              return (
                <div key={team}>
                  <div className="flex items-center gap-2 mb-3">
                  <button
                    className="flex items-center gap-2 flex-1 min-w-0 text-left hover:opacity-80 transition-opacity"
                    onClick={() => toggleTeam(team)}
                  >
                    <span className={`w-2.5 h-2.5 rounded-full ${TEAM_DOT[team]}`} />
                    <h3 className={`text-sm font-semibold ${TEAM_COLORS[team]}`}>{TEAM_LABELS[team]}</h3>
                    <span className="text-xs text-muted">
                      {visibleDealCount} deals
                    </span>
                    <span className="text-[10px] text-muted/60">
                      {totalApproved}/{totalDocs} approved
                    </span>
                    {visibleActionable > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30 font-medium">
                        {visibleActionable} to do
                      </span>
                    )}
                    <svg className={`w-3.5 h-3.5 text-muted transition-transform ${collapsed ? "" : "rotate-180"}`}
                      fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                    </svg>
                  </button>
                  <ExportButtons
                    rows={dealsWithIssues.flatMap(({ summary, teamDocs }) =>
                      docsToExportRows(
                        summary,
                        teamDocs.filter(({ doc, review }) =>
                          !!review && review.status !== "APPROVED" && review.status !== "UNDER_REVIEW" && review.status !== "UPLOADED"
                          && review.status !== "NOT_REQUIRED"
                          && !(review.status === "NOT_UPLOADED" && isDocWaived(doc, summary.deal))
                          && docPassesCategoryFilter(review.status, categoryFilter),
                        ),
                      ),
                    )}
                    title={`PE — ${TEAM_LABELS[team]}`}
                    filename={`pe-${team}.csv`}
                  />
                  </div>
                  {!collapsed && (
                    <div className="space-y-3">
                      {buckets.map(({ bucket: g, items }) => {
                        const bucketKey = `${team}:${g.key}`;
                        const bucketCollapsed = collapsedTeamBuckets.has(bucketKey);
                        const bucketDocs = items.reduce((sum, it) => sum + it.teamActionCount, 0);
                        return (
                          <div key={g.key} className="space-y-1.5">
                            <button
                              className="flex items-center gap-1.5 px-1 w-full text-left hover:opacity-80 transition-opacity"
                              onClick={() => toggleTeamBucket(bucketKey)}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${g.dot}`} />
                              <span className={`text-[10px] uppercase tracking-wide font-medium ${g.text}`}>{g.label}</span>
                              <span className="text-[10px] text-muted">{items.length} {items.length === 1 ? "deal" : "deals"} · {bucketDocs} {bucketDocs === 1 ? "doc" : "docs"}</span>
                              <svg className={`w-3 h-3 text-muted transition-transform ${bucketCollapsed ? "" : "rotate-180"}`}
                                fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                              </svg>
                            </button>
                            {!bucketCollapsed && items.map(({ summary: s, teamActionCount, teamDocs: tDocs }) => (
                              <TeamDealRow
                                key={s.deal.dealId}
                                summary={s}
                                team={team}
                                teamActionCount={teamActionCount}
                                teamDocs={tDocs}
                              />
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {byTeamVisible.length === 0 && (
            <div className="text-center py-12 text-muted">
              {hasFilters || bucketFilter.size > 0
                ? "No deals match the current filters."
                : "No PE deals found."}
            </div>
          )}
        </>
      )}

      {!isLoading && viewMode === "by-document" && filtered.length > 0 && (
        <ByDocumentView rows={byDocument} />
      )}

      {!isLoading && viewMode !== "sections" && viewMode !== "by-team" && filtered.length === 0 && (
        <div className="text-center py-12 text-muted">
          {hasFilters ? "No deals match the current filters." : "No PE deals found."}
        </div>
      )}
    </DashboardShell>
  );
}
