"use client";

import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { StatCard, MiniStat } from "@/components/ui/MetricCard";
import { queryKeys } from "@/lib/query-keys";

// ---------------------------------------------------------------------------
// Types (mirrors PE deals API response)
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

// PE portal document status snapshot — updated manually from raceway.participate.energy
const PE_PORTAL_SNAPSHOT = {
  lastUpdated: "2026-05-08",
  totalProjects: 286,
  byStatus: { actionRequired: 166, underReview: 113, approved: 7, drafts: 6 },
  byMilestone: { onboarded: 244, ic: 26, pc: 5 },
  pcProjects: [
    { customer: "Benjamin Burnham", projectId: "CO2601-BURN3", location: "Erie, CO", approved: 15, underReview: 0, actionRequired: 0, status: "ready" as const, blockers: [] as string[] },
    { customer: "Sarah Skigen-Caird", projectId: "CO2602-CAIR1", location: "Golden, CO", approved: 15, underReview: 0, actionRequired: 0, status: "ready" as const, blockers: [] },
    { customer: "David Rose", projectId: "CO2601-ROSE4", location: "Boulder, CO", approved: 13, underReview: 2, actionRequired: 0, status: "waiting" as const, blockers: ["Photos per Policy (V7)", "Cond. Progress Lien Waiver (V3)"] },
    { customer: "Bradley Baker", projectId: "CO2601-BAKE1", location: "Colorado Springs, CO", approved: 13, underReview: 1, actionRequired: 1, status: "blocked" as const, blockers: ["Photos per Policy (not uploaded)", "Cond. Progress Lien Waiver"] },
    { customer: "Tin Aung", projectId: "CO2603-AUNG2", location: "Colorado Springs, CO", approved: 11, underReview: 2, actionRequired: 2, status: "blocked" as const, blockers: ["Customer Agreement PPA/ESA", "Photos per Policy", "Cond. Progress Lien Waiver", "Cond. Waiver Final Payment"] },
  ],
  topBlockers: [
    { doc: "Photos per Policy", section: "IC / PC", frequency: "Nearly every project", note: "Often requires 3–7 resubmissions" },
    { doc: "Design Plan", section: "IC", frequency: "Very common", note: "Second most frequent IC blocker" },
    { doc: "Customer Agreement (PPA/ESA)", section: "Onboarding", frequency: "Common", note: "Still incomplete on many IC-stage projects" },
    { doc: "Installation Order", section: "Onboarding", frequency: "Common", note: "Same pattern as Customer Agreement" },
    { doc: "Cond. Progress Lien Waiver", section: "IC", frequency: "Most projects", note: "Typically Under Review by PE" },
    { doc: "Access to Monitoring", section: "IC", frequency: "Moderate", note: "Requires monitoring platform credentials" },
  ],
  complianceDocs: [
    { name: "W-9", status: "missing" as const },
    { name: "ACORD Certificate of Insurance", status: "missing" as const },
    { name: "Voided check or bank letter", status: "missing" as const },
  ],
};

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

function DocStatusBadge({ status }: { status: "ready" | "waiting" | "blocked" }) {
  const map = {
    ready: { label: "Ready for Payment", cls: "bg-green-500/20 text-green-400 border-green-500/30" },
    waiting: { label: "Waiting on PE", cls: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
    blocked: { label: "PB Action Needed", cls: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  };
  const { label, cls } = map[status];
  return <span className={`text-xs px-2 py-0.5 rounded-full border ${cls}`}>{label}</span>;
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

// Document checklist for an expanded project row
function ProjectDocChecklist({ milestone, m1Status, m2Status }: {
  milestone: PeMilestone;
  m1Status: string | null;
  m2Status: string | null;
}) {
  const sections = milestoneDocSections(milestone);
  const sectionLabel: Record<string, string> = {
    onboarding: "Onboarding",
    ic: "Inspection Complete (M1)",
    pc: "Project Complete (M2)",
  };
  const sectionStatus: Record<string, string | null> = {
    onboarding: null,
    ic: m1Status,
    pc: m2Status,
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {sections.map((sec) => {
        const docs = PE_DOCUMENTS.filter((d) => d.section === sec);
        const status = sectionStatus[sec];
        const isComplete = status === "Paid" || status === "Approved";
        const isSubmitted = status === "Submitted" || status === "Resubmitted";
        return (
          <div key={sec} className="bg-surface-2 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-foreground">{sectionLabel[sec]}</span>
              {status && <StatusBadge status={status} />}
            </div>
            <div className="space-y-1.5">
              {docs.map((doc) => (
                <div key={doc.name} className="flex items-start gap-2">
                  <span className={`mt-0.5 w-3.5 h-3.5 rounded flex-shrink-0 flex items-center justify-center text-[9px] ${
                    isComplete
                      ? "bg-green-500/30 text-green-400"
                      : isSubmitted
                        ? "bg-blue-500/30 text-blue-400"
                        : "bg-surface border border-border text-muted"
                  }`}>
                    {isComplete ? "✓" : isSubmitted ? "…" : ""}
                  </span>
                  <div className="min-w-0">
                    <div className={`text-xs ${isComplete ? "text-muted line-through" : "text-foreground"}`}>
                      {doc.name}
                    </div>
                    {doc.note && !isComplete && (
                      <div className="text-[10px] text-muted/60">{doc.note}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter select component
// ---------------------------------------------------------------------------

function FilterSelect({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-muted whitespace-nowrap">{label}:</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-xs bg-surface-2 border border-border rounded-lg px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function PeReportPage() {
  const { data, isLoading } = useQuery<{ deals: PeDeal[]; lastUpdated: string }>({
    queryKey: queryKeys.peDeals.list(),
    queryFn: () => fetch("/api/accounting/pe-deals").then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  const deals = data?.deals ?? [];

  // Filter state
  const [search, setSearch] = useState("");
  const [locFilter, setLocFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [m1Filter, setM1Filter] = useState("all");
  const [m2Filter, setM2Filter] = useState("all");
  const [expandedDeal, setExpandedDeal] = useState<string | null>(null);

  // Unique values for filter dropdowns
  const filterOptions = useMemo(() => {
    const locations = [...new Set(deals.map((d) => d.pbLocation).filter(Boolean))].sort();
    const stages = [...new Set(deals.map((d) => d.dealStageLabel).filter(Boolean))].sort();
    return { locations, stages };
  }, [deals]);

  // Filtered deals
  const filtered = useMemo(() => {
    return deals.filter((d) => {
      if (search) {
        const q = search.toLowerCase();
        if (!d.dealName.toLowerCase().includes(q) && !d.pbLocation.toLowerCase().includes(q)) return false;
      }
      if (locFilter !== "all" && d.pbLocation !== locFilter) return false;
      if (stageFilter !== "all" && d.dealStageLabel !== stageFilter) return false;
      if (m1Filter !== "all") {
        if (m1Filter === "none" && d.peM1Status) return false;
        if (m1Filter !== "none" && d.peM1Status !== m1Filter) return false;
      }
      if (m2Filter !== "all") {
        if (m2Filter === "none" && d.peM2Status) return false;
        if (m2Filter !== "none" && d.peM2Status !== m2Filter) return false;
      }
      return true;
    });
  }, [deals, search, locFilter, stageFilter, m1Filter, m2Filter]);

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

    return {
      totalDeals, totalEpcValue, totalPePayment,
      m1: { paid: m1Paid, approved: m1Approved, submitted: m1Submitted, ready: m1Ready, notStarted: m1NotStarted },
      m2: { paid: m2Paid, approved: m2Approved, submitted: m2Submitted, ready: m2Ready, notStarted: m2NotStarted },
      collected, collectPct, readyToInvoice,
      m1PaidValue, m2PaidValue, m1ApprovedValue, m2ApprovedValue,
      byLocation: [...byLocation.entries()].sort((a, b) => b[1] - a[1]),
      byStage: [...byStage.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [deals]);

  const snap = PE_PORTAL_SNAPSHOT;
  const hasFilters = search || locFilter !== "all" || stageFilter !== "all" || m1Filter !== "all" || m2Filter !== "all";

  return (
    <DashboardShell title="PE Program Report" accentColor="emerald" lastUpdated={data?.lastUpdated} fullWidth>
      {/* Report Header */}
      <div className="mb-8">
        <p className="text-muted text-sm">
          Participate Energy program overview for Photon Brothers leadership.
          HubSpot data is live; PE portal document status last updated {snap.lastUpdated}.
        </p>
      </div>

      {/* Hero Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8 stagger-grid">
        <StatCard label="Total PE Deals" value={metrics?.totalDeals ?? null} subtitle="Active in project pipeline" color="emerald" />
        <StatCard label="Total EPC Value" value={metrics ? fmt(metrics.totalEpcValue) : null} subtitle="Across all PE projects" color="blue" />
        <StatCard label="PE Revenue Collected" value={metrics ? fmt(metrics.collected) : null} subtitle={metrics ? `${fmtPct(metrics.collectPct)} of ${fmt(metrics.totalPePayment)}` : undefined} color="green" />
        <StatCard label="Ready to Invoice" value={metrics ? fmt(metrics.readyToInvoice) : null} subtitle="Approved, awaiting invoice" color={metrics && metrics.readyToInvoice > 0 ? "orange" : "green"} />
      </div>

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
            <h3 className="text-lg font-semibold text-foreground">All PE Projects — Document Requirements</h3>
            <p className="text-xs text-muted">Click a row to see required documents for that project&apos;s milestone. {filtered.length} of {deals.length} projects shown.</p>
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
          <FilterSelect
            label="Location"
            value={locFilter}
            onChange={setLocFilter}
            options={[{ value: "all", label: "All" }, ...filterOptions.locations.map((l) => ({ value: l, label: l }))]}
          />
          <FilterSelect
            label="Stage"
            value={stageFilter}
            onChange={setStageFilter}
            options={[{ value: "all", label: "All" }, ...filterOptions.stages.map((s) => ({ value: s, label: s }))]}
          />
          <FilterSelect
            label="M1"
            value={m1Filter}
            onChange={setM1Filter}
            options={[{ value: "all", label: "All" }, { value: "none", label: "Not Started" }, ...M1M2_STATUSES.map((s) => ({ value: s, label: s }))]}
          />
          <FilterSelect
            label="M2"
            value={m2Filter}
            onChange={setM2Filter}
            options={[{ value: "all", label: "All" }, { value: "none", label: "Not Started" }, ...M1M2_STATUSES.map((s) => ({ value: s, label: s }))]}
          />
          {hasFilters && (
            <button
              onClick={() => { setSearch(""); setLocFilter("all"); setStageFilter("all"); setM1Filter("all"); setM2Filter("all"); }}
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
                <th className="pb-2 pr-4">Stage</th>
                <th className="pb-2 pr-4">PE Milestone</th>
                <th className="pb-2 pr-4">Docs Needed</th>
                <th className="pb-2 pr-4">M1</th>
                <th className="pb-2 pr-4">M2</th>
                <th className="pb-2 pr-4 text-right">PE Total</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => {
                const milestone = dealStageToPeMilestone(d.dealStageLabel);
                const docSections = milestoneDocSections(milestone);
                const totalDocs = docSections.reduce((s, sec) => s + PE_DOCUMENTS.filter((doc) => doc.section === sec).length, 0);
                const isExpanded = expandedDeal === d.dealId;

                return (
                  <tbody key={d.dealId}>
                    <tr
                      className={`border-b border-border/50 cursor-pointer transition-colors ${isExpanded ? "bg-surface-2" : "hover:bg-surface-2/50"}`}
                      onClick={() => toggleExpand(d.dealId)}
                    >
                      <td className="py-2.5 pr-3 text-muted text-xs">
                        <span className={`inline-block transition-transform ${isExpanded ? "rotate-90" : ""}`}>▸</span>
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
                      <td className="py-2.5 pr-4 text-muted text-xs">{d.dealStageLabel}</td>
                      <td className="py-2.5 pr-4"><MilestoneBadge milestone={milestone} /></td>
                      <td className="py-2.5 pr-4">
                        <span className="text-xs text-muted">
                          {totalDocs} docs across {docSections.length} section{docSections.length > 1 ? "s" : ""}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4"><StatusBadge status={d.peM1Status} /></td>
                      <td className="py-2.5 pr-4"><StatusBadge status={d.peM2Status} /></td>
                      <td className="py-2.5 pr-4 text-right text-foreground font-medium tabular-nums">{fmt(d.pePaymentTotal)}</td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-surface-2/70">
                        <td colSpan={9} className="px-4 py-4">
                          <ProjectDocChecklist milestone={milestone} m1Status={d.peM1Status} m2Status={d.peM2Status} />
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

      {/* ── PE Portal Document Status (snapshot) ── */}
      <div className="bg-surface rounded-xl border border-border p-6 shadow-card mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground">PE Portal Status Snapshot</h3>
            <p className="text-xs text-muted">Source: raceway.participate.energy — {snap.lastUpdated}</p>
          </div>
          <div className="flex gap-3 text-xs">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-green-500" /> Approved</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-blue-500" /> Under Review</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-orange-500" /> Action Required</span>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <MiniStat label="Total Projects" value={snap.totalProjects} />
          <MiniStat label="Action Required" value={snap.byStatus.actionRequired} />
          <MiniStat label="Under Review" value={snap.byStatus.underReview} />
          <MiniStat label="Approved" value={snap.byStatus.approved} />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-surface-2 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-foreground">{snap.byMilestone.onboarded}</div>
            <div className="text-xs text-muted">Onboarded</div>
            <div className="text-[10px] text-muted mt-1">Early stage — docs being collected</div>
          </div>
          <div className="bg-surface-2 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-foreground">{snap.byMilestone.ic}</div>
            <div className="text-xs text-muted">Inspection Complete (M1)</div>
            <div className="text-[10px] text-muted mt-1">23 action required · 3 under review</div>
          </div>
          <div className="bg-surface-2 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-foreground">{snap.byMilestone.pc}</div>
            <div className="text-xs text-muted">Project Complete (M2)</div>
            <div className="text-[10px] text-muted mt-1">2 ready for payment · 3 need work</div>
          </div>
        </div>
      </div>

      {/* PC Projects Detail */}
      <div className="bg-surface rounded-xl border border-border p-6 shadow-card mb-8">
        <h3 className="text-lg font-semibold text-foreground mb-1">Project Complete (M2) — Document Detail</h3>
        <p className="text-xs text-muted mb-4">These 5 projects have reached PTO and are closest to PE M2 payment</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-border">
                <th className="pb-2 pr-4">Customer</th>
                <th className="pb-2 pr-4">Project ID</th>
                <th className="pb-2 pr-4">Location</th>
                <th className="pb-2 pr-4">Progress</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2">Blockers</th>
              </tr>
            </thead>
            <tbody>
              {snap.pcProjects.map((p) => (
                <tr key={p.projectId} className="border-b border-border/50 last:border-0">
                  <td className="py-3 pr-4 font-medium text-foreground">{p.customer}</td>
                  <td className="py-3 pr-4 text-muted font-mono text-xs">{p.projectId}</td>
                  <td className="py-3 pr-4 text-muted">{p.location}</td>
                  <td className="py-3 pr-4 w-40">
                    <ProgressBar approved={p.approved} underReview={p.underReview} actionRequired={p.actionRequired} total={p.approved + p.underReview + p.actionRequired} />
                    <div className="text-[10px] text-muted mt-1">{p.approved} approved · {p.underReview} review · {p.actionRequired} action</div>
                  </td>
                  <td className="py-3 pr-4"><DocStatusBadge status={p.status} /></td>
                  <td className="py-3">
                    {p.blockers.length === 0 ? (
                      <span className="text-green-400 text-xs">All documents approved</span>
                    ) : (
                      <ul className="text-xs text-muted space-y-0.5">
                        {p.blockers.map((b) => <li key={b}>• {b}</li>)}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Top Blockers + Compliance + Recommendations */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="bg-surface rounded-xl border border-border p-6 shadow-card">
          <h3 className="text-lg font-semibold text-foreground mb-1">Top Document Blockers</h3>
          <p className="text-xs text-muted mb-4">Most common reasons projects are stuck in the PE portal</p>
          <div className="space-y-3">
            {snap.topBlockers.map((b, i) => (
              <div key={b.doc} className="flex items-start gap-3">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-orange-500/20 text-orange-400 flex items-center justify-center text-xs font-bold">{i + 1}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground">{b.doc}</div>
                  <div className="text-xs text-muted">{b.section} · {b.frequency}</div>
                  <div className="text-xs text-muted/70 mt-0.5">{b.note}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-6">
          <div className="bg-surface rounded-xl border border-red-500/30 p-6 shadow-card">
            <h3 className="text-lg font-semibold text-foreground mb-1">Account Compliance</h3>
            <p className="text-xs text-muted mb-4">Company-level docs required by PE — may block all payments</p>
            <div className="space-y-2">
              {snap.complianceDocs.map((d) => (
                <div key={d.name} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                  <span className="text-sm text-foreground">{d.name}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full border bg-red-500/20 text-red-400 border-red-500/30">Missing</span>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-surface rounded-xl border border-emerald-500/30 p-6 shadow-card">
            <h3 className="text-lg font-semibold text-foreground mb-3">Recommendations</h3>
            <ol className="space-y-2 text-sm text-muted list-decimal list-inside">
              <li><span className="text-foreground font-medium">Collect M2 on Burnham &amp; Skigen-Caird</span> — all docs approved, ready for payment</li>
              <li><span className="text-foreground font-medium">Upload Photos per Policy for Baker</span> — only blocker on a PC project</li>
              <li><span className="text-foreground font-medium">Upload 3 company compliance docs</span> — W-9, insurance cert, voided check</li>
              <li><span className="text-foreground font-medium">Standardize Photos per Policy process</span> — #1 blocker across all projects, high rejection rate</li>
              <li><span className="text-foreground font-medium">Clear Onboarding doc backlog</span> — Customer Agreement + Installation Order missing on many IC projects</li>
            </ol>
          </div>
        </div>
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
