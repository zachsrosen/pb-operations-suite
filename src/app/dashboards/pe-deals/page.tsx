"use client";

import React, { useState, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { StatCard } from "@/components/ui/MetricCard";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import { queryKeys } from "@/lib/query-keys";

// ---------------------------------------------------------------------------
// Types (mirrors API response)
// ---------------------------------------------------------------------------

// M1 has an onboarding phase before submission; M2 does not.
// Sourced from HubSpot property definitions for pe_m1_status / pe_m2_status.
const M1_OPTIONS = [
  "",
  "Ready for Onboarding",
  "Onboarding Submitted",
  "Onboarding Rejected",
  "Onboarding Ready to Resubmit",
  "Onboarding Resubmitted",
  "Ready to Submit",
  "Waiting on Information",
  "Submitted",
  "Rejected",
  "Ready to Resubmit",
  "Resubmitted",
  "Approved",
  "Paid",
] as const;

const M2_OPTIONS = [
  "",
  "Ready to Submit",
  "Waiting on Information",
  "Submitted",
  "Rejected",
  "Ready to Resubmit",
  "Resubmitted",
  "Approved",
  "Paid",
] as const;

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
  postalCode: string | null;
  energyCommunity: boolean;
  ecLookupFailed: boolean;
  solarDC: boolean;
  batteryDC: boolean;
  leaseFactor: number;
  peM1Status: string | null;
  peM2Status: string | null;
  milestoneHighlight: "m1" | "m2" | "complete" | null;
  hubspotUrl: string;
  pePortalUrl: string | null;
  peProjectId: string | null;
  docReviews: DocReviewFromHS[];
  paidInFull: boolean;
  daInvoiceStatus: string | null;
  ccInvoiceStatus: string | null;
}

// Customer payment bucket — Paid / Partial / Pending
// Matches the pe-report convention: paid_in_full flag OR both DA + CC milestones marked Paid.
type CustomerPaidStatus = "paid" | "partial" | "pending";
function customerPaidStatus(deal: PeDeal): CustomerPaidStatus {
  const daPaid = deal.daInvoiceStatus === "Paid";
  const ccPaid = deal.ccInvoiceStatus === "Paid";
  if (deal.paidInFull || (daPaid && ccPaid)) return "paid";
  if (daPaid || ccPaid) return "partial";
  return "pending";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const LOCATION_SHORT: Record<string, string> = {
  "Centennial": "DTC",
  "Westminster": "WST",
  "Colorado Springs": "CSP",
  "San Luis Obispo": "SLO",
  "Camarillo": "CAM",
};

function shortLocation(loc: string): string {
  return LOCATION_SHORT[loc] || loc.slice(0, 3).toUpperCase();
}

function shortType(t: string): string {
  if (t === "solar+battery") return "PV+ESS";
  if (t === "solar") return "PV";
  if (t === "battery") return "ESS";
  return t;
}

function truncateName(name: string, max = 20): string {
  if (name.length <= max) return name;
  return name.slice(0, max) + "…";
}

// ---------------------------------------------------------------------------
// PE Document requirements + milestone mapping (shared with pe-docs)
// ---------------------------------------------------------------------------

interface DocReview {
  dealId: string;
  docName: string;
  status: "NOT_UPLOADED" | "UPLOADED" | "UNDER_REVIEW" | "ACTION_REQUIRED" | "REJECTED" | "APPROVED";
  notes: string | null;
}

interface DocRequirement {
  name: string;
  section: "onboarding" | "ic" | "pc";
  owner: "PB" | "Customer" | "PE";
  note?: string;
}

const PE_DOCUMENTS: DocRequirement[] = [
  { name: "Customer Agreement (PPA/ESA)", section: "onboarding", owner: "Customer" },
  { name: "Installation Order", section: "onboarding", owner: "PB" },
  { name: "State Disclosures", section: "onboarding", owner: "PB" },
  { name: "Utility Bill", section: "onboarding", owner: "Customer" },
  { name: "Signed Proposal", section: "ic", owner: "PB" },
  { name: "Design Plan", section: "ic", owner: "PB" },
  { name: "Photos per Policy", section: "ic", owner: "PB" },
  { name: "Signed Final Permit", section: "ic", owner: "PB" },
  { name: "Access to Monitoring", section: "ic", owner: "PB" },
  { name: "Certificate of Acceptance", section: "ic", owner: "PB" },
  { name: "Attestation of Customer Payment", section: "ic", owner: "PB" },
  { name: "Conditional Progress Lien Waiver", section: "ic", owner: "PB" },
  { name: "Signed Interconnection Agreement", section: "pc", owner: "PB" },
  { name: "Conditional Waiver — Final Payment", section: "pc", owner: "PB" },
  { name: "Permission to Operate (PTO)", section: "pc", owner: "PB" },
];

const DOC_SECTION_LABELS: Record<string, string> = {
  onboarding: "Onboarding",
  ic: "Inspection Complete (M1)",
  pc: "Project Complete (M2)",
};

const DOC_STATUS_DOT: Record<string, string> = {
  APPROVED: "bg-green-500",
  REJECTED: "bg-red-500",
  ACTION_REQUIRED: "bg-orange-500",
  UNDER_REVIEW: "bg-blue-500",
  UPLOADED: "bg-blue-500",
  NOT_UPLOADED: "bg-zinc-500",
};

const DOC_STATUS_LABEL: Record<string, string> = {
  APPROVED: "Approved",
  REJECTED: "Rejected",
  ACTION_REQUIRED: "Action Required",
  UNDER_REVIEW: "Under Review",
  UPLOADED: "Uploaded",
  NOT_UPLOADED: "Not Uploaded",
};

function dealDocSections(stageLabel: string): ("onboarding" | "ic" | "pc")[] {
  const s = stageLabel.toLowerCase();
  if (s.includes("complete") || s.includes("close out") || s.includes("pto") || s.includes("permission to operate"))
    return ["onboarding", "ic", "pc"];
  if (s.includes("inspection")) return ["onboarding", "ic"];
  return ["onboarding"];
}

type SortKey = keyof PeDeal;
type SortDir = "asc" | "desc";

function sortDeals(deals: PeDeal[], key: SortKey, dir: SortDir): PeDeal[] {
  return [...deals].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") {
      return dir === "asc" ? av - bv : bv - av;
    }
    return dir === "asc"
      ? String(av).localeCompare(String(bv))
      : String(bv).localeCompare(String(av));
  });
}

// ---------------------------------------------------------------------------
// Section component — renders a labeled table of deals
// ---------------------------------------------------------------------------

/** [sortKey, label, headerAlign] — headerAlign defaults to "text-left" */
const COLUMNS: [SortKey, string, string?][] = [
  ["dealName", "Deal"],
  ["pbLocation", "Loc"],
  ["dealStageLabel", "Stage"],
  ["closeDate", "Close"],
  ["systemType", "Type"],
  ["energyCommunity", "EC", "text-center"],
  ["leaseFactor", "Factor", "text-right"],
  ["epcPrice", "EPC", "text-right"],
  ["customerPays", "Cust.", "text-right"],
  ["paidInFull", "Cust Paid?", "text-center"],
  ["pePaymentTotal", "PE Tot", "text-right"],
  ["pePaymentIC", "PE IC", "text-right"],
  ["pePaymentPC", "PE PC", "text-right"],
  ["totalPBRevenue", "Revenue", "text-right"],
  ["peM1Status", "M1"],
  ["peM2Status", "M2"],
];

function StatusDropdown({
  value,
  onChange,
  saving,
  options,
}: {
  value: string | null;
  onChange: (val: string) => void;
  saving: boolean;
  options: readonly string[];
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      disabled={saving}
      title={value || ""}
      className={`text-xs rounded px-1 py-0.5 border border-border bg-surface-2 text-foreground cursor-pointer hover:bg-surface-elevated transition-colors max-w-[80px] truncate ${saving ? "opacity-50" : ""}`}
    >
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt || "—"}
        </option>
      ))}
    </select>
  );
}

function DealSection({
  title,
  subtitle,
  accent,
  deals,
  sortKey,
  sortDir,
  sortArrow,
  toggleSort,
  onStatusChange,
  savingDeals,
  docMap,
  defaultCollapsed = false,
}: {
  title: string;
  subtitle: string;
  accent?: "orange" | "emerald";
  deals: PeDeal[];
  sortKey: SortKey;
  sortDir: SortDir;
  sortArrow: (key: SortKey) => string;
  toggleSort: (key: SortKey) => void;
  onStatusChange: (dealId: string, field: "pe_m1_status" | "pe_m2_status", value: string) => void;
  savingDeals: Set<string>;
  docMap: Map<string, DocReview>;
  defaultCollapsed?: boolean;
}) {
  const [expandedDeal, setExpandedDeal] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const accentBorder = accent === "orange"
    ? "border-l-orange-400"
    : accent === "emerald"
      ? "border-l-emerald-400"
      : "border-l-transparent";

  // Section sums
  const sumPeTotal = deals.reduce((s, d) => s + (d.pePaymentTotal ?? 0), 0);
  const sumPeIC = deals.reduce((s, d) => s + (d.pePaymentIC ?? 0), 0);
  const sumPePC = deals.reduce((s, d) => s + (d.pePaymentPC ?? 0), 0);
  const sumEpc = deals.reduce((s, d) => s + (d.epcPrice ?? 0), 0);

  return (
    <div>
      <div
        className={`flex items-baseline gap-3 mb-2 cursor-pointer select-none ${accent ? `border-l-2 ${accentBorder} pl-3` : ""}`}
        onClick={() => setCollapsed((c) => !c)}
      >
        <span className="text-xs text-muted/60 w-4">{collapsed ? "▸" : "▾"}</span>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <span className="text-xs text-muted">{subtitle}</span>
        {deals.length > 0 && (
          <span className="text-xs text-muted ml-auto">
            PE: {fmt(sumPeTotal)} ({fmt(sumPeIC)} IC + {fmt(sumPePC)} PC) · EPC: {fmt(sumEpc)}
          </span>
        )}
      </div>
      {collapsed ? null : <div className="bg-surface rounded-lg border border-border shadow-card">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              {COLUMNS.map(([key, label, align]) => (
                <th
                  key={key}
                  onClick={() => toggleSort(key)}
                  className={`px-1.5 py-1.5 font-medium text-muted whitespace-nowrap cursor-pointer hover:text-foreground select-none ${align ?? "text-left"}`}
                >
                  {label}{sortArrow(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {deals.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-8 text-center text-muted text-sm">
                  No deals
                </td>
              </tr>
            ) : (
              deals.map((deal) => {
                const isExpanded = expandedDeal === deal.dealId;
                const sections = dealDocSections(deal.dealStageLabel);
                const docs = PE_DOCUMENTS.filter((d) => sections.includes(d.section));
                const approvedCount = docs.filter((d) => docMap.get(`${deal.dealId}:${d.name}`)?.status === "APPROVED").length;
                const rejectedCount = docs.filter((d) => {
                  const s = docMap.get(`${deal.dealId}:${d.name}`)?.status;
                  return s === "ACTION_REQUIRED" || s === "REJECTED";
                }).length;
                const underReviewCount = docs.filter((d) => {
                  const s = docMap.get(`${deal.dealId}:${d.name}`)?.status;
                  return s === "UPLOADED" || s === "UNDER_REVIEW";
                }).length;
                const submittedCount = approvedCount + rejectedCount + underReviewCount;
                const notUploadedCount = docs.length - submittedCount;

                // Build tooltip with breakdown
                const breakdownParts: string[] = [];
                if (approvedCount > 0) breakdownParts.push(`${approvedCount} approved`);
                if (underReviewCount > 0) breakdownParts.push(`${underReviewCount} under review`);
                if (rejectedCount > 0) breakdownParts.push(`${rejectedCount} action req`);
                if (notUploadedCount > 0) breakdownParts.push(`${notUploadedCount} not uploaded`);
                const docTooltip = `${submittedCount}/${docs.length} submitted · ${breakdownParts.join(" · ")}`;

                return (
                  <React.Fragment key={deal.dealId}>
                    <tr
                      className={`border-b border-border/50 hover:bg-surface-2/50 cursor-pointer ${isExpanded ? "bg-surface-2/30" : ""}`}
                      onClick={() => setExpandedDeal(isExpanded ? null : deal.dealId)}
                    >
                      <td className="px-1.5 py-1.5 whitespace-nowrap max-w-[160px]">
                        <div className="flex items-center gap-1">
                          <a
                            href={deal.hubspotUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-orange-400 hover:text-orange-300 hover:underline truncate"
                            title={deal.dealName}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {truncateName(deal.dealName, 16)}
                          </a>
                          {deal.pePortalUrl && (
                            <a
                              href={deal.pePortalUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-emerald-500/60 hover:text-emerald-400 flex-shrink-0"
                              title={`PE Portal${deal.peProjectId ? ` — ${deal.peProjectId}` : ""}`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                              </svg>
                            </a>
                          )}
                          {/* Doc progress indicator — submitted/total with rejection + review badges */}
                          {docs.length > 0 && (
                            <span className={`text-[9px] ml-0.5 ${submittedCount === docs.length ? "text-green-400" : rejectedCount > 0 ? "text-orange-400" : "text-muted/50"}`} title={docTooltip}>
                              {submittedCount}/{docs.length}
                              {rejectedCount > 0 && <span className="text-red-400 ml-0.5">⚠{rejectedCount}</span>}
                              {underReviewCount > 0 && <span className="text-blue-400 ml-0.5">◎{underReviewCount}</span>}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-1.5 py-1.5 text-muted whitespace-nowrap" title={deal.pbLocation}>{shortLocation(deal.pbLocation) || "—"}</td>
                      <td className="px-1.5 py-1.5 text-muted whitespace-nowrap max-w-[80px] truncate" title={deal.dealStageLabel}>{deal.dealStageLabel}</td>
                      <td className="px-1.5 py-1.5 text-muted whitespace-nowrap">
                        {deal.closeDate ? new Date(deal.closeDate).toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" }) : "—"}
                      </td>
                      <td className="px-1.5 py-1.5 text-muted whitespace-nowrap" title={deal.systemType}>
                        {shortType(deal.systemType)}
                      </td>
                      <td className="px-1.5 py-1.5 whitespace-nowrap text-center">
                        {deal.ecLookupFailed ? (
                          <span className="text-yellow-400" title="EC lookup failed">⚠️</span>
                        ) : deal.energyCommunity ? (
                          <span className="text-emerald-400">✓</span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="px-1.5 py-1.5 text-muted whitespace-nowrap text-right">{deal.leaseFactor.toFixed(3)}</td>
                      <td className="px-1.5 py-1.5 text-foreground whitespace-nowrap text-right font-medium">{fmt(deal.epcPrice)}</td>
                      <td className="px-1.5 py-1.5 text-muted whitespace-nowrap text-right">{fmt(deal.customerPays)}</td>
                      <td className="px-1.5 py-1.5 whitespace-nowrap text-center">
                        {(() => {
                          const s = customerPaidStatus(deal);
                          const label =
                            s === "paid" ? "Paid" : s === "partial" ? "Partial" : "Pending";
                          const tooltip = `DA: ${deal.daInvoiceStatus ?? "—"} · CC: ${deal.ccInvoiceStatus ?? "—"}${deal.paidInFull ? " · paid_in_full=true" : ""}`;
                          const cls =
                            s === "paid"
                              ? "text-emerald-400"
                              : s === "partial"
                                ? "text-amber-400"
                                : "text-muted/60";
                          return (
                            <span className={`text-[10px] ${cls}`} title={tooltip}>
                              {label}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-1.5 py-1.5 text-blue-400 whitespace-nowrap text-right font-medium">{fmt(deal.pePaymentTotal)}</td>
                      <td className="px-1.5 py-1.5 text-muted whitespace-nowrap text-right">{fmt(deal.pePaymentIC)}</td>
                      <td className="px-1.5 py-1.5 text-muted whitespace-nowrap text-right">{fmt(deal.pePaymentPC)}</td>
                      <td className="px-1.5 py-1.5 text-emerald-400 whitespace-nowrap text-right font-medium">{fmt(deal.totalPBRevenue)}</td>
                      <td className="px-1.5 py-1.5 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <StatusDropdown
                          value={deal.peM1Status}
                          onChange={(val) => onStatusChange(deal.dealId, "pe_m1_status", val)}
                          saving={savingDeals.has(`${deal.dealId}:pe_m1_status`)}
                          options={M1_OPTIONS}
                        />
                      </td>
                      <td className="px-1.5 py-1.5 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <StatusDropdown
                          value={deal.peM2Status}
                          onChange={(val) => onStatusChange(deal.dealId, "pe_m2_status", val)}
                          saving={savingDeals.has(`${deal.dealId}:pe_m2_status`)}
                          options={M2_OPTIONS}
                        />
                      </td>
                    </tr>
                    {/* Expanded document breakdown */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={COLUMNS.length} className="bg-surface-2/30 px-4 py-3 border-b border-border/50">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {sections.map((sec) => {
                              const sectionDocs = PE_DOCUMENTS.filter((d) => d.section === sec);
                              const sectionSubmitted = sectionDocs.filter((d) => {
                                const s = docMap.get(`${deal.dealId}:${d.name}`)?.status;
                                return s && s !== "NOT_UPLOADED";
                              }).length;
                              const sectionRejected = sectionDocs.filter((d) => {
                                const s = docMap.get(`${deal.dealId}:${d.name}`)?.status;
                                return s === "ACTION_REQUIRED" || s === "REJECTED";
                              }).length;
                              const sectionReviewing = sectionDocs.filter((d) => {
                                const s = docMap.get(`${deal.dealId}:${d.name}`)?.status;
                                return s === "UPLOADED" || s === "UNDER_REVIEW";
                              }).length;
                              return (
                                <div key={sec}>
                                  <div className="flex items-center justify-between mb-1.5">
                                    <span className="text-xs font-semibold text-foreground">{DOC_SECTION_LABELS[sec]}</span>
                                    <span className="flex items-center gap-1.5">
                                      <span className={`text-[10px] ${sectionSubmitted === sectionDocs.length ? "text-green-400" : "text-muted"}`}>
                                        {sectionSubmitted}/{sectionDocs.length}
                                      </span>
                                      {sectionRejected > 0 && <span className="text-[9px] text-red-400">⚠{sectionRejected}</span>}
                                      {sectionReviewing > 0 && <span className="text-[9px] text-blue-400">◎{sectionReviewing}</span>}
                                    </span>
                                  </div>
                                  <div className="space-y-1">
                                    {sectionDocs.map((doc) => {
                                      const review = docMap.get(`${deal.dealId}:${doc.name}`);
                                      const status = review?.status ?? null;
                                      const isApproved = status === "APPROVED";
                                      return (
                                        <div key={doc.name} className="flex items-center gap-1.5">
                                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${status ? DOC_STATUS_DOT[status] : "bg-zinc-700"}`} />
                                          <span className={`text-[11px] flex-1 truncate ${isApproved ? "text-muted line-through" : "text-foreground"}`} title={doc.name}>
                                            {doc.name}
                                          </span>
                                          {status ? (
                                            <span className={`text-[9px] whitespace-nowrap ${isApproved ? "text-green-400" : status === "REJECTED" ? "text-red-400" : status === "ACTION_REQUIRED" ? "text-orange-400" : "text-muted"}`}>
                                              {DOC_STATUS_LABEL[status]}
                                            </span>
                                          ) : (
                                            <span className="text-[9px] text-muted/40">—</span>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          {/* PE notes */}
                          {(() => {
                            const notes = sections.flatMap((sec) =>
                              PE_DOCUMENTS.filter((d) => d.section === sec)
                                .map((d) => ({ doc: d.name, note: docMap.get(`${deal.dealId}:${d.name}`)?.notes }))
                                .filter((n) => n.note)
                            );
                            if (!notes.length) return null;
                            return (
                              <div className="mt-3 pt-2 border-t border-border/30">
                                <span className="text-[10px] font-medium text-muted">PE Notes:</span>
                                {notes.map((n) => (
                                  <div key={n.doc} className="text-[10px] text-orange-400/80 mt-0.5">
                                    <span className="text-muted">{n.doc}:</span> {n.note}
                                  </div>
                                ))}
                              </div>
                            );
                          })()}
                          {/* Action items from PE portal scraper approver notes */}
                          {(() => {
                            const approverItems: { doc: string; note: string }[] = [];
                            for (const doc of docs) {
                              const review = docMap.get(`${deal.dealId}:${doc.name}`);
                              if (!review?.notes) continue;
                              const match = review.notes.match(/Approver:\s*(.+?)(?:\s*\||$)/);
                              if (match?.[1]?.trim()) {
                                approverItems.push({ doc: doc.name, note: match[1].trim() });
                              }
                            }
                            if (!approverItems.length) return null;
                            return (
                              <div className="mt-3 pt-2 border-t border-border/30">
                                <div className="flex items-center gap-2 mb-1.5">
                                  <span className="text-[10px] font-medium text-orange-400">Action Items ({approverItems.length})</span>
                                  <span className="text-[9px] text-muted">from PE portal</span>
                                </div>
                                <div className="space-y-1.5">
                                  {approverItems.map((item) => (
                                    <div key={item.doc} className="flex items-start gap-1.5 bg-surface rounded px-2 py-1.5 border border-border/30">
                                      <span className="w-1.5 h-1.5 rounded-full bg-orange-500 mt-1 flex-shrink-0" />
                                      <div className="min-w-0 flex-1">
                                        <span className="text-[11px] font-medium text-foreground">{item.doc}</span>
                                        <p className="text-[10px] text-muted mt-0.5 leading-tight">{item.note}</p>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })()}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function PeDealsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.peDeals.list(),
    queryFn: async () => {
      const res = await fetch("/api/accounting/pe-deals");
      if (!res.ok) throw new Error("Failed to fetch PE deals");
      return res.json() as Promise<{ deals: PeDeal[]; lastUpdated: string }>;
    },
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
          status: dr.status as DocReview["status"],
          notes: dr.notes,
        });
      }
    }
    return m;
  }, [data]);

  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState<string[]>([]);
  const [stageFilter, setStageFilter] = useState<string[]>([]);
  const [m1Filter, setM1Filter] = useState<string[]>([]);
  const [m2Filter, setM2Filter] = useState<string[]>([]);
  const [savingDeals, setSavingDeals] = useState<Set<string>>(new Set());

  const handleStatusChange = useCallback(
    async (dealId: string, field: "pe_m1_status" | "pe_m2_status", value: string) => {
      const key = `${dealId}:${field}`;
      setSavingDeals((prev) => new Set(prev).add(key));

      // Optimistic update
      queryClient.setQueryData(
        queryKeys.peDeals.list(),
        (old: { deals: PeDeal[]; lastUpdated: string } | undefined) => {
          if (!old) return old;
          return {
            ...old,
            deals: old.deals.map((d) =>
              d.dealId === dealId
                ? { ...d, [field === "pe_m1_status" ? "peM1Status" : "peM2Status"]: value || null }
                : d,
            ),
          };
        },
      );

      try {
        const res = await fetch("/api/accounting/pe-deals", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dealId, field, value }),
        });
        if (!res.ok) throw new Error("Failed to update");
      } catch {
        // Revert on failure
        queryClient.invalidateQueries({ queryKey: queryKeys.peDeals.list() });
      } finally {
        setSavingDeals((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [queryClient],
  );
  const [sortKey, setSortKey] = useState<SortKey>("closeDate");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const deals = data?.deals ?? [];
  const lastUpdated = data?.lastUpdated
    ? new Date(data.lastUpdated).toLocaleTimeString()
    : undefined;

  // Filter options
  const locationOptions = useMemo(
    () => [...new Set(deals.map((d) => d.pbLocation).filter(Boolean))].sort(),
    [deals],
  );
  const stageOptions = useMemo(
    () =>
      [...new Map(deals.map((d) => [d.dealStage, d.dealStageLabel])).entries()]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [deals],
  );

  const m1Options = useMemo(
    () => [...new Set(deals.map((d) => d.peM1Status).filter(Boolean) as string[])].sort(),
    [deals],
  );
  const m2Options = useMemo(
    () => [...new Set(deals.map((d) => d.peM2Status).filter(Boolean) as string[])].sort(),
    [deals],
  );

  // Apply filters
  const filtered = useMemo(() => {
    let result = deals;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (d) => d.dealName.toLowerCase().includes(q),
      );
    }
    if (locationFilter.length > 0) {
      result = result.filter((d) => locationFilter.includes(d.pbLocation));
    }
    if (stageFilter.length > 0) {
      result = result.filter((d) => stageFilter.includes(d.dealStage));
    }
    if (m1Filter.length > 0) {
      result = result.filter((d) => d.peM1Status !== null && m1Filter.includes(d.peM1Status));
    }
    if (m2Filter.length > 0) {
      result = result.filter((d) => d.peM2Status !== null && m2Filter.includes(d.peM2Status));
    }
    return sortDeals(result, sortKey, sortDir);
  }, [deals, search, locationFilter, stageFilter, m1Filter, m2Filter, sortKey, sortDir]);

  // Split into priority sections
  const paidDeals = useMemo(() => filtered.filter((d) => d.peM1Status === "Paid" && d.peM2Status === "Paid"), [filtered]);
  const partiallyPaidDeals = useMemo(() => filtered.filter((d) =>
    (d.peM1Status === "Paid" || d.peM2Status === "Paid") && !(d.peM1Status === "Paid" && d.peM2Status === "Paid"),
  ), [filtered]);
  const fullyApprovedDeals = useMemo(() => filtered.filter((d) =>
    d.peM1Status === "Approved" && d.peM2Status === "Approved",
  ), [filtered]);
  const partiallyApprovedDeals = useMemo(() => filtered.filter((d) =>
    d.peM1Status !== "Paid" && d.peM2Status !== "Paid" &&
    !(d.peM1Status === "Approved" && d.peM2Status === "Approved") &&
    (d.peM1Status === "Approved" || d.peM2Status === "Approved"),
  ), [filtered]);
  const excludedIds = useMemo(
    () => new Set([...paidDeals, ...partiallyPaidDeals, ...fullyApprovedDeals, ...partiallyApprovedDeals].map((d) => d.dealId)),
    [paidDeals, partiallyPaidDeals, fullyApprovedDeals, partiallyApprovedDeals],
  );
  const unpaid = useMemo(() => filtered.filter((d) => !excludedIds.has(d.dealId)), [filtered, excludedIds]);
  const m2Deals = useMemo(() => unpaid.filter((d) => d.milestoneHighlight === "m2"), [unpaid]);
  const m1Deals = useMemo(() => unpaid.filter((d) => d.milestoneHighlight === "m1"), [unpaid]);

  const PRECON_STAGES = new Set([
    "Site Survey", "Design & Engineering", "Permitting & Interconnection",
    "Ready To Build", "RTB - Blocked", "Project Rejected - Needs Review", "On Hold",
  ]);
  const CONSTRUCTION_STAGES = new Set(["Construction"]);
  const INSPECTION_STAGES = new Set(["Inspection"]);

  const milestoneIds = useMemo(
    () => new Set([...m2Deals, ...m1Deals].map((d) => d.dealId)),
    [m2Deals, m1Deals],
  );
  const remaining = useMemo(() => unpaid.filter((d) => !milestoneIds.has(d.dealId)), [unpaid, milestoneIds]);
  const preconDeals = useMemo(() => remaining.filter((d) => PRECON_STAGES.has(d.dealStageLabel)), [remaining]);
  const constructionDeals = useMemo(() => remaining.filter((d) => CONSTRUCTION_STAGES.has(d.dealStageLabel)), [remaining]);
  const inspectionDeals = useMemo(() => remaining.filter((d) => INSPECTION_STAGES.has(d.dealStageLabel)), [remaining]);
  const otherDeals = useMemo(() => {
    const grouped = new Set([...preconDeals, ...constructionDeals, ...inspectionDeals].map((d) => d.dealId));
    return remaining.filter((d) => !grouped.has(d.dealId));
  }, [remaining, preconDeals, constructionDeals, inspectionDeals]);

  // Hero-card stats use the FULL filtered PE deal set (paid + approved +
  // unpaid). NOT `allDeals` — that's the leftover bucket after subtracting
  // deals shown in other table sections.
  const totalPeExpected = filtered.reduce((s, d) => s + (d.pePaymentTotal ?? 0), 0);

  // Split the deal count into pre-construction (no work started) vs
  // construction+ (Construction, Inspection, PTO, Close Out, Complete, Paid).
  // On Hold and Cancelled deals are excluded — they're not active pipeline.
  const EXCLUDED_BUCKET_STAGES = new Set([
    "On Hold", "On-Hold", "Cancelled", "Project Cancelled",
  ]);
  const bucketableDeals = filtered.filter((d) => !EXCLUDED_BUCKET_STAGES.has(d.dealStageLabel));
  const preconFiltered = bucketableDeals.filter((d) => PRECON_STAGES.has(d.dealStageLabel));
  const constructionPlusFiltered = bucketableDeals.filter((d) => !PRECON_STAGES.has(d.dealStageLabel));
  const preconPeExpected = preconFiltered.reduce((s, d) => s + (d.pePaymentTotal ?? 0), 0);
  const constructionPlusPeExpected = constructionPlusFiltered.reduce((s, d) => s + (d.pePaymentTotal ?? 0), 0);

  // Ready-to-invoice: PE has approved our docs but we haven't been paid.
  const m1ReadyDeals = filtered.filter((d) => d.peM1Status === "Approved");
  const m2ReadyDeals = filtered.filter((d) => d.peM2Status === "Approved");
  const readyToInvoiceCount = m1ReadyDeals.length + m2ReadyDeals.length;
  const readyToInvoiceValue =
    m1ReadyDeals.reduce((s, d) => s + (d.pePaymentIC ?? 0), 0) +
    m2ReadyDeals.reduce((s, d) => s + (d.pePaymentPC ?? 0), 0);

  // Already-paid PE totals across the full filtered set.
  const m1PaidDeals = filtered.filter((d) => d.peM1Status === "Paid");
  const m2PaidDeals = filtered.filter((d) => d.peM2Status === "Paid");
  const m1PaidValue = m1PaidDeals.reduce((s, d) => s + (d.pePaymentIC ?? 0), 0);
  const m2PaidValue = m2PaidDeals.reduce((s, d) => s + (d.pePaymentPC ?? 0), 0);
  const totalPECollected = m1PaidValue + m2PaidValue;

  // PE Receivable = milestones PE has committed to (Approved or Paid only).
  // Excludes deals where PE hasn't yet approved either milestone.
  const APPROVED_OR_PAID = new Set(["Approved", "Paid"]);
  const m1ReceivableValue = filtered
    .filter((d) => d.peM1Status !== null && APPROVED_OR_PAID.has(d.peM1Status))
    .reduce((s, d) => s + (d.pePaymentIC ?? 0), 0);
  const m2ReceivableValue = filtered
    .filter((d) => d.peM2Status !== null && APPROVED_OR_PAID.has(d.peM2Status))
    .reduce((s, d) => s + (d.pePaymentPC ?? 0), 0);
  const totalPEReceivable = m1ReceivableValue + m2ReceivableValue;
  const totalPEOutstanding = Math.max(0, totalPEReceivable - totalPECollected);
  const m1ReceivableCount = filtered.filter((d) => d.peM1Status !== null && APPROVED_OR_PAID.has(d.peM1Status)).length;
  const m2ReceivableCount = filtered.filter((d) => d.peM2Status !== null && APPROVED_OR_PAID.has(d.peM2Status)).length;

  // Awaiting PE Approval = PE payment we're owed based on deal stage,
  // minus what's already Approved or Paid.
  // PTO deals: M1 (pePaymentIC) should be done
  // Close Out / Complete deals: both M1 (pePaymentIC) + M2 (pePaymentPC)
  const isPto = (d: PeDeal) => {
    const s = d.dealStageLabel.toLowerCase();
    return s.includes("permission to operate") || s.includes("pto");
  };
  const isCloseOutOrComplete = (d: PeDeal) => {
    const s = d.dealStageLabel.toLowerCase();
    return s.includes("close out") || s.includes("complete");
  };
  let awaitingM1Value = 0;
  let awaitingM2Value = 0;
  let awaitingM1Count = 0;
  let awaitingM2Count = 0;
  // Awaiting PTO = PC portion of PTO-stage deals where M2 isn't yet eligible
  // (deal still needs to advance from PTO → Close Out before M2 PC can be
  // submitted for PE approval).
  let awaitingPtoValue = 0;
  let awaitingPtoCount = 0;
  for (const d of filtered) {
    const atPto = isPto(d);
    const atCloseOut = isCloseOutOrComplete(d);
    if (!atPto && !atCloseOut) continue;
    // M1: should be approved/paid at PTO or later
    if (!APPROVED_OR_PAID.has(d.peM1Status ?? "")) {
      awaitingM1Value += d.pePaymentIC ?? 0;
      awaitingM1Count++;
    }
    // M2: should be approved/paid at close-out or later
    if (atCloseOut && !APPROVED_OR_PAID.has(d.peM2Status ?? "")) {
      awaitingM2Value += d.pePaymentPC ?? 0;
      awaitingM2Count++;
    }
    // M2 PC of PTO deals — not yet eligible, waiting for Close Out
    if (atPto && !APPROVED_OR_PAID.has(d.peM2Status ?? "")) {
      awaitingPtoValue += d.pePaymentPC ?? 0;
      awaitingPtoCount++;
    }
  }
  const totalAwaitingValue = awaitingM1Value + awaitingM2Value;
  const totalAwaitingCount = awaitingM1Count + awaitingM2Count;

  // CSV export data
  const exportData = filtered.map((d) => ({
    "Deal Name": d.dealName,
    "PB Location": d.pbLocation,
    "Deal Stage": d.dealStageLabel,
    "Close Date": d.closeDate ?? "",
    "System Type": d.systemType,
    "Energy Community": d.energyCommunity ? "Yes" : "No",
    "Lease Factor": d.leaseFactor.toFixed(7),
    "EPC Price": d.epcPrice ?? "",
    "Customer Pays": d.customerPays ?? "",
    "Customer Paid": customerPaidStatus(d) === "paid" ? "Paid" : customerPaidStatus(d) === "partial" ? "Partial" : "Pending",
    "PE Payment Total": d.pePaymentTotal ?? "",
    "PE @ IC": d.pePaymentIC ?? "",
    "PE @ PC": d.pePaymentPC ?? "",
    "Total PB Revenue": d.totalPBRevenue ?? "",
    "PE M1": d.peM1Status ?? "",
    "PE M2": d.peM2Status ?? "",
  }));

  const sortArrow = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  if (error) {
    return (
      <DashboardShell title="PE Deals & Payments" accentColor="orange">
        <div className="text-center py-12 text-red-400">
          Failed to load PE deals. Please try again.
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell
      title="PE Deals & Payments"
      accentColor="orange"
      fullWidth
      lastUpdated={lastUpdated}
      exportData={{ data: exportData, filename: "pe-deals-payments" }}
    >
      {/* Hero Stats — PE payment pipeline */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6 stagger-grid">
        <StatCard
          key={`precon-${preconFiltered.length}`}
          label="Pre-Construction"
          value={String(preconFiltered.length)}
          subtitle={`${fmt(preconPeExpected)} PE expected`}
          color="orange"
        />
        <StatCard
          key={`construction-plus-${constructionPlusFiltered.length}`}
          label="Construction+"
          value={String(constructionPlusFiltered.length)}
          subtitle={`${fmt(constructionPlusPeExpected)} PE expected · ${bucketableDeals.length} active pipeline`}
          color="orange"
        />
        <StatCard
          key={`awaiting-${totalAwaitingCount}-${totalAwaitingValue}`}
          label="Awaiting PE Approval"
          value={fmt(totalAwaitingValue)}
          subtitle={`${totalAwaitingCount} milestones · ${awaitingM1Count} M1 + ${awaitingM2Count} M2`}
          color="amber"
        />
        <StatCard
          key={`ready-${readyToInvoiceCount}-${readyToInvoiceValue}`}
          label="Approved (Unpaid)"
          value={fmt(readyToInvoiceValue)}
          subtitle={`${readyToInvoiceCount} milestones · ${m1ReadyDeals.length} M1 + ${m2ReadyDeals.length} M2`}
          color="blue"
        />
        <StatCard
          key={`paid-${totalPECollected}`}
          label="PE Collected"
          value={fmt(totalPECollected)}
          subtitle={`${m1PaidDeals.length + m2PaidDeals.length} milestones · ${m1PaidDeals.length} M1 + ${m2PaidDeals.length} M2`}
          color="emerald"
        />
        <StatCard
          key={`recv-${totalPEReceivable}`}
          label="Total Approved"
          value={fmt(totalPEReceivable)}
          subtitle={`${m1ReceivableCount + m2ReceivableCount} milestones · Paid ${fmt(totalPECollected)} · Unpaid ${fmt(totalPEOutstanding)}`}
          color="green"
        />
      </div>

      {/* Reconciliation bar — shows how Total PE Expected breaks down */}
      {!isLoading && totalPeExpected > 0 && (() => {
        // Pipeline buckets (sum to totalPeExpected):
        //   Collected         — paid milestones
        //   Approved          — approved but not paid milestones
        //   Awaiting Approval — milestones past due stage waiting on PE
        //                       (M1 IC of PTO+ + M2 PC of Close Out+)
        //   Awaiting PTO      — M2 PC of PTO-stage deals not yet eligible
        //                       (waiting for deal to advance to Close Out)
        //   Pending Inspection / In Construction / Preconstruction — stage breakdown
        //                       of pre-PTO deal value (matches table sections)
        //   Other             — residual (On Hold + Cancelled + edge cases)
        const inspectionPe = inspectionDeals.reduce((s, d) => s + (d.pePaymentTotal ?? 0), 0);
        const constructionPe = constructionDeals.reduce((s, d) => s + (d.pePaymentTotal ?? 0), 0);
        const preconPe = preconDeals.reduce((s, d) => s + (d.pePaymentTotal ?? 0), 0);
        const otherPe = Math.max(
          0,
          totalPeExpected
            - totalPECollected
            - readyToInvoiceValue
            - totalAwaitingValue
            - awaitingPtoValue
            - inspectionPe
            - constructionPe
            - preconPe,
        );
        const pcts = {
          collected: (totalPECollected / totalPeExpected) * 100,
          approved: (readyToInvoiceValue / totalPeExpected) * 100,
          awaiting: (totalAwaitingValue / totalPeExpected) * 100,
          awaitingPto: (awaitingPtoValue / totalPeExpected) * 100,
          inspection: (inspectionPe / totalPeExpected) * 100,
          construction: (constructionPe / totalPeExpected) * 100,
          precon: (preconPe / totalPeExpected) * 100,
          other: (otherPe / totalPeExpected) * 100,
        };
        return (
          <div className="mb-6 bg-surface rounded-lg border border-border p-3 shadow-card">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-foreground">PE Payment Pipeline</span>
              <span className="text-xs text-muted">{fmt(totalPeExpected)} total expected</span>
            </div>
            <div className="flex h-3 rounded-full overflow-hidden bg-surface-2 mb-2">
              {pcts.collected > 0 && (
                <div className="bg-green-500 transition-all" style={{ width: `${pcts.collected}%` }}
                  title={`Collected: ${fmt(totalPECollected)}`} />
              )}
              {pcts.approved > 0 && (
                <div className="bg-blue-500 transition-all" style={{ width: `${pcts.approved}%` }}
                  title={`Approved (Unpaid): ${fmt(readyToInvoiceValue)}`} />
              )}
              {pcts.awaiting > 0 && (
                <div className="bg-amber-500 transition-all" style={{ width: `${pcts.awaiting}%` }}
                  title={`Awaiting Approval: ${fmt(totalAwaitingValue)}`} />
              )}
              {pcts.awaitingPto > 0 && (
                <div className="bg-orange-600 transition-all" style={{ width: `${pcts.awaitingPto}%` }}
                  title={`Awaiting PTO (M2 PC of PTO-stage deals): ${fmt(awaitingPtoValue)}`} />
              )}
              {pcts.inspection > 0 && (
                <div className="bg-cyan-500 transition-all" style={{ width: `${pcts.inspection}%` }}
                  title={`Pending Inspection: ${fmt(inspectionPe)}`} />
              )}
              {pcts.construction > 0 && (
                <div className="bg-indigo-400 transition-all" style={{ width: `${pcts.construction}%` }}
                  title={`In Construction: ${fmt(constructionPe)}`} />
              )}
              {pcts.precon > 0 && (
                <div className="bg-zinc-500 transition-all" style={{ width: `${pcts.precon}%` }}
                  title={`Preconstruction: ${fmt(preconPe)}`} />
              )}
              {pcts.other > 0 && (
                <div className="bg-zinc-700 transition-all" style={{ width: `${pcts.other}%` }}
                  title={`Other (On Hold, Cancelled, etc.): ${fmt(otherPe)}`} />
              )}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-muted">Collected</span>
                <span className="text-foreground font-medium">{fmt(totalPECollected)}</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-blue-500" />
                <span className="text-muted">Approved</span>
                <span className="text-foreground font-medium">{fmt(readyToInvoiceValue)}</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                <span className="text-muted">Awaiting Approval</span>
                <span className="text-foreground font-medium">{fmt(totalAwaitingValue)}</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-orange-600" />
                <span className="text-muted">Awaiting PTO</span>
                <span className="text-foreground font-medium">{fmt(awaitingPtoValue)}</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-cyan-500" />
                <span className="text-muted">Pending Inspection</span>
                <span className="text-foreground font-medium">{fmt(inspectionPe)}</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-indigo-400" />
                <span className="text-muted">In Construction</span>
                <span className="text-foreground font-medium">{fmt(constructionPe)}</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-zinc-500" />
                <span className="text-muted">Preconstruction</span>
                <span className="text-foreground font-medium">{fmt(preconPe)}</span>
              </span>
              {otherPe > 0 && (
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-zinc-700" />
                  <span className="text-muted">Other</span>
                  <span className="text-foreground font-medium">{fmt(otherPe)}</span>
                </span>
              )}
            </div>
          </div>
        );
      })()}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="Search deals..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-1.5 rounded bg-surface-2 border border-border text-foreground text-sm w-64"
        />
        <MultiSelectFilter
          label="Location"
          options={locationOptions.map((l) => ({ value: l, label: `${shortLocation(l)} — ${l}` }))}
          selected={locationFilter}
          onChange={setLocationFilter}
        />
        <MultiSelectFilter
          label="Stage"
          options={stageOptions}
          selected={stageFilter}
          onChange={setStageFilter}
        />
        <MultiSelectFilter
          label="M1 Status"
          options={m1Options.map((s) => ({ value: s, label: s }))}
          selected={m1Filter}
          onChange={setM1Filter}
        />
        <MultiSelectFilter
          label="M2 Status"
          options={m2Options.map((s) => ({ value: s, label: s }))}
          selected={m2Filter}
          onChange={setM2Filter}
        />
      </div>

      {/* Tables by section */}
      {isLoading ? (
        <div className="text-center py-12 text-muted">Loading PE deals...</div>
      ) : (
        <div className="space-y-8">
          <DealSection
            title="Paid"
            subtitle={`${paidDeals.length} deal${paidDeals.length !== 1 ? "s" : ""} — M1 & M2 paid`}
            accent="emerald"
            deals={paidDeals}
            sortKey={sortKey}
            sortDir={sortDir}
            sortArrow={sortArrow}
            toggleSort={toggleSort}
            onStatusChange={handleStatusChange}
            savingDeals={savingDeals}
            docMap={docMap}
          />
          {partiallyPaidDeals.length > 0 && (
            <DealSection
              title="Partially Paid"
              subtitle={`${partiallyPaidDeals.length} deal${partiallyPaidDeals.length !== 1 ? "s" : ""} — M1 or M2 paid`}
              accent="orange"
              deals={partiallyPaidDeals}
              sortKey={sortKey}
              sortDir={sortDir}
              sortArrow={sortArrow}
              toggleSort={toggleSort}
              onStatusChange={handleStatusChange}
              savingDeals={savingDeals}
              docMap={docMap}
            />
          )}
          {fullyApprovedDeals.length > 0 && (
            <DealSection
              title="Fully Approved — Waiting on Payment"
              subtitle={`${fullyApprovedDeals.length} deal${fullyApprovedDeals.length !== 1 ? "s" : ""} — M1 & M2 approved, awaiting PE payment`}
              accent="emerald"
              deals={fullyApprovedDeals}
              sortKey={sortKey}
              sortDir={sortDir}
              sortArrow={sortArrow}
              toggleSort={toggleSort}
              onStatusChange={handleStatusChange}
              savingDeals={savingDeals}
              docMap={docMap}
            />
          )}
          {partiallyApprovedDeals.length > 0 && (
            <DealSection
              title="Partially Approved — In Progress"
              subtitle={`${partiallyApprovedDeals.length} deal${partiallyApprovedDeals.length !== 1 ? "s" : ""} — M1 or M2 approved, other milestone still in progress`}
              accent="orange"
              deals={partiallyApprovedDeals}
              sortKey={sortKey}
              sortDir={sortDir}
              sortArrow={sortArrow}
              toggleSort={toggleSort}
              onStatusChange={handleStatusChange}
              savingDeals={savingDeals}
              docMap={docMap}
            />
          )}
          {m2Deals.length > 0 && (
            <DealSection
              title="M2 — Close Out"
              subtitle={`${m2Deals.length} deal${m2Deals.length !== 1 ? "s" : ""} pending PE payment (1/3)`}
              accent="emerald"
              deals={m2Deals}
              sortKey={sortKey}
              sortDir={sortDir}
              sortArrow={sortArrow}
              toggleSort={toggleSort}
              onStatusChange={handleStatusChange}
              savingDeals={savingDeals}
              docMap={docMap}
            />
          )}
          {m1Deals.length > 0 && (
            <DealSection
              title="M1 — Permission To Operate"
              subtitle={`${m1Deals.length} deal${m1Deals.length !== 1 ? "s" : ""} pending PE payment (2/3)`}
              accent="orange"
              deals={m1Deals}
              sortKey={sortKey}
              sortDir={sortDir}
              sortArrow={sortArrow}
              toggleSort={toggleSort}
              onStatusChange={handleStatusChange}
              savingDeals={savingDeals}
              docMap={docMap}
            />
          )}
          {inspectionDeals.length > 0 && (
            <DealSection
              title="Pending Inspection"
              subtitle={`${inspectionDeals.length} deal${inspectionDeals.length !== 1 ? "s" : ""}`}
              accent="emerald"
              deals={inspectionDeals}
              sortKey={sortKey}
              sortDir={sortDir}
              sortArrow={sortArrow}
              toggleSort={toggleSort}
              onStatusChange={handleStatusChange}
              savingDeals={savingDeals}
              docMap={docMap}
            />
          )}
          {constructionDeals.length > 0 && (
            <DealSection
              title="In Construction"
              subtitle={`${constructionDeals.length} deal${constructionDeals.length !== 1 ? "s" : ""}`}
              accent="orange"
              deals={constructionDeals}
              sortKey={sortKey}
              sortDir={sortDir}
              sortArrow={sortArrow}
              toggleSort={toggleSort}
              onStatusChange={handleStatusChange}
              savingDeals={savingDeals}
              docMap={docMap}
            />
          )}
          {preconDeals.length > 0 && (
            <DealSection
              title="Preconstruction"
              subtitle={`${preconDeals.length} deal${preconDeals.length !== 1 ? "s" : ""} — survey through ready to build`}
              deals={preconDeals}
              sortKey={sortKey}
              sortDir={sortDir}
              sortArrow={sortArrow}
              toggleSort={toggleSort}
              onStatusChange={handleStatusChange}
              savingDeals={savingDeals}
              docMap={docMap}
              defaultCollapsed
            />
          )}
          {otherDeals.length > 0 && (
            <DealSection
              title="Other"
              subtitle={`${otherDeals.length} deal${otherDeals.length !== 1 ? "s" : ""}`}
              deals={otherDeals}
              sortKey={sortKey}
              sortDir={sortDir}
              sortArrow={sortArrow}
              toggleSort={toggleSort}
              onStatusChange={handleStatusChange}
              savingDeals={savingDeals}
              docMap={docMap}
              defaultCollapsed
            />
          )}
        </div>
      )}
    </DashboardShell>
  );
}
