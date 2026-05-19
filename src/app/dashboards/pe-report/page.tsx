"use client";

import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { StatCard, MiniStat } from "@/components/ui/MetricCard";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import { queryKeys } from "@/lib/query-keys";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DocReviewFromHS {
  dealId: string;
  docName: string;
  status: string;
  notes: string | null;
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
  customerPays: number | null;
  pePaymentTotal: number | null;
  pePaymentIC: number | null;
  pePaymentPC: number | null;
  totalPBRevenue: number | null;
  peM1Status: string | null;
  peM2Status: string | null;
  milestoneHighlight: "m1" | "m2" | "complete" | null;
  daInvoiceStatus: string | null;
  ccInvoiceStatus: string | null;
  ptoInvoiceStatus: string | null;
  paidInFull: boolean;
  hubspotUrl: string;
  pePortalUrl: string | null;
  peProjectId: string | null;
  docReviews: DocReviewFromHS[];
}

interface DocReview {
  dealId: string;
  docName: string;
  status: PeDocStatusValue;
  notes: string | null;
}

type PeDocStatusValue =
  | "NOT_UPLOADED"
  | "UPLOADED"
  | "UNDER_REVIEW"
  | "ACTION_REQUIRED"
  | "REJECTED"
  | "APPROVED";

// ---------------------------------------------------------------------------
// PE document requirements by milestone section
// ---------------------------------------------------------------------------

interface DocRequirement {
  name: string;
  section: "onboarding" | "ic" | "pc";
  owner: "PB" | "Customer" | "PE";
  note?: string;
}

const PE_DOCUMENTS: DocRequirement[] = [
  { name: "Customer Agreement (PPA/ESA)", section: "onboarding", owner: "Customer", note: "Signed by customer" },
  { name: "Installation Order", section: "onboarding", owner: "PB" },
  { name: "State Disclosures", section: "onboarding", owner: "PB" },
  { name: "Utility Bill", section: "onboarding", owner: "Customer" },
  { name: "Signed Proposal", section: "ic", owner: "PB" },
  { name: "Design Plan", section: "ic", owner: "PB", note: "Common blocker — ensure latest revision" },
  { name: "Photos per Policy", section: "ic", owner: "PB", note: "#1 rejection reason — follow PE photo guide" },
  { name: "Signed Final Permit", section: "ic", owner: "PB" },
  { name: "Access to Monitoring", section: "ic", owner: "PB", note: "Monitoring platform credentials" },
  { name: "Certificate of Acceptance", section: "ic", owner: "PB" },
  { name: "Attestation of Customer Payment", section: "ic", owner: "PB" },
  { name: "Conditional Progress Lien Waiver", section: "ic", owner: "PB" },
  { name: "Signed Interconnection Agreement", section: "pc", owner: "PB" },
  { name: "Conditional Waiver — Final Payment", section: "pc", owner: "PB" },
  { name: "Permission to Operate (PTO)", section: "pc", owner: "PB" },
];

// ---------------------------------------------------------------------------
// Deal stage → PE milestone mapping
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
// Helpers
// ---------------------------------------------------------------------------

function fmt(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function fmtPct(n: number): string {
  return `${Math.round(n)}%`;
}

const M1M2_STATUSES = [
  // Onboarding phase (M1 only)
  "Ready for Onboarding",
  "Onboarding Submitted",
  "Onboarding Rejected",
  "Onboarding Ready to Resubmit",
  "Onboarding Resubmitted",
  // Submission phase (M1 + M2)
  "Ready to Submit",
  "Waiting on Information",
  "Submitted",
  "Rejected",
  "Ready to Resubmit",
  "Resubmitted",
  "Approved",
  "Paid",
];

const DOC_STATUS_OPTIONS: { value: PeDocStatusValue; label: string }[] = [
  { value: "NOT_UPLOADED", label: "Not Uploaded" },
  { value: "UPLOADED", label: "Uploaded" },
  { value: "UNDER_REVIEW", label: "Under Review" },
  { value: "ACTION_REQUIRED", label: "Action Required" },
  { value: "REJECTED", label: "Rejected" },
  { value: "APPROVED", label: "Approved" },
];

const DOC_STATUS_COLORS: Record<PeDocStatusValue, string> = {
  NOT_UPLOADED: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  UPLOADED: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  UNDER_REVIEW: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  ACTION_REQUIRED: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  REJECTED: "bg-red-500/20 text-red-400 border-red-500/30",
  APPROVED: "bg-green-500/20 text-green-400 border-green-500/30",
};

// ---------------------------------------------------------------------------
// Doc filter category helpers
// ---------------------------------------------------------------------------

type DocFilterCategory = "no-portal-data" | "waiting-on-pe" | "pb-needs-upload" | "pb-action-required" | "all-approved" | "in-progress";

const DOC_FILTER_OPTIONS: { value: DocFilterCategory; label: string }[] = [
  { value: "no-portal-data", label: "No Portal Data" },
  { value: "waiting-on-pe", label: "Waiting on PE" },
  { value: "pb-needs-upload", label: "PB Needs to Upload" },
  { value: "pb-action-required", label: "PB Action Required" },
  { value: "all-approved", label: "All Approved" },
  { value: "in-progress", label: "In Progress" },
];

function classifyDocStatus(summary: DocSummary): DocFilterCategory {
  // CSV-only projects: classify based on the overall portal status
  if (summary.csvOnly && summary.csvStatus) {
    if (summary.csvStatus === "APPROVED") return "all-approved";
    if (summary.csvStatus === "ACTION_REQUIRED") return "pb-action-required";
    if (summary.csvStatus === "UNDER_REVIEW") return "waiting-on-pe";
    return "in-progress";
  }
  // No portal data — all docs are unreviewed
  if (summary.notReviewed === summary.total) return "no-portal-data";
  // All approved
  if (summary.approved === summary.total) return "all-approved";
  // PB Action Required — at least one doc is ACTION_REQUIRED or REJECTED
  if (summary.actionRequired > 0 || summary.rejected > 0) return "pb-action-required";
  // PB Needs to Upload — at least one doc is NOT_UPLOADED
  if (summary.notUploaded > 0) return "pb-needs-upload";
  // Waiting on PE — remaining reviewed docs are all APPROVED, UNDER_REVIEW, or UPLOADED
  // (nothing for PB to do)
  const pbDone = summary.approved + summary.underReview;
  if (pbDone === summary.total - summary.notReviewed && summary.notReviewed === 0) return "waiting-on-pe";
  // In Progress — mixed bag
  return "in-progress";
}

// Synthetic doc name for CSV-imported overall status (must match pe-scraper-sync.ts)
const CSV_SUMMARY_DOC_NAME = "Portal Summary (CSV)";

interface DocSummary {
  approved: number;
  rejected: number;
  actionRequired: number;
  underReview: number;
  notUploaded: number;
  notReviewed: number;
  total: number;
  /** When true, this deal has NO scraper doc data but has a CSV summary row */
  csvOnly: boolean;
  csvStatus: PeDocStatusValue | null;
  csvNotes: string | null;
}

function docStatusSummary(
  dealId: string,
  sections: ("onboarding" | "ic" | "pc")[],
  docMap: Map<string, DocReview>,
): DocSummary {
  const docs = PE_DOCUMENTS.filter((d) => sections.includes(d.section));
  let approved = 0, rejected = 0, actionRequired = 0, underReview = 0, notUploaded = 0, notReviewed = 0;
  for (const doc of docs) {
    const key = `${dealId}:${doc.name}`;
    const review = docMap.get(key);
    if (!review) { notReviewed++; continue; }
    switch (review.status) {
      case "APPROVED": approved++; break;
      case "REJECTED": rejected++; break;
      case "ACTION_REQUIRED": actionRequired++; break;
      case "UNDER_REVIEW": underReview++; break;
      case "NOT_UPLOADED": notUploaded++; break;
      case "UPLOADED": underReview++; break;
    }
  }

  // Check for CSV summary row when no scraper data exists
  const csvRow = docMap.get(`${dealId}:${CSV_SUMMARY_DOC_NAME}`);
  const csvOnly = notReviewed === docs.length && !!csvRow;

  return {
    approved, rejected, actionRequired, underReview, notUploaded, notReviewed,
    total: docs.length,
    csvOnly,
    csvStatus: csvRow?.status ?? null,
    csvNotes: csvRow?.notes ?? null,
  };
}

function summaryText(summary: DocSummary): string {
  // CSV-only: show overall status from portal export
  if (summary.csvOnly && summary.csvStatus) {
    const label = DOC_STATUS_OPTIONS.find((o) => o.value === summary.csvStatus)?.label ?? summary.csvStatus;
    return `${label} (CSV)`;
  }
  if (summary.notReviewed === summary.total) return "No portal data";
  if (summary.approved === summary.total) return "All approved";
  const parts: string[] = [];
  if (summary.rejected > 0) parts.push(`${summary.rejected} rejected`);
  if (summary.actionRequired > 0) parts.push(`${summary.actionRequired} action needed`);
  if (summary.notUploaded > 0) parts.push(`${summary.notUploaded} not uploaded`);
  if (summary.underReview > 0) parts.push(`${summary.underReview} in review`);
  if (summary.approved > 0) parts.push(`${summary.approved} approved`);
  return parts.join(" · ");
}

function summaryColor(summary: DocSummary): string {
  if (summary.csvOnly && summary.csvStatus) {
    if (summary.csvStatus === "APPROVED") return "text-green-400";
    if (summary.csvStatus === "ACTION_REQUIRED" || summary.csvStatus === "REJECTED") return "text-orange-400";
    if (summary.csvStatus === "UNDER_REVIEW") return "text-blue-400";
    return "text-muted";
  }
  if (summary.notReviewed === summary.total) return "text-muted";
  if (summary.approved === summary.total) return "text-green-400";
  if (summary.rejected > 0 || summary.actionRequired > 0) return "text-orange-400";
  return "text-blue-400";
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

type SortColumn = "deal" | "location" | "milestone" | "docs" | "custPaid" | "m1" | "m2" | "peTotal";
type SortDirection = "asc" | "desc";

const MILESTONE_ORDER: Record<PeMilestone, number> = {
  "pre-construction": 0,
  construction: 1,
  inspection: 2,
  pto: 3,
  "close-out": 4,
  complete: 5,
};

const M1M2_STATUS_ORDER: Record<string, number> = {
  "": 0,
  "Ready for Onboarding": 1,
  "Onboarding Submitted": 2,
  "Onboarding Rejected": 3,
  "Onboarding Ready to Resubmit": 4,
  "Onboarding Resubmitted": 5,
  "Ready to Submit": 6,
  "Waiting on Information": 7,
  "Submitted": 8,
  "Ready to Resubmit": 9,
  "Resubmitted": 10,
  "Rejected": 11,
  "Approved": 12,
  "Paid": 13,
};

function customerPaidOrder(d: PeDeal): number {
  if (d.paidInFull) return 3;
  const paidCount = [d.daInvoiceStatus, d.ccInvoiceStatus, d.ptoInvoiceStatus]
    .filter((s) => s === "Paid In Full").length;
  if (paidCount === 3) return 3;
  if (paidCount > 0) return 2;
  const openCount = [d.daInvoiceStatus, d.ccInvoiceStatus, d.ptoInvoiceStatus]
    .filter((s) => s === "Open").length;
  if (openCount > 0) return 1;
  return 0;
}

function SortHeader({ label, column, current, direction, onSort, align }: {
  label: string;
  column: SortColumn;
  current: SortColumn | null;
  direction: SortDirection;
  onSort: (col: SortColumn) => void;
  align?: "right";
}) {
  const active = current === column;
  return (
    <th
      className={`pb-2 pr-3 cursor-pointer select-none hover:text-foreground transition-colors ${align === "right" ? "text-right" : ""}`}
      onClick={() => onSort(column)}
    >
      <span className="inline-flex items-center gap-1">
        {align === "right" && active && (
          <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 12 12" fill="currentColor">
            {direction === "asc"
              ? <path d="M6 2l4 5H2z" />
              : <path d="M6 10l4-5H2z" />}
          </svg>
        )}
        {label}
        {align !== "right" && active && (
          <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 12 12" fill="currentColor">
            {direction === "asc"
              ? <path d="M6 2l4 5H2z" />
              : <path d="M6 10l4-5H2z" />}
          </svg>
        )}
      </span>
    </th>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-muted">—</span>;
  const colors: Record<string, string> = {
    Paid: "bg-green-500/20 text-green-400 border-green-500/30",
    Approved: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    Submitted: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    Resubmitted: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    "Ready to Submit": "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
    Rejected: "bg-red-500/20 text-red-400 border-red-500/30",
    "Ready to Resubmit": "bg-orange-500/20 text-orange-400 border-orange-500/30",
    "Waiting on Information": "bg-purple-500/20 text-purple-400 border-purple-500/30",
    // Onboarding phase (M1 only)
    "Ready for Onboarding": "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
    "Onboarding Submitted": "bg-sky-500/20 text-sky-400 border-sky-500/30",
    "Onboarding Rejected": "bg-red-500/20 text-red-400 border-red-500/30",
    "Onboarding Ready to Resubmit": "bg-orange-500/20 text-orange-400 border-orange-500/30",
    "Onboarding Resubmitted": "bg-sky-500/20 text-sky-400 border-sky-500/30",
  };
  const cls = colors[status] || "bg-surface-2 text-muted border-border";
  return <span className={`text-xs px-2 py-0.5 rounded-full border ${cls}`}>{status}</span>;
}

function ProgressBar({ approved, underReview, actionRequired, total }: {
  approved: number; underReview: number; actionRequired: number; total: number;
}) {
  if (total === 0) return null;
  const pctApproved = (approved / total) * 100;
  const pctReview = (underReview / total) * 100;
  return (
    <div className="flex-1 min-w-[80px] flex h-2 rounded-full overflow-hidden bg-surface-2" title={`${approved} approved, ${underReview} under review, ${actionRequired} action required`}>
      {pctApproved > 0 && <div className="bg-green-500" style={{ width: `${pctApproved}%` }} />}
      {pctReview > 0 && <div className="bg-blue-500" style={{ width: `${pctReview}%` }} />}
    </div>
  );
}

function PipelineRow({ label, count, total, color, value }: {
  label: string; count: number; total: number; color: string; value?: string;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-28 text-xs text-muted">{label}</div>
      <div className="flex-1 h-5 bg-surface-2 rounded-full overflow-hidden relative">
        <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${Math.max(pct, count > 0 ? 2 : 0)}%` }} />
        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium text-foreground">{count}</span>
      </div>
      {value && <div className="w-24 text-right text-xs text-muted tabular-nums">{value}</div>}
      {!value && <div className="w-24" />}
    </div>
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
    <span className={`text-xs px-2 py-0.5 rounded-full border ${colors[milestone]}`}>
      {milestoneLabel(milestone)}
    </span>
  );
}

function CustomerPaymentBadge({ deal }: { deal: PeDeal }) {
  if (deal.paidInFull) {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full border bg-green-500/20 text-green-400 border-green-500/30" title={`DA: ${deal.daInvoiceStatus || "—"} · CC: ${deal.ccInvoiceStatus || "—"} · PTO: ${deal.ptoInvoiceStatus || "—"}`}>
        Paid
      </span>
    );
  }

  const milestones = [
    { label: "DA", status: deal.daInvoiceStatus },
    { label: "CC", status: deal.ccInvoiceStatus },
    { label: "PTO", status: deal.ptoInvoiceStatus },
  ];
  const paidCount = milestones.filter((m) => m.status === "Paid In Full").length;
  const openCount = milestones.filter((m) => m.status === "Open").length;
  const tooltip = milestones.map((m) => `${m.label}: ${m.status || "—"}`).join(" · ");

  if (paidCount === 3) {
    return <span className="text-xs px-2 py-0.5 rounded-full border bg-green-500/20 text-green-400 border-green-500/30" title={tooltip}>Paid</span>;
  }
  if (paidCount > 0) {
    return <span className="text-xs px-2 py-0.5 rounded-full border bg-yellow-500/20 text-yellow-300 border-yellow-500/30" title={tooltip}>{paidCount}/3</span>;
  }
  if (openCount > 0) {
    return <span className="text-xs px-2 py-0.5 rounded-full border bg-blue-500/20 text-blue-400 border-blue-500/30" title={tooltip}>Invoiced</span>;
  }
  return <span className="text-xs text-muted" title={tooltip}>—</span>;
}

function DocStatusDisplay({ doc, review }: {
  doc: DocRequirement;
  review: DocReview | undefined;
}) {
  const currentStatus = review?.status ?? null;
  const statusLabel = currentStatus
    ? DOC_STATUS_OPTIONS.find((o) => o.value === currentStatus)?.label ?? currentStatus
    : null;

  return (
    <div className="flex items-start gap-3 py-1.5">
      <span className={`mt-1 w-2.5 h-2.5 rounded-full flex-shrink-0 ${
        currentStatus === "APPROVED" ? "bg-green-500" :
        currentStatus === "REJECTED" ? "bg-red-500" :
        currentStatus === "ACTION_REQUIRED" ? "bg-orange-500" :
        currentStatus === "UNDER_REVIEW" || currentStatus === "UPLOADED" ? "bg-blue-500" :
        currentStatus === "NOT_UPLOADED" ? "bg-zinc-500" :
        "bg-zinc-700"
      }`} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-xs ${currentStatus === "APPROVED" ? "text-muted line-through" : "text-foreground"}`}>
            {doc.name}
          </span>
          <span className="text-[10px] text-muted/50">{doc.owner}</span>
        </div>

        {doc.note && currentStatus !== "APPROVED" && (
          <div className="text-[10px] text-muted/60 mt-0.5">{doc.note}</div>
        )}

        {review?.notes && (
          <div className="text-[10px] text-orange-400/80 mt-0.5">
            Note: {review.notes}
          </div>
        )}
      </div>

      {statusLabel ? (
        <span className={`text-[10px] rounded border px-1.5 py-0.5 ${DOC_STATUS_COLORS[currentStatus!]}`}>
          {statusLabel}
        </span>
      ) : (
        <span className="text-[10px] text-muted">—</span>
      )}
    </div>
  );
}

function ProjectDocChecklist({ dealId, milestone, docMap }: {
  dealId: string;
  milestone: PeMilestone;
  docMap: Map<string, DocReview>;
}) {
  const sections = milestoneDocSections(milestone);
  const sectionLabel: Record<string, string> = {
    onboarding: "Onboarding",
    ic: "Inspection Complete (M1)",
    pc: "Project Complete (M2)",
  };

  const gridCols =
    sections.length === 1 ? "grid-cols-1" :
    sections.length === 2 ? "grid-cols-1 md:grid-cols-2" :
    "grid-cols-1 md:grid-cols-3";

  return (
    <div className={`grid ${gridCols} gap-4`}>
      {sections.map((sec) => {
        const docs = PE_DOCUMENTS.filter((d) => d.section === sec);
        const sectionDocs = docs.map((d) => ({
          doc: d,
          review: docMap.get(`${dealId}:${d.name}`),
        }));
        const approvedCount = sectionDocs.filter((d) => d.review?.status === "APPROVED").length;
        const reviewedCount = sectionDocs.filter((d) => d.review).length;

        return (
          <div key={sec} className="bg-surface-2 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-foreground">{sectionLabel[sec]}</span>
              <span className="text-[10px] text-muted">
                {approvedCount}/{docs.length} approved
                {reviewedCount < docs.length && ` · ${docs.length - reviewedCount} unreviewed`}
              </span>
            </div>
            <div className="divide-y divide-border/30">
              {sectionDocs.map(({ doc, review }) => (
                <DocStatusDisplay key={doc.name} doc={doc} review={review} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function PeReportPage() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<{ deals: PeDeal[]; lastUpdated: string }>({
    queryKey: queryKeys.peDeals.list(),
    queryFn: () => fetch("/api/accounting/pe-deals").then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  // Build docMap from HubSpot deal properties (no separate DB query needed)
  const docMap = useMemo(() => {
    const m = new Map<string, DocReview>();
    for (const deal of data?.deals ?? []) {
      for (const dr of deal.docReviews ?? []) {
        m.set(`${dr.dealId}:${dr.docName}`, {
          dealId: dr.dealId,
          docName: dr.docName,
          status: dr.status as PeDocStatusValue,
          notes: dr.notes,
        });
      }
    }
    return m;
  }, [data]);

  // CSV import mutation
  const [csvImportResult, setCsvImportResult] = useState<{
    projectsFound: number;
    projectsMatched: number;
    projectsUpdated: number;
    projectsSkippedHasScraperData: number;
    unmatchedProjects: string[];
    errors: string[];
  } | null>(null);

  const csvImportMutation = useMutation({
    mutationFn: async (csvText: string) => {
      const res = await fetch("/api/accounting/pe-docs/csv-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: csvText }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Import failed" }));
        throw new Error(err.error || "Import failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setCsvImportResult(data);
      queryClient.invalidateQueries({ queryKey: queryKeys.peDeals.list() });
    },
  });

  const handleCsvUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      csvImportMutation.mutate(text);
    };
    reader.readAsText(file);
    // Reset input so same file can be re-uploaded
    e.target.value = "";
  }, [csvImportMutation]);

  const deals = data?.deals ?? [];

  // Filter state — all multi-select (empty array = all)
  const [search, setSearch] = useState("");
  const [locFilter, setLocFilter] = useState<string[]>([]);
  const [stageFilter, setStageFilter] = useState<string[]>([]);
  const [m1Filter, setM1Filter] = useState<string[]>([]);
  const [m2Filter, setM2Filter] = useState<string[]>([]);
  const [docStatusFilter, setDocStatusFilter] = useState<string[]>([]);
  const [custPaidFilter, setCustPaidFilter] = useState<string[]>([]);
  const [sortCol, setSortCol] = useState<SortColumn | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>("asc");
  const [expandedDeal, setExpandedDeal] = useState<string | null>(null);

  const handleSort = useCallback((col: SortColumn) => {
    setSortCol((prev) => {
      if (prev === col) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return col;
      }
      setSortDir("asc");
      return col;
    });
  }, []);

  const filterOptions = useMemo(() => {
    const locations = [...new Set(deals.map((d) => d.pbLocation).filter(Boolean))].sort();
    const stages = [...new Set(deals.map((d) => d.dealStageLabel).filter(Boolean))].sort();
    return { locations, stages };
  }, [deals]);

  const filtered = useMemo(() => {
    return deals.filter((d) => {
      if (search) {
        const q = search.toLowerCase();
        if (!d.dealName.toLowerCase().includes(q) && !d.pbLocation.toLowerCase().includes(q)) return false;
      }
      if (locFilter.length > 0 && !locFilter.includes(d.pbLocation)) return false;
      if (stageFilter.length > 0 && !stageFilter.includes(d.dealStageLabel)) return false;
      if (m1Filter.length > 0) {
        const m1Val = d.peM1Status || "none";
        if (!m1Filter.includes(m1Val)) return false;
      }
      if (m2Filter.length > 0) {
        const m2Val = d.peM2Status || "none";
        if (!m2Filter.includes(m2Val)) return false;
      }
      if (docStatusFilter.length > 0) {
        const milestone = dealStageToPeMilestone(d.dealStageLabel);
        const sections = milestoneDocSections(milestone);
        const summary = docStatusSummary(d.dealId, sections, docMap);
        const category = classifyDocStatus(summary);
        if (!docStatusFilter.includes(category)) return false;
      }
      if (custPaidFilter.length > 0) {
        const paidCount = [d.daInvoiceStatus, d.ccInvoiceStatus, d.ptoInvoiceStatus]
          .filter((s) => s === "Paid In Full").length;
        const openCount = [d.daInvoiceStatus, d.ccInvoiceStatus, d.ptoInvoiceStatus]
          .filter((s) => s === "Open").length;
        let payStatus: string;
        if (d.paidInFull || paidCount === 3) payStatus = "paid";
        else if (paidCount > 0) payStatus = "partial";
        else if (openCount > 0) payStatus = "invoiced";
        else payStatus = "not-invoiced";
        if (!custPaidFilter.includes(payStatus)) return false;
      }
      return true;
    });
  }, [deals, search, locFilter, stageFilter, m1Filter, m2Filter, docStatusFilter, custPaidFilter, docMap]);

  const sorted = useMemo(() => {
    if (!sortCol) return filtered;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortCol) {
        case "deal":
          return dir * a.dealName.localeCompare(b.dealName);
        case "location":
          return dir * (a.pbLocation || "").localeCompare(b.pbLocation || "");
        case "milestone": {
          const mA = MILESTONE_ORDER[dealStageToPeMilestone(a.dealStageLabel)];
          const mB = MILESTONE_ORDER[dealStageToPeMilestone(b.dealStageLabel)];
          return dir * (mA - mB);
        }
        case "docs": {
          const secA = milestoneDocSections(dealStageToPeMilestone(a.dealStageLabel));
          const secB = milestoneDocSections(dealStageToPeMilestone(b.dealStageLabel));
          const sA = docStatusSummary(a.dealId, secA, docMap);
          const sB = docStatusSummary(b.dealId, secB, docMap);
          const pctA = sA.total > 0 ? sA.approved / sA.total : -1;
          const pctB = sB.total > 0 ? sB.approved / sB.total : -1;
          return dir * (pctA - pctB);
        }
        case "custPaid":
          return dir * (customerPaidOrder(a) - customerPaidOrder(b));
        case "m1":
          return dir * ((M1M2_STATUS_ORDER[a.peM1Status ?? ""] ?? 0) - (M1M2_STATUS_ORDER[b.peM1Status ?? ""] ?? 0));
        case "m2":
          return dir * ((M1M2_STATUS_ORDER[a.peM2Status ?? ""] ?? 0) - (M1M2_STATUS_ORDER[b.peM2Status ?? ""] ?? 0));
        case "peTotal":
          return dir * ((a.pePaymentTotal ?? 0) - (b.pePaymentTotal ?? 0));
        default:
          return 0;
      }
    });
  }, [filtered, sortCol, sortDir, docMap]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedDeal((prev) => (prev === id ? null : id));
  }, []);

  // Compute live metrics from ALL deals (unfiltered)
  const metrics = useMemo(() => {
    if (!deals.length) return null;

    const totalDeals = deals.length;
    const totalEpcValue = deals.reduce((s, d) => s + (d.epcPrice ?? 0), 0);
    const totalPePayment = deals.reduce((s, d) => s + (d.pePaymentTotal ?? 0), 0);

    const ONBOARDING_STATUSES = new Set(["Ready for Onboarding", "Onboarding Submitted", "Onboarding Rejected", "Onboarding Ready to Resubmit", "Onboarding Resubmitted"]);
    const m1Paid = deals.filter((d) => d.peM1Status === "Paid").length;
    const m1Approved = deals.filter((d) => d.peM1Status === "Approved").length;
    const m1Submitted = deals.filter((d) => ["Submitted", "Resubmitted"].includes(d.peM1Status ?? "")).length;
    const m1Ready = deals.filter((d) => d.peM1Status === "Ready to Submit").length;
    const m1Onboarding = deals.filter((d) => ONBOARDING_STATUSES.has(d.peM1Status ?? "")).length;
    const m1Other = deals.filter((d) => ["Rejected", "Ready to Resubmit", "Waiting on Information"].includes(d.peM1Status ?? "")).length;
    const m1NotStarted = deals.filter((d) => !d.peM1Status || d.peM1Status === "").length;

    const m2Paid = deals.filter((d) => d.peM2Status === "Paid").length;
    const m2Approved = deals.filter((d) => d.peM2Status === "Approved").length;
    const m2Submitted = deals.filter((d) => ["Submitted", "Resubmitted"].includes(d.peM2Status ?? "")).length;
    const m2Ready = deals.filter((d) => d.peM2Status === "Ready to Submit").length;
    const m2NotStarted = deals.filter((d) => !d.peM2Status || d.peM2Status === "").length;

    const m1PaidValue = deals.filter((d) => d.peM1Status === "Paid").reduce((s, d) => s + (d.pePaymentIC ?? 0), 0);
    const m2PaidValue = deals.filter((d) => d.peM2Status === "Paid").reduce((s, d) => s + (d.pePaymentPC ?? 0), 0);
    const collected = m1PaidValue + m2PaidValue;
    const collectPct = totalPePayment > 0 ? (collected / totalPePayment) * 100 : 0;

    const m1ApprovedValue = deals.filter((d) => d.peM1Status === "Approved").reduce((s, d) => s + (d.pePaymentIC ?? 0), 0);
    const m2ApprovedValue = deals.filter((d) => d.peM2Status === "Approved").reduce((s, d) => s + (d.pePaymentPC ?? 0), 0);
    const readyToInvoice = m1ApprovedValue + m2ApprovedValue;

    const byLocation = new Map<string, number>();
    deals.forEach((d) => { const loc = d.pbLocation || "Unknown"; byLocation.set(loc, (byLocation.get(loc) ?? 0) + 1); });
    const byStage = new Map<string, number>();
    deals.forEach((d) => { byStage.set(d.dealStageLabel, (byStage.get(d.dealStageLabel) ?? 0) + 1); });

    // Doc review stats — split by document section, only counting deals
    // that have reached the relevant milestone. "Not Uploaded" means the
    // deal IS at the stage and the doc SHOULD be uploaded.
    interface SectionDocStats {
      dealCount: number; total: number; tracked: number;
      approved: number; rejected: number; actionReq: number;
      underReview: number; notUploaded: number;
      byStage: Map<string, { notUploaded: number; total: number }>;
    }
    const emptySectionStats = (): SectionDocStats => ({
      dealCount: 0, total: 0, tracked: 0, approved: 0, rejected: 0,
      actionReq: 0, underReview: 0, notUploaded: 0,
      byStage: new Map(),
    });
    // Onboarding (4 docs): relevant at PTO+ (inspection complete → ready for M1)
    const onboardingDocs = emptySectionStats();
    // IC (10 docs): relevant at PTO+ (inspection complete → ready for M1)
    const icDocs = emptySectionStats();
    // PC (3 docs): relevant at close-out+ (PTO received → ready for M2)
    const pcDocs = emptySectionStats();
    let preM1DealCount = 0;

    const addToSection = (bucket: SectionDocStats, dealId: string, section: "onboarding" | "ic" | "pc", stageLabel: string) => {
      const summary = docStatusSummary(dealId, [section], docMap);
      bucket.total += summary.total;
      bucket.tracked += summary.total - summary.notReviewed;
      bucket.approved += summary.approved;
      bucket.rejected += summary.rejected;
      bucket.actionReq += summary.actionRequired;
      bucket.underReview += summary.underReview;
      bucket.notUploaded += summary.notUploaded;
      const existing = bucket.byStage.get(stageLabel) ?? { notUploaded: 0, total: 0 };
      existing.notUploaded += summary.notUploaded;
      existing.total += summary.total;
      bucket.byStage.set(stageLabel, existing);
    };

    for (const d of deals) {
      const milestone = dealStageToPeMilestone(d.dealStageLabel);
      if (milestone === "pre-construction" || milestone === "construction" || milestone === "inspection") {
        preM1DealCount++;
        continue;
      }
      // M1 = Inspection Complete: deal must be PAST inspection (PTO+)
      const atM1 = milestone === "pto" || milestone === "close-out" || milestone === "complete";
      // M2 = Project Complete: deal must be PAST PTO (Close Out+)
      const atM2 = milestone === "close-out" || milestone === "complete";
      const stage = milestoneLabel(milestone);
      if (atM1) {
        // Count deal once for onboarding and IC sections
        if (!onboardingDocs.byStage.has(stage) || true) { // always add per deal
          addToSection(onboardingDocs, d.dealId, "onboarding", stage);
        }
        addToSection(icDocs, d.dealId, "ic", stage);
      }
      if (atM2) {
        addToSection(pcDocs, d.dealId, "pc", stage);
      }
      // Increment deal counts (avoid double-counting)
      if (atM1) {
        onboardingDocs.dealCount++;
        icDocs.dealCount++;
      }
      if (atM2) {
        pcDocs.dealCount++;
      }
    }

    // Convert byStage maps to sorted arrays for rendering
    const stageBreakdown = (bucket: SectionDocStats) =>
      [...bucket.byStage.entries()]
        .filter(([, v]) => v.notUploaded > 0)
        .sort((a, b) => b[1].notUploaded - a[1].notUploaded);

    return {
      totalDeals, totalEpcValue, totalPePayment,
      m1: { paid: m1Paid, approved: m1Approved, submitted: m1Submitted, ready: m1Ready, onboarding: m1Onboarding, other: m1Other, notStarted: m1NotStarted },
      m2: { paid: m2Paid, approved: m2Approved, submitted: m2Submitted, ready: m2Ready, notStarted: m2NotStarted },
      collected, collectPct, readyToInvoice,
      m1PaidValue, m2PaidValue, m1ApprovedValue, m2ApprovedValue,
      byLocation: [...byLocation.entries()].sort((a, b) => b[1] - a[1]),
      byStage: [...byStage.entries()].sort((a, b) => b[1] - a[1]),
      onboardingDocs, icDocs, pcDocs, preM1DealCount, stageBreakdown,
    };
  }, [deals, docMap]);

  const hasFilters = search || locFilter.length > 0 || stageFilter.length > 0 || m1Filter.length > 0 || m2Filter.length > 0 || docStatusFilter.length > 0 || custPaidFilter.length > 0;

  // Compute summary totals for the currently-filtered deals
  const filteredTotals = useMemo(() => {
    if (!filtered.length) return null;
    const peTotal = filtered.reduce((s, d) => s + (d.pePaymentTotal ?? 0), 0);
    const m1Paid = filtered.filter((d) => d.peM1Status === "Paid").length;
    const m1Approved = filtered.filter((d) => d.peM1Status === "Approved").length;
    const m1PaidVal = filtered.filter((d) => d.peM1Status === "Paid").reduce((s, d) => s + (d.pePaymentIC ?? 0), 0);
    const m1ApprovedVal = filtered.filter((d) => d.peM1Status === "Approved").reduce((s, d) => s + (d.pePaymentIC ?? 0), 0);
    const m2Paid = filtered.filter((d) => d.peM2Status === "Paid").length;
    const m2Approved = filtered.filter((d) => d.peM2Status === "Approved").length;
    const m2PaidVal = filtered.filter((d) => d.peM2Status === "Paid").reduce((s, d) => s + (d.pePaymentPC ?? 0), 0);
    const m2ApprovedVal = filtered.filter((d) => d.peM2Status === "Approved").reduce((s, d) => s + (d.pePaymentPC ?? 0), 0);
    const collected = m1PaidVal + m2PaidVal;
    const custFullyPaid = filtered.filter((d) => d.paidInFull).length;
    return {
      count: filtered.length, peTotal,
      m1Paid, m1Approved, m1PaidVal, m1ApprovedVal,
      m2Paid, m2Approved, m2PaidVal, m2ApprovedVal,
      collected, custFullyPaid,
    };
  }, [filtered]);

  return (
    <DashboardShell title="PE Program Report" accentColor="emerald" lastUpdated={data?.lastUpdated} fullWidth>
      {/* Report Header */}
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <p className="text-muted text-sm">
          Participate Energy program overview for Photon Brothers leadership.
          HubSpot data is live; PE portal document data synced from scraper + CSV.
        </p>
        <div className="flex items-center gap-3 shrink-0">
          <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-2 border border-border text-sm text-foreground hover:bg-surface cursor-pointer transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
            </svg>
            {csvImportMutation.isPending ? "Importing..." : "Import CSV"}
            <input
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleCsvUpload}
              disabled={csvImportMutation.isPending}
            />
          </label>
        </div>
      </div>
      {/* CSV Import Result */}
      {csvImportResult && (
        <div className="mb-6 p-4 rounded-lg bg-surface-2 border border-border text-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="font-medium text-foreground">CSV Import Complete</span>
            <button onClick={() => setCsvImportResult(null)} className="text-muted hover:text-foreground">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-muted">
            <span>{csvImportResult.projectsFound} in CSV</span>
            <span>{csvImportResult.projectsMatched} matched</span>
            <span className="text-green-400">{csvImportResult.projectsUpdated} updated</span>
            <span>{csvImportResult.projectsSkippedHasScraperData} skipped (has scraper data)</span>
          </div>
          {csvImportResult.unmatchedProjects.length > 0 && (
            <details className="mt-2">
              <summary className="text-muted cursor-pointer hover:text-foreground">{csvImportResult.unmatchedProjects.length} unmatched projects</summary>
              <div className="mt-1 text-xs text-muted max-h-32 overflow-auto">
                {csvImportResult.unmatchedProjects.map((p, i) => <div key={i}>{p}</div>)}
              </div>
            </details>
          )}
          {csvImportResult.errors.length > 0 && (
            <details className="mt-2">
              <summary className="text-red-400 cursor-pointer">{csvImportResult.errors.length} errors</summary>
              <div className="mt-1 text-xs text-red-400 max-h-32 overflow-auto">
                {csvImportResult.errors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            </details>
          )}
        </div>
      )}
      {csvImportMutation.isError && (
        <div className="mb-6 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
          CSV import failed: {csvImportMutation.error.message}
        </div>
      )}

      {/* Hero Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8 stagger-grid">
        <StatCard label="Total PE Deals" value={metrics?.totalDeals ?? null} subtitle="Active in project pipeline" color="emerald" />
        <StatCard label="Total EPC Value" value={metrics ? fmt(metrics.totalEpcValue) : null} subtitle="Across all PE projects" color="blue" />
        <StatCard label="PE Revenue Collected" value={metrics ? fmt(metrics.collected) : null} subtitle={metrics ? `${fmtPct(metrics.collectPct)} of ${fmt(metrics.totalPePayment)}` : undefined} color="green" />
        <StatCard label="Awaiting Payment" value={metrics ? fmt(metrics.readyToInvoice) : null} subtitle="Approved, awaiting payment" color={metrics && metrics.readyToInvoice > 0 ? "orange" : "green"} />
      </div>

      {/* Document Review Stats — by section, only deals at relevant milestone */}
      {metrics && (
        <div className="space-y-4 mb-8">
          {[
            { label: "Onboarding", sub: "4 docs per deal · PTO+ deals", data: metrics.onboardingDocs },
            { label: "M1 — Inspection Complete (IC)", sub: "10 docs per deal · PTO+ deals", data: metrics.icDocs },
            { label: "M2 — Project Completion (PC)", sub: "3 docs per deal · close-out+ deals", data: metrics.pcDocs },
          ].map(({ label, sub, data }) => (
            <div key={label} className="bg-surface rounded-xl border border-border p-4 shadow-card">
              <div className="flex items-baseline gap-2 mb-3">
                <h4 className="text-sm font-semibold text-foreground">{label}</h4>
                <span className="text-xs text-muted">{data.dealCount} deals · {sub}</span>
              </div>
              <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                <MiniStat label="Approved" value={data.approved} />
                <MiniStat label="Under Review" value={data.underReview} />
                <MiniStat label="Not Uploaded" value={data.notUploaded} />
                <MiniStat label="Action Required" value={data.actionReq} />
                <MiniStat label="Rejected" value={data.rejected} />
                <MiniStat label="No Data" value={data.total - data.tracked} />
              </div>
              {/* Stage breakdown for Not Uploaded */}
              {data.notUploaded > 0 && metrics.stageBreakdown(data).length > 0 && (
                <div className="mt-2 text-xs text-muted flex flex-wrap gap-x-4 gap-y-1">
                  <span className="text-muted/70">Not uploaded by stage:</span>
                  {metrics.stageBreakdown(data).map(([stage, { notUploaded }]) => (
                    <span key={stage}>{stage}: {notUploaded}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
          {/* Pre-M1 note */}
          {metrics.preM1DealCount > 0 && (
            <p className="text-xs text-muted px-1">
              {metrics.preM1DealCount} deals are pre-construction, in construction, or at inspection — not yet at a document submission stage.
            </p>
          )}
        </div>
      )}

      {/* M1 / M2 Pipeline Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="bg-surface rounded-xl border border-border p-6 shadow-card">
          <h3 className="text-lg font-semibold text-foreground mb-1">M1 — Inspection Complete</h3>
          <p className="text-xs text-muted mb-4">PE pays ~2/3 of their portion after inspection passes + docs approved</p>
          {metrics && (
            <div className="space-y-2">
              <PipelineRow label="Paid" count={metrics.m1.paid} total={metrics.totalDeals} color="bg-green-500" value={fmt(metrics.m1PaidValue)} />
              <PipelineRow label="Approved" count={metrics.m1.approved} total={metrics.totalDeals} color="bg-emerald-500" value={fmt(metrics.m1ApprovedValue)} />
              <PipelineRow label="Submitted" count={metrics.m1.submitted} total={metrics.totalDeals} color="bg-blue-500" />
              <PipelineRow label="Ready to Submit" count={metrics.m1.ready} total={metrics.totalDeals} color="bg-yellow-500" />
              {metrics.m1.other > 0 && <PipelineRow label="Rejected / Waiting" count={metrics.m1.other} total={metrics.totalDeals} color="bg-orange-500" />}
              <PipelineRow label="Onboarding" count={metrics.m1.onboarding} total={metrics.totalDeals} color="bg-cyan-500" />
              <PipelineRow label="Not Started" count={metrics.m1.notStarted} total={metrics.totalDeals} color="bg-zinc-600" />
            </div>
          )}
        </div>
        <div className="bg-surface rounded-xl border border-border p-6 shadow-card">
          <h3 className="text-lg font-semibold text-foreground mb-1">M2 — Project Complete</h3>
          <p className="text-xs text-muted mb-4">PE pays ~1/3 of their portion after PTO + docs approved</p>
          {metrics && (
            <div className="space-y-2">
              <PipelineRow label="Paid" count={metrics.m2.paid} total={metrics.totalDeals} color="bg-green-500" value={fmt(metrics.m2PaidValue)} />
              <PipelineRow label="Approved" count={metrics.m2.approved} total={metrics.totalDeals} color="bg-emerald-500" value={fmt(metrics.m2ApprovedValue)} />
              <PipelineRow label="Submitted" count={metrics.m2.submitted} total={metrics.totalDeals} color="bg-blue-500" />
              <PipelineRow label="Ready to Submit" count={metrics.m2.ready} total={metrics.totalDeals} color="bg-yellow-500" />
              <PipelineRow label="Not Started" count={metrics.m2.notStarted} total={metrics.totalDeals} color="bg-zinc-600" />
            </div>
          )}
        </div>
      </div>

      {/* ── All Projects — Filterable with Document Breakdown ── */}
      <div className="bg-surface rounded-xl border border-border p-6 shadow-card mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground">All PE Projects — Document Status</h3>
            <p className="text-xs text-muted">Click a row to review documents. Status changes save immediately. {filtered.length} of {deals.length} projects shown.</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <input
            type="text"
            placeholder="Search by name or location…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="text-xs bg-surface-2 border border-border rounded-lg px-3 py-1.5 text-foreground placeholder:text-muted w-56 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
          />
          <MultiSelectFilter
            label="Location"
            options={filterOptions.locations.map((l) => ({ value: l, label: l }))}
            selected={locFilter}
            onChange={setLocFilter}
            accentColor="green"
          />
          <MultiSelectFilter
            label="Stage"
            options={filterOptions.stages.map((s) => ({ value: s, label: s }))}
            selected={stageFilter}
            onChange={setStageFilter}
            accentColor="green"
          />
          <MultiSelectFilter
            label="M1"
            options={[{ value: "none", label: "Not Started" }, ...M1M2_STATUSES.map((s) => ({ value: s, label: s }))]}
            selected={m1Filter}
            onChange={setM1Filter}
            accentColor="green"
          />
          <MultiSelectFilter
            label="M2"
            options={[{ value: "none", label: "Not Started" }, ...M1M2_STATUSES.map((s) => ({ value: s, label: s }))]}
            selected={m2Filter}
            onChange={setM2Filter}
            accentColor="green"
          />
          <MultiSelectFilter
            label="Docs"
            options={DOC_FILTER_OPTIONS}
            selected={docStatusFilter}
            onChange={setDocStatusFilter}
            accentColor="green"
          />
          <MultiSelectFilter
            label="Cust. Paid"
            options={[
              { value: "paid", label: "Fully Paid" },
              { value: "partial", label: "Partially Paid" },
              { value: "invoiced", label: "Invoiced (Unpaid)" },
              { value: "not-invoiced", label: "Not Invoiced" },
            ]}
            selected={custPaidFilter}
            onChange={setCustPaidFilter}
            accentColor="green"
          />
          {hasFilters && (
            <button
              onClick={() => { setSearch(""); setLocFilter([]); setStageFilter([]); setM1Filter([]); setM2Filter([]); setDocStatusFilter([]); setCustPaidFilter([]); }}
              className="text-xs text-muted hover:text-foreground transition-colors"
            >
              Clear filters
            </button>
          )}
        </div>

        {/* Summary totals for filtered set */}
        {filteredTotals && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted mb-3 px-1 py-2 border-b border-border/50">
            <span className="font-medium text-foreground">{filteredTotals.count} projects</span>
            <span>PE Total: <span className="text-foreground font-medium tabular-nums">{fmt(filteredTotals.peTotal)}</span></span>
            <span>Collected: <span className="text-green-400 font-medium tabular-nums">{fmt(filteredTotals.collected)}</span></span>
            <span className="border-l border-border/50 pl-6">
              M1: <span className="text-green-400">{filteredTotals.m1Paid} paid</span>
              {filteredTotals.m1PaidVal > 0 && <span className="text-muted"> ({fmt(filteredTotals.m1PaidVal)})</span>}
              {" · "}<span className="text-emerald-400">{filteredTotals.m1Approved} approved</span>
              {filteredTotals.m1ApprovedVal > 0 && <span className="text-muted"> ({fmt(filteredTotals.m1ApprovedVal)})</span>}
            </span>
            <span className="border-l border-border/50 pl-6">
              M2: <span className="text-green-400">{filteredTotals.m2Paid} paid</span>
              {filteredTotals.m2PaidVal > 0 && <span className="text-muted"> ({fmt(filteredTotals.m2PaidVal)})</span>}
              {" · "}<span className="text-emerald-400">{filteredTotals.m2Approved} approved</span>
              {filteredTotals.m2ApprovedVal > 0 && <span className="text-muted"> ({fmt(filteredTotals.m2ApprovedVal)})</span>}
            </span>
            <span>Cust. Paid: <span className="text-foreground">{filteredTotals.custFullyPaid}</span></span>
          </div>
        )}

        {/* Project table */}
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col className="w-8" />
              {/* Deal name — flexible */}
              <col />
              <col className="w-28" />
              <col className="w-32" />
              {/* Document Status — flexible */}
              <col />
              <col className="w-28" />
              <col className="w-28" />
              <col className="w-28" />
              <col className="w-28" />
            </colgroup>
            <thead>
              <tr className="text-left text-xs text-muted border-b border-border">
                <th className="pb-2 pr-2" />
                <SortHeader label="Deal" column="deal" current={sortCol} direction={sortDir} onSort={handleSort} />
                <SortHeader label="Location" column="location" current={sortCol} direction={sortDir} onSort={handleSort} />
                <SortHeader label="PE Milestone" column="milestone" current={sortCol} direction={sortDir} onSort={handleSort} />
                <SortHeader label="Document Status" column="docs" current={sortCol} direction={sortDir} onSort={handleSort} />
                <SortHeader label="Cust. Paid" column="custPaid" current={sortCol} direction={sortDir} onSort={handleSort} />
                <SortHeader label="M1" column="m1" current={sortCol} direction={sortDir} onSort={handleSort} />
                <SortHeader label="M2" column="m2" current={sortCol} direction={sortDir} onSort={handleSort} />
                <SortHeader label="PE Total" column="peTotal" current={sortCol} direction={sortDir} onSort={handleSort} align="right" />
              </tr>
            </thead>
            {sorted.map((d) => {
              const milestone = dealStageToPeMilestone(d.dealStageLabel);
              const docSections = milestoneDocSections(milestone);
              const summary = docStatusSummary(d.dealId, docSections, docMap);
              const isExpanded = expandedDeal === d.dealId;

              return (
                <tbody key={d.dealId}>
                  <tr
                    className={`border-b border-border/50 cursor-pointer transition-colors ${isExpanded ? "bg-surface-2" : "hover:bg-surface-2/50"}`}
                    onClick={() => toggleExpand(d.dealId)}
                  >
                    <td className="py-2.5 pr-2 text-muted text-xs">
                      <span className={`inline-block transition-transform ${isExpanded ? "rotate-90" : ""}`}>&#9656;</span>
                    </td>
                    <td className="py-2.5 pr-3 truncate">
                      <div className="flex items-center gap-1.5">
                        <a
                          href={d.hubspotUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-foreground hover:text-emerald-400 transition-colors truncate"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {d.dealName}
                        </a>
                        {d.pePortalUrl && (
                          <a
                            href={d.pePortalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-emerald-500/60 hover:text-emerald-400 flex-shrink-0 transition-colors"
                            title={`PE Portal${d.peProjectId ? ` — ${d.peProjectId}` : ""}`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                            </svg>
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 text-muted text-xs truncate">{d.pbLocation}</td>
                    <td className="py-2.5 pr-3"><MilestoneBadge milestone={milestone} /></td>
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-2">
                        {summary.notReviewed < summary.total && (
                          <ProgressBar
                            approved={summary.approved}
                            underReview={summary.underReview}
                            actionRequired={summary.rejected + summary.actionRequired + summary.notUploaded}
                            total={summary.total}
                          />
                        )}
                        <span className={`text-xs whitespace-nowrap ${summaryColor(summary)}`}>
                          {summaryText(summary)}
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 pr-3"><CustomerPaymentBadge deal={d} /></td>
                    <td className="py-2.5 pr-3"><StatusBadge status={d.peM1Status} /></td>
                    <td className="py-2.5 pr-3"><StatusBadge status={d.peM2Status} /></td>
                    <td className="py-2.5 pr-3 text-right text-foreground font-medium tabular-nums">{fmt(d.pePaymentTotal)}</td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-surface-2/70">
                      <td colSpan={9} className="px-4 py-4">
                        <ProjectDocChecklist
                          dealId={d.dealId}
                          milestone={milestone}
                          docMap={docMap}
                        />
                      </td>
                    </tr>
                  )}
                </tbody>
              );
            })}
          </table>
        </div>
        {filtered.length === 0 && !isLoading && (
          <div className="text-center py-8 text-muted text-sm">No projects match your filters.</div>
        )}
      </div>

      {/* Location & Stage Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {metrics && (
          <>
            <div className="bg-surface rounded-xl border border-border p-6 shadow-card">
              <h3 className="text-sm font-semibold text-foreground mb-3">By Location</h3>
              <div className="space-y-2">
                {metrics.byLocation.map(([loc, count]) => (
                  <div key={loc} className="flex items-center justify-between">
                    <span className="text-sm text-muted">{loc || "Unknown"}</span>
                    <span className="text-sm font-medium text-foreground tabular-nums">{count}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-surface rounded-xl border border-border p-6 shadow-card">
              <h3 className="text-sm font-semibold text-foreground mb-3">By Deal Stage</h3>
              <div className="space-y-2">
                {metrics.byStage.map(([stage, count]) => (
                  <div key={stage} className="flex items-center justify-between">
                    <span className="text-sm text-muted">{stage}</span>
                    <span className="text-sm font-medium text-foreground tabular-nums">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {isLoading && <div className="text-center py-12 text-muted">Loading PE deal data from HubSpot…</div>}
    </DashboardShell>
  );
}
