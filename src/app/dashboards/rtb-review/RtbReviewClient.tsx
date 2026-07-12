"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import {
  MultiSelectFilter,
  type FilterOption,
} from "@/components/ui/MultiSelectFilter";
import { getHubSpotDealUrl } from "@/lib/external-links";
import type { RtbQueueItem, RtbQueueStage } from "@/lib/rtb-review";

interface RtbQueueResponse {
  items: RtbQueueItem[];
  lastUpdated: string;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

/** Format a bare YYYY-MM-DD without Date parsing (avoids UTC off-by-one). */
function formatYmd(value: string | null): string {
  if (!value) return "—";
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return value;
  return `${Number(m[2])}/${Number(m[3])}/${m[1]}`;
}

/**
 * Deal names follow "PROJ-XXXX | Customer | Full address". The address makes
 * the column blow out, so render just the project number + customer; the full
 * name stays available as a hover tooltip.
 */
function dealDisplay(dealName: string): { number: string; customer: string | null } {
  const parts = dealName.split("|").map((s) => s.trim());
  if (parts.length < 2) return { number: dealName, customer: null };
  return { number: parts[0], customer: parts[1] || null };
}

/** Distinct non-empty values from a field, sorted, as MultiSelect options. */
function optionsFrom(
  items: RtbQueueItem[],
  pick: (i: RtbQueueItem) => string | null
): FilterOption[] {
  const values = new Set<string>();
  for (const i of items) {
    const v = pick(i);
    if (v) values.add(v);
  }
  return [...values]
    .sort((a, b) => a.localeCompare(b))
    .map((v) => ({ value: v, label: v }));
}

const CURRENCY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

type SortField =
  | "dealName"
  | "projectManager"
  | "location"
  | "projectType"
  | "amount"
  | "permitIssueDate"
  | "interconnectionStatus"
  | "constructionStatus"
  | "daStatus"
  | "daysInStage"
  | "paymentMethod"
  | "loanStatus"
  | "earliestInstallDate";

/** Per-field comparable value; null/undefined sort last in either direction. */
function sortValue(item: RtbQueueItem, field: SortField): string | number | null {
  const v = item[field];
  if (v == null || v === "") return null;
  return v;
}

function SortIcon({
  field,
  sortField,
  sortDir,
}: {
  field: SortField;
  sortField: SortField;
  sortDir: "asc" | "desc";
}) {
  return (
    <span className={sortField === field ? "text-foreground" : "opacity-30"}>
      {sortField === field ? (sortDir === "asc" ? "▲" : "▼") : "▼"}
    </span>
  );
}

const TABS: Array<{ key: RtbQueueStage; label: string }> = [
  { key: "blocked", label: "RTB - Blocked" },
  { key: "ready", label: "Ready to Build" },
];

export default function RtbReviewClient() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<RtbQueueStage>("blocked");

  const { data, isLoading } = useQuery<RtbQueueResponse>({
    queryKey: ["rtb-review", tab],
    queryFn: async () => {
      const res = await fetch(`/api/deals/rtb-review?stage=${tab}`);
      if (!res.ok) throw new Error("Failed to load RTB review queue");
      return res.json();
    },
  });

  const approveDeal = useMutation({
    mutationFn: async (dealId: string) => {
      const res = await fetch(`/api/deals/rtb-review/${dealId}/approve`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["rtb-review"] }),
  });

  const items = useMemo(() => data?.items ?? [], [data]);

  const [selectedPMs, setSelectedPMs] = useState<string[]>([]);
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  // Default: longest-waiting first (oldest permit issue date at the top).
  const [sortField, setSortField] = useState<SortField>("permitIssueDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const pmOptions = useMemo(
    () => optionsFrom(items, (i) => i.projectManager),
    [items]
  );
  const locationOptions = useMemo(
    () => optionsFrom(items, (i) => i.location),
    [items]
  );

  const filtered = useMemo(() => {
    const subset = items.filter((i) => {
      const pmOk =
        selectedPMs.length === 0 ||
        (i.projectManager != null && selectedPMs.includes(i.projectManager));
      const locOk =
        selectedLocations.length === 0 ||
        (i.location != null && selectedLocations.includes(i.location));
      return pmOk && locOk;
    });
    return [...subset].sort((a, b) => {
      const av = sortValue(a, sortField);
      const bv = sortValue(b, sortField);
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // nulls last regardless of direction
      if (bv == null) return -1;
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return sortDir === "desc" ? -cmp : cmp;
    });
  }, [items, selectedPMs, selectedLocations, sortField, sortDir]);

  return (
    <DashboardShell
      title="RTB Review Queue"
      subtitle="Permit-issued deals parked in RTB - Blocked, awaiting PM release to build"
      accentColor="red"
      fullWidth
      lastUpdated={data?.lastUpdated}
    >
      <div className="flex items-center gap-1 mb-3">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={
              tab === t.key
                ? "text-xs px-3 py-1.5 rounded-full bg-red-500/20 text-red-400 font-medium"
                : "text-xs px-3 py-1.5 rounded-full text-muted hover:text-foreground hover:bg-surface-2"
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <MultiSelectFilter
          label="Project Manager"
          accentColor="red"
          options={pmOptions}
          selected={selectedPMs}
          onChange={setSelectedPMs}
        />
        <MultiSelectFilter
          label="Location"
          accentColor="red"
          options={locationOptions}
          selected={selectedLocations}
          onChange={setSelectedLocations}
        />
        <div className="text-xs text-muted ml-auto">
          {filtered.length}
          {filtered.length !== items.length ? ` of ${items.length}` : ""}{" "}
          {tab === "blocked" ? "deals awaiting review" : "deals in Ready to Build"}
        </div>
      </div>

      <div className="rounded-lg border border-t-border overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-surface-2 text-muted">
            <tr>
              {(
                [
                  ["Deal", "dealName"],
                  ["PM / Office", "projectManager"],
                  ["Days", "daysInStage"],
                  ["Type / $", "amount"],
                  ["Permit", "permitIssueDate"],
                  ["IC / Constr", "interconnectionStatus"],
                  ["RTB Notes", null],
                  ["Items", null],
                  ["Payment", "loanStatus"],
                  ["Avail", "earliestInstallDate"],
                ] as Array<[string, SortField | null]>
              ).map(([label, field]) =>
                field ? (
                  <th
                    key={label}
                    onClick={() => toggleSort(field)}
                    className="text-left px-2 py-2 font-medium cursor-pointer select-none hover:text-foreground whitespace-nowrap"
                  >
                    {label}{" "}
                    <SortIcon field={field} sortField={sortField} sortDir={sortDir} />
                  </th>
                ) : (
                  <th key={label} className="text-left px-2 py-2 font-medium whitespace-nowrap">
                    {label}
                  </th>
                )
              )}
              <th className="text-right px-2 py-2 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={11} className="text-center text-muted py-8">
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr>
                <td colSpan={11} className="text-center text-muted py-8">
                  {items.length === 0
                    ? "No deals awaiting RTB review"
                    : "No deals match the selected filters"}
                </td>
              </tr>
            )}
            {filtered.map((item) => {
              const isPending =
                approveDeal.isPending && approveDeal.variables === item.dealId;
              return (
                <tr
                  key={item.dealId}
                  className="border-t border-t-border hover:bg-surface-2/40 align-top"
                >
                  <td className="px-2 py-2 whitespace-nowrap">
                    {(() => {
                      const { number, customer } = dealDisplay(
                        item.dealName || item.dealId
                      );
                      return (
                        <>
                          <a
                            href={getHubSpotDealUrl(item.dealId)}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={item.dealName}
                            className="font-semibold text-foreground hover:underline"
                          >
                            {number}
                          </a>
                          {customer && (
                            <div className="text-muted max-w-36 truncate" title={item.dealName}>
                              {customer}
                            </div>
                          )}
                          {item.driveFolderUrl && (
                            <a
                              href={item.driveFolderUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block text-muted hover:text-foreground hover:underline mt-0.5"
                            >
                              📁 Drive
                            </a>
                          )}
                        </>
                      );
                    })()}
                  </td>
                  <td className="px-2 py-2">
                    <div className="text-muted whitespace-nowrap">
                      {item.projectManager ?? "—"}
                    </div>
                    <div className="text-muted opacity-70">{item.location ?? "—"}</div>
                  </td>
                  <td
                    className="px-2 py-2 whitespace-nowrap text-foreground"
                    title={
                      item.enteredStageAt
                        ? `Entered ${item.dealStage ?? "stage"} ${formatDate(item.enteredStageAt)}`
                        : undefined
                    }
                  >
                    {item.daysInStage ?? "—"}
                  </td>
                  <td className="px-2 py-2">
                    <div className="text-muted max-w-24">{item.projectType ?? "—"}</div>
                    <div className="text-foreground whitespace-nowrap">
                      {item.amount != null ? CURRENCY.format(item.amount) : "—"}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-muted whitespace-nowrap">
                    {formatDate(item.permitIssueDate)}
                  </td>
                  <td className="px-2 py-2 max-w-32">
                    <div className="text-muted">{item.interconnectionStatus ?? "—"}</div>
                    <div className="text-muted opacity-70">
                      {item.constructionStatus ?? "—"}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-muted">
                    {item.rtbBlockedReason ? (
                      <details className="group max-w-72">
                        <summary className="cursor-pointer hover:text-foreground list-none">
                          <span className="group-open:hidden line-clamp-2 whitespace-pre-wrap">
                            {item.rtbBlockedReason}
                          </span>
                          <span className="hidden group-open:inline opacity-60">▲</span>
                        </summary>
                        <div className="whitespace-pre-wrap">
                          {item.rtbBlockedReason}
                        </div>
                      </details>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-2 py-2 text-muted">
                    {item.lineItems.length === 0 ? (
                      "—"
                    ) : (
                      <ul className="space-y-0.5">
                        {item.lineItems.map((li, idx) => (
                          <li
                            key={idx}
                            className="whitespace-nowrap max-w-40 truncate"
                            title={`${li.quantity}× ${li.name}`}
                          >
                            <span className="text-foreground">{li.quantity}×</span>{" "}
                            {li.name}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <div
                      className="text-muted max-w-28 truncate"
                      title={item.paymentMethod ?? undefined}
                    >
                      {item.paymentMethod ?? "—"}
                    </div>
                    <div className="whitespace-nowrap">
                      {item.daPaid ? (
                        <span className="text-green-500" title="DA Paid In Full">
                          DA ✓
                        </span>
                      ) : (
                        <span className="text-muted" title="DA invoice status">
                          DA {item.daStatus ?? "—"}
                        </span>
                      )}
                      {item.loanStatus && (
                        <span className="text-muted" title="Loan status">
                          {" · "}
                          {item.loanStatus}
                        </span>
                      )}
                    </div>
                  </td>
                  <td
                    className="px-2 py-2 whitespace-nowrap text-foreground"
                    title={
                      item.earliestInstallDate
                        ? `Earliest open install day for ${item.location ?? "this location"}`
                        : undefined
                    }
                  >
                    {formatYmd(item.earliestInstallDate)}
                  </td>
                  <td className="px-2 py-2 text-right">
                    {tab === "ready" ? (
                      <span
                        className="text-green-500 whitespace-nowrap"
                        title={item.approved ? "Released via PM approval" : "Moved without the approval flag"}
                      >
                        {item.approved ? "Released ✓" : "—"}
                      </span>
                    ) : (
                      <button
                        onClick={() => approveDeal.mutate(item.dealId)}
                        disabled={isPending || item.approved}
                        title="Approve — Release to Build"
                        className="text-xs px-2 py-1 whitespace-nowrap bg-green-500/20 text-green-400 rounded hover:bg-green-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {item.approved
                          ? "Approved"
                          : isPending
                            ? "Approving…"
                            : "Release ✓"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </DashboardShell>
  );
}
