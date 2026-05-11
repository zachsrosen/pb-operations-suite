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
  hubspotUrl: string;
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

function classifyDocStatus(summary: ReturnType<typeof docStatusSummary>): DocFilterCategory {
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

function docStatusSummary(
  dealId: string,
  sections: ("onboarding" | "ic" | "pc")[],
  docMap: Map<string, DocReview>,
): { approved: number; rejected: number; actionRequired: number; underReview: number; notUploaded: number; notReviewed: number; total: number } {
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
  return { approved, rejected, actionRequired, underReview, notUploaded, notReviewed, total: docs.length };
}

function summaryText(summary: ReturnType<typeof docStatusSummary>): string {
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

function summaryColor(summary: ReturnType<typeof docStatusSummary>): string {
  if (summary.notReviewed === summary.total) return "text-muted";
  if (summary.approved === summary.total) return "text-green-400";
  if (summary.rejected > 0 || summary.actionRequired > 0) return "text-orange-400";
  return "text-blue-400";
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
    <div className="flex h-2 rounded-full overflow-hidden bg-surface-2" title={`${approved} approved, ${underReview} under review, ${actionRequired} action required`}>
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

// Inline document status editor for a single document
function DocStatusSelect({ dealId, doc, review, onUpdate }: {
  dealId: string;
  doc: DocRequirement;
  review: DocReview | undefined;
  onUpdate: (dealId: string, docName: string, status: PeDocStatusValue, notes?: string) => void;
}) {
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState(review?.notes ?? "");
  const currentStatus = review?.status ?? null;

  return (
    <div className="flex items-start gap-3 py-1.5">
      {/* Status indicator */}
      <span className={`mt-1 w-2.5 h-2.5 rounded-full flex-shrink-0 ${
        currentStatus === "APPROVED" ? "bg-green-500" :
        currentStatus === "REJECTED" ? "bg-red-500" :
        currentStatus === "ACTION_REQUIRED" ? "bg-orange-500" :
        currentStatus === "UNDER_REVIEW" || currentStatus === "UPLOADED" ? "bg-blue-500" :
        currentStatus === "NOT_UPLOADED" ? "bg-zinc-500" :
        "bg-zinc-700"
      }`} />

      <div className="flex-1 min-w-0">
        {/* Doc name + owner */}
        <div className="flex items-center gap-2">
          <span className={`text-xs ${currentStatus === "APPROVED" ? "text-muted line-through" : "text-foreground"}`}>
            {doc.name}
          </span>
          <span className="text-[10px] text-muted/50">{doc.owner}</span>
        </div>

        {/* Note from PE doc definition */}
        {doc.note && currentStatus !== "APPROVED" && (
          <div className="text-[10px] text-muted/60 mt-0.5">{doc.note}</div>
        )}

        {/* Review notes */}
        {review?.notes && !editingNotes && (
          <div
            className="text-[10px] text-orange-400/80 mt-0.5 cursor-pointer hover:text-orange-300"
            onClick={(e) => { e.stopPropagation(); setEditingNotes(true); setNotesDraft(review.notes ?? ""); }}
          >
            Note: {review.notes}
          </div>
        )}

        {/* Notes editor */}
        {editingNotes && (
          <div className="flex items-center gap-1 mt-1" onClick={(e) => e.stopPropagation()}>
            <input
              type="text"
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              placeholder="Add a note (e.g. rejection reason)…"
              className="text-[10px] bg-surface border border-border rounded px-1.5 py-0.5 text-foreground flex-1 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onUpdate(dealId, doc.name, currentStatus || "NOT_UPLOADED", notesDraft || undefined);
                  setEditingNotes(false);
                }
                if (e.key === "Escape") setEditingNotes(false);
              }}
            />
            <button
              onClick={() => { onUpdate(dealId, doc.name, currentStatus || "NOT_UPLOADED", notesDraft || undefined); setEditingNotes(false); }}
              className="text-[10px] text-emerald-400 hover:text-emerald-300"
            >Save</button>
            <button onClick={() => setEditingNotes(false)} className="text-[10px] text-muted hover:text-foreground">Cancel</button>
          </div>
        )}

        {/* Reviewed timestamp */}
        {review && (
          <div className="text-[10px] text-muted/40 mt-0.5">
            Reviewed {new Date(review.reviewedAt).toLocaleDateString()}{review.reviewedBy ? ` by ${review.reviewedBy}` : ""}
          </div>
        )}
      </div>

      {/* Status dropdown */}
      <select
        value={currentStatus ?? ""}
        onChange={(e) => {
          e.stopPropagation();
          if (e.target.value) onUpdate(dealId, doc.name, e.target.value as PeDocStatusValue);
        }}
        onClick={(e) => e.stopPropagation()}
        className={`text-[10px] rounded border px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-500/50 cursor-pointer ${
          currentStatus ? DOC_STATUS_COLORS[currentStatus] : "bg-surface-2 text-muted border-border"
        }`}
      >
        <option value="">— Set status —</option>
        {DOC_STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      {/* Add/edit notes button */}
      {!editingNotes && (
        <button
          onClick={(e) => { e.stopPropagation(); setEditingNotes(true); setNotesDraft(review?.notes ?? ""); }}
          className="text-[10px] text-muted hover:text-foreground mt-0.5 flex-shrink-0"
          title="Add note"
        >
          {review?.notes ? "Edit" : "+Note"}
        </button>
      )}
    </div>
  );
}

// Document checklist for an expanded project row — adapts grid to section count
function ProjectDocChecklist({ dealId, milestone, docMap, onUpdate }: {
  dealId: string;
  milestone: PeMilestone;
  docMap: Map<string, DocReview>;
  onUpdate: (dealId: string, docName: string, status: PeDocStatusValue, notes?: string) => void;
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
                <DocStatusSelect
                  key={doc.name}
                  dealId={dealId}
                  doc={doc}
                  review={review}
                  onUpdate={onUpdate}
                />
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

  const { data: docsData } = useQuery<{ docs: DocReview[] }>({
    queryKey: ["peDocReviews"],
    queryFn: () => fetch("/api/accounting/pe-docs").then((r) => r.json()),
    staleTime: 60 * 1000,
  });

  const docMap = useMemo(() => {
    const m = new Map<string, DocReview>();
    for (const d of docsData?.docs ?? []) {
      m.set(`${d.dealId}:${d.docName}`, d);
    }
    return m;
  }, [docsData]);

  const updateDocMutation = useMutation({
    mutationFn: async ({ dealId, docName, status, notes }: {
      dealId: string; docName: string; status: PeDocStatusValue; notes?: string;
    }) => {
      const res = await fetch("/api/accounting/pe-docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId, docName, status, notes }),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onMutate: async ({ dealId, docName, status, notes }) => {
      await queryClient.cancelQueries({ queryKey: ["peDocReviews"] });
      const prev = queryClient.getQueryData<{ docs: DocReview[] }>(["peDocReviews"]);

      queryClient.setQueryData<{ docs: DocReview[] }>(["peDocReviews"], (old) => {
        if (!old) return { docs: [] };
        const key = `${dealId}:${docName}`;
        const existing = old.docs.find((d) => `${d.dealId}:${d.docName}` === key);
        if (existing) {
          return {
            docs: old.docs.map((d) =>
              `${d.dealId}:${d.docName}` === key
                ? { ...d, status, notes: notes ?? d.notes, reviewedAt: new Date().toISOString() }
                : d,
            ),
          };
        }
        return {
          docs: [
            ...old.docs,
            { id: "temp", dealId, docName, status, notes: notes ?? null, reviewedAt: new Date().toISOString(), reviewedBy: null },
          ],
        };
      });

      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) queryClient.setQueryData(["peDocReviews"], context.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["peDocReviews"] });
    },
  });

  const handleDocUpdate = useCallback((dealId: string, docName: string, status: PeDocStatusValue, notes?: string) => {
    updateDocMutation.mutate({ dealId, docName, status, notes });
  }, [updateDocMutation]);

  const deals = data?.deals ?? [];

  // Filter state — all multi-select (empty array = all)
  const [search, setSearch] = useState("");
  const [locFilter, setLocFilter] = useState<string[]>([]);
  const [stageFilter, setStageFilter] = useState<string[]>([]);
  const [m1Filter, setM1Filter] = useState<string[]>([]);
  const [m2Filter, setM2Filter] = useState<string[]>([]);
  const [docStatusFilter, setDocStatusFilter] = useState<string[]>([]);
  const [expandedDeal, setExpandedDeal] = useState<string | null>(null);

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
      return true;
    });
  }, [deals, search, locFilter, stageFilter, m1Filter, m2Filter, docStatusFilter, docMap]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedDeal((prev) => (prev === id ? null : id));
  }, []);

  // Compute live metrics from ALL deals (unfiltered)
  const metrics = useMemo(() => {
    if (!deals.length) return null;

    const totalDeals = deals.length;
    const totalEpcValue = deals.reduce((s, d) => s + (d.epcPrice ?? 0), 0);
    const totalPePayment = deals.reduce((s, d) => s + (d.pePaymentTotal ?? 0), 0);

    const m1Paid = deals.filter((d) => d.peM1Status === "Paid").length;
    const m1Approved = deals.filter((d) => d.peM1Status === "Approved").length;
    const m1Submitted = deals.filter((d) => ["Submitted", "Resubmitted"].includes(d.peM1Status ?? "")).length;
    const m1Ready = deals.filter((d) => d.peM1Status === "Ready to Submit").length;
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

    // Doc review stats
    let totalDocs = 0, reviewedDocs = 0, approvedDocs = 0, rejectedDocs = 0, actionReqDocs = 0;
    for (const d of deals) {
      const milestone = dealStageToPeMilestone(d.dealStageLabel);
      const sections = milestoneDocSections(milestone);
      const summary = docStatusSummary(d.dealId, sections, docMap);
      totalDocs += summary.total;
      reviewedDocs += summary.total - summary.notReviewed;
      approvedDocs += summary.approved;
      rejectedDocs += summary.rejected;
      actionReqDocs += summary.actionRequired;
    }

    return {
      totalDeals, totalEpcValue, totalPePayment,
      m1: { paid: m1Paid, approved: m1Approved, submitted: m1Submitted, ready: m1Ready, notStarted: m1NotStarted },
      m2: { paid: m2Paid, approved: m2Approved, submitted: m2Submitted, ready: m2Ready, notStarted: m2NotStarted },
      collected, collectPct, readyToInvoice,
      m1PaidValue, m2PaidValue, m1ApprovedValue, m2ApprovedValue,
      byLocation: [...byLocation.entries()].sort((a, b) => b[1] - a[1]),
      byStage: [...byStage.entries()].sort((a, b) => b[1] - a[1]),
      docs: { totalDocs, reviewedDocs, approvedDocs, rejectedDocs, actionReqDocs },
    };
  }, [deals, docMap]);

  const hasFilters = search || locFilter.length > 0 || stageFilter.length > 0 || m1Filter.length > 0 || m2Filter.length > 0 || docStatusFilter.length > 0;

  return (
    <DashboardShell title="PE Program Report" accentColor="emerald" lastUpdated={data?.lastUpdated} fullWidth>
      {/* Report Header */}
      <div className="mb-8">
        <p className="text-muted text-sm">
          Participate Energy program overview for Photon Brothers leadership.
          HubSpot data is live; PE portal document data last captured 2026-05-10.
        </p>
      </div>

      {/* Hero Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8 stagger-grid">
        <StatCard label="Total PE Deals" value={metrics?.totalDeals ?? null} subtitle="Active in project pipeline" color="emerald" />
        <StatCard label="Total EPC Value" value={metrics ? fmt(metrics.totalEpcValue) : null} subtitle="Across all PE projects" color="blue" />
        <StatCard label="PE Revenue Collected" value={metrics ? fmt(metrics.collected) : null} subtitle={metrics ? `${fmtPct(metrics.collectPct)} of ${fmt(metrics.totalPePayment)}` : undefined} color="green" />
        <StatCard label="Ready to Invoice" value={metrics ? fmt(metrics.readyToInvoice) : null} subtitle="Approved, awaiting invoice" color={metrics && metrics.readyToInvoice > 0 ? "orange" : "green"} />
      </div>

      {/* Document Review Stats */}
      {metrics && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8 stagger-grid">
          <MiniStat label="Total Documents" value={metrics.docs.totalDocs} />
          <MiniStat label="Reviewed" value={`${metrics.docs.reviewedDocs} / ${metrics.docs.totalDocs}`} />
          <MiniStat label="Approved" value={metrics.docs.approvedDocs} />
          <MiniStat label="Rejected" value={metrics.docs.rejectedDocs} />
          <MiniStat label="Action Required" value={metrics.docs.actionReqDocs} />
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
          {hasFilters && (
            <button
              onClick={() => { setSearch(""); setLocFilter([]); setStageFilter([]); setM1Filter([]); setM2Filter([]); setDocStatusFilter([]); }}
              className="text-xs text-muted hover:text-foreground transition-colors"
            >
              Clear filters
            </button>
          )}
        </div>

        {/* Project table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-border">
                <th className="pb-2 pr-3 w-6" />
                <th className="pb-2 pr-4">Deal</th>
                <th className="pb-2 pr-4">Location</th>
                <th className="pb-2 pr-4">PE Milestone</th>
                <th className="pb-2 pr-4">Document Status</th>
                <th className="pb-2 pr-4">M1</th>
                <th className="pb-2 pr-4">M2</th>
                <th className="pb-2 pr-4 text-right">PE Total</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => {
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
                      <td className="py-2.5 pr-3 text-muted text-xs">
                        <span className={`inline-block transition-transform ${isExpanded ? "rotate-90" : ""}`}>&#9656;</span>
                      </td>
                      <td className="py-2.5 pr-4">
                        <a
                          href={d.hubspotUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-foreground hover:text-emerald-400 transition-colors"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {d.dealName}
                        </a>
                      </td>
                      <td className="py-2.5 pr-4 text-muted text-xs">{d.pbLocation}</td>
                      <td className="py-2.5 pr-4"><MilestoneBadge milestone={milestone} /></td>
                      <td className="py-2.5 pr-4">
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
                      <td className="py-2.5 pr-4"><StatusBadge status={d.peM1Status} /></td>
                      <td className="py-2.5 pr-4"><StatusBadge status={d.peM2Status} /></td>
                      <td className="py-2.5 pr-4 text-right text-foreground font-medium tabular-nums">{fmt(d.pePaymentTotal)}</td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-surface-2/70">
                        <td colSpan={8} className="px-4 py-4">
                          <ProjectDocChecklist
                            dealId={d.dealId}
                            milestone={milestone}
                            docMap={docMap}
                            onUpdate={handleDocUpdate}
                          />
                        </td>
                      </tr>
                    )}
                  </tbody>
                );
              })}
            </tbody>
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
