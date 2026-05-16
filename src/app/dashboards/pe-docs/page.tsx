"use client";

import { useState, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { StatCard, MiniStat } from "@/components/ui/MetricCard";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import { queryKeys } from "@/lib/query-keys";

// ---------------------------------------------------------------------------
// Types (mirrors pe-report API shape)
// ---------------------------------------------------------------------------

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
  hubspotUrl: string;
  pePortalUrl: string | null;
  peProjectId: string | null;
}

interface DocReview {
  id: string;
  dealId: string;
  docName: string;
  status: PeDocStatusValue;
  notes: string | null;
  reviewedAt: string;
  reviewedBy: string | null;
}

type PeDocStatusValue =
  | "NOT_UPLOADED"
  | "UPLOADED"
  | "UNDER_REVIEW"
  | "ACTION_REQUIRED"
  | "REJECTED"
  | "APPROVED";

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
  { name: "Signed Final Permit", section: "ic", owner: "PB", team: "permit" },
  { name: "Access to Monitoring", section: "ic", owner: "PB", team: "operations", note: "Monitoring platform credentials" },
  { name: "Certificate of Acceptance", section: "ic", owner: "PB", team: "compliance" },
  { name: "Attestation of Customer Payment", section: "ic", owner: "PB", team: "compliance" },
  { name: "Conditional Progress Lien Waiver", section: "ic", owner: "PB", team: "accounting" },
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
    case "inspection":
      return ["onboarding", "ic"];
    case "pto":
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
  UPLOADED: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  UNDER_REVIEW: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  ACTION_REQUIRED: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  REJECTED: "bg-red-500/20 text-red-400 border-red-500/30",
  APPROVED: "bg-green-500/20 text-green-400 border-green-500/30",
};

const DOC_STATUS_LABELS: Record<PeDocStatusValue, string> = {
  NOT_UPLOADED: "Not Uploaded",
  UPLOADED: "Uploaded",
  UNDER_REVIEW: "Under Review",
  ACTION_REQUIRED: "Action Required",
  REJECTED: "Rejected",
  APPROVED: "Approved",
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
  noData: number;
  category: ActionCategory;
  csvOnly: boolean;
  csvStatus: PeDocStatusValue | null;
  csvNotes: string | null;
}

function computeDealDocSummary(
  deal: PeDeal,
  docMap: Map<string, DocReview>,
): DealDocSummary {
  const milestone = dealStageToPeMilestone(deal.dealStageLabel);
  const sections = milestoneDocSections(milestone);
  const docs = PE_DOCUMENTS.filter((d) => sections.includes(d.section));

  let approved = 0, rejected = 0, actionRequired = 0, underReview = 0, notUploaded = 0, noData = 0;
  for (const doc of docs) {
    const review = docMap.get(`${deal.dealId}:${doc.name}`);
    if (!review) { noData++; continue; }
    switch (review.status) {
      case "APPROVED": approved++; break;
      case "REJECTED": rejected++; break;
      case "ACTION_REQUIRED": actionRequired++; break;
      case "UNDER_REVIEW": underReview++; break;
      case "NOT_UPLOADED": notUploaded++; break;
      case "UPLOADED": underReview++; break;
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
  } else if (approved === docs.length) {
    category = "approved";
  } else {
    category = "waiting-on-pe";
  }

  return {
    deal, milestone, sections,
    totalDocs: docs.length,
    approved, rejected, actionRequired, underReview, notUploaded, noData,
    category,
    csvOnly,
    csvStatus: csvRow?.status ?? null,
    csvNotes: csvRow?.notes ?? null,
  };
}

const CATEGORY_LABELS: Record<ActionCategory, string> = {
  "needs-upload": "PB Needs to Upload",
  "action-required": "Action Required",
  "rejected": "Rejected — Fix & Resubmit",
  "waiting-on-pe": "Waiting on PE Review",
  "approved": "All Approved",
  "no-data": "No Portal Data",
};

const CATEGORY_COLORS: Record<ActionCategory, string> = {
  "needs-upload": "border-yellow-500/40 bg-yellow-500/5",
  "action-required": "border-orange-500/40 bg-orange-500/5",
  "rejected": "border-red-500/40 bg-red-500/5",
  "waiting-on-pe": "border-blue-500/40 bg-blue-500/5",
  "approved": "border-green-500/40 bg-green-500/5",
  "no-data": "border-zinc-500/30 bg-zinc-500/5",
};

const CATEGORY_DOT: Record<ActionCategory, string> = {
  "needs-upload": "bg-yellow-400",
  "action-required": "bg-orange-400",
  "rejected": "bg-red-400",
  "waiting-on-pe": "bg-blue-400",
  "approved": "bg-green-400",
  "no-data": "bg-zinc-500",
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
// M1/M2 status badge helpers
// ---------------------------------------------------------------------------

function m1m2Color(status: string | null): string {
  if (!status) return "bg-zinc-500/20 text-zinc-400 border-zinc-500/30";
  const s = status.toLowerCase();
  if (s === "paid") return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
  if (s === "approved") return "bg-green-500/20 text-green-400 border-green-500/30";
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

function DocLine({ doc, review }: { doc: DocRequirement; review: DocReview | undefined }) {
  const status = review?.status ?? null;
  const label = status ? DOC_STATUS_LABELS[status] : null;
  const isApproved = status === "APPROVED";

  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <span className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${
        status === "APPROVED" ? "bg-green-500" :
        status === "REJECTED" ? "bg-red-500" :
        status === "ACTION_REQUIRED" ? "bg-orange-500" :
        status === "UNDER_REVIEW" || status === "UPLOADED" ? "bg-blue-500" :
        status === "NOT_UPLOADED" ? "bg-zinc-500" :
        "bg-zinc-700"
      }`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`text-xs ${isApproved ? "text-muted line-through" : "text-foreground"}`}>
            {doc.name}
          </span>
          <span className="text-[9px] text-muted/50">{doc.owner}</span>
        </div>
        {doc.note && !isApproved && (
          <div className="text-[10px] text-muted/60 mt-0.5">{doc.note}</div>
        )}
        {review?.notes && (
          <div className="text-[10px] text-orange-400/80 mt-0.5">PE: {review.notes}</div>
        )}
      </div>
      {label ? (
        <span className={`text-[10px] rounded border px-1.5 py-0.5 whitespace-nowrap ${DOC_STATUS_COLORS[status!]}`}>
          {label}
        </span>
      ) : (
        <span className="text-[10px] text-muted/40">No data</span>
      )}
    </div>
  );
}

function DealCard({ summary, docMap, defaultExpanded }: {
  summary: DealDocSummary;
  docMap: Map<string, DocReview>;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const { deal, milestone, sections, category, csvOnly, csvStatus, csvNotes } = summary;

  // Count actionable items (items Layla needs to address)
  const actionCount = summary.rejected + summary.actionRequired + summary.notUploaded;

  return (
    <div className={`rounded-lg border transition-colors ${CATEGORY_COLORS[category]}`}>
      {/* Header — always visible */}
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
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
            {deal.peProjectId && (
              <span className="text-[10px] text-muted/50">{deal.peProjectId}</span>
            )}
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
          {/* Quick status dots */}
          <div className="flex items-center gap-1" title={`${summary.approved} approved · ${summary.underReview} in review · ${summary.notUploaded} not uploaded · ${summary.actionRequired} action required · ${summary.rejected} rejected`}>
            {summary.approved > 0 && <span className="text-[10px] text-green-400">{summary.approved}✓</span>}
            {summary.underReview > 0 && <span className="text-[10px] text-blue-400">{summary.underReview}⟳</span>}
            {(summary.notUploaded + summary.actionRequired + summary.rejected) > 0 && (
              <span className="text-[10px] text-orange-400">{summary.notUploaded + summary.actionRequired + summary.rejected}!</span>
            )}
          </div>
          {/* External links */}
          <div className="flex items-center gap-1">
            <a href={deal.hubspotUrl} target="_blank" rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-orange-400/60 hover:text-orange-400 transition-colors" title="HubSpot">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
              </svg>
            </a>
            {deal.pePortalUrl && (
              <a href={deal.pePortalUrl} target="_blank" rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-emerald-500/60 hover:text-emerald-400 transition-colors"
                title={`PE Portal${deal.peProjectId ? ` — ${deal.peProjectId}` : ""}`}>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                </svg>
              </a>
            )}
          </div>
          {/* Chevron */}
          <svg className={`w-4 h-4 text-muted transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </div>
      </button>

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
            const docs = PE_DOCUMENTS.filter((d) => d.section === sec);
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

function TeamDealRow({ summary, team, teamActionCount, teamDocs }: {
  summary: DealDocSummary;
  team: DocTeam;
  teamActionCount: number;
  teamDocs: { doc: DocRequirement; review: DocReview | undefined }[];
}) {
  const [expanded, setExpanded] = useState(teamActionCount > 0);
  const { deal } = summary;

  return (
    <div className={`rounded-lg border transition-colors ${
      teamActionCount > 0 ? TEAM_BG[team] : "border-border/30 bg-surface/30"
    }`}>
      <button
        className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-surface/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-foreground truncate">{deal.dealName}</span>
            <MilestoneBadge milestone={summary.milestone} />
            {teamActionCount > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30 font-medium">
                {teamActionCount} to do
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-muted">{deal.pbLocation}</span>
            {deal.peProjectId && <span className="text-[10px] text-muted/50">{deal.peProjectId}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Quick doc status dots */}
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
          <div className="flex items-center gap-1 ml-1">
            <a href={deal.hubspotUrl} target="_blank" rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-orange-400/60 hover:text-orange-400 transition-colors" title="HubSpot">
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
              </svg>
            </a>
            {deal.pePortalUrl && (
              <a href={deal.pePortalUrl} target="_blank" rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-emerald-500/60 hover:text-emerald-400 transition-colors" title="PE Portal">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                </svg>
              </a>
            )}
          </div>
          <svg className={`w-3.5 h-3.5 text-muted transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </div>
      </button>
      {expanded && (
        <div className="px-3 pb-2 border-t border-border/20">
          <div className="divide-y divide-border/20 mt-1">
            {teamDocs.map(({ doc, review }) => (
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

export default function PeDocsPage() {
  const { data, isLoading } = useQuery<{ deals: PeDeal[]; lastUpdated: string }>({
    queryKey: queryKeys.peDeals.list(),
    queryFn: () => fetch("/api/accounting/pe-deals").then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  const { data: docsData } = useQuery<{ docs: DocReview[] }>({
    queryKey: ["peDocReviews"],
    queryFn: () => fetch("/api/accounting/pe-docs").then((r) => r.json()),
    staleTime: 60 * 1000,
  });

  const queryClient = useQueryClient();
  const [emailSyncing, setEmailSyncing] = useState(false);
  const [emailSyncResult, setEmailSyncResult] = useState<{
    upserted: number;
    matched: number;
    errors: number;
    gmailError?: string;
  } | null>(null);

  const handleEmailSync = useCallback(async () => {
    setEmailSyncing(true);
    setEmailSyncResult(null);
    try {
      const res = await fetch("/api/accounting/pe-docs/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "email" }),
      });
      const result = await res.json();
      setEmailSyncResult(result);
      queryClient.invalidateQueries({ queryKey: ["peDocReviews"] });
    } catch (err) {
      setEmailSyncResult({ upserted: 0, matched: 0, errors: 1, gmailError: String(err) });
    } finally {
      setEmailSyncing(false);
    }
  }, [queryClient]);

  const docMap = useMemo(() => {
    const m = new Map<string, DocReview>();
    for (const d of docsData?.docs ?? []) {
      m.set(`${d.dealId}:${d.docName}`, d);
    }
    return m;
  }, [docsData]);

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
  const [viewMode, setViewMode] = useState<"grouped" | "list" | "by-team">("grouped");

  const filterOptions = useMemo(() => {
    const locations = [...new Set(summaries.map((s) => s.deal.pbLocation).filter(Boolean))].sort();
    return { locations };
  }, [summaries]);

  const filtered = useMemo(() => {
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
      if (categoryFilter.length > 0 && !categoryFilter.includes(s.category)) return false;
      if (milestoneFilter.length > 0 && !milestoneFilter.includes(s.milestone)) return false;
      return true;
    });
  }, [summaries, search, locFilter, categoryFilter, milestoneFilter]);

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

  // Group by category
  const grouped = useMemo(() => {
    const groups = new Map<ActionCategory, DealDocSummary[]>();
    for (const s of sorted) {
      const existing = groups.get(s.category) ?? [];
      existing.push(s);
      groups.set(s.category, existing);
    }
    // Return in priority order
    const order: ActionCategory[] = ["needs-upload", "rejected", "action-required", "waiting-on-pe", "no-data", "approved"];
    return order
      .filter((cat) => groups.has(cat))
      .map((cat) => ({ category: cat, items: groups.get(cat)! }));
  }, [sorted]);

  // Group by team — for each team, find deals with outstanding docs owned by that team
  const teamGrouped = useMemo(() => {
    return TEAM_ORDER.map((team) => {
      const teamDocs = PE_DOCUMENTS.filter((d) => d.team === team);
      const dealsWithIssues: { summary: DealDocSummary; teamActionCount: number; teamDocs: { doc: DocRequirement; review: DocReview | undefined }[] }[] = [];

      for (const s of sorted) {
        const relevantDocs = teamDocs.filter((d) => s.sections.includes(d.section));
        if (relevantDocs.length === 0) continue;

        let teamActionCount = 0;
        const docsWithReviews: { doc: DocRequirement; review: DocReview | undefined }[] = [];

        for (const doc of relevantDocs) {
          const review = docMap.get(`${s.deal.dealId}:${doc.name}`);
          const status = review?.status;
          if (status && status !== "APPROVED" && status !== "UNDER_REVIEW" && status !== "UPLOADED") {
            teamActionCount++;
          }
          docsWithReviews.push({ doc, review });
        }

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

  const hasFilters = search || locFilter.length > 0 || categoryFilter.length > 0 || milestoneFilter.length > 0;

  const clearFilters = useCallback(() => {
    setSearch("");
    setLocFilter([]);
    setCategoryFilter([]);
    setMilestoneFilter([]);
  }, []);

  return (
    <DashboardShell title="PE Document Tracker" accentColor="emerald" lastUpdated={data?.lastUpdated} fullWidth>
      {/* Email sync controls */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={handleEmailSync}
          disabled={emailSyncing}
          className="rounded-lg bg-surface-2 px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface transition-colors disabled:opacity-50"
        >
          {emailSyncing ? "Syncing..." : "Sync from Email"}
        </button>
        {emailSyncResult && (
          <span className="text-xs text-muted">
            {emailSyncResult.gmailError
              ? `Error: ${emailSyncResult.gmailError}`
              : `${emailSyncResult.upserted} updated, ${emailSyncResult.matched} matched`}
          </span>
        )}
      </div>

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
          label="Under Review"
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
      <div className="grid grid-cols-3 md:grid-cols-5 gap-2 mb-6">
        <MiniStat label="Approved" value={stats.totalApproved} />
        <MiniStat label="Under Review" value={stats.totalUnderReview} />
        <MiniStat label="Not Uploaded" value={stats.totalNotUploaded} />
        <MiniStat label="Action Required" value={stats.totalActionReq} />
        <MiniStat label="Rejected" value={stats.totalRejected} />
      </div>

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
            { value: "rejected", label: "Rejected" },
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

        <div className="ml-auto flex items-center gap-1 bg-surface-2 rounded-lg p-0.5 border border-border">
          {(["grouped", "list", "by-team"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-2.5 py-1 rounded text-xs transition-colors ${
                viewMode === mode ? "bg-emerald-500/20 text-emerald-400" : "text-muted hover:text-foreground"
              }`}
            >
              {mode === "grouped" ? "Grouped" : mode === "list" ? "List" : "By Team"}
            </button>
          ))}
        </div>
      </div>

      {/* Results count */}
      <div className="text-xs text-muted mb-3">
        {filtered.length === summaries.length
          ? `${summaries.length} deals`
          : `${filtered.length} of ${summaries.length} deals`}
      </div>

      {/* Deal cards */}
      {isLoading && (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 rounded-lg bg-surface-2 animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && viewMode === "grouped" && (
        <div className="space-y-6">
          {grouped.map(({ category, items }) => (
            <div key={category}>
              <div className="flex items-center gap-2 mb-2">
                <span className={`w-2.5 h-2.5 rounded-full ${CATEGORY_DOT[category]}`} />
                <h3 className="text-sm font-semibold text-foreground">{CATEGORY_LABELS[category]}</h3>
                <span className="text-xs text-muted">({items.length})</span>
              </div>
              <div className="space-y-2">
                {items.map((s) => (
                  <DealCard
                    key={s.deal.dealId}
                    summary={s}
                    docMap={docMap}
                    defaultExpanded={category !== "approved" && category !== "no-data" && items.length <= 10}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && viewMode === "list" && (
        <div className="space-y-2">
          {sorted.map((s) => (
            <DealCard key={s.deal.dealId} summary={s} docMap={docMap} defaultExpanded={false} />
          ))}
        </div>
      )}

      {!isLoading && viewMode === "by-team" && (
        <div className="space-y-6">
          {teamGrouped.map(({ team, dealsWithIssues, totalActionable, totalApproved, totalDocs }) => (
            <div key={team}>
              <div className="flex items-center gap-2 mb-3">
                <span className={`w-2.5 h-2.5 rounded-full ${TEAM_DOT[team]}`} />
                <h3 className={`text-sm font-semibold ${TEAM_COLORS[team]}`}>{TEAM_LABELS[team]}</h3>
                <span className="text-xs text-muted">
                  {dealsWithIssues.length} deals
                </span>
                <span className="text-[10px] text-muted/60">
                  {totalApproved}/{totalDocs} approved
                </span>
                {totalActionable > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30 font-medium">
                    {totalActionable} to do
                  </span>
                )}
              </div>
              <div className="space-y-1.5">
                {dealsWithIssues.map(({ summary: s, teamActionCount, teamDocs: tDocs }) => (
                  <TeamDealRow
                    key={s.deal.dealId}
                    summary={s}
                    team={team}
                    teamActionCount={teamActionCount}
                    teamDocs={tDocs}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <div className="text-center py-12 text-muted">
          {hasFilters ? "No deals match the current filters." : "No PE deals found."}
        </div>
      )}
    </DashboardShell>
  );
}
